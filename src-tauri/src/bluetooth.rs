//! Windows BLE transport. Print encoding belongs in `protocol`, not here.
//!
//! A selected device must expose an explicitly supported GATT profile. A name
//! match alone never selects a characteristic and a successful write only means
//! the Bluetooth stack accepted bytes, not that a physical label was printed.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::AtomicBool;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[path = "capabilities.rs"]
pub mod capabilities;
pub use capabilities::{CapabilityExchange, CapabilityReport, PrinterCapabilities};
#[path = "transport.rs"]
pub mod transport;
use transport::{ChunkWriter, TransferPolicy};

use btleplug::api::{
    Central, CentralEvent, CentralState, CharPropFlags, Characteristic, Manager as _,
    Peripheral as _, ScanFilter, WriteType,
};
use btleplug::platform::{Adapter, Manager, Peripheral};
use futures_util::StreamExt;
use serde::Serialize;
use tokio::time::{timeout, Instant};
use uuid::Uuid;

const IO_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Printer {
    pub id: String,
    pub name: String,
    pub address: String,
    pub rssi: Option<i16>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInfo {
    pub id: String,
    pub name: String,
    pub service_uuid: String,
    pub write_uuid: String,
    pub notify_uuid: Option<String>,
    pub write_mode: String,
    pub max_chunk: usize,
    pub negotiated_mtu: Option<u16>,
    pub chunk_source: String,
    pub capabilities: PrinterCapabilities,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendReceipt {
    pub bytes_sent: usize,
    pub chunks_sent: usize,
    pub message: String,
    pub elapsed_ms: u64,
    pub bytes_per_second: f64,
    pub max_chunk: usize,
    pub negotiated_mtu: Option<u16>,
    pub chunk_source: String,
    pub write_mode: String,
    pub host_rate_limit_bps: Option<u32>,
    pub pacing_delay_ms: u64,
}

#[derive(Clone)]
struct Connection {
    peripheral: Peripheral,
    characteristic: Characteristic,
    write_type: WriteType,
    info: ConnectionInfo,
    capability_report: CapabilityReport,
    mtu_probe: MtuProbe,
}

#[derive(Clone, Default)]
struct MtuProbe {
    #[cfg(target_os = "windows")]
    session: Option<windows::Devices::Bluetooth::GenericAttributeProfile::GattSession>,
}

impl MtuProbe {
    fn close(&mut self) {
        #[cfg(target_os = "windows")]
        if let Some(session) = self.session.take() {
            let _ = session.Close();
        }
    }

    #[cfg(target_os = "windows")]
    async fn for_connected(peripheral: &Peripheral) -> Self {
        use std::future::IntoFuture;
        use windows::Devices::Bluetooth::{
            BluetoothLEDevice, GenericAttributeProfile::GattSession,
        };
        // Called only after the user's explicit connect and service discovery.
        // No MaintainConnection setting, discovery, read/write or MTU negotiation
        // is requested here. Windows owns ATT negotiation.
        let result = timeout(Duration::from_secs(2), async {
            let device = BluetoothLEDevice::FromBluetoothAddressAsync(peripheral.address().into())?
                .into_future()
                .await?;
            let session = GattSession::FromDeviceIdAsync(&device.BluetoothDeviceId()?)?
                .into_future()
                .await?;
            Ok::<_, windows::core::Error>(session)
        })
        .await;
        match result {
            Ok(Ok(session)) => Self {
                session: Some(session),
            },
            _ => Self::default(),
        }
    }

    #[cfg(not(target_os = "windows"))]
    async fn for_connected(_peripheral: &Peripheral) -> Self {
        Self::default()
    }

    fn current(&self) -> Option<u16> {
        #[cfg(target_os = "windows")]
        {
            transport::valid_mtu(
                self.session
                    .as_ref()
                    .and_then(|session| session.MaxPduSize().ok()),
            )
        }
        #[cfg(not(target_os = "windows"))]
        {
            None
        }
    }
}

fn chunk_source(write_type: WriteType, mtu: Option<u16>) -> String {
    if write_type == WriteType::WithoutResponse {
        "conservative-unacknowledged-baseline"
    } else if mtu.is_some() {
        "windows-gatt-session-max-pdu-size"
    } else {
        "baseline-att-mtu-fallback"
    }
    .into()
}

struct BtleChunkWriter<'a> {
    peripheral: &'a Peripheral,
    characteristic: &'a Characteristic,
    write_type: WriteType,
}

impl ChunkWriter for BtleChunkWriter<'_> {
    fn write<'a>(
        &'a mut self,
        bytes: &'a [u8],
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>> {
        Box::pin(async move {
            self.peripheral
                .write(self.characteristic, bytes, self.write_type)
                .await
                .map_err(|error| format!("Send print data: {error}"))
        })
    }
}

