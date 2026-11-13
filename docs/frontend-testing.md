# Frontend validation

## Version 0.6.1 — tooltips and proportional handles

- 75 frontend tests pass. Crop geometry covers every edge, proportional corner
  clamping and Shift-unlocked corners. Resize tests cover eight object handles,
  proportional corners, independent sides, text scaling and snapping.
- Actual Chromium pointer checks passed eight crop handles, corner aspect lock,
  Shift toggling during a drag, independent side cropping, object side resizing
  and text corner scaling. Image side resizing changes the frame while preserving
  the source's proportions; use Crop for trimming the source image.
- Installed the official shadcn Tooltip component. All 13 text creator-bar icons
  passed hover checks; keyboard focus also displays the tooltip. Toggle selection
  state remains separate from tooltip open state. Image Crop uses the same tooltip.
- Corner gestures preserve proportions by default; Shift unlocks them. Crop arrow
  keys follow the same policy; Alt increases keyboard adjustment steps.

## Version 0.6.0 — final editor feature pass

- 69 frontend tests pass, including CSV component IDs and required headers,
  sample CSV round trips, imported settings, rotated geometry, proportional text
  resizing, template bulk validation and storage error preservation.
- Actual Chromium (Browser plugin unavailable) exercised Component ID editing,
  sample CSV download, two-row CSV import, multi-file template import and reload
  persistence. No page errors occurred.
- Rendered pointer interactions verified proportional text resizing, horizontal
  and vertical centering, rotated alignment, draggable rotation with Shift steps,
  snapping guides and cleanup after drag. RTL/right alignment and font selection
  were exercised through the controls.
- Browser pixel assertions checked text alignment/direction, QR transparent
  background layering and center logo toggles, barcode text visibility, line and
  border thickness, cropping, arbitrary rotation and distinct CSV-row output.
- PDF import showed a blurred low-resolution page and circular preparation
  progress before the full raster finished. Applying pages 1–2 and opening the
  workspace succeeded. PDF decoding/rasterization is done during import; the
  bounded prepared-label cache reuses unchanged previews for printing. Progress
  percentages indicate preparation phases, not network upload bytes.
- Final follow-up UI checks passed the contextual icon toolbar at 1024x720,
  all six component rotation handles (Snap/Alt/Shift policies), 1 mm resize
  snapping, wheel zoom in both previews and unchanged preview-caption geometry
  while zooming. Fields have 4 px label gaps and 12 px bottom padding.
- Visual crop pointer tests passed corner resizing, moving, Cancel preservation,
  Apply commit and Reset. The source remains visible with excluded areas shaded.
- Switching templates clears stale CSV batches; importing CSV clears the PDF
  queue, so only the currently selected data workflow is printed.
- New settings use shared frontend/rendering code in Windows and web. QR logos
  use high error correction and a small center footprint, but physical decoding
  with arbitrary logos, long CSV print batches and other printer models remain
  unverified. Current supported distributions are Windows x64 and the web app;
  no macOS/Linux/iOS Bluetooth certification is claimed.

## Version 0.5.1 — browser transfer performance

- All 47 frontend tests, TypeScript and production builds pass. Tests cover
  browser-reported payload limits, the DB403 model inquiry, rejected/truncated
  probes, silent notifications, uncertain-write timeouts, fallback packet sizes,
  sequential byte preservation and skipping timers when ACK latency has already
  consumed the pacing budget.
- A rendered simulated DB403 flow sent 2,891 encoded bytes in 12 sequential
  packets of at most 244 bytes. Model queries were 4 and 244 bytes; diagnostics
  contained transfer and preparation timings. No console/page errors occurred.
- An actual Chrome 157 / Windows 11 connection to DB403 verified the 244-byte
  packet using the padded model inquiry. The requested repeat of a 60 × 90 mm WORKSHOP / 001 sample
  reached Sent in 896 ms, including about 734 ms transfer and 17 ms encoding.
  The owner confirmed correct physical output. An earlier 935 ms run was
  interrupted by printer power loss after transfer; it was not counted as
  physical-output confirmation. These are small sample timings, not PDF timings.
