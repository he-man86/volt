#Requires -Version 5.1
# Build the Volt bridges + the user-facing Connector:
#   - Beckhoff: a standalone .exe that attaches to TwinCAT over COM.
#   - CODESYS:  a net48 in-proc DLL loaded by the IronPython script command,
#               talking to the IDE's .NET object model (no plugin, no signing).
#   - Connector: the single system-tray app that supervises every bridge.
# The bridges share VoltBridge.Core (HTTP server, handlers, ST/PLCopen logic, openapi).
$ErrorActionPreference = "Stop"
$ROOT = $PSScriptRoot
$DIST = "$ROOT\dist"
$DOTNET = "C:\Program Files\dotnet\dotnet.exe"

Write-Output "========================================"
Write-Output " Volt Bridges Build"
Write-Output "========================================"

Remove-Item -Recurse -Force $DIST -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$DIST\Beckhoff", "$DIST\Codesys", "$DIST\Connector" | Out-Null

# ── Beckhoff bridge (standalone exe) ───────────────────────────────
Write-Output "`n[1/3] VoltBridge.Beckhoff"
& $DOTNET publish "$ROOT\src\VoltBridge.Beckhoff\VoltBridge.Beckhoff.csproj" -c Release -o "$DIST\Beckhoff" --nologo -v q
if ($LASTEXITCODE -ne 0) { Write-Output "  FAILED"; exit 1 }
Write-Output "  OK -> dist\Beckhoff\BeckhoffBridge.exe"

# ── CODESYS bridge (in-proc DLL + script commands) ─────────────────
# Install by copying dist\Codesys\* into C:\ProgramData\CODESYS\Script Commands\.
# config.json registers the Start/Stop menu items; start_bridge.py loads the DLL.
Write-Output "`n[2/3] VoltBridge.Codesys"
& $DOTNET build "$ROOT\src\VoltBridge.Codesys\VoltBridge.Codesys.csproj" -c Release -o "$DIST\Codesys" --nologo -v q
if ($LASTEXITCODE -ne 0) { Write-Output "  FAILED"; exit 1 }
$SC = "$ROOT\codesys-scriptcommands"
Copy-Item "$SC\config.json","$SC\start_bridge.py","$SC\stop_bridge.py","$SC\run_bridge_headless.py","$SC\README.md" -Destination "$DIST\Codesys\" -Force
Write-Output "  OK -> dist\Codesys\ (VoltBridge.Codesys.dll + deps + script commands)"

# ── Connector (the one tray app) — bundle the workers next to it ────
# Self-contained: VoltConnector.exe + BeckhoffBridge.exe + codesys-scriptcommands/,
# so the connector's "next to me" path resolution is zero-config for the user.
Write-Output "`n[3/3] VoltBridge.Connector"
& $DOTNET publish "$ROOT\src\VoltBridge.Connector\VoltBridge.Connector.csproj" -c Release -o "$DIST\Connector" --nologo -v q
if ($LASTEXITCODE -ne 0) { Write-Output "  FAILED"; exit 1 }
Copy-Item "$DIST\Beckhoff\*" -Destination "$DIST\Connector\" -Recurse -Force
New-Item -ItemType Directory -Force "$DIST\Connector\codesys-scriptcommands" | Out-Null
Copy-Item "$SC\config.json","$SC\start_bridge.py","$SC\stop_bridge.py","$SC\run_bridge_headless.py","$SC\README.md" -Destination "$DIST\Connector\codesys-scriptcommands\" -Force
Write-Output "  OK -> dist\Connector\VoltConnector.exe (+ bundled workers)"

Write-Output "`n========================================"
Write-Output " Build complete"
Write-Output "   dist\Connector\VoltConnector.exe   <- the one app the user runs"
Write-Output "   dist\Beckhoff\BeckhoffBridge.exe   (worker, also bundled in Connector)"
Write-Output "   dist\Codesys\  (copy into C:\ProgramData\CODESYS\Script Commands\)"
Write-Output "========================================"
