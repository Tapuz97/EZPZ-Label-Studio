param(
  [string]$IdentityName,
  [string]$Publisher,
  [string]$PublisherDisplayName,
  [string]$PackageVersion,
  [string]$MakeAppxPath,
  [switch]$ValidationOnly
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$identity = Get-Content -LiteralPath (Join-Path $projectRoot 'packaging/store-identity.json') -Raw | ConvertFrom-Json
if (-not $IdentityName) { $IdentityName = $identity.identityName }
if (-not $Publisher) { $Publisher = $identity.publisher }
if (-not $PublisherDisplayName) { $PublisherDisplayName = $identity.publisherDisplayName }
if (-not $PackageVersion) { $PackageVersion = $identity.packageVersion }
$parsedVersion = [Version]::Parse($PackageVersion)
if ($PackageVersion -notmatch '^\d+\.\d+\.\d+\.0$' -or $parsedVersion.Major -lt 1 -or $parsedVersion.Major -gt 65535 -or $parsedVersion.Minor -gt 65535 -or $parsedVersion.Build -gt 65535) {
  throw 'The Store package version needs four parts, a nonzero major, components <=65535, and revision 0.'
}
$config = Get-Content -LiteralPath (Join-Path $projectRoot 'src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json
if ($IdentityName -notmatch '^[A-Za-z0-9.-]{3,50}$' -or $IdentityName -match 'PLACEHOLDER|CHANGEME' -or $Publisher -notmatch '^CN=') {
  throw 'Copy the exact Identity Name and Publisher (CN=...) from Partner Center > Product identity.'
}
if (-not $MakeAppxPath) {
  $sdkRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
  $MakeAppxPath = Get-ChildItem -LiteralPath $sdkRoot -Directory | Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName 'x64/makeappx.exe' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $MakeAppxPath -or -not (Test-Path -LiteralPath $MakeAppxPath)) { throw 'Install the Windows SDK MakeAppx tool first.' }
$outputRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'output/microsoft-store'))
if (-not $outputRoot.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Output must remain inside this project.' }
$stage = Join-Path $outputRoot ('stage-' + $config.version + '-' + [guid]::NewGuid().ToString('N'))
$assets = Join-Path $stage 'Assets'
New-Item -ItemType Directory -Path $assets -Force | Out-Null
$sourceExe = Join-Path $projectRoot 'src-tauri/target/release/ezpz-label-studio.exe'
if (-not (Test-Path -LiteralPath $sourceExe)) { throw 'Build the native application first: npm run tauri -- build --no-bundle' }
$actualVersion = (Get-Item -LiteralPath $sourceExe).VersionInfo.ProductVersion
if ($actualVersion -ne $config.version) { throw "Build version $($config.version) first; executable is $actualVersion." }
Copy-Item -LiteralPath $sourceExe -Destination (Join-Path $stage 'EZPZ Label Studio.exe')
foreach ($name in @('LICENSE','NOTICE','COMMERCIAL.md','THIRD_PARTY_NOTICES.txt')) { Copy-Item -LiteralPath (Join-Path $projectRoot $name) -Destination (Join-Path $stage $name) }
Add-Type -AssemblyName System.Drawing
$image = [Drawing.Image]::FromFile((Join-Path $projectRoot 'src-tauri/icons/icon.png'))
try {
  foreach ($size in @(44,50,150,300)) {
    $bitmap = [Drawing.Bitmap]::new($size,$size)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.DrawImage($image,0,0,$size,$size)
      $bitmap.Save((Join-Path $assets "Logo$size.png"),[Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
  }
} finally { $image.Dispose() }
$identityXml = [Security.SecurityElement]::Escape($IdentityName)
$publisherXml = [Security.SecurityElement]::Escape($Publisher)
$displayXml = [Security.SecurityElement]::Escape($PublisherDisplayName)
$version = $PackageVersion
$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10" xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10" xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities" IgnorableNamespaces="uap rescap">
  <Identity Name="$identityXml" Publisher="$publisherXml" Version="$version" ProcessorArchitecture="x64" />
  <Properties><DisplayName>EZPZ Label Studio</DisplayName><PublisherDisplayName>$displayXml</PublisherDisplayName><Logo>Assets\Logo50.png</Logo></Properties>
  <Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0" /></Dependencies>
  <Resources><Resource Language="en-us" /></Resources>
  <Applications><Application Id="App" Executable="EZPZ Label Studio.exe" EntryPoint="Windows.FullTrustApplication"><uap:VisualElements DisplayName="EZPZ Label Studio" Description="Design labels and print over Bluetooth" BackgroundColor="transparent" Square44x44Logo="Assets\Logo44.png" Square150x150Logo="Assets\Logo150.png" /></Application></Applications>
  <Capabilities><rescap:Capability Name="runFullTrust" /><DeviceCapability Name="bluetooth" /></Capabilities>
</Package>
"@
[IO.File]::WriteAllText((Join-Path $stage 'AppxManifest.xml'),$manifest,[Text.UTF8Encoding]::new($false))
$suffix = if ($ValidationOnly) { '-validation' } else { '' }
$package = Join-Path $outputRoot ("EZPZ-Label-Studio_$version`_x64$suffix.msix")
& $MakeAppxPath pack /o /d $stage /p $package
if ($LASTEXITCODE -ne 0) { throw 'MakeAppx validation failed.' }
Write-Output "Created unsigned package: $package"
if ($ValidationOnly) { Write-Output 'VALIDATION ONLY: this identity is not reserved in Partner Center. Do not submit it.' }
Write-Output 'Do not install this unsigned package directly. Use a separately signed test package for WACK/live testing. Store identity, WebView2 availability, BLE behavior and certification still require verification.'
