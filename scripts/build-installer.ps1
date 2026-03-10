$ErrorActionPreference = "Stop"

function Resolve-IsccPath {
  $fromPath = Get-Command iscc.exe -ErrorAction SilentlyContinue
  if ($fromPath) {
    return $fromPath.Source
  }

  $candidates = @(
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles}\Inno Setup 6\ISCC.exe"
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  throw "Inno Setup compiler not found. Install Inno Setup 6 and ensure ISCC.exe is available."
}

$root = Split-Path $PSScriptRoot -Parent
$packageJsonPath = Join-Path $root "package.json"
$installerScript = Join-Path $PSScriptRoot "installer.iss"
$sourceDir = if ($env:ZYPHER_PACKAGE_DIR) {
  if ([System.IO.Path]::IsPathRooted($env:ZYPHER_PACKAGE_DIR)) {
    $env:ZYPHER_PACKAGE_DIR
  }
  else {
    Join-Path $root $env:ZYPHER_PACKAGE_DIR
  }
}
else {
  Join-Path $root "release\Zypher-win32-x64"
}
$outputDir = Join-Path $root "release-installer"

if (-not (Test-Path $sourceDir)) {
  throw "Packaged app not found at '$sourceDir'. Run npm run build:exe first."
}

if (-not (Test-Path $outputDir)) {
  New-Item -ItemType Directory -Path $outputDir | Out-Null
}

$packageJson = Get-Content -Raw $packageJsonPath | ConvertFrom-Json
$version = [string]$packageJson.version
if ([string]::IsNullOrWhiteSpace($version)) {
  throw "Could not read version from package.json."
}

$iscc = Resolve-IsccPath
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outputBaseFilename = "Zypher-Setup-$version-$timestamp"

Write-Host "[Installer] Compiling Zypher installer with ISCC..."
& $iscc `
  "/DAppVersion=$version" `
  "/DSourceDir=$sourceDir" `
  "/DOutputDir=$outputDir" `
  "/DOutputBaseFilename=$outputBaseFilename" `
  $installerScript

if ($LASTEXITCODE -ne 0) {
  throw "ISCC failed with exit code $LASTEXITCODE"
}

Write-Host "[Installer] Created $outputBaseFilename.exe in $outputDir"
