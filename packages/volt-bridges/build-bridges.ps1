#Requires -Version 5.1
# Build both Volt PLC bridges:
#   - Beckhoff: a standalone .exe that attaches to TwinCAT over COM.
#   - CODESYS:  a net48 in-proc DLL loaded by the IronPython script command,
#               talking to the IDE's .NET object model (no plugin, no signing).
# Both share VoltBridge.Core (HTTP server, handlers, ST/PLCopen logic, openapi.yaml).
$ErrorActionPreference = "Stop"
$ROOT = $PSScriptRoot
$DIST = "$ROOT\dist"
$DOTNET = "C:\Program Files\dotnet\dotnet.exe"

Write-Output "========================================"
Write-Output " Volt Bridges Build"
Write-Output "========================================"

Remove-Item -Recurse -Force $DIST -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$DIST\Beckhoff", "$DIST\Codesys" | Out-Null

# ── Beckhoff bridge (standalone exe) ───────────────────────────────
Write-Output "`n[1/2] VoltBridge.Beckhoff"
& $DOTNET publish "$ROOT\src\VoltBridge.Beckhoff\VoltBridge.Beckhoff.csproj" -c Release -o "$DIST\Beckhoff" --nologo -v q
if ($LASTEXITCODE -ne 0) { Write-Output "  FAILED"; exit 1 }
Write-Output "  OK -> dist\Beckhoff\BeckhoffBridge.exe"

# ── CODESYS bridge (in-proc DLL + script commands) ─────────────────
# Install by copying dist\Codesys\* into C:\ProgramData\CODESYS\Script Commands\.
# config.json registers the Start/Stop menu items; start_bridge.py loads the DLL.
Write-Output "`n[2/2] VoltBridge.Codesys"
& $DOTNET build "$ROOT\src\VoltBridge.Codesys\VoltBridge.Codesys.csproj" -c Release -o "$DIST\Codesys" --nologo -v q
if ($LASTEXITCODE -ne 0) { Write-Output "  FAILED"; exit 1 }
$SC = "$ROOT\codesys-scriptcommands"
Copy-Item "$SC\config.json","$SC\start_bridge.py","$SC\stop_bridge.py","$SC\run_bridge_headless.py","$SC\README.md" -Destination "$DIST\Codesys\" -Force
Write-Output "  OK -> dist\Codesys\ (VoltBridge.Codesys.dll + deps + script commands)"

Write-Output "`n========================================"
Write-Output " Build complete"
Write-Output "   dist\Beckhoff\BeckhoffBridge.exe"
Write-Output "   dist\Codesys\  (copy into C:\ProgramData\CODESYS\Script Commands\)"
Write-Output "========================================"