- Native command-bridge tests verify packed monochrome rows replace RGBA JSON,
  preserving metadata and reducing raw raster bytes by 32 times at aligned widths.
  Single-label preflight rendering is reused for transmission. Existing batch
  validation still runs before the first label is sent.
- The unacknowledged-only policy remains 20-byte packets / 10 ms pacing. Other
  printer profiles retain conservative sizing unless the browser reports a limit.
  The host ceiling remains 8 KiB/s; no print is automatically replayed.

## Version 0.5.0 — web edition

- Thirty-eight frontend tests pass, including browser raster packing, alpha and
  white edge padding, TSPL polarity, zlib/base64 band round trips, invalid jobs,
  browser permission selection, ambiguous endpoints, partial-job cancellation
  and cleanup of a connection completing after timeout.
- Built the production web edition at `/EZPZ-Label-Studio/` and tested using the
  existing headless Playwright Chromium runtime (Browser plugin unavailable).
  Light/Dark screens, initial Home fit, immediate PDF preview and all subpath
  assets passed without console/page errors or failed asset requests.
- Browser window controls are omitted. A beforeunload warning protects dirty
  browser work; import cancellation still uses the shadcn unsaved-work dialog.
- A simulated DB403 passed the rendered selection → connect → workspace → print
  flow: 145 sequential chunks, max 20 bytes each, compressed ZPL with the correct
  final print command. No real Bluetooth device was used for these tests.
- Support/privacy pages and bundled licence/notice resources are available in
  the web build. README images use synthetic workshop content, not user artwork.
- Native Tauri commands still use the existing Rust implementation through a
  shared command bridge. Browser device/profile support remains experimental;
  real browser-to-printer output is not yet physically verified.

## Version 0.4.2 — cleanup regression checks

The source cleanup removed only unused styles/exports. Twenty before/after
states at 1440x960 Light and 1024x720 Dark produced identical computed appearance
and geometry with no browser errors. Checks cover Home (no initial scrollbar),
new-label settings, the editor, saved templates and export, printer selection,
immediate PDF preview, prepared artwork, zoom and unsaved-work confirmation.
Browser plugin not available; used existing headless Playwright Chromium.

Earlier generated screenshots, scripts and fixtures referenced below were
archived with SHA-256 verification under
`../../EZPZ-Label-Research/cleanup-2026-11-13-source-review/output/`.

## Version 0.4.0

- Browser plugin/skill unavailable; used existing headless Playwright Chromium
  against http://127.0.0.1:1420. App identity, meaningful content, error overlays,
  console health, screenshots and interactive state changes were checked.
- Real DOM DataTransfer file drops add/select artwork. Image and first PDF page
  preview automatically; applying PDF page ranges replaces that PDF batch without
  duplicates. Errors and the pixel budget preserve existing artwork.
- Orientation follows source aspect ratio, labels appear below page icons, and
  Vertical/Horizontal swap stock dimensions. Margin/scale affect committed print
  geometry; preview zoom/pan do not. Rotated-image resize and numeric size changes
  preserve aspect ratio. Middle-button panning does not drag label elements.
- Close warning supports Keep working, explicit save/export, further edits and
  opt-out persisted only on confirmed discard. Default Home does not warn.
- Prepared-notice checkmark aligned; diagnostic action remains small, muted and
  transparent on hover. Printer rescan mock verifies top-right placement, redo
  icon, spinner and busy-state disabling, without hardware calls.
- Initial Home has no scroll overflow at 1600x1000, 1440x900, 1229x691 and
  1024x720. Header actions/tabs fit at 1024/1229. Saved libraries can scroll as
  their contents grow. Physical labels remain white in light and dark themes.
- Four sample templates validated through the production parser and imported
  through the UI from Downloads/EZPZ Sample Templates.
- Thirty frontend unit tests and TypeScript/Vite production build pass.
- Windows Explorer-to-WebView drag was not physically exercised; native
  dragDropEnabled:false removes Tauri's documented HTML5 drop interception.

## Version 0.3.1

- Thumbnail previews now have explicit 64×80 geometry with a 24×24 delete button
  above the top-right corner. Legacy CSS no longer conflicts with shadcn sizing.
