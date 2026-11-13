pub mod bluetooth;
pub mod protocol;
mod shutdown;
mod template_store;

use bluetooth::{
    Bluetooth, CapabilityReport, ConnectionInfo, Printer, PrinterCapabilities, SendReceipt,
};
use protocol::{PrintJob, RasterPrintJob};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::{Emitter, Manager, State};
use tokio::sync::Mutex;

#[derive(Default)]
struct AppState {
    bluetooth: Mutex<Bluetooth>,
    busy: AtomicBool,
    cancelled: AtomicBool,
    connection: Mutex<Option<ConnectionInfo>>,
    shutdown: shutdown::Shutdown,
    close_guard_ready: AtomicBool,
    close_requests: CloseRequests,
}

#[derive(Default)]
struct CloseRequests {
    sequence: AtomicU64,
    pending: AtomicU64,
}
impl CloseRequests {
    fn begin(&self) -> u64 {
        let id = self.sequence.fetch_add(1, Ordering::SeqCst) + 1;
        self.pending.store(id, Ordering::SeqCst);
        id
    }
    fn take(&self, id: u64) -> bool {
        id != 0
            && self
                .pending
                .compare_exchange(id, 0, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
    }
}

// Drops on all return/error paths, including task cancellation.
struct BusyGuard<'a>(&'a AtomicBool);
impl Drop for BusyGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
fn begin(state: &AppState) -> Result<BusyGuard<'_>, String> {
    if state.shutdown.is_requested() {
        return Err("The application is closing.".into());
    }
    state
        .busy
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map_err(|_| "Another printer operation is in progress.".to_string())?;
    Ok(BusyGuard(&state.busy))
}

#[tauri::command]
async fn scan_printers(state: State<'_, AppState>) -> Result<Vec<Printer>, String> {
    state
        .shutdown
        .while_running(async {
            let _busy = begin(&state)?;
            state.bluetooth.lock().await.scan().await
        })
        .await
}

#[tauri::command]
async fn connect_printer(id: String, state: State<'_, AppState>) -> Result<ConnectionInfo, String> {
    state
        .shutdown
        .while_running(async {
            let _busy = begin(&state)?;
            *state.connection.lock().await = None;
            let result = state.bluetooth.lock().await.connect(&id).await?;
            *state.connection.lock().await = Some(result.clone());
            Ok(result)
        })
        .await
}

