//! Read-only native scan / connection smoke test. No print commands are sent.
//! cargo run --example ble_probe -- --connect DB403
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
    let mut ble = bluetooth::Bluetooth::default();
    let devices = ble.scan().await?;
    println!(
        "{}",
        serde_json::to_string_pretty(&devices).map_err(|e| e.to_string())?
    );
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        return Ok(());
    }
    if args.len() != 2 || args[0] != "--connect" {
        return Err("Usage: ble_probe [--connect exact-name-or-id]".into());
    }
    let matches: Vec<_> = devices
        .iter()
        .filter(|item| item.name == args[1] || item.id == args[1])
        .collect();
    if matches.len() != 1 {
        return Err("Expected exactly one matching device in the current scan.".into());
    }
    let info = ble.connect(&matches[0].id).await?;
    println!(
        "Connected: {}",
        serde_json::to_string_pretty(&info).map_err(|e| e.to_string())?
    );
    println!(
        "Status: {}",
        serde_json::to_string(&ble.status().await?).map_err(|e| e.to_string())?
    );
    ble.disconnect().await?;
    println!("Disconnected. No print data was sent.");
    Ok(())
}
