#Requires -Version 5.1
# Build the Volt bridges + the user-facing Connector:
#   - Beckhoff: a standalone .exe that attaches to TwinCAT over COM.
#   - CODESYS:  a net48 in-proc DLL loaded by the IronPython script command,
#               talking to the IDE's .NET object model (no plugin, no signing).
#   - Connector: the single system-tray app that supervises every bridge.
# The bridges share VoltBridge.Core (HTTP server, handlers, ST/PLCopen logic, openapi).
param(
    # Also run the TwinCAT API-layer wire tests (bun test: bridge.test.ts + push-api.test.ts)
    # against the freshly-built bridge. Requires TwinCAT (TcXaeShell) open with a project: the
    # step clears port 8555, launches the built bridge, runs the tests, then stops it. Off by
    # default so the package build still works on machines without TwinCAT.
    [switch]$ApiTests
)
$ErrorActionPreference = "Stop"
$ROOT = $PSScriptRoot
$DIST = "$ROOT\dist"
$DOTNET = "C:\Program Files\dotnet\dotnet.exe"

Write-Output "========================================"
Write-Output " Volt Bridges Build"
Write-Output "========================================"

# --- Tests (fail fast - never package a red build) -----------------
# Core holds the shared logic both bridges depend on (ST split/assemble,
# PLCopen/VG graphical round-trip, hashing). Run it before publishing.
Write-Output "`n[Test] VoltBridge.Core.Tests"
& $DOTNET test "$ROOT\test\VoltBridge.Core.Tests\VoltBridge.Core.Tests.csproj" -c Release --nologo -v q
if ($LASTEXITCODE -ne 0) { Write-Output "  TESTS FAILED"; exit 1 }
Write-Output "  OK"

Remove-Item -Recurse -Force $DIST -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$DIST\Beckhoff", "$DIST\Codesys", "$DIST\Connector" | Out-Null

# --- Beckhoff bridge (standalone exe) ------------------------------
Write-Output "`n[1/3] VoltBridge.Beckhoff"
& $DOTNET publish "$ROOT\src\VoltBridge.Beckhoff\VoltBridge.Beckhoff.csproj" -c Release -o "$DIST\Beckhoff" --nologo -v q
if ($LASTEXITCODE -ne 0) { Write-Output "  FAILED"; exit 1 }
Write-Output "  OK -> dist\Beckhoff\BeckhoffBridge.exe"

# --- CODESYS bridge (in-proc DLL + script commands) ----------------
# Install by copying dist\Codesys\* into C:\ProgramData\CODESYS\Script Commands\.
Write-Output "`n[2/3] VoltBridge.Codesys"
& $DOTNET build "$ROOT\src\VoltBridge.Codesys\VoltBridge.Codesys.csproj" -c Release -o "$DIST\Codesys" --nologo -v q
if ($LASTEXITCODE -ne 0) { Write-Output "  FAILED"; exit 1 }
$SC = "$ROOT\codesys-scriptcommands"
Copy-Item "$SC\config.json","$SC\start_bridge.py","$SC\stop_bridge.py","$SC\run_bridge_headless.py","$SC\README.md" -Destination "$DIST\Codesys\" -Force
Write-Output "  OK -> dist\Codesys\ (VoltBridge.Codesys.dll + deps + script commands)"

# --- Connector (the one tray app) - bundle the workers next to it ---
Write-Output "`n[3/3] VoltBridge.Connector"
& $DOTNET publish "$ROOT\src\VoltBridge.Connector\VoltBridge.Connector.csproj" -c Release -o "$DIST\Connector" --nologo -v q
if ($LASTEXITCODE -ne 0) { Write-Output "  FAILED"; exit 1 }
Copy-Item "$DIST\Beckhoff\*" -Destination "$DIST\Connector\" -Recurse -Force
New-Item -ItemType Directory -Force "$DIST\Connector\codesys-scriptcommands" | Out-Null
Copy-Item "$SC\config.json","$SC\start_bridge.py","$SC\stop_bridge.py","$SC\run_bridge_headless.py","$SC\README.md" -Destination "$DIST\Connector\codesys-scriptcommands\" -Force
Write-Output "  OK -> dist\Connector\VoltConnector.exe (+ bundled workers)"

# --- API-layer wire tests (opt-in: -ApiTests; needs TwinCAT open) ---
if ($ApiTests) {
    Write-Output "`n[API] TwinCAT wire tests (bun test)"
    $BUN = (Get-Command bun -ErrorAction SilentlyContinue).Source
    if (-not $BUN) { $BUN = Join-Path $env:USERPROFILE ".bun\bin\bun.exe" }
    if (-not (Test-Path $BUN)) { Write-Output "  bun not found ($BUN)"; exit 1 }

    # Own the bridge: clear port 8555, launch the freshly-built worker (streams to files so an
    # inherited pipe can't stall its HTTP listener), wait for it to attach to TwinCAT, run the
    # wire tests, then stop it. Do not run -ApiTests while the Connector's bridge serves :8555.
    Get-Process -Name BeckhoffBridge -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    Write-Output "  launching dist\Beckhoff\BeckhoffBridge.exe"
    $bridgeOut = Join-Path $env:TEMP "volt-apitest-bridge.out.log"
    $bridgeErr = Join-Path $env:TEMP "volt-apitest-bridge.err.log"
    $owned = Start-Process "$DIST\Beckhoff\BeckhoffBridge.exe" -PassThru -WindowStyle Hidden -RedirectStandardOutput $bridgeOut -RedirectStandardError $bridgeErr

    $healthy = $false
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Seconds 1
        try { if ((Invoke-RestMethod "http://127.0.0.1:8555/health" -TimeoutSec 2).status -eq "healthy") { $healthy = $true; break } } catch {}
    }
    Write-Output ("  bridge healthy: {0} (pid {1})" -f $healthy, $owned.Id)

    $code = 1
    if ($healthy) {
        Push-Location $ROOT
        # bun writes results to stderr; under ErrorActionPreference=Stop that surfaces as a
        # terminating NativeCommandError, so relax it around the native call and trust exit code.
        $prevEAP = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        & $BUN test
        $code = $LASTEXITCODE
        $ErrorActionPreference = $prevEAP
        Pop-Location
    }

    if ($owned -and -not $owned.HasExited) { Stop-Process -Id $owned.Id -Force -ErrorAction SilentlyContinue }
    if (-not $healthy) { Write-Output "  bridge not healthy - is TwinCAT open with a project?"; exit 1 }
    if ($code -ne 0) { Write-Output "  API TESTS FAILED"; exit 1 }
    Write-Output "  API tests OK"
}

Write-Output "`n========================================"
Write-Output " Build complete"
Write-Output "   dist\Connector\VoltConnector.exe   (the one app the user runs)"
Write-Output "   dist\Beckhoff\BeckhoffBridge.exe   (worker, also bundled in Connector)"
Write-Output "   dist\Codesys\  (copy into C:\ProgramData\CODESYS\Script Commands\)"
Write-Output "========================================"