/// Parent owns a mutex around this state to serialize scan/connect/send.
#[derive(Default)]
pub struct Bluetooth {
    adapter: Option<Adapter>,
    discovered: HashMap<String, (Peripheral, Printer)>,
    connection: Option<Connection>,
    // Retained before the first connect await and until disconnect succeeds.
    // Dropping an in-flight command must not lose the explicitly selected target.
    // Scan results alone never populate this field.
    cleanup_target: Option<Peripheral>,
    cleanup_notification: Option<Characteristic>,
}

async fn bounded<T>(
    operation: &str,
    duration: Duration,
    future: impl Future<Output = btleplug::Result<T>>,
) -> Result<T, String> {
    timeout(duration, future)
        .await
        .map_err(|_| {
            format!("{operation} timed out. Check Bluetooth and the printer, then reconnect.")
        })?
        .map_err(|error| format!("{operation}: {error}"))
}

async fn cleanup_in_parallel(
    stop_scan: impl Future<Output = Result<(), String>>,
    disconnect: impl Future<Output = Result<(), String>>,
) -> Result<(), String> {
    let limit = Duration::from_secs(3);
    let (scan, connection) = tokio::join!(timeout(limit, stop_scan), timeout(limit, disconnect));
    let errors: Vec<_> = [
        ("Stop scan", scan),
        ("Disconnect selected printer", connection),
    ]
    .into_iter()
    .filter_map(|(operation, result)| match result {
        Ok(Ok(())) => None,
        Ok(Err(error)) => Some(format!("{operation}: {error}")),
        Err(_) => Some(format!("{operation}: shutdown timeout")),
    })
    .collect();
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

impl Bluetooth {
    async fn adapter(&mut self) -> Result<Adapter, String> {
        if let Some(adapter) = &self.adapter {
            let state =
                bounded("Read Bluetooth radio", IO_TIMEOUT, adapter.adapter_state()).await?;
            if state == CentralState::PoweredOn {
                return Ok(adapter.clone());
            }
            self.adapter = None;
        }
        let manager = bounded("Initialize Bluetooth", IO_TIMEOUT, Manager::new()).await?;
        let adapters = bounded("Find Bluetooth adapters", IO_TIMEOUT, manager.adapters()).await?;
        for adapter in adapters {
            if bounded("Read Bluetooth radio", IO_TIMEOUT, adapter.adapter_state()).await?
                == CentralState::PoweredOn
            {
                self.adapter = Some(adapter.clone());
                return Ok(adapter);
            }
        }
        Err("No enabled Bluetooth LE adapter. Turn on Bluetooth in Windows Settings.".into())
    }

    pub async fn scan(&mut self) -> Result<Vec<Printer>, String> {
        let adapter = self.adapter().await?;
        let mut events = bounded("Observe Bluetooth scan", IO_TIMEOUT, adapter.events()).await?;
        if let Err(error) = bounded(
            "Start Bluetooth scan",
            IO_TIMEOUT,
            adapter.start_scan(ScanFilter::default()),
        )
        .await
        {
            let _ = bounded("Release unsuccessful scan", IO_TIMEOUT, adapter.stop_scan()).await;
            return Err(error);
        }
        let deadline = Instant::now() + Duration::from_secs(6);
        let mut seen = HashSet::new();
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break;
            }
            match timeout(remaining, events.next()).await {
                Ok(Some(CentralEvent::DeviceDiscovered(id) | CentralEvent::DeviceUpdated(id))) => {
                    seen.insert(id.to_string());
                }
                Ok(Some(
                    CentralEvent::ManufacturerDataAdvertisement { id, .. }
                    | CentralEvent::ServiceDataAdvertisement { id, .. }
                    | CentralEvent::ServicesAdvertisement { id, .. },
                )) => {
                    seen.insert(id.to_string());
                }
                Ok(Some(_)) => {}
                Ok(None) | Err(_) => break,
            }
        }
        // Always stop this scan before inspecting results; there is no persistent
        // background watcher or concurrent scan to interfere with printing.
        bounded("Stop Bluetooth scan", IO_TIMEOUT, adapter.stop_scan()).await?;
        let peripherals =
            bounded("Read discovered devices", IO_TIMEOUT, adapter.peripherals()).await?;
        let mut discovered = HashMap::new();
        let deadline = Instant::now() + Duration::from_secs(8);
        for peripheral in peripherals
            .into_iter()
            .filter(|item| seen.contains(&item.id().to_string()))
            .take(128)
        {
            if Instant::now() >= deadline {
                break;
            }
            let properties =
                match timeout(Duration::from_millis(500), peripheral.properties()).await {
                    Ok(Ok(Some(properties))) => properties,
                    _ => continue,
                };
            let id = peripheral.id().to_string();
            let address = peripheral.address().to_string();
            let printer = Printer {
                id: id.clone(),
                name: properties
                    .local_name
                    .filter(|name| !name.trim().is_empty())
                    .unwrap_or_else(|| format!("Unnamed BLE device ({address})")),
                address,
                rssi: properties.rssi,
            };
            discovered.insert(id, (peripheral, printer));
        }
        let mut printers: Vec<_> = discovered
            .values()
            .map(|(_, printer)| printer.clone())
            .collect();
        printers.sort_by(|a, b| {
            a.name
                .to_lowercase()
                .cmp(&b.name.to_lowercase())
                .then(a.id.cmp(&b.id))
        });
        self.discovered = discovered;
        Ok(printers)
    }

    pub async fn connect(&mut self, id: &str) -> Result<ConnectionInfo, String> {
        if self
            .connection
            .as_ref()
            .is_some_and(|connection| connection.info.id == id)
        {
            if let Some(info) = self.status().await? {
                return Ok(info);
            }
        }
        let (peripheral, printer) =
            self.discovered.get(id).cloned().ok_or(
                "This device is no longer in the scan results. Scan again before connecting.",
            )?;
        self.disconnect().await?;
        self.cleanup_target = Some(peripheral.clone());
        let result = async {
            bounded(
                "Connect to printer",
                Duration::from_secs(20),
                peripheral.connect(),
            )
            .await?;
            bounded(
                "Discover printer services",
                Duration::from_secs(20),
                peripheral.discover_services(),
            )
            .await?;
            let (characteristic, notify_uuid, write_type) =
                select_profile(&peripheral.characteristics())?;
            let mut capability_report = read_gatt_capabilities(&peripheral).await;
            // Only this model/dialect has been exercised in this investigation.
            // Unknown printer families still get standard GATT information.
            if printer.name.trim().eq_ignore_ascii_case("DB403") {
                query_model(
                    &peripheral,
                    &characteristic,
                    notify_uuid,
                    write_type,
                    &mut capability_report,
                    &mut self.cleanup_notification,
                )
                .await;
            } else {
                capability_report.capabilities.notes.push(
                    "Printer-specific capability queries are not verified for this model.".into(),
                );
            }
            capability_report.capabilities.finish();
            let mtu_probe = MtuProbe::for_connected(&peripheral).await;
            let negotiated_mtu = mtu_probe.current();
            let policy =
                TransferPolicy::for_link(write_type == WriteType::WithResponse, negotiated_mtu);
            let info = ConnectionInfo {
                id: printer.id,
                name: printer.name,
                service_uuid: characteristic.service_uuid.to_string(),
                write_uuid: characteristic.uuid.to_string(),
                notify_uuid: notify_uuid.map(|uuid| uuid.to_string()),
                write_mode: match write_type {
                    WriteType::WithResponse => "with-response",
                    WriteType::WithoutResponse => "without-response",
                }
                .into(),
                max_chunk: policy.chunk_size,
                negotiated_mtu,
                chunk_source: chunk_source(write_type, negotiated_mtu),
                capabilities: capability_report.capabilities.clone(),
            };
            Ok::<_, String>(Connection {
                peripheral: peripheral.clone(),
                characteristic,
                write_type,
                info,
                capability_report,
                mtu_probe,
            })
        }
        .await;
        match result {
            Ok(connection) => {
                let info = connection.info.clone();
                self.connection = Some(connection);
                Ok(info)
            }
            Err(error) => {
                // Service discovery can fail after the radio has connected.
                if bounded(
                    "Release unsuccessful connection",
                    IO_TIMEOUT,
                    peripheral.disconnect(),
                )
                .await
                .is_ok()
                {
                    self.cleanup_target = None;
                    self.cleanup_notification = None;
                }
                Err(error)
            }
        }
    }

    pub async fn disconnect(&mut self) -> Result<(), String> {
        // A cancelled/failed connection may own a target before Connection exists.
        let peripheral = self.cleanup_target.clone().or_else(|| {
            self.connection
                .as_ref()
                .map(|connection| connection.peripheral.clone())
        });
        if let Some(peripheral) = peripheral {
            if let Err(error) =
                bounded("Disconnect printer", IO_TIMEOUT, peripheral.disconnect()).await
            {
                return Err(error);
            }
        }
        if let Some(mut connection) = self.connection.take() {
            connection.mtu_probe.close();
        }
        self.cleanup_target = None;
        self.cleanup_notification = None;
        Ok(())
    }

    /// The caller first prevents new commands and drops any in-flight operation
    /// future, then acquires the state mutex. Cleanup takes ownership before its
    /// first await, so even an outer shutdown timeout releases all local handles.
    /// Only an explicitly selected connection target is disconnected.
    pub async fn shutdown(&mut self) -> Result<(), String> {
        let adapter = self.adapter.take();
        let mut connection = self.connection.take();
        let peripheral = self.cleanup_target.take().or_else(|| {
            connection
                .as_ref()
                .map(|connection| connection.peripheral.clone())
        });
        let notification = self.cleanup_notification.take();
        self.discovered.clear();
        if let Some(connection) = connection.as_mut() {
            connection.mtu_probe.close();
        }
        drop(connection);
        cleanup_in_parallel(
            async {
                match adapter {
                    Some(adapter) => adapter.stop_scan().await.map_err(|error| error.to_string()),
                    None => Ok(()),
                }
            },
            async {
                match peripheral {
                    Some(peripheral) => {
                        // Cancellation can interrupt a model inquiry between
                        // subscribe and unsubscribe. Still disconnect if this
                        // bounded best-effort unsubscribe fails or hangs.
                        if let Some(notification) = notification {
                            let _ = timeout(
                                Duration::from_millis(500),
                                peripheral.unsubscribe(&notification),
                            )
                            .await;
                        }
                        peripheral
                            .disconnect()
                            .await
                            .map_err(|error| error.to_string())
                    }
                    None => Ok(()),
                }
            },
        )
        .await
    }

    pub async fn status(&mut self) -> Result<Option<ConnectionInfo>, String> {
        let Some(connection) = self.connection.as_ref() else {
            return Ok(None);
        };
        match bounded(
            "Check printer connection",
            Duration::from_secs(3),
            connection.peripheral.is_connected(),
        )
        .await
        {
            Ok(true) => Ok(Some(connection.info.clone())),
            Ok(false) => {
                if let Some(mut connection) = self.connection.take() {
                    connection.mtu_probe.close();
                }
                self.cleanup_target = None;
                self.cleanup_notification = None;
                Ok(None)
            }
            Err(error) => {
                let _ = self.disconnect().await;
                Err(error)
            }
        }
    }

    pub fn capability_report(&self) -> Option<CapabilityReport> {
        self.connection
            .as_ref()
            .map(|connection| connection.capability_report.clone())
    }

    pub async fn send(
        &mut self,
        bytes: &[u8],
        progress: impl Fn(usize, usize),
    ) -> Result<SendReceipt, String> {
        self.send_with_cancel(bytes, progress, &AtomicBool::new(false))
            .await
    }

    pub async fn send_with_cancel(
        &mut self,
        bytes: &[u8],
        progress: impl Fn(usize, usize),
        cancel: &AtomicBool,
    ) -> Result<SendReceipt, String> {
        if bytes.is_empty() || bytes.len() > transport::MAX_TRANSFER_BYTES {
            return Err("Print data must contain 1 to 1,048,576 bytes.".into());
        }
        if self.status().await?.is_none() {
            return Err("The printer is disconnected. Connect before printing.".into());
        }
        let connection = self.connection.as_mut().ok_or("Printer disconnected")?;
        // Refresh the read-only property per job; do not cache a guessed MTU.
        let negotiated_mtu = connection.mtu_probe.current();
        let policy = TransferPolicy::for_link(
            connection.write_type == WriteType::WithResponse,
            negotiated_mtu,
        );
        connection.info.max_chunk = policy.chunk_size;
        connection.info.negotiated_mtu = negotiated_mtu;
        connection.info.chunk_source = chunk_source(connection.write_type, negotiated_mtu);
        let mut connection = connection.clone();
        let mut writer = BtleChunkWriter {
            peripheral: &connection.peripheral,
            characteristic: &connection.characteristic,
            write_type: connection.write_type,
        };
        let result = transport::transfer_bytes(&mut writer, bytes, &policy, cancel, progress).await;
        if let Err(error) = result {
            self.connection = None;
            connection.mtu_probe.close();
            if bounded(
                "Release failed print connection",
                IO_TIMEOUT,
                connection.peripheral.disconnect(),
            )
            .await
            .is_ok()
            {
                self.cleanup_target = None;
                self.cleanup_notification = None;
            }
            let uncertainty = if error.last_write_uncertain {
                " The last write may be uncertain."
            } else {
                ""
            };
            return Err(format!("{}. Transfer stopped after {}/{} accepted bytes.{uncertainty} Check the label and power-cycle the printer before reconnecting and retrying. The job was not replayed.", error.message, error.stats.bytes_sent, bytes.len()));
        }
        let stats = result.expect("error returned above");
        Ok(SendReceipt {
            bytes_sent: stats.bytes_sent,
            chunks_sent: stats.chunks_sent,
            message: "Data sent to the printer. Physical print completion is not confirmed.".into(),
            elapsed_ms: stats.elapsed_ms,
            bytes_per_second: stats.bytes_per_second,
            max_chunk: policy.chunk_size,
            negotiated_mtu,
            chunk_source: connection.info.chunk_source,
            write_mode: connection.info.write_mode,
            host_rate_limit_bps: policy.host_rate_limit_bps,
            pacing_delay_ms: policy.minimum_gap.as_millis() as u64,
        })
    }
}

