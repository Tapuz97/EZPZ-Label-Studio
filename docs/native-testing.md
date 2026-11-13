# Native Windows validation — 2026-11-13

## Version 0.6.0 — shared editor features and disk templates

- 45 Rust release tests pass, including persistent template replacement,
  read-only installation fallback, permission changes and corrupt-file preservation.
- Windows NSIS and web builds pass. Store package version is 1.1.0.0.
- An isolated native release confirmed the registered storage command selects
  its executable's templates directory. Native save/reload UI checks are recorded
  below when completed; filesystem fallback cases are exercised by native tests.
- Shared frontend checks cover CSV, editing, cropping, snapping, PDF preparation
  and zoom as detailed in frontend-testing.md. No new physical labels were sent
  in this feature pass. Existing DB403 output confirmation is from 0.5.1.
- Remaining distribution checks: clean installer install/uninstall, signed MSIX
  installation/Store flight, WACK and Store certification. Custom QR logos need
  physical scanning; other printer families require hardware tests.

## Version 0.5.1 — packed raster bridge and live transfer

- All 41 native release tests and Rust formatting checks pass. Packed-raster
  tests prove byte-identical ZPL/TSPL output to the existing RGBA encoder and
  reject malformed lengths or black bits in unused row padding.
- Read-only DB403 capability inspection observed Windows MTU 247 / 244-byte
  acknowledged writes. DPI and maximum width remain unreported.
- The reproducible `payload_probe` example sent only model inquiries: 4-byte
  baseline and a 244-byte packet containing blank separators with the inquiry
  at its tail. Both returned DB403 (72/76 ms to reply); no print/feed/configuration
  command was sent. The probe unsubscribed and disconnected afterward.
- The actual 0.5.1 native UI sent one 60 × 90 mm WORKSHOP / 001 label through
  the new packed command: 2,883 encoded bytes, 742 ms BLE transfer, 938 ms from
  Print click to Sent. The owner confirmed correct physical output. This is a
  synthetic sample, not a timing measurement of the owner's shipping PDF or
  paper-feed completion.
- Closing the isolated native app through its title-bar X left neither its
  application process nor its owned debug endpoint running. The subsequent
  independent Chrome connection succeeded.
- The optimized Windows NSIS build passes. Store packaging uses package version
  1.0.1.0 separately from application 0.5.1. MSIX installation, WACK and Store
  certification remain separate, incomplete checks.

## Version 0.5.0 — repository, licensing and Store preparation

- 39 native release tests, Rust formatting checks and the Windows NSIS build
  pass. Startup stays centered at 1440x960, without automatic maximization.
- Native printer commands retain the same Rust paths; the frontend selects the
  browser implementation only outside Tauri. The native installer bundles the
  project licence, attribution and commercial-use information as well as the
  existing offline WebView2 and dependency notices.
- Windows SDK MakeAppx 10.0.26100 validated and created an unsigned x64 MSIX
  using an explicit local validation identity. This proves package/manifest
  structure, not Store association, certification, installation or BLE behavior
  under a Store identity. The artifact is labelled `-validation.msix` and must
  not be submitted or installed as the final product.
- The owner subsequently supplied the real Partner Center identity. MakeAppx
  created `EZPZ-Label-Studio_1.0.0.0_x64.msix` for
  `Engineer101.EZPZLabelStudio` / publisher `Engineer101`, Store ID 9PNR3K65GQFL.
  The Store version starts at 1.0.0.0 separately from application 0.5.0, because
  Microsoft requires a nonzero package major and revision 0. A
  signed/Store-flight test and WACK check remain required. No live printer was
  connected or printed during these checks. The existing EXE is unsigned and
  cannot be submitted as-is through the Store EXE/MSI route.

## Version 0.4.2 — source cleanup

No Bluetooth, protocol, shutdown or window behavior changed. Startup remains a
centered normal window. Earlier generated diagnostics and build receipts cited
below are now in
`../../EZPZ-Label-Research/cleanup-2026-11-13-source-review/output/`.

## Version 0.4.1 — normal startup window

- Corrected the startup configuration to a centered, normal 1440x960 window.
  Maximizing remains available through the window controls.
- Title-bar initial state now matches the normal startup configuration.

## Version 0.4.0 — window integration and close confirmation

- Frameless window opens maximized. Integrated title-bar restore/maximize uses
  the window API with scoped permissions; minimum size is 1000x560 logical px.
- HTML5 file dropping is enabled by disabling Tauri's competing native drop
  handler on Windows. Browser DataTransfer drops pass; physical Explorer drag
  was not exercised in this round.
- Native close interception is armed after frontend event registration. The
  frontend immediately acknowledges a sequenced close request before awaiting
  the unsaved-work dialog. No user decision deadline is imposed; an unresponsive
  renderer that fails to acknowledge falls back to bounded exit after 3 seconds.
- Existing cancellation and Bluetooth cleanup remain on the final exit path.
- 39 release Rust tests and 30 frontend tests pass, including close-request
  state, stale acknowledgements and lifecycle cancellation coverage.
- Launched an isolated 0.4.0 release EXE/profile. Confirmed maximized Home,
  integrated restore control, native file picker, immediate image preview and
  automatic Horizontal orientation. Alt+F4 with imported files showed the
  warning and remained open beyond the watchdog. Keep working retained the
  upload. Opened the artwork, saved a template, then closed via title-bar X.
- After closure, the isolated app process and all WebView processes using its
  profile were absent. The final title bar also stays clickable above dialogs;
  headless verification confirms X warns and Keep working preserves the upload.
- No printer connection or print job was started during these UI checks.

## Version 0.3.2 — explicit shutdown