- Headless checks selected the second page, removed the first, verified the
  remaining selection/count, and removed the final page to reach the empty state.
  No console/page errors. See `thumbnail-delete-fixed.png` under QA output.
- Print progress now accepts elapsed-time and transfer-rate fields and displays
  elapsed seconds plus a remaining-time estimate once enough data is available.
- The frontend unit suite remains 20 passing tests; TypeScript/Vite builds pass.

## Version 0.3.0

- Official shadcn components installed with the CLI; cards, dialogs, tabs, form
  controls, selection menus, alerts, badges, progress, empty states and startup
  feedback use those components. Icons use the locally bundled duotone set.
- Twenty frontend tests pass, including atomic template bundle validation and
  automatic printer format selection. TypeScript and production Vite builds pass.
- Home tests cover keyboard card activation, a visibly blue hover border/ring,
  23 size choices, single/bundle template imports, selection of exported templates,
  actual JSON download and reimport, and malformed bundle rejection without changes.
- Light/Dark/System preferences and reload persistence pass. Home, export dialog,
  artwork import and workshop screens were inspected in headless Chromium.
- The HTML bootstrap displays themed loading text before JavaScript. The lazy
  application uses a shadcn Card, Spinner and Skeleton while loading. Testing held
  script requests to verify both loading phases before allowing the app to open.
- Production assets served under the exact packaged CSP pass image fit/match and
  two-page PDF import with zero external requests and zero console/page errors.
- Printer dialog opens from Home and the workshop. Its native branch was checked
  with explicitly simulated scan/connect responses: two listed devices, selection,
  connected state, no print command. This is not a new physical hardware test.
- Slider keyboard input and the 1024×720 layout pass. Removed footer text and the
  printer-language control are absent. Print format is derived internally.

Current QA scripts and screenshots are under `output/playwright`, including
`qa-shadcn-startup.cjs`, `qa-printer-mocked.cjs` and `qa-shadcn-home.cjs`.

## Earlier validation

Validated on Windows on 2026-11-13. This report covers the editor and raster preparation, not physical printer compatibility.

## Checks

- TypeScript and Vite production build pass (`npm run build`). PDF.js is loaded only when a PDF is opened; its worker is bundled locally.
- Vitest validates document round trips, dimensions, duplicate element IDs, safe embedded image imports, legacy font/barcode/protocol defaults, imported font/barcode/protocol choices, physical pixel conversion, CSV quoting/malformed rows, variable substitution, and monochrome conversion.
- Real Chrome at `http://127.0.0.1:1420` was exercised using Playwright CLI. The initially available Playwright MCP became unavailable, and the IAB connection timed out, so the CLI was used for actual browser verification.
- Edited a text element to Hebrew, selected RTL direction and right alignment, duplicated/deleted the element, restored it with undo, and saved a template. No rendering error was shown.
- Imported a two-row CSV, selected row two, verified its values, and enabled batch printing. Printing remained disabled in the browser because no native connection existed.
- Imported a two-page PDF, verified its page queue, and selected page two. The monochrome canvas was 480 × 719 pixels for 60 × 90 mm at 203 dpi, without rendering errors.
- Exported a label JSON file and imported that actual file successfully.
- Switched the printer language between TSPL and ZPL. Exported the actual PNG; the 480 × 719 bitmap contained 30,042 black pixels in the inspected sample.
- Selected EAN-13, rendered `5901234123457`, then changed its check digit to `5901234123458` and observed the expected validation error. Restored Code 128 and verified that the error cleared. Selected Consolas for an existing text layer.
- Checked desktop layouts at 1365 × 900 and 1024 × 720. Side panels scroll independently at the smaller height; the header Print action stays visible. This is a desktop application, not a mobile website.

## Visual inspection

Earlier editor screenshots were inspected with the image viewer and have since been superseded by the blue-theme screenshots listed below. The exported-label fixture is retained for current import QA. Compared the header controls, tool and layer panels, label dimensions, monochrome preview, font clarity, barcode digits, printer-language selector, and smaller-window scrolling.