fn exchange(
    operation: &str,
    uuid: Uuid,
    direction: &str,
    bytes: &[u8],
    note: Option<String>,
) -> CapabilityExchange {
    CapabilityExchange {
        timestamp_unix_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
        operation: operation.into(),
        characteristic_uuid: uuid.to_string(),
        direction: direction.into(),
        hex: bytes
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<Vec<_>>()
            .join(" "),
        note,
    }
}

/// Read standard, non-unique Device Information fields only. Serial number
/// (2A25), system ID and other identity-bearing values are deliberately omitted.
async fn read_gatt_capabilities(peripheral: &Peripheral) -> CapabilityReport {
    let mut report = CapabilityReport {
        capabilities: PrinterCapabilities::unknown(),
        exchanges: Vec::new(),
    };
    let chars = peripheral.characteristics();
    for (id, field) in [
        (0x2a24, "gattModel"),
        (0x2a29, "gattManufacturer"),
        (0x2a26, "gattFirmwareRevision"),
        (0x2a28, "gattSoftwareRevision"),
        (0x2a27, "gattHardwareRevision"),
    ] {
        let uuid = short_uuid(id);
        let Some(characteristic) = chars.iter().find(|item| {
            item.service_uuid == short_uuid(0x180a)
                && item.uuid == uuid
                && item.properties.contains(CharPropFlags::READ)
        }) else {
            continue;
        };
        match bounded(
            "Read printer information",
            Duration::from_millis(1200),
            peripheral.read(characteristic),
        )
        .await
        {
            Ok(bytes) => {
                let text = capabilities::decode_gatt_text(&bytes);
                report
                    .exchanges
                    .push(exchange(field, uuid, "read-response", &bytes, text.clone()));
                if text.is_some() {
                    report
                        .capabilities
                        .source
                        .push(format!("GATT Device Information {field} ({uuid})"));
                    report
                        .capabilities
                        .field_sources
                        .insert(field.into(), format!("GATT Device Information ({uuid})"));
                }
                match field {
                    "gattModel" => report.capabilities.gatt_model = text,
                    "gattManufacturer" => report.capabilities.gatt_manufacturer = text,
                    "gattFirmwareRevision" => report.capabilities.gatt_firmware_revision = text,
                    "gattSoftwareRevision" => report.capabilities.gatt_software_revision = text,
                    "gattHardwareRevision" => report.capabilities.gatt_hardware_revision = text,
                    _ => {}
                }
            }
            Err(error) => {
                report
                    .exchanges
                    .push(exchange(field, uuid, "read-error", &[], Some(error)))
            }
        }
    }
    report.capabilities.finish();
    report
}

