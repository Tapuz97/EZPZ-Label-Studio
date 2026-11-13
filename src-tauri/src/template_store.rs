use serde::Serialize;
use serde_json::Value;
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

const MAX_BYTES: usize = 64_000_000;
#[derive(Default)]
pub struct TemplateStore(Mutex<Option<Location>>);
#[derive(Clone)]
struct Location {
    directory: PathBuf,
    fallback: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Library {
    templates: Value,
    location: String,
    fallback: bool,
}
fn token() -> String {
    format!(
        "{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    )
}
fn writable(directory: &Path) -> std::io::Result<()> {
    fs::create_dir_all(directory)?;
    let probe = directory.join(format!(".write-check-{}", token()));
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)?;
    drop(file);
    fs::remove_file(probe)
}
fn choose(install: &Path, fallback: &Path) -> Result<Location, String> {
    // Keep an existing library in its established location when permissions change.
    if fallback.join("library.json").is_file() {
        writable(fallback).map_err(|e| {
            format!(
                "Cannot write template directory {}: {e}",
                fallback.display()
            )
        })?;
        return Ok(Location {
            directory: fallback.into(),
            fallback: true,
        });
    }
    if writable(install).is_ok() {
        return Ok(Location {
            directory: install.into(),
            fallback: false,
        });
    }
    writable(fallback).map_err(|e| {
        format!(
            "Cannot write template directory {}: {e}",
            fallback.display()
        )
    })?;
    // Preserve an installation library when it becomes read-only.
    if install.join("library.json").is_file() {
        let data = read_library(install)?.ok_or("Template library disappeared")?;
        write_library(fallback, &data)?;
    }
    Ok(Location {
        directory: fallback.into(),
        fallback: true,
    })
}
fn validate(value: &Value) -> Result<(), String> {
    let list = value.as_array().ok_or("Invalid template library")?;
    if list.len() > 30 {
        return Err("Template library is limited to 30 labels".into());
    }
    let mut ids = std::collections::HashSet::new();
    for item in list {
        let id = item
            .get("id")
            .and_then(Value::as_str)
            .ok_or("Invalid template ID")?;
        if id.is_empty() || !ids.insert(id) || !item.get("document").is_some_and(Value::is_object) {
            return Err("Invalid template entry".into());
        }
    }
    Ok(())
}
fn read_library(directory: &Path) -> Result<Option<Value>, String> {
    let path = directory.join("library.json");
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    let mut bytes = Vec::new();
    file.take((MAX_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BYTES {
        return Err("Template library exceeds 64 MB".into());
    }
    let value = serde_json::from_slice(&bytes)
        .map_err(|e| format!("Cannot read template library; existing file preserved: {e}"))?;
    validate(&value)?;
    Ok(Some(value))
}
fn write_library(directory: &Path, value: &Value) -> Result<(), String> {
    validate(value)?;
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BYTES {
        return Err("Template library exceeds 64 MB".into());
    }
    let temp = directory.join(format!(".library-{}.tmp", token()));
    let result = (|| -> std::io::Result<()> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp, directory.join("library.json"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map_err(|e| format!("Templates could not be saved; previous library preserved: {e}"))
}
fn location(app: &tauri::AppHandle, slot: &mut Option<Location>) -> Result<Location, String> {
    if let Some(location) = slot {
        return Ok(location.clone());
    }
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let install = executable
        .parent()
        .ok_or("No installation directory")?
        .join("templates");
    let fallback = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("templates");
    let selected = choose(&install, &fallback)?;
    *slot = Some(selected.clone());
    Ok(selected)
}
#[tauri::command]
pub fn load_template_library(
    app: tauri::AppHandle,
    state: tauri::State<'_, TemplateStore>,
    legacy: Value,
) -> Result<Library, String> {
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    let at = location(&app, &mut slot)?;
    let templates = match read_library(&at.directory)? {
        Some(value) => value,
        None => {
            write_library(&at.directory, &legacy)?;
            legacy
        }
    };
    Ok(Library {
        templates,
        location: at.directory.to_string_lossy().into_owned(),
        fallback: at.fallback,
    })
}
fn persist_with_fallback(
    at: Location,
    fallback: &Path,
    templates: &Value,
) -> Result<Location, String> {
    // Validate before attempting either destination; invalid input never switches locations.
    validate(templates)?;
    match write_library(&at.directory, templates) {
        Ok(()) => Ok(at),
        Err(original) if !at.fallback => {
            writable(fallback)
                .map_err(|error| format!("{original}; fallback unavailable: {error}"))?;
            write_library(fallback, templates)?;
            Ok(Location {
                directory: fallback.into(),
                fallback: true,
            })
        }
        Err(error) => Err(error),
    }
}
#[tauri::command]
pub fn save_template_library(
    app: tauri::AppHandle,
    state: tauri::State<'_, TemplateStore>,
    templates: Value,
) -> Result<Library, String> {
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    let at = location(&app, &mut slot)?;
    let fallback = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("templates");
    let at = persist_with_fallback(at, &fallback, &templates)?;
    *slot = Some(at.clone());
    Ok(Library {
        templates,
        location: at.directory.to_string_lossy().into_owned(),
        fallback: at.fallback,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> PathBuf {
        let p = std::env::temp_dir().join(format!("ezpz-template-test-{}", token()));
        fs::create_dir_all(&p).unwrap();
        p
    }
    #[test]
    fn switches_to_fallback_when_existing_destination_becomes_unwritable() {
        let dir = root();
        let install = dir.join("templates");
        let fallback = dir.join("user/templates");
        let at = choose(&install, &fallback).unwrap();
        // A directory at the target prevents atomic file replacement on all platforms.
        fs::create_dir(install.join("library.json")).unwrap();
        let selected = persist_with_fallback(at, &fallback, &serde_json::json!([])).unwrap();
        assert!(selected.fallback);
        assert_eq!(
            read_library(&fallback).unwrap(),
            Some(serde_json::json!([]))
        );
        assert!(install.join("library.json").is_dir());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn persistent_replace_and_invalid_write_preserve_previous() {
        let dir = root();
        let first = serde_json::json!([{ "id":"one", "document":{"name":"first"} }]);
        write_library(&dir, &first).unwrap();
        assert_eq!(read_library(&dir).unwrap(), Some(first.clone()));
        assert!(write_library(&dir, &serde_json::json!({})).is_err());
        assert_eq!(read_library(&dir).unwrap(), Some(first));
        write_library(&dir, &serde_json::json!([])).unwrap();
        assert_eq!(read_library(&dir).unwrap(), Some(serde_json::json!([])));
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn blocked_install_path_uses_stable_persistent_fallback() {
        let dir = root();
        let install = dir.join("templates");
        let fallback = dir.join("user/templates");
        fs::write(&install, "blocked").unwrap();
        assert!(choose(&install, &fallback).unwrap().fallback);
        write_library(&fallback, &serde_json::json!([])).unwrap();
        fs::remove_file(&install).unwrap();
        assert!(choose(&install, &fallback).unwrap().fallback);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn writable_install_location_is_preferred_and_corrupt_library_is_not_overwritten() {
        let dir = root();
        let install = dir.join("templates");
        let fallback = dir.join("user/templates");
        assert!(!choose(&install, &fallback).unwrap().fallback);
        fs::write(install.join("library.json"), "broken").unwrap();
        assert!(read_library(&install).is_err());
        assert_eq!(
            fs::read_to_string(install.join("library.json")).unwrap(),
            "broken"
        );
        fs::remove_dir_all(dir).unwrap();
    }
}
