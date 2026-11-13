//! Independent raster encoders; evidence and compatibility limits are preserved
//! outside this project in the sibling EZPZ-Label-Research archive.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use flate2::{write::ZlibEncoder, Compression};
use serde::{Deserialize, Serialize};
use std::io::Write;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrintJob {
    pub width_mm: f64,
    pub height_mm: f64,
    pub gap_mm: f64,
    pub dpi: u32,
    pub copies: u16,
    pub density: u8,
    pub rgba: Vec<u8>,
    pub width_px: usize,
    pub height_px: usize,
    pub threshold: u8,
    pub protocol: String,
}

impl PrintJob {
    pub fn validate(&self) -> Result<(), String> {
        let pixels = self.validate_metadata()?;
        if self.rgba.len() != pixels.checked_mul(4).ok_or("Raster size overflow")? {
            return Err("Invalid RGBA buffer or raster exceeds 8 million pixels.".into());
        }
        Ok(())
    }
    fn validate_metadata(&self) -> Result<usize, String> {
        if !self.width_mm.is_finite()
            || !(10.0..=216.0).contains(&self.width_mm)
            || !self.height_mm.is_finite()
            || !(10.0..=500.0).contains(&self.height_mm)
            || !self.gap_mm.is_finite()
            || !(0.0..=10.0).contains(&self.gap_mm)
        {
            return Err(
                "Use a width of 10–216 mm, height of 10–500 mm, and gap of 0–10 mm.".into(),
            );
        }
        if ![203, 300].contains(&self.dpi) || !(1..=100).contains(&self.copies) || self.density > 15
        {
            return Err("Use 203/300 DPI, 1–100 copies, and density 0–15.".into());
        }
        let expected_w = (self.width_mm * self.dpi as f64 / 25.4).round() as usize;
        let expected_h = (self.height_mm * self.dpi as f64 / 25.4).round() as usize;
        if self.width_px != expected_w || self.height_px != expected_h {
            return Err(
                "Raster dimensions do not match the label size and DPI. Render the label again."
                    .into(),
            );
        }
        let pixels = self
            .width_px
            .checked_mul(self.height_px)
            .ok_or("Raster size overflow")?;
        if pixels > 8_000_000 {
            return Err("Invalid RGBA buffer or raster exceeds 8 million pixels.".into());
        }
        if !["tspl", "zpl"].contains(&self.protocol.as_str()) {
            return Err("Unsupported printer language.".into());
        }
        Ok(pixels)
    }
}

/// Packed, MSB-first black=1 rows avoid transferring RGBA JSON through WebView IPC.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RasterPrintJob {
    pub width_mm: f64,
    pub height_mm: f64,
    pub gap_mm: f64,
    pub dpi: u32,
    pub copies: u16,
    pub density: u8,
    pub raster: Vec<u8>,
    pub width_px: usize,
    pub height_px: usize,
    pub threshold: u8,
    pub protocol: String,
}
impl RasterPrintJob {
    fn metadata(&self) -> PrintJob {
        PrintJob {
            width_mm: self.width_mm,
            height_mm: self.height_mm,
            gap_mm: self.gap_mm,
            dpi: self.dpi,
            copies: self.copies,
            density: self.density,
            rgba: Vec::new(),
            width_px: self.width_px,
            height_px: self.height_px,
            threshold: self.threshold,
            protocol: self.protocol.clone(),
        }
    }
}
pub fn encode_raster(job: &RasterPrintJob) -> Result<Vec<u8>, String> {
    let metadata = job.metadata();
    metadata.validate_metadata()?;
    let row_bytes = job.width_px.div_ceil(8);
    if job.raster.len() != row_bytes * job.height_px {
        return Err("Packed raster dimensions do not match the label.".into());
    }
    if job.width_px % 8 != 0 {
        let unused_mask = 0xffu8 >> (job.width_px % 8);
        if job
            .raster
            .chunks_exact(row_bytes)
            .any(|row| row[row_bytes - 1] & unused_mask != 0)
        {
            return Err("Packed raster edge padding must be white.".into());
        }
    }
    match job.protocol.as_str() {
        "zpl" => encode_zpl(&metadata, &job.raster),
        "tspl" => encode_tspl(&metadata, &job.raster),
        _ => unreachable!("validated printer format"),
    }
}

