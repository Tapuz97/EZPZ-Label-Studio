# Printable icons and SVG/PNG artwork — unreleased branch

Implemented on `feature/printable-icons-svg-import`. App and Store versions remain
0.7.3 / 1.2.3.0. No release or deployment is part of this change.

## Usage

- Choose **Icons & emoji artwork** from Design or the creator toolbar.
- Search the bundled Lucide library, including aliases such as “smile” and common
  terms such as “shipping”. Pagination keeps the dialog responsive.
- Use **Import SVG / PNG** to choose or drop up to ten files. Transparency and
  proportions are preserved. New artwork is a normal image element, with the
  existing crop, resize, rotate, alignment and layer controls.
- SVG files also work through Image, Upload & prepare and QR-logo upload.
- Templates store prepared PNG data, so sharing a template does not depend on
  the original file or icon library being present on the receiving computer.

## Verification

Verified 2026-11-16. Browser plugin unavailable; rendered checks used Playwright.

- 214 Vitest checks pass, including catalog uniqueness/search/serialization,
  geometry, artwork-name round trips and DOM-based SVG sanitization tests.
- Desktop/web production builds and native `cargo check --all-targets` pass.
- The catalog is a separate lazy-loaded build asset, bundled locally. No icon
  CDN or remote lookup is used. `npm run icons:generate` regenerates it from the
  installed Lucide 1.72.0 package; the current catalog contains 2,052 icons.
- Browser checks cover search, pagination, no results, icon insertion, SVG/PNG
  bulk import, drag/drop, aspect ratios and transparent pixels.
- An exported template containing an icon, SVG and transparent PNG was imported
  into a fresh browser context. The rendered preview matched the prepared output.
- Verified SVG preparation through Upload & prepare and the QR center-logo input.
- Verified undo/redo and rotated imported artwork in the print paths.
- Web print RGBA (1,380,480 bytes) and Windows UI packed raster (43,140 bytes)
  matched the preview exactly using simulated printer connections. No physical
  print was sent; printer protocols and transport code are unchanged.
- SVG checks cover namespace-less files, viewBox dimensions, CSS styles, gradients,
  internal symbols, script/event/foreign-object removal, external references,
  embedded raster images, malformed XML, entity declarations and invisible artwork.
  The browser gradient check retained the black-to-white ramp, executed no SVG
  script and made zero external requests.

SVG files are converted locally to PNG before entering the document. Scripts and
interactive content are removed; linked images/fonts/stylesheets are rejected.
Input limits are 5 MB per artwork file, 20 MB per multi-file selection and 32
million pixels for raster decoding. Existing QR-logo size limits are retained.
Generated images are bounded to 2,048 pixels on their longest edge (1,024 for
library icons; 2,400 through artwork preparation; 256 for QR logos).

The Lucide ISC notice and DOMPurify Apache-2.0 license text are included in
`THIRD_PARTY_NOTICES.txt`. The existing Unicode emoji/font workflow is unchanged.
