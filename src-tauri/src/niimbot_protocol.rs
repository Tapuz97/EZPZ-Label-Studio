//! Independent implementation of documented wire facts (experimental D110 only).
//! Provenance: https://github.com/iscarelli/niimbot-web-bluetooth/blob/main/docs/protocol-v4.md
//! (MIT), read 2026-11-15; APK hardware.json corroborates model 2304, 203dpi,
//! 8 dots/mm and 12mm head. This implementation has not been hardware verified.
use crate::protocol::RasterPrintJob;

pub const SERVICE: u128 = 0xe7810a71_73ae_499d_8c15_faa9aef0c3f2;
pub const CHARACTERISTIC: u128 = 0xbef8d6c9_9c21_4c9e_b632_bd58c1009f9f;
pub const CONNECT: &[u8] = &[3, 0x55, 0x55, 0xc1, 1, 1, 0xc1, 0xaa, 0xaa];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    pub command: u8,
    pub data: Vec<u8>,
}
pub fn frame(command: u8, data: &[u8]) -> Vec<u8> {
    assert!(data.len() <= 255);
    let length = data.len() as u8;
    let checksum = data.iter().fold(command ^ length, |crc, byte| crc ^ byte);
    let mut bytes = vec![0x55, 0x55, command, length];
    bytes.extend_from_slice(data);
    bytes.extend([checksum, 0xaa, 0xaa]);
    bytes
}

/// Bounded stream assembler. Invalid candidates advance one byte, preserving a
/// possible following header; accepts fragmented and coalesced notifications.
#[derive(Default)]
pub struct Parser {
    buffer: Vec<u8>,
}
impl Parser {
    pub fn clear(&mut self) {
        self.buffer.clear();
    }
    pub fn feed(&mut self, bytes: &[u8]) -> Vec<Frame> {
        let mut frames = Vec::new();
        for byte in bytes {
            self.buffer.push(*byte);
            loop {
                if self.buffer.len() < 2 {
                    break;
                }
                if self.buffer[..2] != [0x55, 0x55] {
                    self.buffer.remove(0);
                    continue;
                }
                if self.buffer.len() < 4 {
                    break;
                }
                let size = self.buffer[3] as usize + 7;
                if self.buffer.len() < size {
                    break;
                }
                let crc = self.buffer[2..size - 3].iter().fold(0, |a, b| a ^ b);
                if self.buffer[size - 3] != crc || self.buffer[size - 2..size] != [0xaa, 0xaa] {
                    self.buffer.remove(0);
                    continue;
                }
                frames.push(Frame {
                    command: self.buffer[2],
                    data: self.buffer[4..size - 3].to_vec(),
                });
                self.buffer.drain(..size);
            }
        }
        frames
    }
}

pub fn model_id(data: &[u8]) -> Result<u16, String> {
    match data {
        [high] => Ok((*high as u16) << 8),
        [high, low] => Ok(u16::from_be_bytes([*high, *low])),
        _ => Err("Invalid NIIMBOT model response.".into()),
    }
}
pub fn completed_page(data: &[u8]) -> Result<u16, String> {
    if data.len() < 4 || data[2] > 100 || data[3] > 100 {
        return Err("Invalid NIIMBOT print status; completion is unconfirmed.".into());
    }
    Ok(u16::from_be_bytes([data[0], data[1]]))
}

/// Decode only a stock code from the self-describing RFID response. Unit UID
/// and serial fields are consumed for structural validation and never exposed.
/// Unknown/no-tag/malformed payloads provide no stock inference.
pub fn stock_code(data: &[u8]) -> Option<String> {
    if data.len() < 10 {
        return None;
    }
    let barcode_len = data[8] as usize;
    if !(1..=64).contains(&barcode_len) {
        return None;
    }
    let barcode_end = 9usize.checked_add(barcode_len)?;
    let barcode = data.get(9..barcode_end)?;
    if !barcode.iter().all(|byte| byte.is_ascii_graphic()) {
        return None;
    }
    let serial_len = *data.get(barcode_end)? as usize;
    if serial_len > 64 {
        return None;
    }
    let serial_end = barcode_end.checked_add(1)?.checked_add(serial_len)?;
    let serial = data.get(barcode_end + 1..serial_end)?;
    if !serial.iter().all(|byte| byte.is_ascii_graphic()) {
        return None;
    }
    // Remaining fields: print limit i16BE, used count i16BE, type u8, and
    // optionally capacity i16BE. Accept only complete known structures.
    if ![5, 7].contains(&data.len().checked_sub(serial_end)?) {
        return None;
    }
    String::from_utf8(barcode.to_vec()).ok()
}

