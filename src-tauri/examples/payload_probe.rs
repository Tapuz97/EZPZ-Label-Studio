//! Read-only DB403 packet verification. No print, feed or configuration commands.
//! cargo run --release --example payload_probe
use btleplug::{
    api::{Central, Characteristic, Manager as _, Peripheral as _, ValueNotification, WriteType},
    platform::{Manager, Peripheral},
};
use futures_util::{Stream, StreamExt};
use std::time::Duration;
use tokio::time::{timeout, Instant};
use uuid::Uuid;

async fn inquiry(
    peripheral: &Peripheral,
    write: &Characteristic,
    events: &mut (impl Stream<Item = ValueNotification> + Unpin),
    bytes: &[u8],
) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    while matches!(
        timeout(Duration::from_millis(150), events.next()).await,
        Ok(Some(_))
    ) {}
    let started = Instant::now();
    timeout(
        Duration::from_secs(3),
        peripheral.write(write, bytes, WriteType::WithResponse),
    )
    .await??;
    let write_ms = started.elapsed().as_millis();
    let mut response = Vec::new();
    let model = timeout(Duration::from_secs(3), async {
        while let Some(event) = events.next().await {
            if event.uuid != Uuid::from_u128(0x00002af0_0000_1000_8000_00805f9b34fb) {
                continue;
            }
            response.extend_from_slice(&event.value);
            if response.len() > 128 {
                break;
            }
            if let Ok(text) = std::str::from_utf8(&response) {
                if text.trim_matches(|c| matches!(c, '\0' | '\r' | '\n' | ' ')) == "DB403" {
                    return true;
                }
            }
        }
        false
    })
    .await
    .unwrap_or(false);
    if !model {
        return Err("No fresh DB403 reply to the complete inquiry packet".into());
    }
    Ok(
        serde_json::json!({"bytes":bytes.len(),"writeMs":write_ms,"replyMs":started.elapsed().as_millis(),"model":"DB403"}),
    )
}
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manager = Manager::new().await?;
    let adapter = manager
        .adapters()
        .await?
        .into_iter()
        .next()
        .ok_or("No Bluetooth adapter")?;
    adapter.start_scan(Default::default()).await?;
    tokio::time::sleep(Duration::from_secs(4)).await;
    let mut found = Vec::new();
    for peripheral in adapter.peripherals().await? {
        if peripheral
            .properties()
            .await?
            .and_then(|p| p.local_name)
            .as_deref()
            == Some("DB403")
        {
            found.push(peripheral);
        }
    }
    adapter.stop_scan().await?;
    if found.len() != 1 {
        return Err("Expected exactly one DB403; no device contacted".into());
    }
    let peripheral = found.pop().unwrap();
    peripheral.connect().await?;
    let result = async {
        peripheral.discover_services().await?;
        let chars = peripheral.characteristics();
        let service = Uuid::from_u128(0x000018f0_0000_1000_8000_00805f9b34fb);
        let write = chars
            .iter()
            .find(|c| {
                c.service_uuid == service
                    && c.uuid == Uuid::from_u128(0x00002af1_0000_1000_8000_00805f9b34fb)
            })
            .ok_or("No verified print service")?;
        let notify = chars
            .iter()
            .find(|c| {
                c.service_uuid == service
                    && c.uuid == Uuid::from_u128(0x00002af0_0000_1000_8000_00805f9b34fb)
            })
            .ok_or("No model notification endpoint")?;
        let mut events = peripheral.notifications().await?;
        peripheral.subscribe(notify).await?;
        let checks = async {
            let baseline = inquiry(&peripheral, write, &mut events, b"~!T\n").await?;
            let mut padded = vec![b'\n'; 244];
            padded[240..].copy_from_slice(b"~!T\n");
            let verified = inquiry(&peripheral, write, &mut events, &padded).await?;
            Ok::<_, Box<dyn std::error::Error>>(
                serde_json::json!({"printDataSent":false,"baseline":baseline,"padded":verified}),
            )
        }
        .await;
        let _ = peripheral.unsubscribe(notify).await;
        checks
    }
    .await;
    let _ = peripheral.disconnect().await;
    println!("{}", serde_json::to_string_pretty(&result?)?);
    Ok(())
}
