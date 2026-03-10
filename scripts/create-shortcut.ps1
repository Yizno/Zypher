param(
  [string]$TargetPath = "",
  [string]$ShortcutPath = ""
)

$root = Split-Path $PSScriptRoot -Parent

if ([string]::IsNullOrWhiteSpace($TargetPath)) {
  $TargetPath = Join-Path $root "release\\Zypher-win32-x64\\Zypher.exe"
}

if ([string]::IsNullOrWhiteSpace($TargetPath) -or -not (Test-Path $TargetPath)) {
  Write-Error "No packaged executable found. Build first with npm run build:exe."
  exit 1
}

if ([string]::IsNullOrWhiteSpace($ShortcutPath)) {
  $ShortcutPath = Join-Path $env:USERPROFILE "Desktop\\Zypher.lnk"
}

$targetDirectory = [System.IO.Path]::GetDirectoryName($TargetPath)
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($ShortcutPath)
$shortcut.TargetPath = $TargetPath
$shortcut.WorkingDirectory = $targetDirectory
$shortcut.IconLocation = "$TargetPath,0"
$shortcut.Save()

Write-Output "Created shortcut: $ShortcutPath"
Write-Output "Target: $TargetPath"