#[tauri::command]
async fn disconnect_printer(state: State<'_, AppState>) -> Result<(), String> {
    state
        .shutdown
        .while_running(async {
            let _busy = begin(&state)?;
            let result = state.bluetooth.lock().await.disconnect().await;
            *state.connection.lock().await = None;
            result
        })
        .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PrinterStatus {
    connected: bool,
    name: Option<String>,
    busy: bool,
    capabilities: Option<PrinterCapabilities>,
}

#[tauri::command]
async fn printer_status(state: State<'_, AppState>) -> Result<PrinterStatus, String> {
    state
        .shutdown
        .while_running(async {
            let busy = state.busy.load(Ordering::SeqCst);
            if !busy {
                if let Ok(mut bluetooth) = state.bluetooth.try_lock() {
                    match bluetooth.status().await {
                        Ok(current) => *state.connection.lock().await = current,
                        Err(error) => {
                            *state.connection.lock().await = None;
                            return Err(error);
                        }
                    }
                }
            }
            let connection = state.connection.lock().await;
            Ok(PrinterStatus {
                connected: connection.is_some(),
                name: connection.as_ref().map(|c| c.name.clone()),
                busy,
                capabilities: connection
                    .as_ref()
                    .map(|connection| connection.capabilities.clone()),
            })
        })
        .await
}

#[tauri::command]
async fn printer_diagnostics(
    state: State<'_, AppState>,
) -> Result<Option<CapabilityReport>, String> {
    state
        .shutdown
        .while_running(async {
            let _busy = begin(&state)?;
            Ok(state.bluetooth.lock().await.capability_report())
        })
        .await
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PrintProgress {
    sent: usize,
    total: usize,
    elapsed_ms: u128,
    bytes_per_second: f64,
}

#[tauri::command]
async fn print_label(
    job: PrintJob,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<SendReceipt, String> {
    submit_print(PrintInput::Rgba(job), state, app).await
}

#[tauri::command]
async fn print_raster(
    job: RasterPrintJob,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<SendReceipt, String> {
    submit_print(PrintInput::Packed(job), state, app).await
}
enum PrintInput {
    Rgba(PrintJob),
    Packed(RasterPrintJob),
}
async fn submit_print(
    input: PrintInput,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<SendReceipt, String> {
    state
        .shutdown
        .while_running(async {
            let _busy = begin(&state)?;
            state.cancelled.store(false, Ordering::SeqCst);
            if state.shutdown.is_requested() {
                state.cancelled.store(true, Ordering::SeqCst);
                return Err("The application is closing.".into());
            }
            let (encoded, width_px, dpi) = match input {
                PrintInput::Rgba(job) => (protocol::encode(&job)?, job.width_px, job.dpi),
                PrintInput::Packed(job) => (protocol::encode_raster(&job)?, job.width_px, job.dpi),
            };
            let mut bluetooth = state.bluetooth.lock().await;
            if let Some(report) = bluetooth.capability_report() {
                report.capabilities.validate_raster(width_px, dpi)?;
            }
            let transfer_started = std::time::Instant::now();
            let result = bluetooth
                .send_with_cancel(
                    &encoded,
                    |sent, total| {
                        // The transport already limits notification frequency by time.
                        let elapsed = transfer_started.elapsed();
                        let bytes_per_second = if elapsed.as_secs_f64() > 0.0 {
                            sent as f64 / elapsed.as_secs_f64()
                        } else {
                            0.0
                        };
                        let _ = app.emit(
                            "print-progress",
                            PrintProgress {
                                sent,
                                total,
                                elapsed_ms: elapsed.as_millis(),
                                bytes_per_second,
                            },
                        );
                    },
                    &state.cancelled,
                )
                .await;
            *state.connection.lock().await = bluetooth.status().await.unwrap_or(None);
            result
        })
        .await
}

#[tauri::command]
fn cancel_print(state: State<'_, AppState>) {
    state.cancelled.store(true, Ordering::SeqCst);
}

#[tauri::command]
async fn save_export(
    suggested_name: String,
    bytes: Vec<u8>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    state
        .shutdown
        .while_running(async {
            if bytes.len() > 32 * 1024 * 1024 {
                return Err("Export exceeds the 32 MB limit.".into());
            }
            let filename = std::path::Path::new(&suggested_name)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("label.json")
                .to_owned();
            let mut dialog = rfd::AsyncFileDialog::new().set_file_name(&filename);
            dialog = if filename.to_ascii_lowercase().ends_with(".png") {
                dialog.add_filter("PNG image", &["png"])
            } else {
                dialog.add_filter("Label template", &["json"])
            };
            if let Ok(documents) = app.path().document_dir() {
                dialog = dialog.set_directory(documents);
            }
            let file = dialog.save_file().await;
            match file {
                None => Ok(None),
                Some(file) => {
                    file.write(&bytes)
                        .await
                        .map_err(|e| format!("Could not save file: {e}"))?;
                    Ok(Some(file.path().display().to_string()))
                }
            }
        })
        .await
}

#[tauri::command]
fn set_close_guard_ready(ready: bool, state: State<'_, AppState>) {
    state.close_guard_ready.store(ready, Ordering::SeqCst);
}

#[tauri::command]
fn acknowledge_close_request(request_id: u64, state: State<'_, AppState>) {
    state.close_requests.take(request_id);
}

/// Called only after the frontend has checked unsaved work. ExitRequested still
/// performs the same bounded Bluetooth shutdown before the process exits.
#[tauri::command]
fn close_app(app: tauri::AppHandle) {
    app.exit(0);
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .manage(template_store::TemplateStore::default())
        .invoke_handler(tauri::generate_handler![
            template_store::load_template_library,
            template_store::save_template_library,
            scan_printers,
            connect_printer,
            disconnect_printer,
            printer_status,
            printer_diagnostics,
            print_label,
            print_raster,
            cancel_print,
            save_export,
            set_close_guard_ready,
            acknowledge_close_request,
            close_app
        ])
        .build(tauri::generate_context!())
        .expect("Could not start EZPZ Label Studio")
        .run(|app, event| {
            if let tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::CloseRequested { api, .. },
                ..
            } = &event
            {
                let state = app.state::<AppState>();
                if label == "main"
                    && state.close_guard_ready.load(Ordering::SeqCst)
                    && !state.shutdown.is_requested()
                {
                    let request_id = state.close_requests.begin();
                    if app
                        .emit_to("main", "app-close-requested", request_id)
                        .is_ok()
                    {
                        api.prevent_close();
                        let handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                            let state = handle.state::<AppState>();
                            // An immediate frontend ACK stops this watchdog. The
                            // user's confirmation dialog has no decision timeout.
                            if state.close_requests.take(request_id)
                                && !state.shutdown.is_requested()
                            {
                                handle.exit(0);
                            }
                        });
                    }
                }
            }
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                let state = app.state::<AppState>();
                if state.shutdown.is_complete() {
                    return;
                }
                api.prevent_exit();
                if !state.shutdown.request() {
                    return;
                }
                state.cancelled.store(true, Ordering::SeqCst);
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let state = handle.state::<AppState>();
                    let result = tokio::time::timeout(std::time::Duration::from_secs(5), async {
                        let mut bluetooth = state.bluetooth.lock().await;
                        let result = bluetooth.shutdown().await;
                        *state.connection.lock().await = None;
                        result
                    })
                    .await;
                    match result {
                        Ok(Ok(())) => {}
                        Ok(Err(error)) => eprintln!("Bluetooth shutdown: {error}"),
                        Err(_) => eprintln!("Bluetooth shutdown reached its five-second deadline"),
                    }
                    state.shutdown.finish();
                    handle.exit(0);
                });
            }
        });
}

