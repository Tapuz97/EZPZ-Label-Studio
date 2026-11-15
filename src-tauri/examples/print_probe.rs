//! Explicit one-label diagnostic using the app's exact encoder and BLE transport.
//! Default validates/encodes only. Sending requires BOTH --job PATH and --print.
use ble_label_studio_lib::{bluetooth, niimbot_protocol, protocol};
use std::sync::atomic::AtomicBool;

enum PreparedJob {
    Stream(Vec<u8>),
    Niimbot(protocol::RasterPrintJob),
}

/// Finish all raster validation before constructing or touching a radio.
fn prepare_job(job: &protocol::PrintJob) -> Result<PreparedJob, String> {
    if job.copies != 1 {
        return Err("This diagnostic accepts exactly one copy.".into());
    }
    job.validate()?;
    if job.protocol != "niimbot" {
        return protocol::encode(job).map(PreparedJob::Stream);
    }
    let packed = protocol::RasterPrintJob {
        width_mm: job.width_mm,
        height_mm: job.height_mm,
        gap_mm: job.gap_mm,
        dpi: job.dpi,
        copies: job.copies,
        density: job.density,
        raster: protocol::monochrome(job),
        width_px: job.width_px,
        height_px: job.height_px,
        threshold: job.threshold,
        protocol: job.protocol.clone(),
    };
    niimbot_protocol::prepare(&packed)?;
    Ok(PreparedJob::Niimbot(packed))
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), String> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let mut target = "DB403".to_string();
    let mut job_path = None;
    let mut print = false;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--print" => print = true,
            "--job" | "--target" => {
                let value = args.get(index + 1).ok_or("Missing option value")?.clone();
                if args[index] == "--job" {
                    job_path = Some(value);
                } else {
                    target = value;
                }
                index += 1;
            }
            _ => return Err("Usage: print_probe --job PATH [--target DB403] [--print]".into()),
        }
        index += 1;
    }
    let path = job_path.ok_or("Usage: print_probe --job PATH [--target DB403] [--print]. Without --print no printer is contacted.")?;
    let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if metadata.len() > 32 * 1024 * 1024 {
        return Err("Print-job JSON exceeds 32 MB".into());
    }
    let data = std::fs::read(&path).map_err(|e| e.to_string())?;
    let job: protocol::PrintJob = serde_json::from_slice(&data).map_err(|e| e.to_string())?;
    let prepared = prepare_job(&job)?;
    let preparation = match &prepared {
        PreparedJob::Stream(bytes) => format!("{} encoded bytes", bytes.len()),
        PreparedJob::Niimbot(packed) => {
            let raster = niimbot_protocol::prepare(packed)?;
            format!(
                "NIIMBOT {} × {} dot raster, {} row packets; a verified D110 session is required",
                raster.width,
                raster.height,
                raster.rows.len()
            )
        }
    };
    println!(
        "Validated {} x {} mm, {} x {} pixels, {} DPI, {}, {} copy; {}.",
        job.width_mm,
        job.height_mm,
        job.width_px,
        job.height_px,
        job.dpi,
        job.protocol,
        job.copies,
        preparation
    );
    if !print {
        println!("Validation only. No Bluetooth connection or print data sent. Add --print to send exactly this job.");
        return Ok(());
    }
    let mut ble = bluetooth::Bluetooth::default();
    let devices = ble.scan().await?;
    let matches: Vec<_> = devices
        .iter()
        .filter(|item| item.name == target || item.id == target)
        .collect();
    if matches.len() != 1 {
        return Err(format!(
            "Expected one {target} in the current scan; found {}. Nothing sent.",
            matches.len()
        ));
    }
    let result = async {
        let info = ble.connect(&matches[0].id).await?;
        println!(
            "Connected to {} via {} / {}",
            info.name, info.service_uuid, info.write_uuid
        );
        ble.validate_job_protocol(&job.protocol)?;
        match &prepared {
            PreparedJob::Niimbot(packed) => {
                ble.print_niimbot(
                    packed,
                    |sent, total| {
                        println!("NIIMBOT job progress {sent}/{total}");
                    },
                    &AtomicBool::new(false),
                )
                .await
            }
            PreparedJob::Stream(encoded) => {
                info.capabilities.validate_raster(job.width_px, job.dpi)?;
                ble.send(encoded, |sent, total| {
                    if sent % 1000 == 0 || sent == total {
                        println!("Accepted {sent}/{total} bytes");
                    }
                })
                .await
            }
        }
    }
    .await;
    // Run cleanup on every post-connect error, including format mismatch.
    let disconnect = ble.shutdown().await;
    println!(
        "{}",
        serde_json::to_string_pretty(&result?).map_err(|e| e.to_string())?
    );
    disconnect?;
    println!("Disconnected. Inspect the physical label to verify the result.");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn job() -> protocol::PrintJob {
        protocol::PrintJob {
            width_mm: 15.,
            height_mm: 30.,
            gap_mm: 2.,
            dpi: 203,
            copies: 1,
            density: 2,
            rgba: vec![255; 120 * 240 * 4],
            width_px: 120,
            height_px: 240,
            threshold: 160,
            protocol: "niimbot".into(),
        }
    }
    #[test]
    fn niimbot_preflight_uses_session_raster_and_rejects_multiple_copies() {
        let mut input = job();
        assert!(matches!(
            prepare_job(&input).unwrap(),
            PreparedJob::Niimbot(_)
        ));
        input.copies = 2;
        assert!(prepare_job(&input).is_err());
    }
    #[test]
    fn niimbot_preflight_rejects_black_unprintable_margins() {
        let mut input = job();
        input.rgba[..3].fill(0);
        assert!(prepare_job(&input).is_err());
    }
}
