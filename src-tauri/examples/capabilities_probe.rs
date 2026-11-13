//! Printer capability inventory using the exact app transport. Never prints.
#[allow(dead_code)]
#[path = "../src/bluetooth.rs"]
mod bluetooth;

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
    let mut output = None;
    let mut index = 0;
    while index < args.len() {
        let value = args
            .get(index + 1)
            .ok_or("Usage: capabilities_probe [--target DB403] [--output PATH]")?
            .clone();
        match args[index].as_str() {
            "--target" => target = value,
            "--output" => output = Some(value),
            _ => return Err("Usage: capabilities_probe [--target DB403] [--output PATH]".into()),
        }
        index += 2;
    }
    let mut ble = bluetooth::Bluetooth::default();
    let devices = ble.scan().await?;
    let matches: Vec<_> = devices
        .iter()
        .filter(|item| item.name == target || item.id == target)
        .collect();
    if matches.len() != 1 {
        return Err(format!(
            "Expected one {target} in the current scan; found {}. No device contacted.",
            matches.len()
        ));
    }
    let info = ble.connect(&matches[0].id).await?;
    let report = ble.capability_report().ok_or("No capability report")?;
    ble.disconnect().await?;
    let result = serde_json::json!({"connection":info,"report":report,"printDataSent":false,"disconnected":true});
    let json = serde_json::to_string_pretty(&result).map_err(|e| e.to_string())?;
    if let Some(path) = output {
        std::fs::write(&path, &json).map_err(|e| e.to_string())?;
    }
    println!("{json}");
    Ok(())
}