#[cfg(test)]
mod close_tests {
    use super::CloseRequests;

    #[test]
    fn acknowledged_close_never_reaches_watchdog_exit() {
        let requests = CloseRequests::default();
        let id = requests.begin();
        assert!(requests.take(id));
        assert!(!requests.take(id));
    }

    #[test]
    fn stale_acknowledgement_cannot_clear_new_close_request() {
        let requests = CloseRequests::default();
        let first = requests.begin();
        let second = requests.begin();
        assert!(!requests.take(first));
        assert!(requests.take(second));
    }

    #[test]
    fn unattended_request_expires_once_and_zero_never_acknowledges() {
        let requests = CloseRequests::default();
        assert!(!requests.take(0));
        let id = requests.begin();
        assert!(!requests.take(0));
        assert!(requests.take(id));
        assert!(!requests.take(id));
    }

    #[test]
    fn native_window_config_matches_custom_controls_and_html_drop() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let window = &config["app"]["windows"][0];
        assert_eq!(window["decorations"], false);
        assert_eq!(window["maximized"], false);
        assert_eq!(window["dragDropEnabled"], false);
        assert_eq!(window["minHeight"], 560);
        assert_eq!(window["minWidth"], 1000);
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let permissions = capability["permissions"].as_array().unwrap();
        for required in [
            "core:default",
            "core:window:allow-minimize",
            "core:window:allow-toggle-maximize",
            "core:window:allow-start-dragging",
            "core:window:allow-is-maximized",
        ] {
            assert!(permissions.iter().any(|permission| permission == required));
        }
        // All close paths use our guarded IPC; the frontend gets no direct
        // permission to destroy the window and bypass the confirmation.
        assert!(!permissions
            .iter()
            .any(|permission| permission == "core:window:allow-destroy"));
    }
}
