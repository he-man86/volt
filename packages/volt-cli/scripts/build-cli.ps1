#Requires -Version 5.1
# Build the unified Volt CLI toolchain + the user-facing Connector (pipe transport):
#   - volt.exe:            the PLC CLI (Volt.Cli) — git-native sync over the named pipe.
#   - VoltBridgeTwincat:   standalone worker that attaches to TwinCAT over COM, serves pipe `volt.bridge.twincat`.
#   - Volt.Ide.Codesys: net48 in-proc DLL the CODESYS script command loads, serves pipe `volt.bridge.codesys` -
#                          ONE assembly, its dependencies merged in at build (the csproj's VoltBundle target).
#   - Connector:           the one system-tray app that supervises every worker (probes `health` over the pipe).
$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent           # the volt-cli package dir
$DIST = "$ROOT\dist"

# "Has an SDK" is not enough: this machine carries several dotnet installs and the FIRST one with any SDK at
# all used to win. Since the toolchain targets net10.0 that picked a .NET 8 SDK and failed with NETSDK1045
# several minutes into the build. Require an SDK that can actually target it.
$SDK_MAJOR = 10
function Test-DotnetSdk($exe) {
    if (-not $exe -or -not (Test-Path $exe)) { return $false }
    $sdks = & $exe --list-sdks 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $sdks) { return $false }
    return [bool]($sdks | Where-Object { [int]($_ -split '\.')[0] -ge $SDK_MAJOR })
}
$DOTNET = $null
foreach ($cand in @((Get-Command dotnet.exe -ErrorAction SilentlyContinue).Source, "$env:USERPROFILE\.dotnet\dotnet.exe", "C:\Program Files\dotnet\dotnet.exe")) {
    if (Test-DotnetSdk $cand) { $DOTNET = $cand; break }
}
if (-not $DOTNET) { Write-Output "  no dotnet with a .NET $SDK_MAJOR SDK found - install it (winget install Microsoft.DotNet.SDK.$SDK_MAJOR)"; exit 1 }

Write-Output "========================================"
Write-Output " Volt CLI toolchain build (pipe)"
Write-Output "========================================"

