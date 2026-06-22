#Requires -Version 5.1
<#
.SYNOPSIS
  Install the Volt local stack - per-user, no admin required.

.DESCRIPTION
  Installs two things and wires them together:
    1. The Volt Connector (system-tray supervisor + bundled bridge workers) into
       %LOCALAPPDATA%\Programs\Volt. The connector self-registers for start-at-
       login on first launch.
    2. The editor extension (.vsix) into every detected editor (Windsurf / VS
       Code / Cursor).
  Optionally (-WithCodesys) installs the CODESYS in-proc bridge + script commands
  into %ProgramData%\CODESYS\Script Commands (that step may require elevation).

  Idempotent: re-running upgrades in place. This is the engine the Inno Setup
  installer (installer/volt-connector.iss) invokes, and also works standalone
  from a repo checkout.

.EXAMPLE
  powershell -File volt-scripts/install-volt.ps1
  # Build first if needed:
  #   packages/volt-bridge/build-bridges.ps1
  #   (cd packages/volt-vscode; bun run build; vsce package --no-dependencies --allow-missing-repository)
#>
[CmdletBinding()]
param(
    [string]   $ConnectorSource,
    [string]   $Vsix,
    [string]   $InstallDir = "$env:LOCALAPPDATA\Programs\Volt",
    [switch]   $WithCodesys,
    [string]   $CodesysSource,
    [string[]] $Editors = @("windsurf", "code", "cursor"),
    [switch]   $SkipExtension,
    [switch]   $SkipLaunch
)
$ErrorActionPreference = "Stop"

$repoBridges = Join-Path $PSScriptRoot "..\packages\volt-bridge"
$repoVscode  = Join-Path $PSScriptRoot "..\packages\volt-vscode"

# --- Resolve the connector bundle ---
if (-not $ConnectorSource) { $ConnectorSource = Join-Path $repoBridges "dist\Connector" }
if (-not (Test-Path (Join-Path $ConnectorSource "VoltConnector.exe"))) {
    throw "VoltConnector.exe not found under '$ConnectorSource'. Build it first: packages\volt-bridge\build-bridges.ps1"
}

# --- Stop the connector AND its bridge workers so their files aren't locked ---
# A tray app has no main window (CloseMainWindow is a no-op), so stop directly.
# Stop the supervisor FIRST so it doesn't respawn a worker we're about to kill,
# then the workers (which otherwise keep their DLLs locked during the copy).
$workerNames = @("BeckhoffBridge")   # extend as vendors are added
if (Get-Process VoltConnector -ErrorAction SilentlyContinue) {
    Write-Host "Stopping the connector and bridge workers..."
    Get-Process VoltConnector -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 400
}
Get-Process -Name $workerNames -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

# --- Place the connector bundle ---
$same = $false
try { $same = (Resolve-Path $ConnectorSource).Path -eq (Resolve-Path $InstallDir -ErrorAction SilentlyContinue).Path } catch {}
if ($same) {
    Write-Host "Connector already at $InstallDir (in place)."
} else {
    New-Item -ItemType Directory -Force $InstallDir | Out-Null
    Copy-Item (Join-Path $ConnectorSource "*") $InstallDir -Recurse -Force
    Write-Host "Connector       -> $InstallDir"
}

# --- Install the extension into detected editors ---
if (-not $SkipExtension) {
    if (-not $Vsix) {
        $vsixFile = Get-ChildItem (Join-Path $repoVscode "volt-vscode-*.vsix") -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending | Select-Object -First 1
        if ($vsixFile) { $Vsix = $vsixFile.FullName }
    }
    if ($Vsix -and (Test-Path $Vsix)) {
        $any = $false
        foreach ($ed in $Editors) {
            $cli = Get-Command $ed -ErrorAction SilentlyContinue
            if ($cli) {
                & $cli.Source --install-extension $Vsix --force | Out-Null
                Write-Host "Extension       -> $ed"
                $any = $true
            }
        }
        if (-not $any) { Write-Warning "No supported editor CLI found (windsurf/code/cursor)." }
    } else {
        Write-Warning "No .vsix found. Build it: (cd packages/volt-vscode; bun run build; vsce package --no-dependencies --allow-missing-repository)"
    }
}

# --- Optional: CODESYS in-proc bridge + script commands ---
if ($WithCodesys) {
    if (-not $CodesysSource) { $CodesysSource = Join-Path $repoBridges "dist\Codesys" }
    $dest = Join-Path $env:ProgramData "CODESYS\Script Commands"
    try {
        New-Item -ItemType Directory -Force $dest | Out-Null
        Copy-Item (Join-Path $CodesysSource "*") $dest -Recurse -Force
        Write-Host "CODESYS bridge  -> $dest"
    } catch {
        Write-Warning "Couldn't install CODESYS script commands (try an elevated shell): $($_.Exception.Message)"
    }
}

# --- Launch the connector (it self-registers the login item) ---
if (-not $SkipLaunch) {
    Start-Process (Join-Path $InstallDir "VoltConnector.exe") -ArgumentList "--silent"
    Write-Host "Connector launched (system tray)."
}

Write-Host ""
Write-Host "Volt installed. Reload your editor - the tray icon now supervises the bridges."