/// One nonmutating, evidenced query. A fresh notification stream and a bounded
/// quiet interval keep unsolicited data separate from the captured response.
async fn query_model(
    peripheral: &Peripheral,
    write: &Characteristic,
    notify_uuid: Option<Uuid>,
    write_type: WriteType,
    report: &mut CapabilityReport,
    cleanup_notification: &mut Option<Characteristic>,
) {
    let chars = peripheral.characteristics();
    let Some(notify) = chars.iter().find(|item| {
        Some(item.uuid) == notify_uuid
            && item.service_uuid == write.service_uuid
            && item
                .properties
                .intersects(CharPropFlags::NOTIFY | CharPropFlags::INDICATE)
    }) else {
        report
            .capabilities
            .notes
            .push("No notification endpoint is available for the model query.".into());
        return;
    };
    let result = async {
        let mut events = bounded("Listen for printer information", Duration::from_secs(2), peripheral.notifications()).await?;
        *cleanup_notification = Some(notify.clone());
        bounded("Subscribe to printer information", Duration::from_secs(2), peripheral.subscribe(notify)).await?;
        let drain_deadline = Instant::now() + Duration::from_millis(150);
        while Instant::now() < drain_deadline {
            match timeout(drain_deadline.saturating_duration_since(Instant::now()), events.next()).await {
                Ok(Some(event)) if event.uuid == notify.uuid => {
                    report.exchanges.push(exchange("model", event.uuid, "pre-query-notification", &event.value[..event.value.len().min(512)], None));
                }
                Ok(Some(_)) => {},
                _ => break,
            }
        }
        report.exchanges.push(exchange("model", write.uuid, "write-query", capabilities::MODEL_QUERY,
            Some("Reference app QUERY_DEVICE_NAME; official TSC ~!T model inquiry".into())));
        bounded("Query printer model", Duration::from_secs(3), peripheral.write(write, capabilities::MODEL_QUERY, write_type)).await?;
        let deadline = Instant::now() + Duration::from_secs(3);
        let mut response = Vec::new();
        while Instant::now() < deadline {
            let wait = if response.is_empty() { deadline.saturating_duration_since(Instant::now()) }
                else { Duration::from_millis(250).min(deadline.saturating_duration_since(Instant::now())) };
            match timeout(wait, events.next()).await {
                Ok(Some(event)) if event.uuid == notify.uuid => {
                    report.exchanges.push(exchange("model", event.uuid, "notification", &event.value[..event.value.len().min(512)], None));
                    if response.len() + event.value.len() > 512 { return Err("Model response exceeded the 512-byte limit".to_string()); }
                    response.extend_from_slice(&event.value);
                }
                Ok(Some(_)) => {},
                _ => break,
            }
        }
        if let Some(model) = capabilities::decode_model_reply(&response) {
            report.capabilities.model = Some(model);
            let source = "Printer response to reference-app/TSC model query ~!T (ASCII)".to_string();
            report.capabilities.source.push(source.clone());
            report.capabilities.field_sources.insert("model".into(), source);
        } else {
            report.capabilities.notes.push(if response.is_empty() { "The printer did not answer the model query." } else { "The model response was not recognized; its raw bytes are retained in diagnostics." }.into());
        }
        Ok::<(), String>(())
    }.await;
    if bounded(
        "Release printer information subscription",
        Duration::from_secs(2),
        peripheral.unsubscribe(notify),
    )
    .await
    .is_ok()
    {
        *cleanup_notification = None;
    }
    if let Err(error) = result {
        report.exchanges.push(exchange(
            "model",
            write.uuid,
            "query-error",
            &[],
            Some(error.clone()),
        ));
        report.capabilities.notes.push(error);
    }
}