/// Row-major, MSB first, black=1. Unused bits at the right edge stay white.
/// Composite transparency over white before applying the same threshold as UI.
pub fn monochrome(job: &PrintJob) -> Vec<u8> {
    let row_bytes = job.width_px.div_ceil(8);
    let mut out = vec![0u8; row_bytes * job.height_px];
    for (index, pixel) in job.rgba.chunks_exact(4).enumerate() {
        let alpha = pixel[3] as f64 / 255.0;
        let luminance =
            (0.299 * pixel[0] as f64 + 0.587 * pixel[1] as f64 + 0.114 * pixel[2] as f64) * alpha
                + 255.0 * (1.0 - alpha);
        if luminance < job.threshold as f64 {
            let x = index % job.width_px;
            let y = index / job.width_px;
            out[y * row_bytes + x / 8] |= 0x80 >> (x % 8);
        }
    }
    out
}

pub fn encode(job: &PrintJob) -> Result<Vec<u8>, String> {
    job.validate()?;
    let raster = monochrome(job);
    match job.protocol.as_str() {
        "zpl" => encode_zpl(job, &raster),
        "tspl" => encode_tspl(job, &raster),
        _ => unreachable!("validated printer language"),
    }
}

fn encode_zpl(job: &PrintJob, raster: &[u8]) -> Result<Vec<u8>, String> {
    // The reference app's ZPLCommand actually prefixes TSPL SIZE/GAP. This is its
    // Xinye/compatible-printer dialect, not a promise of universal Zebra support.
    let mut output = format!(
        "\nSIZE {:.3} mm,{:.3} mm\nGAP {:.3} mm,0 mm\n^XA\n~SD{}\n^PW{}\n^LL{}\n^LH0,0\n",
        job.width_mm,
        job.height_mm,
        job.gap_mm,
        job.density * 2,
        job.width_px,
        job.height_px
    );
    let row_bytes = job.width_px.div_ceil(8);
    // Bounded bands preserve absolute y positions while keeping each bitmap small.
    for (band, data) in raster.chunks(row_bytes * 256).enumerate() {
        let mut compressor = ZlibEncoder::new(Vec::new(), Compression::default());
        compressor
            .write_all(data)
            .map_err(|e| format!("Bitmap compression failed: {e}"))?;
        let compressed = compressor
            .finish()
            .map_err(|e| format!("Bitmap compression failed: {e}"))?;
        let encoded = STANDARD.encode(compressed);
        output.push_str(&format!(
            "^FO0,{}\n^GFA,{},{},{},:Z64:",
            band * 256,
            data.len(),
            data.len(),
            row_bytes
        ));
        // Mirrors Android Base64.DEFAULT used by the reference app: 76 columns and LF.
        // Its recovered method appends no CRC; do not silently invent one.
        for line in encoded.as_bytes().chunks(76) {
            output.push_str(std::str::from_utf8(line).expect("base64 is ASCII"));
            output.push('\n');
        }
        output.push_str("\n^FS\n");
    }
    output.push_str(&format!("^PQ{}\n^XZ\n", job.copies));
    if output.len() > 1_048_576 {
        return Err("Encoded label exceeds 1 MB. Reduce image complexity or DPI.".into());
    }
    Ok(output.into_bytes())
}
fn encode_tspl(job: &PrintJob, raster: &[u8]) -> Result<Vec<u8>, String> {
    let mut output = format!("SIZE {:.3} mm,{:.3} mm\nGAP {:.3} mm,0 mm\nDENSITY {}\nDIRECTION 1\nREFERENCE 0,0\nCLS\nBITMAP 0,0,{},{},0,",
        job.width_mm,job.height_mm,job.gap_mm,job.density,job.width_px.div_ceil(8),job.height_px).into_bytes();
    // REA getbmpdataTsc: white=1, black=0, including white padding bits.
    output.extend(raster.iter().map(|b| !b));
    output.extend(format!("\nPRINT 1,{}\n", job.copies).bytes());
    if output.len() > 1_048_576 {
        return Err("Encoded label exceeds 1 MB. Reduce label size or DPI.".into());
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn pixel_job(width: usize, height: usize, rgba: Vec<u8>) -> PrintJob {
        PrintJob {
            width_mm: 60.0,
            height_mm: 90.0,
            gap_mm: 2.0,
            dpi: 203,
            copies: 1,
            density: 8,
            rgba,
            width_px: width,
            height_px: height,
            threshold: 128,
            protocol: "zpl".into(),
        }
    }
    #[test]
    fn msb_first_rows_and_white_padding() {
        let mut rgba = vec![255; 9 * 2 * 4];
        for i in [0, 7, 8, 10] {
            rgba[i * 4..i * 4 + 3].fill(0);
        }
        assert_eq!(
            monochrome(&pixel_job(9, 2, rgba)),
            vec![0x81, 0x80, 0x40, 0x00]
        );
    }
    #[test]
    fn transparent_black_is_white() {
        assert_eq!(monochrome(&pixel_job(1, 1, vec![0, 0, 0, 0])), vec![0]);
    }
    #[test]
    fn malformed_raster_rejected_before_send() {
        let job = pixel_job(1, 1, vec![0, 0, 0, 255]);
        assert!(encode(&job).unwrap_err().contains("dimensions"));
    }
    #[test]
    fn non_finite_dimensions_rejected() {
        let mut job = pixel_job(1, 1, vec![]);
        job.width_mm = f64::NAN;
        assert!(job.validate().is_err());
    }
    #[test]
    fn tspl_polarity_and_trailing_copy_command() {
        let job = pixel_job(9, 2, vec![]);
        let data = encode_tspl(&job, &[0x81, 0x80, 0x40, 0x00]).unwrap();
        let marker = b"BITMAP 0,0,2,2,0,";
        let start = data
            .windows(marker.len())
            .position(|x| x == marker)
            .unwrap()
            + marker.len();
        assert_eq!(&data[start..start + 4], &[0x7e, 0x7f, 0xbf, 0xff]);
        assert!(data.ends_with(b"\nPRINT 1,1\n"));
    }
    #[test]
    fn zpl_payload_round_trips_with_white_padding() {
        use std::io::Read;
        let job = pixel_job(9, 2, vec![]);
        let raster = [0x81, 0x80, 0x40, 0x00];
        let data = String::from_utf8(encode_zpl(&job, &raster).unwrap()).unwrap();
        assert!(data.contains("^GFA,4,4,2,:Z64:"));
        assert!(data.contains("^PW9\n^LL2\n"));
        assert!(data.ends_with("^PQ1\n^XZ\n"));
        let payload = data
            .split(":Z64:")
            .nth(1)
            .unwrap()
            .split("^FS")
            .next()
            .unwrap()
            .replace('\n', "");
        let compressed = STANDARD.decode(payload).unwrap();
        let mut decoded = Vec::new();
        flate2::read::ZlibDecoder::new(&compressed[..])
            .read_to_end(&mut decoded)
            .unwrap();
        assert_eq!(decoded, raster);
    }
    #[test]
    fn zpl_bands_have_contiguous_y_positions() {
        let job = pixel_job(8, 513, vec![]);
        let data = String::from_utf8(encode_zpl(&job, &vec![0; 513]).unwrap()).unwrap();
        assert!(data.contains("^FO0,0\n"));
        assert!(data.contains("^FO0,256\n"));
        assert!(data.contains("^FO0,512\n^GFA,1,1,1,:Z64:"));
    }
    fn packed(job: &PrintJob) -> RasterPrintJob {
        RasterPrintJob {
            width_mm: job.width_mm,
            height_mm: job.height_mm,
            gap_mm: job.gap_mm,
            dpi: job.dpi,
            copies: job.copies,
            density: job.density,
            raster: monochrome(job),
            width_px: job.width_px,
            height_px: job.height_px,
            threshold: job.threshold,
            protocol: job.protocol.clone(),
        }
    }
    #[test]
    fn packed_ipc_preserves_exact_zpl_and_tspl_output() {
        let mut job = pixel_job(80, 80, vec![255; 80 * 80 * 4]);
        job.width_mm = 10.0;
        job.height_mm = 10.0;
        job.rgba[..3].fill(0);
        for format in ["zpl", "tspl"] {
            job.protocol = format.into();
            let small = packed(&job);
            assert_eq!(small.raster.len() * 32, job.rgba.len());
            assert_eq!(encode_raster(&small).unwrap(), encode(&job).unwrap());
        }
    }
    #[test]
    fn packed_ipc_rejects_wrong_length_and_black_padding() {
        let mut job = pixel_job(82, 80, vec![255; 82 * 80 * 4]);
        job.width_mm = 10.2;
        job.height_mm = 10.0;
        let mut small = packed(&job);
        small.raster[10] |= 1;
        assert!(encode_raster(&small).unwrap_err().contains("padding"));
        small.raster.pop();
        assert!(encode_raster(&small).unwrap_err().contains("dimensions"));
    }
}
