//! Capability facts are populated only from device responses, never from a
//! Bluetooth name or the editor's current label dimensions.
use serde::Serialize;
use std::collections::BTreeMap;

/// Reference app BluetoothConstant.QUERY_DEVICE_NAME; corroborated as a model-name
/// inquiry (ASCII reply) by the official TSC TSPL/TSPL2 manual, section ~!T.
pub const MODEL_QUERY: &[u8] = b"~!T\n";

pub fn decode_model_reply(bytes: &[u8]) -> Option<String> {
    if bytes.len() > 128 || !bytes.is_ascii() {
        return None;
    }
    let text = std::str::from_utf8(bytes)
        .ok()?
        .trim_matches(|c| matches!(c, '\0' | '\r' | '\n' | ' '));
    if text.is_empty() || text.chars().any(|c| c.is_control()) {
        return None;
    }
    Some(text.into())
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterCapabilities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manufacturer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub firmware: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub software_revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hardware_revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gatt_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gatt_manufacturer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gatt_firmware_revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gatt_software_revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gatt_hardware_revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dpi: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_width_dots: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_width_mm: Option<f64>,
    pub status: String,
    pub source: Vec<String>,
    pub field_sources: BTreeMap<String, String>,
    pub notes: Vec<String>,
}

impl PrinterCapabilities {
    pub fn unknown() -> Self {
        Self {
            status: "unknown".into(),
            notes: vec!["Loaded label width and height are not detected; choose the stock size in the editor.".into()],
            ..Self::default()
        }
    }

    pub fn finish(&mut self) {
        self.max_width_mm = match (self.max_width_dots, self.dpi) {
            (Some(dots), Some(dpi)) if dpi > 0 => Some(dots as f64 * 25.4 / dpi as f64),
            _ => None,
        };
        if self.max_width_mm.is_some() {
            self.field_sources.insert("maxWidthMm".into(), "Calculated from reported maxWidthDots and DPI (dots × 25.4 / DPI); not loaded stock width".into());
        }
        self.status = if self.dpi.is_some() && self.max_width_dots.is_some() {
            "reported"
        } else if self.model.is_some()
            || self.manufacturer.is_some()
            || self.firmware.is_some()
            || self.software_revision.is_some()
            || self.hardware_revision.is_some()
            || self.dpi.is_some()
            || self.max_width_dots.is_some()
            || self.gatt_model.is_some()
            || self.gatt_manufacturer.is_some()
            || self.gatt_firmware_revision.is_some()
            || self.gatt_software_revision.is_some()
            || self.gatt_hardware_revision.is_some()
        {
            "partial"
        } else {
            "unknown"
        }
        .into();
    }

    pub fn validate_raster(&self, width_px: usize, dpi: u32) -> Result<(), String> {
        if let Some(reported_dpi) = self.dpi {
            if dpi != reported_dpi {
                return Err(format!("The printer reports {reported_dpi} DPI. Set the label to that DPI before printing."));
            }
        }
        if let Some(limit) = self.max_width_dots {
            if width_px > limit as usize {
                return Err(format!("This label is {width_px} dots wide; the printer reports a maximum of {limit} dots. Reduce the label width."));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityExchange {
    /// Milliseconds since Unix epoch; captures can be correlated without relying
    /// on the computer's local timezone.
    pub timestamp_unix_ms: u128,
    pub operation: String,
    pub characteristic_uuid: String,
    pub direction: String,
    pub hex: String,
    pub note: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityReport {
    pub capabilities: PrinterCapabilities,
    pub exchanges: Vec<CapabilityExchange>,
}

pub fn decode_gatt_text(bytes: &[u8]) -> Option<String> {
    // Device Information text values are UTF-8; reject arbitrary binary or
    // oversized values instead of presenting lossy text as a capability.
    if bytes.len() > 256 {
        return None;
    }
    let value = std::str::from_utf8(bytes).ok()?.trim_matches('\0').trim();
    if value.is_empty() || value.chars().any(|c| c.is_control()) {
        return None;
    }
    Some(value.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absent_dpi_does_not_invent_physical_width() {
        let mut caps = PrinterCapabilities::unknown();
        caps.max_width_dots = Some(832);
        caps.finish();
        assert_eq!(caps.max_width_mm, None);
        assert_eq!(caps.status, "partial");
    }

    #[test]
    fn width_requires_two_reported_values() {
        let mut caps = PrinterCapabilities::unknown();
        caps.max_width_dots = Some(832);
        caps.dpi = Some(203);
        caps.finish();
        assert!((caps.max_width_mm.unwrap() - 104.102463).abs() < 0.00001);
        assert_eq!(caps.status, "reported");
    }

    #[test]
    fn gatt_text_rejects_binary_controls_and_empty_values() {
        assert_eq!(decode_gatt_text(b"DB403\0"), Some("DB403".into()));
        assert_eq!(decode_gatt_text(&[0xff, 0x00]), None);
        assert_eq!(decode_gatt_text(b"\0"), None);
        assert_eq!(decode_gatt_text(b"foo\nbar"), None);
    }

    #[test]
    fn unknown_capabilities_do_not_invent_limits() {
        assert!(PrinterCapabilities::unknown()
            .validate_raster(1726, 300)
            .is_ok());
    }

    #[test]
    fn reported_geometry_is_enforced_without_guessing() {
        let mut caps = PrinterCapabilities::unknown();
        caps.dpi = Some(203);
        caps.max_width_dots = Some(832);
        assert!(caps.validate_raster(832, 203).is_ok());
        assert!(caps.validate_raster(833, 203).is_err());
        assert!(caps.validate_raster(480, 300).is_err());
    }

    #[test]
    fn model_query_and_reply_are_bounded_ascii() {
        assert_eq!(MODEL_QUERY, &[0x7e, 0x21, 0x54, 0x0a]);
        assert_eq!(decode_model_reply(b"DB403\r\n"), Some("DB403".into()));
        assert_eq!(decode_model_reply(&[0xff, 0x02]), None);
        assert_eq!(decode_model_reply(b"DB403\r\n203"), None);
        assert_eq!(decode_model_reply(b"\r\n"), None);
    }
}