fn short_uuid(value: u16) -> Uuid {
    Uuid::from_u128(((value as u128) << 96) | 0x0000_1000_8000_0080_5f9b_34fb)
}

/// DB403's 18F0 / 2AF1 write / 2AF0 notify was observed directly on the
/// user's printer (external archive: db403-gatt.json, 2026-11-13). It has priority when
/// a device exposes several UART compatibility services.
/// FFF0 with the FFF1/FFF2 pair occurs in the supplied reference Android app.
/// This conservative discovery route accepts a single writable endpoint in that
/// pair; ambiguous or unrelated characteristics need an explicitly added profile.
/// A service match does not establish the printer's command language.
fn select_profile(
    characteristics: &BTreeSet<Characteristic>,
) -> Result<(Characteristic, Option<Uuid>, WriteType), String> {
    // The first three endpoint pairs were read from the user's DB403. Prefer
    // 18F0; its native connect/disconnect route was also exercised successfully.
    let profiles = [
        (short_uuid(0x18f0), short_uuid(0x2af1), short_uuid(0x2af0)),
        (
            Uuid::from_u128(0x49535343_fe7d_4ae5_8fa9_9fafd205e455),
            Uuid::from_u128(0x49535343_8841_43f4_a8d4_ecbe34729bb3),
            Uuid::from_u128(0x49535343_1e4d_4bd9_ba61_23c647249616),
        ),
        (
            Uuid::from_u128(0xe7810a71_73ae_499d_8c15_faa9aef0c3f2),
            Uuid::from_u128(0xbef8d6c9_9c21_4c9e_b632_bd58c1009f9f),
            Uuid::from_u128(0xbef8d6c9_9c21_4c9e_b632_bd58c1009f9f),
        ),
    ];
    for (service, write_uuid, notify_uuid) in profiles {
        if let Some(write) = characteristics.iter().find(|item| {
            item.service_uuid == service
                && item.uuid == write_uuid
                && item
                    .properties
                    .intersects(CharPropFlags::WRITE | CharPropFlags::WRITE_WITHOUT_RESPONSE)
        }) {
            let notify = characteristics
                .iter()
                .find(|item| {
                    item.service_uuid == service
                        && item.uuid == notify_uuid
                        && item
                            .properties
                            .intersects(CharPropFlags::NOTIFY | CharPropFlags::INDICATE)
                })
                .map(|item| item.uuid);
            return Ok((write.clone(), notify, write_mode(write)));
        }
    }
    let service = short_uuid(0xfff0);
    let pair = [short_uuid(0xfff1), short_uuid(0xfff2)];
    let writable: Vec<_> = characteristics
        .iter()
        .filter(|characteristic| {
            characteristic.service_uuid == service
                && pair.contains(&characteristic.uuid)
                && characteristic
                    .properties
                    .intersects(CharPropFlags::WRITE | CharPropFlags::WRITE_WITHOUT_RESPONSE)
        })
        .collect();
    if writable.len() != 1 {
        return Err(if writable.is_empty() {
            "This device does not expose a supported Bluetooth print profile. No print data was sent. Save its GATT details to add a verified profile."
        } else {
            "This device has multiple possible print endpoints. A verified model-specific profile is needed; no print data was sent."
        }.into());
    }
    let characteristic = writable[0].clone();
    let notify_uuid = characteristics
        .iter()
        .find(|item| {
            item.service_uuid == service
                && pair.contains(&item.uuid)
                && item
                    .properties
                    .intersects(CharPropFlags::NOTIFY | CharPropFlags::INDICATE)
        })
        .map(|item| item.uuid);
    let write_type = write_mode(&characteristic);
    Ok((characteristic, notify_uuid, write_type))
}