#[derive(Debug)]
pub struct Prepared {
    pub width: usize,
    pub height: usize,
    pub rows: Vec<Vec<u8>>,
    pub density: u8,
    pub copies: u16,
}
/// Original D110 wire variant: counts describe three equal byte groups.
/// Wire facts: NIIMBOT Community Wiki PrintBitmapRow and MultiMote's documented
/// D110 task / packet count definitions. No upstream implementation is copied.
pub fn legacy_rows(rows: &[Vec<u8>]) -> Result<Vec<Vec<u8>>, String> {
    rows.iter()
        .map(|bytes| {
            let parsed = Parser::default().feed(bytes);
            if parsed.len() != 1 {
                return Err("Invalid prepared NIIMBOT row.".into());
            }
            let row = &parsed[0];
            if row.command == 0x84 && row.data.len() == 3 {
                return Ok(bytes.clone());
            }
            if row.command != 0x85 || ![18, 21].contains(&row.data.len()) {
                return Err("Legacy D110 requires complete monochrome rows.".into());
            }
            let mut payload = row.data[..2].to_vec();
            payload.extend(
                row.data[6..]
                    .chunks_exact((row.data.len() - 6) / 3)
                    .map(|part| part.iter().map(|b| b.count_ones() as u8).sum::<u8>()),
            );
            payload.push(row.data[5]);
            payload.extend(&row.data[6..]);
            Ok(frame(0x85, &payload))
        })
        .collect()
}
pub fn prepare(job: &RasterPrintJob) -> Result<Prepared, String> {
    job.validate()?;
    if job.protocol != "niimbot" || job.dpi != 203 || !(1..=3).contains(&job.density) {
        return Err("D110 requires 203 DPI and density 1–3.".into());
    }
    let rotate = job.width_px > 96 && job.height_px <= 120 && job.height_px < job.width_px;
    let (width, height) = if rotate {
        (job.height_px, job.width_px)
    } else {
        (job.width_px, job.height_px)
    };
    if width > 120 || height > (100.0_f64 * 203.0 / 25.4).round() as usize {
        return Err("D110 requires paper no wider than 15 mm and no longer than 100 mm. Choose compatible stock or rotate the design.".into());
    }
    let input_stride = job.width_px.div_ceil(8);
    // Keep every artwork pixel, including the edges of 15mm stock. Model-table
    // head recommendations are advisory; no cropping or resampling is applied.
    let output_width = if width > 96 { 120 } else { 96 };
    let pad = (output_width - width) / 2;
    let width = output_width;
    let stride = width.div_ceil(8);
    let mut raster = vec![0u8; stride * height];
    for y in 0..job.height_px {
        for x in 0..job.width_px {
            if job.raster[y * input_stride + x / 8] & (0x80 >> (x % 8)) != 0 {
                let (dx, dy) = if rotate {
                    (job.height_px - 1 - y, x)
                } else {
                    (x, y)
                };
                let dx = dx + pad;
                raster[dy * stride + dx / 8] |= 0x80 >> (dx % 8);
            }
        }
    }
    let mut rows = Vec::new();
    let mut y = 0;
    while y < height {
        let row = &raster[y * stride..(y + 1) * stride];
        let mut run = 1;
        while run < 200
            && y + run < height
            && row == &raster[(y + run) * stride..(y + run + 1) * stride]
        {
            run += 1;
        }
        let black: u16 = row.iter().map(|b| b.count_ones() as u16).sum();
        let mut payload = (y as u16).to_be_bytes().to_vec();
        if black == 0 {
            payload.push(run as u8);
            rows.push(frame(0x84, &payload));
        } else {
            payload.extend([0, black as u8, (black >> 8) as u8, run as u8]);
            payload.extend(row);
            rows.push(frame(0x85, &payload));
        }
        y += run;
    }
    Ok(Prepared {
        width,
        height,
        rows,
        density: job.density,
        copies: job.copies,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn golden_and_fragmentation() {
        assert_eq!(
            frame(0x40, &[8]),
            vec![0x55, 0x55, 0x40, 1, 8, 0x49, 0xaa, 0xaa]
        );
        let bytes = frame(0x48, &[9, 0]);
        let mut p = Parser::default();
        assert!(p.feed(&bytes[..3]).is_empty());
        assert_eq!(p.feed(&bytes[3..])[0].data, [9, 0]);
        let mut corrupt = bytes.clone();
        corrupt[4] ^= 1;
        corrupt.extend(&bytes);
        corrupt.extend(&bytes);
        assert_eq!(p.feed(&corrupt).len(), 2);
        assert_eq!(model_id(&[9]).unwrap(), 2304);
        assert!(model_id(&[]).is_err());
        assert!(completed_page(&[0, 1, 101, 0]).is_err());
        assert_eq!(completed_page(&[0, 1, 100, 100]).unwrap(), 1);
    }
    fn job(w: usize, h: usize) -> RasterPrintJob {
        RasterPrintJob {
            width_mm: w as f64 * 25.4 / 203.,
            height_mm: h as f64 * 25.4 / 203.,
            gap_mm: 2.,
            dpi: 203,
            copies: 1,
            density: 2,
            raster: vec![0; w.div_ceil(8) * h],
            width_px: w,
            height_px: h,
            threshold: 160,
            protocol: "niimbot".into(),
        }
    }
    #[test]
    fn limits_rotation_runs_and_padding() {
        let mut portrait = job(96, 240);
        portrait.raster[0] = 0x80;
        let p = prepare(&portrait).unwrap();
        assert_eq!((p.width, p.height), (96, 240));
        assert_eq!(&p.rows[0][4..10], &[0, 0, 0, 1, 0, 1]);
        assert_eq!(p.rows.len(), 3);
        let mut landscape = job(240, 96);
        landscape.raster[0] = 0x80;
        let p = prepare(&landscape).unwrap();
        assert_eq!((p.width, p.height), (96, 240));
        assert_eq!(p.rows[0][21], 1); // clockwise maps top-left to top-right.
        assert!(prepare(&job(121, 121)).is_err());
        assert!(prepare(&job(96, 800)).is_err());
        let mut bad = job(95, 240);
        bad.raster[11] = 1;
        assert!(prepare(&bad).is_err());
        let mut bad = job(96, 240);
        bad.density = 0;
        assert!(prepare(&bad).is_err());
    }
    #[test]
    fn narrow_artwork_is_centered_without_scaling() {
        let mut narrow = job(80, 240);
        narrow.raster[0] = 0x80;
        narrow.raster[9] = 1;
        let prepared = prepare(&narrow).unwrap();
        assert_eq!(prepared.width, 96);
        let parsed = Parser::default().feed(&prepared.rows[0]);
        let pixels = &parsed[0].data[6..];
        assert_eq!(pixels.len(), 12);
        assert_eq!(pixels[0], 0);
        assert_eq!(pixels[1], 0x80);
        assert_eq!(pixels[10], 1);
        assert_eq!(pixels[11], 0);
    }
    #[test]
    fn rfid_stock_code_requires_a_complete_structure() {
        let mut payload = vec![0; 8];
        payload.push(8);
        payload.extend(b"02282280");
        payload.push(14);
        payload.extend(b"SANITIZED00000");
        payload.extend([0, 120, 0, 3, 1, 0, 100]);
        assert_eq!(payload.len(), 39);
        assert_eq!(stock_code(&payload), Some("02282280".into()));
        assert_eq!(stock_code(&[0]), None);
        assert_eq!(stock_code(&payload[..36]), None);
        let mut corrupt = payload.clone();
        corrupt[8] = 65;
        assert_eq!(stock_code(&corrupt), None);
        let mut corrupt = payload.clone();
        corrupt[9] = 0xff;
        assert_eq!(stock_code(&corrupt), None);
        let mut corrupt = payload.clone();
        corrupt[17] = 64;
        assert_eq!(stock_code(&corrupt), None);
        payload.push(0);
        assert_eq!(stock_code(&payload), None);
    }
    #[test]
    fn legacy_bitmap_counts_are_three_parts_of_32_dots() {
        let mut payload = vec![0, 0, 0, 3, 0, 1];
        let mut pixels = vec![0; 12];
        pixels[0] = 0x80;
        pixels[4] = 0xc0;
        pixels[8] = 0xe0;
        payload.extend(pixels);
        let rows = legacy_rows(&[frame(0x85, &payload)]).unwrap();
        let parsed = Parser::default().feed(&rows[0]);
        assert_eq!(&parsed[0].data[..6], &[0, 0, 1, 2, 3, 1]);
        assert_eq!(&parsed[0].data[6..], &payload[6..]);
        assert!(legacy_rows(&[vec![0]]).is_err());
    }
    #[test]
    fn fifteen_mm_stock_preserves_all_black_pixels_in_both_orientations() {
        let mut portrait = job(120, 240);
        portrait.raster[0] = 0x80;
        portrait.raster[14] = 1;
        let p = prepare(&portrait).unwrap();
        assert_eq!((p.width, p.height), (120, 240));
        let row = Parser::default().feed(&p.rows[0]);
        assert_eq!(row[0].data[6], 0x80);
        assert_eq!(row[0].data[20], 1);
        let legacy = legacy_rows(&p.rows).unwrap();
        let row = Parser::default().feed(&legacy[0]);
        assert_eq!(&row[0].data[..6], &[0, 0, 1, 0, 1, 1]);
        assert_eq!(row[0].data.len(), 21);
        let mut landscape = job(240, 120);
        landscape.raster[0] = 0x80;
        landscape.raster[119 * 30] = 0x80;
        let p = prepare(&landscape).unwrap();
        let row = Parser::default().feed(&p.rows[0]);
        assert_eq!(row[0].data[6], 0x80);
        assert_eq!(row[0].data[20], 1);
        assert_eq!((p.width, p.height), (120, 240));
    }
}