# Stamp the RELEASE version into every binary, so each one is self-describing and "what is installed" is MEASURED
# off the binary itself. This is the ONLY version record now -- there is no version.txt (it was written by the
# installer, so a half-applied update where a locked file made Inno roll back after some components were replaced
# confidently reported the version it MEANT to be; a binary cannot lie about its own version). The bun-compiled
# LSP gets the equivalent via a compile-time --define in build-payload.ts. Empty outside CI: a dev build stays 1.0.0.
$VER = $env:VOLT_VERSION
$VERARGS = if ($VER) { @("/p:Version=$VER", "/p:FileVersion=$VER") } else { @() }
# An unstamped build is said out loud because nothing else marks it until someone runs a binary: a consumer that
# packaged dist\ from a local build shipped bridges that all reported 1.0.0.0, and learned it from the field. It is
# NOT stamped with a computed number instead -- a local (possibly dirty) build carrying a real release number would
# be a binary lying about its version, and would compare as current against the updater.
if ($VER) { Write-Output "  stamping version $VER into every binary" }
else { Write-Output "  VOLT_VERSION is unset: this is an unstamped DEVELOPMENT build (1.0.0.0, reported as `"(dev)`"), not a release. For a release set VOLT_VERSION, or use the published GitHub release." }

# --- Tests (fail fast — never package a red build) -----------------
Write-Output "`n[Test] Volt.Cli.Tests"
& $DOTNET test "$ROOT\test\Volt.Cli.Tests\Volt.Cli.Tests.csproj" -c Release --nologo -v q
if ($LASTEXITCODE -ne 0) { Write-Output "  TESTS FAILED"; exit 1 }
Write-Output "  OK"

Remove-Item -Recurse -Force $DIST -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$DIST\Cli", "$DIST\Twincat", "$DIST\Codesys", "$DIST\Connector" | Out-Null

# --- volt.exe (the PLC CLI) ----------------------------------------
# Self-contained: runs on an air-gapped PLC machine with no .NET install (same constraint that keeps volt-config
# dependency-free). ponytail: self-contained per exe duplicates the net10 runtime; dedupe into a shared runtime dir
# only if installer size measurably matters.
Write-Output "`n[1/4] Volt.Cli (volt.exe)"
& $DOTNET publish "$ROOT\src\Volt.Cli\Volt.Cli.csproj" @VERARGS -c Release -o "$DIST\Cli" --nologo -v q -r win-x64 --self-contained true
if ($LASTEXITCODE -ne 0) { Write-Output "  FAILED"; exit 1 }
Write-Output "  OK -> dist\Cli\volt.exe"

# --- TwinCAT pipe worker (standalone exe) --------------------------
Write-Output "`n[2/4] Volt.Ide.Twincat (VoltBridgeTwincat.exe)"
& $DOTNET publish "$ROOT\src\Volt.Ide.Twincat\Volt.Ide.Twincat.csproj" @VERARGS -c Release -o "$DIST\Twincat" --nologo -v q -r win-x64 --self-contained true
if ($LASTEXITCODE -ne 0) { Write-Output "  FAILED"; exit 1 }
Write-Output "  OK -> dist\Twincat\VoltBridgeTwincat.exe"

# --- CODESYS pipe host (in-proc net48 DLL + script commands) -------
Write-Output "`n[3/4] Volt.Ide.Codesys (in-proc DLL)"
& $DOTNET build "$ROOT\src\Volt.Ide.Codesys\Volt.Ide.Codesys.csproj" @VERARGS -c Release -o "$DIST\CodesysBuild" --nologo -v q
if ($LASTEXITCODE -ne 0) { Write-Output "  FAILED"; exit 1 }
# What ships is the merged bundle\ folder (one assembly), never the build output beside it: that holds every Volt and
# System.Text.Json DLL the merge took in, which CODESYS must not be offered (openspec codesys-bridge-single-assembly).
Copy-Item "$DIST\CodesysBuild\bundle\*" -Destination "$DIST\Codesys\" -Force
Remove-Item -Recurse -Force "$DIST\CodesysBuild"
# Ship only the user-facing activation scripts; run_pipe_production.py is the dev/test launcher around them.
Copy-Item "$ROOT\scripts\start_volt_codesys.py","$ROOT\scripts\stop_volt_codesys.py" -Destination "$DIST\Codesys\" -Force
Write-Output "  OK -> dist\Codesys\ (Volt.Ide.Codesys.dll, one assembly + pipe scripts)"

# --- Connector (the one tray app) — bundle the workers next to it --
Write-Output "`n[4/4] Volt.Connector"
& $DOTNET publish "$ROOT\src\Volt.Connector\Volt.Connector.csproj" @VERARGS -c Release -o "$DIST\Connector" --nologo -v q -r win-x64 --self-contained true
if ($LASTEXITCODE -ne 0) { Write-Output "  FAILED"; exit 1 }
Copy-Item "$DIST\Twincat\*" -Destination "$DIST\Connector\" -Recurse -Force
New-Item -ItemType Directory -Force "$DIST\Connector\codesys-scriptcommands" | Out-Null
# start_volt_codesys.py loads "<this folder>/Volt.Ide.Codesys.dll"; dist\Codesys already holds the DLL + scripts.
Copy-Item "$DIST\Codesys\*" -Destination "$DIST\Connector\codesys-scriptcommands\" -Recurse -Force
Write-Output "  OK -> dist\Connector\VoltConnector.exe (+ pipe workers + CODESYS DLL)"

Write-Output "`n========================================"
Write-Output " Build complete"
Write-Output "   dist\Cli\volt.exe                       (the PLC CLI)"
Write-Output "   dist\Connector\VoltConnector.exe        (the one app the user runs)"
Write-Output "========================================"
