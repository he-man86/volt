#Requires -Version 5.1
# Build the unified Volt CLI toolchain + the user-facing Connector (pipe transport):
#   - volt.exe:            the PLC CLI (Volt.Cli) — git-native sync over the named pipe.
#   - VoltBridgeTwincat:   standalone worker that attaches to TwinCAT over COM, serves pipe `volt.bridge.beckhoff`.
#   - Volt.Cli.Ide.Codesys: net48 in-proc DLL the CODESYS script command loads, serves pipe `volt.bridge.codesys`.
#   - Connector:           the one system-tray app that supervises every worker (probes `health` over the pipe).
# Pipe twin of volt-bridge/scripts/build-bridges.ps1 (which stays as the HTTP backup builder).
$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent           # the volt-cli package dir
$BRIDGE = Join-Path (Split-Path $ROOT -Parent) "volt-bridge"   # the connector still lives in volt-bridge
$DIST = "$ROOT\dist"

function Test-DotnetSdk($exe) {
    if (-not $exe -or -not (Test-Path $exe)) { return $false }
    $sdks = & $exe --list-sdks 2>$null
    return ($LASTEXITCODE -eq 0 -and $sdks)
}
$DOTNET = $null
foreach ($cand in @((Get-Command dotnet.exe -ErrorAction SilentlyContinue).Source, "$env:USERPROFILE\.dotnet\dotnet.exe", "C:\Program Files\dotnet\dotnet.exe")) {
    if (Test-DotnetSdk $cand) { $DOTNET = $cand; break }
}
if (-not $DOTNET) { Write-Output "  dotnet with an SDK not found - install the .NET 8 SDK"; exit 1 }

Write-Output "========================================"
Write-Output " Volt CLI toolchain build (pipe)"
Write-Output "========================================"

# --- Tests (fail fast — never package a red build) -----------------
Write-Output "`n[Test] Volt.Cli.Tests"
& $DOTNET test "$ROOT\test\Volt.Cli.Tests\Volt.Cli.Tests.csproj" -c Release --nologo -v q
if ($LASTEXITCODE -ne 0) { Write-Output "  TESTS FAILED"; exit 1 }
Write-Output "  OK"

Remove-Item -Recurse -Force $DIST -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$DIST\Cli", "$DIST\Twincat", "$DIST\Codesys", "$DIST\Connector" | Out-Null

# --- volt.exe (the PLC CLI) ----------------------------------------
# Self-contained: runs on an air-gapped PLC machine with no .NET install (same constraint that keeps volt-config
# dependency-free). ponytail: self-contained per exe duplicates the net8 runtime; dedupe into a shared runtime dir
# only if installer size measurably matters.
Write-Output "`n[1/4] Volt.Cli (volt.exe)"
& $DOTNET publish "$ROOT\src\Volt.Cli\Volt.Cli.csproj" -c Release -o "$DIST\Cli" --nologo -v q -r win-x64 --self-contained true
if ($LASTEXITCODE -ne 0) { Write-Output "  FAILED"; exit 1 }
Write-Output "  OK -> dist\Cli\volt.exe"

# --- TwinCAT pipe worker (standalone exe) --------------------------
Write-Output "`n[2/4] Volt.Cli.Ide.Twincat (VoltBridgeTwincat.exe)"
& $DOTNET publish "$ROOT\src\Volt.Cli.Ide.Twincat\Volt.Cli.Ide.Twincat.csproj" -c Release -o "$DIST\Twincat" --nologo -v q -r win-x64 --self-contained true
if ($LASTEXITCODE -ne 0) { Write-Output "  FAILED"; exit 1 }
# The BeckhoffDriver comes from the Volt.Bridge.Beckhoff project, which is itself an Exe (the HTTP backup bridge),
# so publish drags in its apphost. We only need the DLL (the driver) — drop the stray exe so the shipped bundle
# has ONE TwinCAT worker (the pipe one), not a dead HTTP twin.
Remove-Item "$DIST\Twincat\Volt.Bridge.Beckhoff.exe" -ErrorAction SilentlyContinue
Write-Output "  OK -> dist\Twincat\VoltBridgeTwincat.exe"

# --- CODESYS pipe host (in-proc net48 DLL + script commands) -------
Write-Output "`n[3/4] Volt.Cli.Ide.Codesys (in-proc DLL)"
& $DOTNET build "$ROOT\src\Volt.Cli.Ide.Codesys\Volt.Cli.Ide.Codesys.csproj" -c Release -o "$DIST\Codesys" --nologo -v q
if ($LASTEXITCODE -ne 0) { Write-Output "  FAILED"; exit 1 }
Copy-Item "$ROOT\scripts\start_pipe.py","$ROOT\scripts\run_pipe_headless.py" -Destination "$DIST\Codesys\" -Force
if (Test-Path "$BRIDGE\codesys-scriptcommands\config.json") { Copy-Item "$BRIDGE\codesys-scriptcommands\config.json" "$DIST\Codesys\" -Force }
Write-Output "  OK -> dist\Codesys\ (Volt.Cli.Ide.Codesys.dll + deps + pipe scripts)"

# --- Connector (the one tray app) — bundle the workers next to it --
Write-Output "`n[4/4] Volt.Bridge.Connector"
& $DOTNET publish "$BRIDGE\src\Volt.Bridge.Connector\Volt.Bridge.Connector.csproj" -c Release -o "$DIST\Connector" --nologo -v q -r win-x64 --self-contained true
if ($LASTEXITCODE -ne 0) { Write-Output "  FAILED"; exit 1 }
Copy-Item "$DIST\Twincat\*" -Destination "$DIST\Connector\" -Recurse -Force
New-Item -ItemType Directory -Force "$DIST\Connector\codesys-scriptcommands" | Out-Null
# start_pipe.py loads "<this folder>/Volt.Cli.Ide.Codesys.dll"; dist\Codesys already holds the DLL + deps + scripts.
Copy-Item "$DIST\Codesys\*" -Destination "$DIST\Connector\codesys-scriptcommands\" -Recurse -Force
Write-Output "  OK -> dist\Connector\VoltConnector.exe (+ pipe workers + CODESYS DLL)"

Write-Output "`n========================================"
Write-Output " Build complete"
Write-Output "   dist\Cli\volt.exe                       (the PLC CLI)"
Write-Output "   dist\Connector\VoltConnector.exe        (the one app the user runs)"
Write-Output "========================================"
