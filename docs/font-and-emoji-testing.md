# Font and emoji verification — 0.7.3

Verified on 2026-11-15. Browser plugin unavailable; rendered checks used Playwright.

- All 192 frontend tests passed, including font schema validation, embedded font
  round trips, missing/corrupt font rejection, SHA-256 validation, deferred font
  loading and Unicode grapheme wrapping.
- TypeScript and Windows/web production builds passed. The bundled Noto Emoji
  asset and its license are present in both build outputs.
- Actual TTF, OTF, WOFF and WOFF2 uploads loaded through the editor. Tested batch
  upload, both font selectors, IndexedDB persistence across reload and rejection
  of invalid files without changing the design.
- Exported a template using an uploaded WOFF2 font, imported it in a fresh browser
  context with an empty font library, and verified identical preview/output pixels.
- Visually inspected monochrome Unicode emoji, joined family emoji, skin tones,
  a regional flag, a keycap sequence, ASCII emoticons, numbers and Hebrew text.
- Verified picker insertion replaces the selected text and restores the cursor.
- The web print payload matched the preview pixels exactly. The native UI's
  43,140-byte packed raster matched the preview's monochrome raster exactly.
  These print checks used simulated printer connections; no physical print was sent.
- Verified the loaded custom font changes output pixels compared with Arial.
  No runtime page errors occurred during the successful flows.
- Checked the picker at desktop and narrow viewport widths. The editor retains
  its existing desktop layout; this change does not redesign mobile editing.

Font coverage is determined by the selected font and the bundled emoji font.
Custom font uploads are limited to 2 MB per file, 4 MB of font files per design,
and a local library of 20 fonts totaling 20 MB. Fonts load before preparing the
preview, PNG export and printer raster; exports include the fonts a design uses.
