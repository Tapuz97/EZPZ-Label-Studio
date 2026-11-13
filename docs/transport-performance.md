# Bluetooth transfer performance

## Version 0.5.1

The browser previously sent only 20 bytes per acknowledged write and scheduled
a timer even when the acknowledgement had already consumed the pacing budget.
Windows could use its negotiated 244-byte payload. This explains the additional
round trips in the browser; the exact cause of the owner's one-minute PDF print
was not instrumented before this change.

The browser now feature-detects a reported packet limit. If unavailable, the
DB403/18F0 profile verifies delivery of a 244-byte packet with a non-printing
model inquiry at its tail. Missing, rejected or unanswered verification falls
back to 20 bytes; uncertain control-write timeouts disconnect. Other models
retain the conservative path unless a browser-reported limit is available.
Acknowledged writes stay sequential, the 8 KiB/s host ceiling remains, and
unacknowledged-only links retain 20-byte/10 ms pacing. No automatic replay occurs.

Windows now receives packed monochrome rows through WebView IPC instead of
millions of RGBA JSON values. Raw raster data is 32 times smaller at byte-aligned
widths. Native tests prove the final ZPL/TSPL bytes remain identical. Single-job
preflight rendering is reused. Diagnostics separate preparation, backend and
transfer timing without including label artwork.

### Actual DB403 sample measurements

One identical initial 60 × 90 mm WORKSHOP / 001 design was sent through each
actual UI on Windows 11. Font/compressor differences produced slightly different
encoded byte counts. Timing ends when the transport accepts the stream, not when
the paper stops moving.

| Sender | Encoded bytes | Transfer | Print click to Sent |
| --- | ---: | ---: | ---: |
| Windows 0.5.1 | 2,883 | 742 ms | 938 ms |
| Chrome 157 / web 0.5.1 | 2,891 / 12 packets | 734 ms | 896 ms |

The owner confirmed correct physical output from both senders. The Chrome row
is the requested repeat after power was interrupted during an earlier run. The
original shipping PDF has not yet been timed on the updated release.

For the previously measured 8,754-byte PDF payload, an offline simulation at
125 ms per ACK takes 54.75 seconds with 438 × 20-byte writes versus 4.5 seconds
with 36 × 244-byte writes. The ACK time is a simulation input, not a measured
DB403 value or a promise of PDF print speed. Reproduce with:

```powershell
cargo run --release --manifest-path src-tauri/Cargo.toml --example transport_benchmark -- --bytes 8754 --ack-ms 125 --mtu 247
```

The read-only hardware verification is reproducible with
`cargo run --release --manifest-path src-tauri/Cargo.toml --example payload_probe`.
It connects only to DB403 on the verified profile, subscribes, queries the model
and releases the connection. It does not print.

## Historical implementation — 0.3.1

The previous sender always used 20-byte writes followed by a 10 ms delay,
including writes that already waited for an ATT acknowledgement. For the
8,754-byte payload produced from the supplied shipping-label PDF, that means
438 writes and **4.37 seconds of deliberate inter-write sleep**, in addition to
acknowledgement latency. The payload was measured offline; this is not a timing
measurement of a physical print job.

## Change

- Acknowledged writes stay sequential; exactly one is outstanding at a time.
  Their acknowledgement provides transport backpressure, so the fixed 10 ms
  post-write delay is removed.
- A separate **8 KiB/s host ceiling** limits the stream. This is a conservative
  design choice, not a measured UART baud rate. No token credit accumulates
  during a slow write, and the final packet's rate budget is included.
- After an explicit connection, the app obtains a read-only Windows GATT
  session. It reads the current negotiated MTU when each job starts and chooses
  `min(MTU − 3, 244)` bytes. Missing or invalid MTU information falls back to 20.
  Microsoft documents `MaxPduSize` as the negotiated MTU and says Windows owns
  negotiation. This implementation does not request negotiation or change
  `MaintainConnection`. [Microsoft MaxPduSize](https://learn.microsoft.com/en-us/uwp/api/windows.devices.bluetooth.genericattributeprofile.gattsession.maxpdusize?view=winrt-19041),
  [MTU change semantics](https://learn.microsoft.com/en-us/uwp/api/windows.devices.bluetooth.genericattributeprofile.gattsession.maxpdusizechanged?view=winrt-28000).
- Characteristics that cannot acknowledge writes retain 20-byte chunks and
  the original 10 ms gap. There is no automatic switch to unacknowledged writes.
- Cancellation, ten-second write deadlines, the ten-minute job bound,
  disconnect-on-failure and no automatic replay remain. Progress is throttled
  by elapsed time rather than exact byte multiples.

An ATT acknowledgement does not prove that the print engine has consumed data.
The host ceiling bounds the traffic but is not a guarantee for every printer's
internal buffer. New packet sizes and actual throughput have not been measured
on the DB403. The user's active connection/print job was left untouched.

## Offline measurements

The benchmark runs the **same sender scheduler** against a simulated writer
with a paused Tokio clock. It creates no Bluetooth manager, connection, or
hardware write. An MTU of 247 below is an input to the simulation, not a device
observation.

| Simulated acknowledgement | Previous 20 B + 10 ms | New fallback 20 B | New simulated MTU 247 / 244 B |
|---|---:|---:|---:|
| 5 ms | 6.560 s / 438 writes | 2.190 s / 438 writes | 1.077 s / 36 writes |
| 15 ms | 10.940 s / 438 writes | 6.570 s / 438 writes | 1.077 s / 36 writes |

These isolate host scheduling overhead; they do not predict paper-feed or
physical print completion times. Raw results are in
`../../EZPZ-Label-Research/cleanup-2026-11-13-source-review/output/benchmarks/transport-8754-5ms.json`
and `transport-8754-15ms.json` in the same archive folder.

Reproduce without hardware:

```powershell
cargo run --release --manifest-path src-tauri/Cargo.toml --example transport_benchmark -- --bytes 8754 --ack-ms 5 --mtu 247
```

All 29 Rust library tests passed with `cargo test --release --lib`, including
eight transport tests for bounded MTU selection, original unacknowledged
pacing, acknowledged delay removal, serial byte preservation, the host ceiling,
cancel, write timeout, no replay and final progress updates.

## Reported metrics

Connection information now includes `negotiatedMtu`, `maxChunk` and
`chunkSource`. Receipts include `elapsedMs`, `bytesPerSecond`, the actual chunk
policy, write mode and host ceiling. Duration covers the transfer and its host
pacing, excluding raster encoding and connection establishment. A successful
receipt still means bytes were accepted by the Bluetooth transport, not that a
paper sensor confirmed output.
