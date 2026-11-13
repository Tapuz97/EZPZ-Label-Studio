# Store listing draft

**Product:** EZPZ Label Studio<br>
**Publisher:** Engineer101<br>
**Support:** gm@galmitrani.com

**Reserved Store ID:** 9PNR3K65GQFL (publication pending certification).

## Short description

Design labels, prepare PDF artwork and print over Bluetooth—without a phone or an account.

## Description

EZPZ Label Studio is a desktop workspace for thermal labels. Start from a blank
label, reuse a saved template, or upload images and PDF pages. Preview the final
monochrome output, set the stock size and print to a supported Bluetooth label
printer.

Create text, barcodes and QR codes; resize and rotate artwork; import template
bundles; and use CSV data for repeated labels. Automatic artwork orientation,
print scale, inset margins, preview zoom and middle-button panning help prepare
the layout before printing. Appearance follows the system by default, with a sun/moon toggle for a remembered preference.

Files and templates are processed locally. No application account or cloud
document service is required. The Windows installer bundles the application
assets locally; Bluetooth printing requires a compatible printer and Windows
Bluetooth support.

The intended target is most BLE printers compatible with the EZlabel app.
BPXX DB403 printing has been physically verified; other models require further
testing. Printer discovery alone does not establish print compatibility. Stock
size and DPI must be set manually when the printer does not report them.

Original project code is licensed for permitted noncommercial purposes under
PolyForm Noncommercial 1.0.0. Commercial use outside those purposes requires a
separate paid written agreement with Gal Mitrani: gm@galmitrani.com. Downloading
the app does not itself grant a commercial licence.

## Features

- PDF and common-image artwork import with immediate previews.
- Text, barcode, QR, image, line and border tools.
- Common label sizes, custom dimensions and automatic artwork orientation.
- Local template library with JSON import/export, PNG export and CSV data.
- Monochrome preview, artwork sizing, zoom and middle-button pan.
- Supported BLE printer selection, transfer progress and cancellation.
- Blue theme with system-default appearance and a Light/Dark icon toggle.

## Certification notes draft

This is a full-trust Win32/Tauri desktop application. `runFullTrust` is required
for the desktop process and Bluetooth is used only for a printer explicitly
selected by the user. No account is required. A physical supported BLE printer
is required to validate printing; BPXX DB403 is the verified native model.
Printing sends thermal-label commands to the chosen printer and may consume a
label. No physical print should be initiated without preparing the printer.

The MSIX path requires an installed WebView2 runtime. Certification tests,
actual package identity, Store pricing/EULA and packaged-app screenshots must
be completed before this draft is submitted.
