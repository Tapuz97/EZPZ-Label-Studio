//! Explicit one-label diagnostic using the app's exact encoder and BLE transport.
//! Default validates/encodes only. Sending requires BOTH --job PATH and --print.
#[allow(dead_code)]
#[path = "../src/bluetooth.rs"]
mod bluetooth;
#[path = "../src/protocol.rs"]
mod protocol;

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
    if job.copies != 1 {
        return Err("This diagnostic accepts exactly one copy.".into());
    }
    let encoded = protocol::encode(&job)?;
    println!(
        "Validated {} x {} mm, {} x {} pixels, {} DPI, {}, {} copy; {} encoded bytes.",
        job.width_mm,
        job.height_mm,
        job.width_px,
        job.height_px,
        job.dpi,
        job.protocol,
        job.copies,
        encoded.len()
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
    let info = ble.connect(&matches[0].id).await?;
    println!(
        "Connected to {} via {} / {}",
        info.name, info.service_uuid, info.write_uuid
    );
    let result = ble
        .send(&encoded, |sent, total| {
            if sent % 1000 == 0 || sent == total {
                println!("Accepted {sent}/{total} bytes");
            }
        })
        .await;
    let disconnect = ble.disconnect().await;
    println!(
        "{}",
        serde_json::to_string_pretty(&result?).map_err(|e| e.to_string())?
    );
    disconnect?;
    println!("Disconnected. Inspect the physical label to verify the result.");
    Ok(())
}