An earlier screenshot revealed squashed barcode digits. The renderer now measures the barcode at a one-pixel module width, then regenerates it at its final integer module width with ten-module horizontal quiet zones. It draws the resulting bitmap at its native size instead of stretching its text. The corrected exported PNG visibly contains complete, readable digits. Physical barcode scanning is still unverified.

Vite initially exited while watching locked Rust build executables. `vite.config.ts` now ignores `src-tauri`, `research`, and `output`; subsequent editor/PDF checks ran successfully. An initial favicon 404 was resolved with an embedded SVG favicon.

## Boundaries

- The UI is an independent desktop label editor. It does not reproduce the reference Android app's accounts, cloud templates, subscriptions, OCR service, or every specialized Android workflow.
- Font choices use installed Windows fonts. Five linear barcode formats and QR are offered; unsupported content and insufficient code dimensions prevent printing.
- CSV batches and PDF page queues are local session state. The current label autosaves; the template library and exported JSON preserve reusable single-label designs. The whole PDF/CSV batch is not automatically persisted.
- All rows are rendered before a batch starts transmitting, so invalid later-row code content is detected before paper is used. Transmission failures report how many earlier jobs were already sent. Native cancellation may leave data buffered in the printer; the native backend defines that behavior.
- Native BLE discovery, connection, save dialogs, transmission, and physical print quality require separate native/hardware validation.
- Raster bounds are 10–216 mm wide, 10–500 mm tall, and at most eight million pixels. These are software limits, not a claim that every printer can print that width.


## EZPZ Label Studio 0.2.0 expansion

Headless Chromium QA completed on 2026-11-13 without desktop or native input. Repro scripts: `output/playwright/qa-expansion.cjs` and `qa-packaged.cjs` (use the locally cached Playwright module path recorded in each script).

- Home opens first; New Label, artwork upload, resume and local template actions are available. Exact picture sizes preserve101.6x101.6,101.6x152.4,101.6x203.2mm. Workshop stock is labeled separately.
- System theme responds to simulated OS dark/light changes. Explicit Dark survives reload; switching back to Light works. Both themes inspected visually. Screenshots disable CSS transitions to avoid capturing intermediate colors.
- Image fit and match-size modes preview successfully;480x719px at203dpi matches60.06x89.96mm. Monochrome editor preview remains white paper in dark mode.
- Two-page PDF imported and page2 selected; imported page edits are retained when switching pages. Current protocol, DPI, density, threshold and gap apply across a queued job; artwork dimensions remain per page.
- Browser printing stays disabled. Native capability fields display only reported model/DPI/width, with unknown DPI/width explicitly shown as not reported. No capability response has been fabricated.
-1024x720 editor has no horizontal document overflow.1365x900 Home, import and editor screenshots inspected.
- Production `dist` served with the exact Tauri CSP response header from src-tauri/tauri.conf.json. All external network requests blocked: zero external requests and zero page/console errors. Local PDF worker and local LiberationSans-Regular.ttf loaded; two-page PDF preview rendered. This exercises browser CSP and offline paths, not the native WebView itself or every PDF codec/CMap.
-15-page PDF exceeding40million decoded pixels rejected without partial import. Cancel during active PDF rendering closes the flow without page errors; destroyed worker promises are handled.
-Unit suite:15tests covering schema validation, barcodes/fonts, CSV, exact picture presets, page selection, artwork fit, dimensional/raster limits. Production TypeScript/Vite build passes.

Screenshots: `output/playwright/home-light.png`, `home-dark.png`, `import-image-fit.png`, `import-image-match.png`, `import-pdf.png`, `import-packaged-csp.png`, `editor-blue-light.png`, `editor-blue-dark.png`, `editor-blue-1024.png`.

Limits: theme and editor checked headlessly; no new physical print or native UI interaction during this expansion. PDF budget is40MP decoded raster across up to50pages/images. PDF dimensions come from pages; raster image sizing uses explicitly selected source DPI. GIF imports a decoded frame, not animation. Native label stock size is manually chosen. Advanced reference-app multirow/shape/black-mark configuration is cataloged but not claimed implemented.
