#Requires -Version 5.1
# Package the Volt Bridge Connector as a standalone download — the second distribution flow (the VS Code
# extension, which can't bundle a background Windows service). The desktop install bundles the connector
# itself (NSIS); this is for users who only want the extension. Run after `bun volt-scripts/dist.ts`.
#
#   pwsh volt-scripts/pack-connector.ps1   ->  dist/Volt-Bridge-Connector.zip
$ErrorActionPreference = "Stop"
$repo = Split-Path $PSScriptRoot -Parent
$src = "$repo\dist\volt\connector"
if (-not (Test-Path "$src\VoltConnector.exe")) {
    Write-Output "connector bundle missing ($src) - run: bun volt-scripts/dist.ts"
    exit 1
}

$stage = "$repo\dist\Volt Bridge Connector"
Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
Copy-Item $src $stage -Recurse

# A clean-uninstall helper for the standalone (the desktop install has its own NSIS uninstaller). The
# connector self-registers a per-user start-at-login item on first run; this stops it and removes that.
$uninstall = @'
@echo off
echo Stopping Volt Bridge Connector...
taskkill /F /IM VoltConnector.exe >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v VoltConnector /f >nul 2>&1
echo Done - start-at-login removed. Delete this folder to finish uninstalling.
pause
'@
Set-Content "$stage\Uninstall Volt Bridge Connector.cmd" -Value $uninstall -Encoding ascii

$zip = "$repo\dist\Volt-Bridge-Connector.zip"
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path "$stage\*" -DestinationPath $zip
Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
Write-Output ("OK -> {0} ({1:N0} KB)" -f $zip, ((Get-Item $zip).Length / 1KB))
