#Requires -Version 5.1
<#
.SYNOPSIS
  Remove the Volt local stack: stop the connector, drop the login item, delete
  the install dir, and optionally uninstall the editor extension.
#>
[CmdletBinding()]
param(
    [string]   $InstallDir = "$env:LOCALAPPDATA\Programs\Volt",
    [string[]] $Editors = @("windsurf", "code", "cursor"),
    [switch]   $RemoveExtension,
    [switch]   $RemoveCodesys
)
$ErrorActionPreference = "Continue"

# Stop the connector (it stops its bridge workers on exit).
Get-Process VoltConnector -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

# Remove the start-at-login entry.
try {
    Remove-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name VoltConnector -ErrorAction Stop
    Write-Host "Removed login item."
} catch { }

# Remove the install dir.
if (Test-Path $InstallDir) {
    Remove-Item -Recurse -Force $InstallDir -ErrorAction SilentlyContinue
    Write-Host "Removed $InstallDir."
}

# Optionally uninstall the extension.
if ($RemoveExtension) {
    foreach ($ed in $Editors) {
        $cli = Get-Command $ed -ErrorAction SilentlyContinue
        if ($cli) { & $cli.Source --uninstall-extension volt.volt-vscode | Out-Null; Write-Host "Uninstalled extension from $ed." }
    }
}

# Optionally remove the CODESYS script commands.
if ($RemoveCodesys) {
    $dest = Join-Path $env:ProgramData "CODESYS\Script Commands"
    if (Test-Path $dest) {
        try { Remove-Item -Recurse -Force $dest -ErrorAction Stop; Write-Host "Removed CODESYS script commands." }
        catch { Write-Warning "Couldn't remove CODESYS script commands (try an elevated shell): $($_.Exception.Message)" }
    }
}

Write-Host "Volt uninstalled."
