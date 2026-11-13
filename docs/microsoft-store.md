# Publish EZPZ Label Studio to Microsoft Store

This is a submission guide and packaging workflow. Store publication,
certification, local signing and packaged-app installation testing are not yet
complete.

The product is now reserved: **Engineer101.EZPZLabelStudio**, publisher
**Engineer101**, Store ID **9PNR3K65GQFL**. The public package identity supplied by
the owner is recorded in [store-identity.json](../packaging/store-identity.json).
The licence holder and support contact remain Gal Mitrani / gm@galmitrani.com.

## 1. Register the publisher and reserve the name

1. Start at [storedeveloper.microsoft.com](https://storedeveloper.microsoft.com/).
   Microsoft's current onboarding flow has no registration fee. Choose the
   Individual or Company account that matches your circumstances; Microsoft
   documents the distinctions and identity/business verification in its
   [account guide](https://learn.microsoft.com/en-us/windows/apps/publish/partner-center/open-a-developer-account).
2. Complete the account sign-in and identity/business verification yourself.
   Do not put passwords, ID documents, certificates or secrets in this repo.
3. In Partner Center, open **Apps and games** and create a Windows application.
   For the recommended route below, select an MSIX/APPX submission rather than
   an EXE/MSI listing. Reserve **EZPZ Label Studio**, subject to name availability.
4. Open **Product management → Product identity**. Copy the exact **Package/Identity
   Name**, **Publisher** (`CN=...`) and **Publisher display name**. These values are
   assigned by Microsoft; the GitHub name and `com.local.blelabelstudio` are not
   substitutes. These are public package metadata, not login credentials.

## 2. Build an MSIX with that identity

MSIX gives Store-managed hosting, signing and updates. Microsoft accepts MSIX
packages made outside Visual Studio; see its [package requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/package-version-numbering).

On Windows, install the Windows SDK (MakeAppx) and the project's normal build
prerequisites, then run:

```powershell
npm ci
npm run tauri -- build --no-bundle
./scripts/package-store.ps1
```

The script stages the current executable, original printer icon at the required
manifest sizes, licence/attribution and dependency notices. It creates a 4-part
versioned x64 MSIX under `output/microsoft-store` and validates it with the SDK's
[MakeAppx tool](https://learn.microsoft.com/en-us/windows/uwp/packaging/create-app-package-with-makeappx-tool).
It does not install the package or alter Windows security settings.
The script defaults to the reserved identity in `packaging/store-identity.json`;
its identity parameters can be overridden explicitly for a different product.
The Store package version is **1.1.0.0**, tracked separately from the application's
0.6.0 version in that identity file. Microsoft requires a nonzero package major
and reserves the final component as 0. Increment `packageVersion` before future
Store submissions; `-PackageVersion` can override it explicitly.

The package declares `runFullTrust` because this is a Tauri/Win32 desktop app,
and Bluetooth capability for printer communication. Explain these capabilities
in certification notes. The first MSIX version must be higher than any previous
version submitted for the same product identity.

The current MSIX packaging path expects an installed **Evergreen WebView2
runtime**. Windows configurations without WebView2 need to be handled and tested
before submission; the MSIX does not contain the NSIS offline runtime installer.
Use a clean Windows test machine to verify this prerequisite. The separate NSIS
installer already includes the offline WebView2 installer.

## 3. Test the packaged application

An unsigned MSIX is a submission artifact, not a directly installable download.
For local testing, use a separately signed test copy or a Store flight with the
correct product identity. Microsoft replaces package signatures for Store
distribution. Do not upload signing keys to the repository.

Run the **Windows App Certification Kit** and a real packaged-app test. Verify:

- Launch, import PDF/images, fonts/RTL, saved templates and export.
- DB403 discovery, connection, a deliberately requested physical test print,
  cancellation, and connect → close → reconnect.
- Window close confirmation and resource release with the MSIX identity.
- WebView2 availability, clean install/uninstall, updates, and profile storage.

Native unpackaged DB403 printing was previously verified. That does not replace
MSIX-specific installation and certification tests. Never submit the
`-validation.msix` preflight artifact generated with an unreserved identity.

## 4. Complete the listing

Use [store-listing.md](store-listing.md) as a starting point. Supply actual
Windows app screenshots after the packaged app is tested; README screenshots
are of the shared web interface and are not substitutes for that test.

- Support/contact: **gm@galmitrani.com**
- Support website: <https://tapuz97.github.io/EZPZ-Label-Studio/support.html>
- Privacy policy: <https://tapuz97.github.io/EZPZ-Label-Studio/privacy.html>
- Category: Utilities (choose the matching current Partner Center category).
- Complete age rating, markets, availability, pricing and accessibility fields.
- Retain the noncommercial/commercial-use terms in the listing and EULA fields.
  Free download does not grant commercial rights. Choose actual Store pricing
  separately; this project has no in-app payment or licence enforcement service.

Confirm the support/privacy URLs are publicly reachable before submitting.
Review product claims: most EZlabel-family BLE printers are the intended target,
but only DB403 printing on Windows and Chrome/Windows 11 has been physically verified. Niimbot, iPrint,
Labelife, Nelko, Jadens, Pixmate, and other families support is a future investigation, not a feature claim.

## 5. Submit for certification

Upload the MSIX with the real product identity, complete certification notes,
review the generated submission and submit. Certification and publication are
Microsoft's process and can require changes. Use a flight first if appropriate.

## Alternative: list the existing EXE installer

[Tauri's Store guide](https://v2.tauri.app/distribute/microsoft-store/) documents
the EXE/MSI route. The NSIS installer supports silent installation with `/S`
(uppercase), and already includes offline WebView2. However:

- The current installer/application are **unsigned**.
- The installer and its PE files need a valid CA-trusted code-signing certificate.
- Microsoft requires a public, immutable, versioned HTTPS download URL.
  A private GitHub release download is not a suitable public Store installer URL.
- EXE/MSI updates need an application/installer update strategy; this app has no
  automatic updater. MSIX avoids that extra distribution responsibility.

See Microsoft's [EXE/MSI requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/app-package-requirements).
Do not submit the current unsigned installer through this route.
