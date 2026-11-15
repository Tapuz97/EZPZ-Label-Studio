//! Investigative, read-only D110 identity probe. Not production printer support.
//! Requires: --connect-read-only <exact D110 Bluetooth name> [--media-info | --session-info]
//! Default sends only model inquiry. Optional media-info adds read-only head,
//! DPI and RFID inquiries. Session-info captures connect/status/model/heartbeat/
//! RFID replies without interpreting success. Never configures, feeds or prints.
use btleplug::api::{
    Central, CharPropFlags, Characteristic, Manager as _, Peripheral as _, ScanFilter, WriteType,
};
use btleplug::platform::{Adapter, Manager, Peripheral};
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::{
    future::Future,
    time::{Duration, Instant},
};
use uuid::Uuid;

const SERVICE: &str = "e7810a71-73ae-499d-8c15-faa9aef0c3f2";
const ENDPOINT: &str = "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f";
const QUERY: [u8; 8] = [0x55, 0x55, 0x40, 0x01, 0x08, 0x49, 0xaa, 0xaa];

#[derive(Default)]
struct Cleanup {
    adapter: Option<Adapter>,
    peripheral: Option<Peripheral>,
    notification: Option<Characteristic>,
}

async fn bounded<T, E: std::fmt::Display>(
    label: &str,
    seconds: u64,
    future: impl Future<Output = Result<T, E>>,
) -> Result<T, String> {
    tokio::time::timeout(Duration::from_secs(seconds), future)
        .await
        .map_err(|_| format!("{label} timed out"))?
        .map_err(|error| format!("{label}: {error}"))
}

fn hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}

// Frame: 55 55 command length payload XOR(command,length,payload) AA AA.
// Preserve every raw notification separately; malformed input is never acted upon.
fn parse_frames(buffer: &mut Vec<u8>, frames: &mut Vec<Value>, rejected: &mut usize) {
    while buffer.len() >= 2 {
        if buffer[..2] != [0x55, 0x55] {
            buffer.remove(0);
            *rejected += 1;
            continue;
        }
        if buffer.len() < 4 {
            break;
        }
        let length = buffer[3] as usize;
        let total = length + 7;
        if buffer.len() < total {
            break;
        }
        let checksum = buffer[2..4 + length].iter().fold(0, |sum, byte| sum ^ byte);
        if buffer[4 + length] != checksum || buffer[5 + length..total] != [0xaa, 0xaa] {
            buffer.remove(0);
            *rejected += 1;
            continue;
        }
        frames.push(json!({"command": buffer[2], "payload": &buffer[4..4 + length], "rawHex": hex(&buffer[..total]), "checksumValid": true}));
        buffer.drain(..total);
    }
}