- Normal app exit now rejects new commands, cancels in-flight async work, waits
  for the Bluetooth mutex to be released, stops scanning and disconnects only the
  selected device. GATT sessions, interrupted notification subscriptions,
  discovery caches and adapter handles are released explicitly.
- Bluetooth cleanup is bounded to three seconds; the complete shutdown has a
  five-second deadline and then permits process exit. No tray/background mode
  is installed. Buffered data already accepted by a printer is independent of
  application shutdown and may finish printing.
- 35 release Rust tests pass. New tests cover lifecycle cancellation without a
  lost wakeup, rejecting new work after close, releasing an in-flight operation's
  mutex, idempotent cleanup, partial cleanup failures and concurrent timeouts.
- Launched the exact 0.3.2 release EXE in an isolated temporary WebView profile.
  Idle close left no application/profile WebView processes. Then connected to
  the live DB403, clicked the native window X, and checked the process tree:
  all seven app-owned processes (one app and six WebView children) had exited.
- An independent native capability client subsequently scanned, connected to
  DB403, read its model and disconnected successfully. No print data was sent.
  It observed MTU 247 / 244-byte payloads. This verifies reconnection availability,
  not a live print-speed measurement.
- Evidence is under `output/diagnostics/shutdown-*.json`. The optional additional
  close-during-scan UI check was stopped by the user's physical Escape key before
  scanning started. No further desktop automation was performed; its isolated
  test window was left for the user to close.

## Version 0.3.1

- Replaced fixed 20-byte/10 ms sending for acknowledged links with negotiated
  ATT payload sizing, capped at 244 bytes, and an 8 KiB/s host ceiling. Windows
  GattSession supplies the live MTU; unavailable/invalid values use 20 bytes.
- Writes remain sequential and acknowledged. Acknowledgement time contributes
  to pacing; it is no longer followed by an unconditional 10 ms sleep.
  Unacknowledged-only links retain the original 20-byte/10 ms policy.
- Progress is throttled by time rather than divisibility of the byte count,
  so larger packets still produce regular updates. Receipts include timings and
  negotiated-size provenance. Cancellation, bounded timeouts and no replay remain.
- 29 release Rust tests pass, including eight asynchronous transport tests.
- The supplied PDF produced 8,754 encoded bytes at 812×1218 pixels. Its old
  sender needed 438 packets and 4.37 seconds of explicit sleeps before Bluetooth
  latency. Import/render and compression measurements are in `output/performance`.
- Encoding/band sizes are unchanged. No live throughput or new physical print
  was tested while the user's printer session was active; simulated timings do
  not establish the printer's negotiated MTU, sustained speed or output quality.

## Version 0.3.0

- Updated Windows x64 release and self-contained NSIS installer are generated
  with `tauri build --bundles nsis`; hashes are collected in the versioned receipt.
- Native window background is set before web content loads. Critical HTML and
  a shadcn loading screen cover browser and application-module initialization.
- Packet bytes and Bluetooth behavior are unchanged except for user-facing
  provenance wording. No new physical print or installer installation is claimed.
- Current frontend behavior is covered by headless UI, packaged-CSP and simulated
  hardware tests documented in `frontend-testing.md`.

## Version 0.2.0 — EZPZ Label Studio

- Optimized release compilation passes. Product/window name is EZPZ Label Studio,
  with a locally rendered theSVG duotone printer icon.
- 21 exact-source Rust protocol, transport and capability tests pass; full Cargo
  check passes. The DB403 model inquiry returned ASCII `DB403` 82 ms after the
  write. See `../../EZPZ-Label-Research/db403-capabilities-model.json`.
- Standard GATT identity was identified as the Feasycom radio module. DPI, maximum
  width and loaded stock dimensions remain unknown/manual. No print, calibration
  or configuration command was issued during capability testing.
- Installer configuration uses the complete offline WebView2 installer, with
  application assets and third-party notices included locally.
- Final `tauri build --bundles nsis` completed successfully after frontend QA.
  The NSIS script embeds the Microsoft-signed offline WebView2 installer and
  third-party notices. The release EXE is 12,445,184 bytes; final artifact hashes
  are in `../../EZPZ-Label-Research/legacy-builds/build-receipt-0.2.0.json`.
- Further native UI automation was stopped by the user's physical Escape key.
  The revised native UI and installer installation have not been exercised.
  Headless frontend checks are documented separately in `frontend-testing.md`.

## Version 0.1.0 — previous physical and native UI checks

- Built the Tauri Windows x64 application with embedded production frontend assets. Portable EXE: 15,657,472 bytes. NSIS installer: 3,471,247 bytes. The original build receipt is archived outside the project under `../../EZPZ-Label-Research/legacy-builds/build-receipt-0.1.0.json`.
- Launched the portable EXE. Native window rendered the label canvas, layers, settings and hardware controls at its default desktop size.
- Used the app's Find Bluetooth printer control; DB403 appeared. Selected it and observed Connected to DB403, Connected over Bluetooth, and enabled print controls.
- Opened PNG export through the app; the native Windows Save As dialog appeared. Input activity from the user interrupted the save verification, so control was left to the user. A completed native PNG file save was not claimed. Browser PNG/JSON exports were independently verified.
- Stopped the owned Vite development server and QA browser session; the native app was left open.
- Before UI validation, the exact Rust encoder and transport sent one diagnostic label: 60×90 mm, 203 DPI, ZPL, 3,046 bytes, 153 acknowledged BLE chunks. User reply: “Yes, the label printed correctly”. This was through the diagnostic executable using the app's exact modules, not the desktop Print button.
- 15 Rust protocol/transport tests and 10 frontend tests passed. The packaged application's build passed. Installer creation succeeded; installing it was not part of verification.

Other printer models, TSPL physical output, barcode scanner decoding, long batches, and cancellation during a live print remain unverified.
