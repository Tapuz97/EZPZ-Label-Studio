# NIIMBOT D110 development status

Experimental original-D110 driver for model ID **2304**. D110_M, Hi-D110 and
other NIIMBOT models are not enabled. One native Windows physical output test
passed; browser-to-printer physical output remains unverified.

## Observed on the printer — 15 November 2026

- Service `e7810a71-73ae-499d-8c15-faa9aef0c3f2`, combined write-without-response/
  notify characteristic `bef8d6c9-9c21-4c9e-b632-bd58c1009f9f`.
- A generic UART is also exposed. NIIMBOT takes priority to prevent an accidental
  ZPL/TSPL stream through that compatibility UART.
- Connect returns `C2 [02]` (protocol 1), model returns `48 [09 00]`, and
  status-data returns the short payload `30 30`.
- Advanced heartbeat and direct head-width/DPI inquiries return unsupported
  `00 [01]`. Optional unsupported inquiries do not prevent connection.
- RFID product code `02282280` matches NIIMBOT's catalog response: width 30 mm,
  height 15 mm, gap-label type 1. The owner confirmed this stock and 12 mm
  printable width. APK resources specify 203 dpi and density 1–3, default 2.
- The native app handshake completed and disconnected cleanly. These checks
  sent no print or feed command.
- A separately authorized single test sent 2,673 bytes in 221 writes using the
  native app driver. The printer acknowledged completion in 5,067 ms and the
  connection was released. The owner confirmed the 30 × 15 mm label's text and
  QR code printed correctly without clipping. QR decoding was not separately
  tested.

Raw captures, APKs and unique device/roll identifiers remain outside Git.

## Print and stock handling

The legacy task uses one-byte Start, Clear, PageStart, four-byte Size, separate
Quantity and split bitmap counts for three 32-dot head sections. Independently
negotiated protocol 3 uses the b1 variant. Each copy is a separate single-page
job; physical page completion is polled before PrintEnd. Uncertain writes are
never automatically retried.

The output head is 96 dots. Landscape artwork rotates clockwise. Narrow artwork
is centered; wider paper loses only blank margins. Black content outside the
centered 12 mm band is rejected. Artwork is never silently shrunk to fit.

RFID supplies an identifier, not dimensions. Known codes resolve locally;
unfamiliar codes get one bounded manufacturer lookup sending only the SKU.
Validated sizes are cached locally. Unavailable/unrecognized results leave
manual selection available. Existing designs retain their dimensions; new
labels can default to recognized paper sizes. Only ordinary gap-label catalog
entries are currently accepted.

## Validation and limits

Tests cover framing, checksums, fragmented notifications, negotiation, legacy/
b1 sequences, margins, rotation, density, copies, cancellation, completion,
no retries, RFID parsing, catalog/cache failures and existing DB403 behavior.
Browser UI checks with simulated Bluetooth cover recognized paper defaults,
sample import, density limits, size feedback and the print button flow.

QR scanning, long batches, other media/firmware and actual browser-to-printer
printing remain verification gaps for broader compatibility.

## References

- [Protocol and connection enum](https://printers.niim.blue/interfacing/proto/).
- [NiimBlueLib D110 task](https://github.com/MultiMote/niimbluelib/blob/master/src/print_tasks/D110PrintTask.ts)
  and [packet generator](https://github.com/MultiMote/niimbluelib/blob/master/src/packets/packet_generator.ts)
  (MIT project).
- [Independent D110 physical observations](https://github.com/iscarelli/niimbot-web-bluetooth/blob/main/docs/NOTES.md)
  (MIT project): matching short status/unsupported heartbeat and job behavior.
- [Catalog API](https://printers.niim.blue/other/niimbot-cloud/).

These are protocol references; the app bundles neither their SDKs nor the APKs.