fn write_mode(characteristic: &Characteristic) -> WriteType {
    if characteristic.properties.contains(CharPropFlags::WRITE) {
        WriteType::WithResponse
    } else {
        WriteType::WithoutResponse
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn shutdown_without_radio_is_idempotent() {
        let mut bluetooth = Bluetooth::default();
        bluetooth.shutdown().await.unwrap();
        bluetooth.shutdown().await.unwrap();
        assert!(bluetooth.adapter.is_none());
        assert!(bluetooth.connection.is_none());
        assert!(bluetooth.cleanup_target.is_none());
        assert!(bluetooth.cleanup_notification.is_none());
        assert!(bluetooth.discovered.is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn shutdown_attempts_disconnect_even_if_scan_cleanup_fails() {
        let disconnected = AtomicBool::new(false);
        let result = cleanup_in_parallel(async { Err("radio unavailable".into()) }, async {
            disconnected.store(true, std::sync::atomic::Ordering::SeqCst);
            Ok(())
        })
        .await;
        assert!(disconnected.load(std::sync::atomic::Ordering::SeqCst));
        assert!(result.unwrap_err().contains("radio unavailable"));
    }

    #[tokio::test(start_paused = true)]
    async fn shutdown_bounds_both_hung_operations_in_parallel() {
        let started = Instant::now();
        let result = cleanup_in_parallel(
            std::future::pending::<Result<(), String>>(),
            std::future::pending::<Result<(), String>>(),
        )
        .await
        .unwrap_err();
        assert_eq!(started.elapsed(), Duration::from_secs(3));
        assert!(result.contains("Stop scan: shutdown timeout"));
        assert!(result.contains("Disconnect selected printer: shutdown timeout"));
    }

    fn characteristic(service: u16, endpoint: u16, properties: CharPropFlags) -> Characteristic {
        Characteristic {
            uuid: short_uuid(endpoint),
            service_uuid: short_uuid(service),
            properties,
            descriptors: BTreeSet::new(),
        }
    }

    #[test]
    fn uuid_encoding_matches_bluetooth_base() {
        assert_eq!(
            short_uuid(0xfff0).to_string(),
            "0000fff0-0000-1000-8000-00805f9b34fb"
        );
    }

    #[test]
    fn selects_single_writable_endpoint_and_preserves_notify_endpoint() {
        let chars = BTreeSet::from([
            characteristic(0xfff0, 0xfff1, CharPropFlags::NOTIFY),
            characteristic(0xfff0, 0xfff2, CharPropFlags::WRITE_WITHOUT_RESPONSE),
        ]);
        let (write, notify, mode) = select_profile(&chars).unwrap();
        assert_eq!(write.uuid, short_uuid(0xfff2));
        assert_eq!(notify, Some(short_uuid(0xfff1)));
        assert_eq!(mode, WriteType::WithoutResponse);
    }

    #[test]
    fn refuses_unrelated_writable_characteristics() {
        let chars = BTreeSet::from([characteristic(0x180f, 0xfff2, CharPropFlags::WRITE)]);
        assert!(select_profile(&chars).is_err());
    }

    #[test]
    fn refuses_ambiguous_write_endpoints() {
        let chars = BTreeSet::from([
            characteristic(0xfff0, 0xfff1, CharPropFlags::WRITE),
            characteristic(0xfff0, 0xfff2, CharPropFlags::WRITE),
        ]);
        assert!(select_profile(&chars).is_err());
    }

    #[test]
    fn prefers_acknowledged_write_when_supported() {
        let chars = BTreeSet::from([characteristic(
            0xfff0,
            0xfff2,
            CharPropFlags::WRITE | CharPropFlags::WRITE_WITHOUT_RESPONSE,
        )]);
        assert_eq!(select_profile(&chars).unwrap().2, WriteType::WithResponse);
    }

    #[test]
    fn selects_db403_observed_profile() {
        let chars = BTreeSet::from([
            characteristic(0x18f0, 0x2af0, CharPropFlags::NOTIFY),
            characteristic(
                0x18f0,
                0x2af1,
                CharPropFlags::WRITE | CharPropFlags::WRITE_WITHOUT_RESPONSE,
            ),
        ]);
        let (write, notify, mode) = select_profile(&chars).unwrap();
        assert_eq!(write.uuid, short_uuid(0x2af1));
        assert_eq!(notify, Some(short_uuid(0x2af0)));
        assert_eq!(mode, WriteType::WithResponse);
    }

    #[test]
    fn accepts_live_observed_fallback_and_prefers_18f0_when_both_exist() {
        let fallback = Characteristic {
            uuid: Uuid::from_u128(0x49535343_8841_43f4_a8d4_ecbe34729bb3),
            service_uuid: Uuid::from_u128(0x49535343_fe7d_4ae5_8fa9_9fafd205e455),
            properties: CharPropFlags::WRITE,
            descriptors: BTreeSet::new(),
        };
        let mut chars = BTreeSet::from([fallback.clone()]);
        assert_eq!(select_profile(&chars).unwrap().0.uuid, fallback.uuid);
        chars.insert(characteristic(0x18f0, 0x2af1, CharPropFlags::WRITE));
        assert_eq!(select_profile(&chars).unwrap().0.uuid, short_uuid(0x2af1));
    }

    #[test]
    fn accepts_live_observed_shared_read_write_notify_endpoint() {
        let endpoint = Characteristic {
            uuid: Uuid::from_u128(0xbef8d6c9_9c21_4c9e_b632_bd58c1009f9f),
            service_uuid: Uuid::from_u128(0xe7810a71_73ae_499d_8c15_faa9aef0c3f2),
            properties: CharPropFlags::WRITE | CharPropFlags::NOTIFY,
            descriptors: BTreeSet::new(),
        };
        let chars = BTreeSet::from([endpoint.clone()]);
        let (write, notify, _) = select_profile(&chars).unwrap();
        assert_eq!(write.uuid, endpoint.uuid);
        assert_eq!(notify, Some(endpoint.uuid));
    }
}
