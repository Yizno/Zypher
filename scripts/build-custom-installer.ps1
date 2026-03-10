$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
$packageJsonPath = Join-Path $root "package.json"
$installerOutDir = Join-Path $root "release-installer"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$packageOutDir = Join-Path $installerOutDir ("package-" + $timestamp)
$packagedDir = Join-Path $packageOutDir "Zypher-win32-x64"
$customBuildDir = Join-Path $installerOutDir ("custom-installer-" + $timestamp)
$payloadZip = Join-Path $customBuildDir "ZypherPayload.zip"
$templateCs = Join-Path $PSScriptRoot "custom-installer\InstallerShell.cs"
$generatedCs = Join-Path $customBuildDir "InstallerShell.generated.cs"
$iconPath = Join-Path $root "assets\icon.ico"

if (-not (Test-Path $templateCs)) {
  throw "Missing installer source at '$templateCs'."
}

if (-not (Test-Path $installerOutDir)) {
  New-Item -ItemType Directory -Path $installerOutDir | Out-Null
}

if (-not (Test-Path $customBuildDir)) {
  New-Item -ItemType Directory -Path $customBuildDir | Out-Null
}

if (-not (Test-Path $packageOutDir)) {
  New-Item -ItemType Directory -Path $packageOutDir | Out-Null
}

$packageJson = Get-Content -Raw $packageJsonPath | ConvertFrom-Json
$version = [string]$packageJson.version
if ([string]::IsNullOrWhiteSpace($version)) {
  throw "Could not read version from package.json"
}
$releaseLabel = if ($version -eq "1.0.0") { "V1" } else { $version }

Push-Location $root
try {
  Write-Host "[Custom Installer] Building app bundles..."
  npm run build
  if ($LASTEXITCODE -ne 0) {
    throw "npm run build failed with exit code $LASTEXITCODE"
  }

  Write-Host "[Custom Installer] Packaging app for payload..."
  $packagerArgs = @(
    ".",
    "Zypher",
    "--platform=win32",
    "--arch=x64",
    "--out=$packageOutDir",
    "--overwrite",
    "--asar",
    "--prune=true",
    "--icon=assets/icon.ico",
    "--ignore=^/src($|/)",
    "--ignore=^/electron($|/)",
    "--ignore=^/shared($|/)",
    "--ignore=^/release.*($|/)",
    "--ignore=^/tsconfig",
    "--ignore=^/vite\\.config\\.ts$",
    "--ignore=\\.test\\.ts$"
  )

  $packagerCli = Join-Path $root "node_modules\electron-packager\bin\electron-packager.js"
  & node $packagerCli @packagerArgs
  if ($LASTEXITCODE -ne 0) {
    throw "electron-packager failed with exit code $LASTEXITCODE"
  }

  if (-not (Test-Path $packagedDir)) {
    throw "Packaged app not found at '$packagedDir'."
  }

  Write-Host "[Custom Installer] Creating payload archive..."
  if (Test-Path $payloadZip) {
    Remove-Item -Force $payloadZip
  }
  Compress-Archive -Path (Join-Path $packagedDir "*") -DestinationPath $payloadZip -CompressionLevel Optimal

  $templateContent = Get-Content -Raw $templateCs
  $generatedContent = $templateContent.Replace("__APP_VERSION__", $version)
  Set-Content -Path $generatedCs -Value $generatedContent -Encoding UTF8

  $cscCandidates = @(
    "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
  )
  $csc = $cscCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $csc) {
    throw "Could not find csc.exe. Install .NET Framework compiler tools."
  }

  $outputExe = Join-Path $installerOutDir ("Zypher-Setup-{0}-Custom.exe" -f $releaseLabel)

  if (Test-Path $outputExe) {
    Remove-Item -Force $outputExe
  }

  Write-Host "[Custom Installer] Compiling executable..."
  & $csc `
    /nologo `
    /target:winexe `
    /platform:x64 `
    /optimize+ `
    /out:$outputExe `
    /win32icon:$iconPath `
    /reference:System.dll `
    /reference:System.Core.dll `
    /reference:System.Drawing.dll `
    /reference:System.Windows.Forms.dll `
    /reference:System.IO.Compression.dll `
    /reference:System.IO.Compression.FileSystem.dll `
    "/resource:$payloadZip,ZypherPayload.zip" `
    $generatedCs

  if ($LASTEXITCODE -ne 0) {
    throw "csc compilation failed with exit code $LASTEXITCODE"
  }

  Write-Host "[Custom Installer] Created $outputExe"
}
finally {
  Pop-Location
}
