# Project cleanup — 2026-11-13

## Full source review — version 0.4.2

- Reviewed the React/TypeScript module graph, Rust modules and examples, build
  scripts, dependency manifests, styles, documentation and bundled assets.
  All application modules are reachable and all direct dependencies have a
  runtime, build or type-checking purpose. Official shadcn component APIs,
  diagnostic tools, test suites and offline PDF resources remain in use.
- Removed 33 obsolete CSS selectors and 12 superseded declarations: old canvas
  controls/resize handles, pre-shadcn fields/notices/empty states and the former
  import preview. The layout stylesheet is 191 lines shorter. Removed two unused
  icon exports and made the internal Theme type private.
- Compared 20 before/after rendered states across light/dark themes and
  1440x960/1024x720: computed layout and appearance are identical. Home, creation,
  saved templates/export, printer selection, PDF import, artwork editing, zoom
  and unsaved-work confirmation all passed without browser errors.
- Archived 67 historical screenshots, one-off QA scripts/fixtures, diagnostics,
  benchmarks and superseded build receipts outside this application project in
  `../../EZPZ-Label-Research/cleanup-2026-11-13-source-review/`. Every archived file
  was SHA-256 verified after moving; `_cleanup-manifest.json` records them.
- Removed five superseded generated installers and the obsolete 0.3.1 portable
  EXE (1,117,078,756 bytes total). `_removed-generated-builds.json` in the same
  archive records paths/hashes.
  The current portable application, offline installer, active release cache,
  dependencies and user templates are retained.
- All generated output folders are now ignored. Removed the obsolete in-project
  research watch exclusion. Current QA scratch files are in the system Temp
  directory instead of the application source tree.
- Thirty frontend tests, 39 Rust library tests, production compilation, all four
  native diagnostic/example builds and NSIS packaging passed. The scan-only
  example retains unused-code warnings for shared print paths it does not call;
  those paths are used by the actual application. No hardware was contacted.
  The owned QA server was stopped. Installed dependencies and their cache are
  retained.

## Earlier cleanup record

Original reference-package research was moved outside this application project
to the sibling `../../EZPZ-Label-Research` directory. All 78 original research
files were SHA-256 checked before and after the move; their contents are
unchanged. The archive also retains the historical diagnostic PNG, the initial
build receipt, and two investigation helpers that the application does not use.

| Action | Files removed from project | Bytes |
|---|---:|---:|
| Original research archived | 78 | 86,488,142 |
| Historical support files archived | 4 | 25,175 |
| Obsolete files sent to Windows Recycle Bin | 5,542 | 4,203,180,545 |
| Total removed from project | 5,624 | 4,289,693,862 |

Recycled items include the obsolete Rust debug cache, old application binaries,
unused Android/iOS/macOS/MSIX icons, generated schemas, old browser-session
artifacts, superseded editor screenshots, and the obsolete round-trip fixture.
This is reversible cleanup; the byte count describes removal from the project,
not space permanently freed from the disk.

Preserved: the current portable application and installer, version 0.2 build
receipt, Rust release cache, dependencies, production assets, current QA scripts
and their PDF/CSV/PNG fixtures, and current Home/import/blue-theme screenshots.
The exported-label PNG is retained because the current import QA uses it.
Only `icon.ico` and `icon.png` remain in the native icon directory.

The archive's `_archive-integrity.json`, `_archived-support-files.json`, and
`_cleanup-recycle-record.json` contain detailed records. Future builds may
recreate ignored build information and generated schemas. `.gitignore` covers
those files, browser-session caches, temporary files, and generated diagnostics.
