//! Offline scheduling benchmark. No Bluetooth manager/device/connection exists.
//! cargo run --release --example transport_benchmark -- --bytes 8754 --ack-ms 5 --mtu 247
#[allow(dead_code)]
#[path = "../src/transport.rs"]
mod transport;

use std::{future::Future, pin::Pin, sync::atomic::AtomicBool, time::Duration};
use transport::{ChunkWriter, TransferPolicy};

struct SimulatedGatt {
    ack_delay: Duration,
    write_count: usize,
}
impl ChunkWriter for SimulatedGatt {
    fn write<'a>(
        &'a mut self,
        _bytes: &'a [u8],
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>> {
        Box::pin(async move {
            self.write_count += 1;
            tokio::time::sleep(self.ack_delay).await;
            Ok(())
        })
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut bytes = 8754usize;
    let mut ack_ms = 5u64;
    let mut mtu = 247u16;
    for pair in args.chunks(2) {
        if pair.len() != 2 {
            return Err("Expected --bytes N --ack-ms N --mtu N".into());
        }
        match pair[0].as_str() {
            "--bytes" => bytes = pair[1].parse()?,
            "--ack-ms" => ack_ms = pair[1].parse()?,
            "--mtu" => mtu = pair[1].parse()?,
            _ => return Err("Unknown option".into()),
        }
    }
    if bytes == 0 || bytes > transport::MAX_TRANSFER_BYTES || ack_ms > 5000 {
        return Err("Invalid simulation bounds".into());
    }
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .start_paused(true)
        .build()?;
    runtime.block_on(async {
        let mut scenarios = Vec::new();
        for (name, policy) in [
            ("previous_20_bytes_plus_10ms", TransferPolicy::legacy_baseline()),
            ("acknowledged_unknown_mtu", TransferPolicy::for_link(true, None)),
            ("acknowledged_reported_mtu", TransferPolicy::for_link(true, Some(mtu))),
        ] {
            let mut writer = SimulatedGatt { ack_delay: Duration::from_millis(ack_ms), write_count: 0 };
            let stats = transport::transfer_bytes(&mut writer, &vec![0u8; bytes], &policy, &AtomicBool::new(false), |_, _| {}).await.unwrap();
            scenarios.push(serde_json::json!({"scenario":name,"chunkBytes":policy.chunk_size,"chunks":stats.chunks_sent,"simulatedElapsedMs":stats.elapsed_ms,"simulatedBytesPerSecond":stats.bytes_per_second,"hostRateLimitBps":policy.host_rate_limit_bps}));
        }
        println!("{}", serde_json::to_string_pretty(&serde_json::json!({"physicalPrinterAccess":false,"clock":"Tokio paused virtual time","wireBytes":bytes,"simulatedAckMs":ack_ms,"simulatedMtu":mtu,"scenarios":scenarios})).unwrap());
    });
    Ok(())
}