async fn probe(
    target: &str,
    media_info: bool,
    session_info: bool,
    cleanup: &mut Cleanup,
    report: &mut Value,
) -> Result<(), String> {
    let manager = bounded("create manager", 5, Manager::new()).await?;
    let adapters = bounded("enumerate adapters", 5, manager.adapters()).await?;
    let adapter = adapters.into_iter().next().ok_or("No Bluetooth adapter")?;
    cleanup.adapter = Some(adapter.clone());
    bounded("start scan", 3, adapter.start_scan(ScanFilter::default())).await?;
    tokio::time::sleep(Duration::from_secs(6)).await;
    bounded("stop scan", 3, adapter.stop_scan()).await?;
    let peripherals = bounded("enumerate peripherals", 3, adapter.peripherals()).await?;
    let mut matches = Vec::new();
    for peripheral in peripherals {
        let properties = bounded("read advertisement", 2, peripheral.properties()).await?;
        if properties.as_ref().and_then(|p| p.local_name.as_deref()) == Some(target) {
            matches.push(peripheral);
        }
    }
    report["matchingAdvertisements"] = json!(matches.len());
    if matches.len() != 1 {
        return Err("Expected exactly one advertisement matching the authorized name".into());
    }
    let peripheral = matches.remove(0);
    cleanup.peripheral = Some(peripheral.clone()); // Retain before connect, including timeout/failure.
    report["deviceId"] = json!(peripheral.id().to_string());
    bounded("connect", 8, peripheral.connect()).await?;
    bounded("discover services", 6, peripheral.discover_services()).await?;
    report["services"] = json!(peripheral
        .services()
        .iter()
        .map(|service| service.uuid.to_string())
        .collect::<Vec<_>>());
    let characteristics = peripheral.characteristics();
    report["gatt"] = json!(characteristics.iter().map(|c| json!({
        "serviceUuid": c.service_uuid.to_string(), "uuid": c.uuid.to_string(), "properties": format!("{:?}", c.properties)
    })).collect::<Vec<_>>());
    let service_uuid = Uuid::parse_str(SERVICE).map_err(|e| e.to_string())?;
    let endpoint_uuid = Uuid::parse_str(ENDPOINT).map_err(|e| e.to_string())?;
    let candidates = characteristics
        .iter()
        .filter(|c| c.service_uuid == service_uuid && c.uuid == endpoint_uuid)
        .cloned()
        .collect::<Vec<_>>();
    if candidates.len() != 1 {
        return Err("Expected exactly one known NIIMBOT endpoint; refusing fallback writes".into());
    }
    let endpoint = candidates[0].clone();
    if !endpoint
        .properties
        .intersects(CharPropFlags::NOTIFY | CharPropFlags::INDICATE)
    {
        return Err("Known endpoint has no notification/indication support; no query sent".into());
    }
    let mode = if endpoint.properties.contains(CharPropFlags::WRITE) {
        WriteType::WithResponse
    } else if endpoint
        .properties
        .contains(CharPropFlags::WRITE_WITHOUT_RESPONSE)
    {
        WriteType::WithoutResponse
    } else {
        return Err("Known endpoint is not writable; no query sent".into());
    };
    let mut notifications = bounded("open notifications", 3, peripheral.notifications()).await?;
    cleanup.notification = Some(endpoint.clone()); // Also clean up a subscription that times out.
    bounded("subscribe", 3, peripheral.subscribe(&endpoint)).await?;
    report["subscribed"] = json!(true);
    report["writeMode"] = json!(format!("{mode:?}"));
    let started = Instant::now();
    let mut raw = Vec::new();
    let mut frames = Vec::new();
    let mut buffer = Vec::new();
    let mut rejected = 0;
    let mut received_bytes = 0;
    let mut queries = if session_info {
        vec![
            (
                "connect-session",
                vec![3, 0x55, 0x55, 0xc1, 1, 1, 0xc1, 0xaa, 0xaa],
            ),
            (
                "status-data",
                vec![0x55, 0x55, 0xa5, 1, 1, 0xa5, 0xaa, 0xaa],
            ),
            ("model", QUERY.to_vec()),
            ("heartbeat", vec![0x55, 0x55, 0xdc, 1, 4, 0xd9, 0xaa, 0xaa]),
            ("rfid", vec![0x55, 0x55, 0x1a, 1, 1, 0x1a, 0xaa, 0xaa]),
        ]
    } else {
        vec![("model", QUERY.to_vec())]
    };
    if media_info {
        queries.extend([
            ("head-width", vec![0x55, 0x55, 0x40, 1, 4, 0x45, 0xaa, 0xaa]),
            ("dpi", vec![0x55, 0x55, 0x40, 1, 5, 0x44, 0xaa, 0xaa]),
            ("rfid", vec![0x55, 0x55, 0x1a, 1, 1, 0x1a, 0xaa, 0xaa]),
        ]);
    }
    report["queries"] = json!([]);
    for (query_index, (name, query)) in queries.into_iter().enumerate() {
        let query_record = json!({"name": name, "queryHex": hex(&query), "attempted": true, "writeAccepted": false, "notifications": [], "frames": []});
        report["queries"].as_array_mut().unwrap().push(query_record);
        report["queryAttempted"] = json!(true);
        bounded(
            "read-only inquiry write",
            3,
            peripheral.write(&endpoint, &query, mode),
        )
        .await?;
        report["queries"][query_index]["writeAccepted"] = json!(true);
        if query_index == 0 {
            report["queryWriteAccepted"] = json!(true);
        }
        let deadline = tokio::time::Instant::now() + Duration::from_millis(1500);
        let first_frame = frames.len();
        loop {
            match tokio::time::timeout_at(deadline, notifications.next()).await {
                Ok(Some(note)) => {
                    received_bytes += note.value.len();
                    let retained = note
                        .value
                        .len()
                        .min(65536usize.saturating_sub(received_bytes - note.value.len()));
                    let raw_note = json!({"query": name, "elapsedMs": started.elapsed().as_millis(), "uuid": note.uuid.to_string(), "rawHex": hex(&note.value[..retained]), "originalLength": note.value.len(), "truncated": retained != note.value.len()});
                    raw.push(raw_note.clone());
                    report["queries"][query_index]["notifications"]
                        .as_array_mut()
                        .unwrap()
                        .push(raw_note);
                    report["notifications"] = json!(raw);
                    if received_bytes > 65536 || raw.len() >= 128 {
                        report["captureLimitReached"] = json!(true);
                        return Err(
                            "Notification capture limit reached; no further inquiries sent".into(),
                        );
                    }
                    if note.uuid == endpoint_uuid {
                        buffer.extend_from_slice(&note.value);
                        parse_frames(&mut buffer, &mut frames, &mut rejected);
                        report["frames"] = json!(frames);
                        report["queries"][query_index]["frames"] = json!(&frames[first_frame..]);
                        report["discardedParserBytes"] = json!(rejected);
                        report["trailingUnparsedHex"] = json!(hex(&buffer));
                    }
                }
                Ok(None) => {
                    report["notificationStreamEnded"] = json!(true);
                    return Err("Notification stream ended; no further inquiries sent".into());
                }
                Err(_) => break,
            }
        }
        report["queries"][query_index]["captureFinished"] = json!(true);
    }
    report["notifications"] = json!(raw);
    report["frames"] = json!(frames);
    report["discardedParserBytes"] = json!(rejected);
    report["trailingUnparsedHex"] = json!(hex(&buffer));
    report["responseCaptureFinished"] = json!(true);
    Ok(())
}

async fn cleanup(state: Cleanup) -> Value {
    let mut result = json!({});
    if let Some(adapter) = state.adapter {
        result["stopScan"] = json!(bounded("cleanup stop scan", 3, adapter.stop_scan())
            .await
            .map(|_| "ok".to_string())
            .unwrap_or_else(|e| e));
    }
    if let Some(peripheral) = state.peripheral {
        if let Some(notification) = state.notification {
            result["unsubscribe"] = json!(bounded(
                "cleanup unsubscribe",
                3,
                peripheral.unsubscribe(&notification)
            )
            .await
            .map(|_| "ok".to_string())
            .unwrap_or_else(|e| e));
        }
        result["disconnect"] = json!(bounded("cleanup disconnect", 5, peripheral.disconnect())
            .await
            .map(|_| "ok".to_string())
            .unwrap_or_else(|e| e));
        result["connectedAfterCleanup"] =
            match bounded("verify disconnect", 2, peripheral.is_connected()).await {
                Ok(connected) => json!(connected),
                Err(error) => json!({"unknown": error}),
            };
    }
    result
}

#[tokio::main]
async fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let mut report = json!({"tool": "read-only NIIMBOT identity investigation",
        "queryHex": hex(&QUERY), "queryAttempted": false, "queryWriteAccepted": false,
        "printCommandsSent": false, "protocolSupportEstablished": false});
    if !(args.len() == 2
        || (args.len() == 3 && ["--media-info", "--session-info"].contains(&args[2].as_str())))
        || args[0] != "--connect-read-only"
        || !args[1].starts_with("D110-")
        || args[1].len() <= 5
        || args[1].contains(['*', '?'])
        || args[1].trim() != args[1]
    {
        report["error"] = json!("No radio activity. Usage: niimbot_probe --connect-read-only <exact D110 Bluetooth name> [--media-info | --session-info]; D110- prefix and nonempty suffix required, no wildcards.");
        println!("{}", serde_json::to_string_pretty(&report).unwrap());
        std::process::exit(2);
    }
    let target = &args[1];
    report["target"] = json!(target);
    let media_info = args.get(2).map(String::as_str) == Some("--media-info");
    let session_info = args.get(2).map(String::as_str) == Some("--session-info");
    report["mediaInfoRequested"] = json!(media_info);
    report["sessionInfoRequested"] = json!(session_info);
    let mut state = Cleanup::default();
    let result = tokio::time::timeout(
        Duration::from_secs(45),
        probe(target, media_info, session_info, &mut state, &mut report),
    )
    .await;
    let error = match result {
        Ok(Ok(())) => None,
        Ok(Err(error)) => Some(error),
        Err(_) => Some("Overall probe deadline reached".into()),
    };
    if let Some(error) = &error {
        report["error"] = json!(error);
    }
    report["cleanup"] = cleanup(state).await;
    println!("{}", serde_json::to_string_pretty(&report).unwrap());
    if error.is_some() {
        std::process::exit(1);
    }
}
