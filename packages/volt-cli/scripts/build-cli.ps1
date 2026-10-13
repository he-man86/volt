#Requires -Version 5.1
# Build the unified Volt CLI toolchain into the three INSTALLED folders (openspec installer-rebuild, design 2):
#   dist\Cli\volt.exe     the PLC CLI (Volt.Cli) - ONE self-contained single-file exe, the only thing besides the LSP
#                         that lands on PATH ({app}\bin); beside it git\, the CLI's own MinGit ({app}\bin\git, not on
#                         PATH) - the full CLI only, never a bridge bundle
#   dist\Connector\       the tray connector (VoltConnector.exe) + the TwinCAT pipe worker (VoltBridgeTwincat.exe) on
#                         ONE shared self-contained runtime ({app}\connector), with the worker's x86 hierarchy reader
#                         VoltTwincatExplorer.exe (net48 - .NET Framework ships with Windows; it rides in the worker's
#                         publish output, DIALECT C2i "what the read requires")
#   dist\Codesys\         Volt.Ide.Codesys.dll (net48 in-proc, ONE merged assembly - the csproj's VoltBundle target)
#                         + start/stop_volt_codesys.py ({app}\codesys)
# Every publish: SatelliteResourceLanguages=en (the 52 WinForms/runtime satellite DLLs in 13 locales nobody reads)
# and DebugType=none (no PDBs ship).
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
# off the binary itself (there is no version.txt: a binary cannot lie about its own version). The bun-compiled LSP
# gets the equivalent via a compile-time --define in build-payload.ts. Empty outside CI/the payload build: a dev
# build stays 1.0.0.0, said out loud - a local build carrying a real release number would compare as current
# against the updater.
$VER = $env:VOLT_VERSION
$VERARGS = if ($VER) { @("/p:Version=$VER", "/p:FileVersion=$VER") } else { @() }
if ($VER) { Write-Output "  stamping version $VER into every binary" }
else { Write-Output "  VOLT_VERSION is unset: this is an unstamped DEVELOPMENT build (1.0.0.0, reported as `"(dev)`"), not a release. For a release set VOLT_VERSION, or use the published GitHub release." }

# --- Tests (fail fast - never package a red build) -----------------
Write-Output "`n[Test] Volt.Cli.Tests"
& $DOTNET test "$ROOT\test\Volt.Cli.Tests\Volt.Cli.Tests.csproj" -c Release --nologo -v q
if ($LASTEXITCODE -ne 0) { Write-Output "  TESTS FAILED"; exit 1 }
Write-Output "  OK"

Remove-Item -Recurse -Force $DIST -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$DIST\Cli", "$DIST\Twincat", "$DIST\Codesys", "$DIST\Connector" | Out-Null

# --- volt.exe (the PLC CLI) ----------------------------------------
# Self-contained (runs on an air-gapped PLC machine with no .NET install) and SINGLE-FILE: PATH gets one exe, not the
# 198-file runtime it used to drag along. Uncompressed - every agent-driven CLI call would pay the decompression, and
# the installer is LZMA anyway (design 0: 71.0 MiB vs 36.1 compressed). Trimming/NativeAOT are out: Volt.Engine etc.
# multi-target net48 (NETSDK1124) and use reflection JSON.
Write-Output "`n[1/4] Volt.Cli (volt.exe, single-file)"
& $DOTNET publish "$ROOT\src\Volt.Cli\Volt.Cli.csproj" @VERARGS /p:SatelliteResourceLanguages=en /p:DebugType=none /p:PublishSingleFile=true -c Release -o "$DIST\Cli" --nologo -v q -r win-x64 --self-contained true
if ($LASTEXITCODE -ne 0) { Write-Output "  FAILED"; exit 1 }
# Beside it, git\: the CLI's OWN git (MinGit, src\Volt.Cli\MinGit.targets - openspec environment-dependency-audit 2.1),
# which volt.exe runs by path. It lands in {app}\bin\git\ - a folder, so not on PATH (only {app}\bin is).
$cliTop = @(Get-ChildItem "$DIST\Cli" | ForEach-Object { $_.Name } | Sort-Object)
if (($cliTop -join '|') -ne 'git|volt.exe' -or -not (Test-Path "$DIST\Cli\volt.exe" -PathType Leaf) -or -not (Test-Path "$DIST\Cli\git\cmd\git.exe" -PathType Leaf)) {
    Write-Output "  REFUSED: the single-file publish left [$($cliTop -join ', ')] in dist\Cli, not exactly volt.exe + git\ (with git\cmd\git.exe) - {app}\bin is on PATH and holds volt.exe + volt-lsp-iec.exe + the CLI's git\ only"
    exit 1
}
Write-Output "  OK -> dist\Cli\volt.exe + dist\Cli\git\ (the bundled MinGit)"


# --- Connector (the one tray app) + the TwinCAT worker, ONE runtime -----------
# Published back to back, before anything else rebuilds the libraries they share: MSBuild's up-to-date check does not
# see a changed global property (DebugType), so a build in between left the two with differently-built copies of the
# same Volt library (measured 2026-10-12: Volt.Contracts.dll, 512 bytes apart).
Write-Output "`n[2/4] Volt.Connector (VoltConnector.exe)"
& $DOTNET publish "$ROOT\src\Volt.Connector\Volt.Connector.csproj" @VERARGS /p:SatelliteResourceLanguages=en /p:DebugType=none -c Release -o "$DIST\Connector" --nologo -v q -r win-x64 --self-contained true
if ($LASTEXITCODE -ne 0) { Write-Output "  FAILED"; exit 1 }
Write-Output "`n[3/4] Volt.Ide.Twincat (VoltBridgeTwincat.exe), laid over the connector's runtime"
& $DOTNET publish "$ROOT\src\Volt.Ide.Twincat\Volt.Ide.Twincat.csproj" @VERARGS /p:SatelliteResourceLanguages=en /p:DebugType=none -c Release -o "$DIST\Twincat" --nologo -v q -r win-x64 --self-contained true
if ($LASTEXITCODE -ne 0) { Write-Output "  FAILED"; exit 1 }
# Both are self-contained net10.0-windows apps on the same runtime and the same Volt assemblies, so one copy serves
# both. Every file both carry must be byte-identical, with ONE named exception: the connector is a WinForms app, so its
# runtime is Microsoft.NETCore.App PLUS Microsoft.WindowsDesktop.App, and where the desktop pack ships its own build of
# a framework facade (measured: Microsoft.VisualBasic.dll, System.Drawing.dll - same assembly version, forwarding a
# superset of types, to Microsoft.VisualBasic.Forms / System.Drawing.Common) the connector's copy is the one the
# connector needs, and the worker references neither. That set is READ from the connector's deps.json, never listed
# here. Any other difference would make one of them run on the other's bytes - refused by name.
$deps = Get-Content "$DIST\Connector\VoltConnector.deps.json" -Raw | ConvertFrom-Json
$target = ($deps.targets.PSObject.Properties | Where-Object { $_.Name -like "*/win-x64" }).Value
$desktopPack = $target.PSObject.Properties | Where-Object { $_.Name -like "runtimepack.Microsoft.WindowsDesktop.App.Runtime.*" }
if (-not $desktopPack) { Write-Output "  REFUSED: VoltConnector.deps.json names no Microsoft.WindowsDesktop.App runtime pack - cannot tell the connector's WinForms facades"; exit 1 }
$desktopFiles = @($desktopPack.Value.runtime.PSObject.Properties.Name) + @($desktopPack.Value.native.PSObject.Properties.Name)
$differ = @()
$superseded = @()
$shared = 0
foreach ($f in Get-ChildItem "$DIST\Twincat" -Recurse -File) {
    $rel = $f.FullName.Substring("$DIST\Twincat\".Length)
    $dst = Join-Path "$DIST\Connector" $rel
    if (Test-Path $dst) {
        $shared++
        if ((Get-FileHash $f.FullName).Hash -ne (Get-FileHash $dst).Hash) {
            if ($desktopFiles -contains $rel) { $superseded += $rel } else { $differ += $rel }
        }
        continue
    }
    New-Item -ItemType Directory -Force (Split-Path $dst -Parent) | Out-Null
    Copy-Item $f.FullName $dst
}
if ($differ.Count -gt 0) {
    Write-Output "  REFUSED: the connector and the TwinCAT worker carry DIFFERENT bytes for $($differ.Count) shared file(s): $($differ -join ', ') - they cannot share one runtime folder"
    exit 1
}
Remove-Item -Recurse -Force "$DIST\Twincat"
if (-not (Test-Path "$DIST\Connector\VoltTwincatExplorer.exe")) { Write-Output "  REFUSED: the worker's publish left no VoltTwincatExplorer.exe - the TwinCAT worker cannot read a 32-bit XAE's Solution Explorer without it"; exit 1 }
Write-Output "  OK -> dist\Connector\ (VoltConnector.exe + VoltBridgeTwincat.exe + VoltTwincatExplorer.exe; $shared shared files, identical but the connector's WindowsDesktop facade(s): $($superseded -join ', '))"

# --- CODESYS pipe host (in-proc net48 DLL + script commands) -------
Write-Output "`n[4/4] Volt.Ide.Codesys (in-proc DLL)"
& $DOTNET build "$ROOT\src\Volt.Ide.Codesys\Volt.Ide.Codesys.csproj" @VERARGS /p:DebugType=none -c Release -o "$DIST\CodesysBuild" --nologo -v q
if ($LASTEXITCODE -ne 0) { Write-Output "  FAILED"; exit 1 }
# What ships is the merged bundle\ folder (one assembly), never the build output beside it: that holds every Volt and
# System.Text.Json DLL the merge took in, which CODESYS must not be offered (openspec codesys-bridge-single-assembly).
Copy-Item "$DIST\CodesysBuild\bundle\*" -Destination "$DIST\Codesys\" -Force
Remove-Item -Recurse -Force "$DIST\CodesysBuild"
# Ship only the user-facing activation scripts; run_pipe_production.py is the dev/test launcher around them.
Copy-Item "$ROOT\scripts\start_volt_codesys.py","$ROOT\scripts\stop_volt_codesys.py" -Destination "$DIST\Codesys\" -Force
Write-Output "  OK -> dist\Codesys\ (Volt.Ide.Codesys.dll, one assembly + the two scripts)"

# --- The bridge bundles carry NO git -------------------------------
# dist\Connector and dist\Codesys are also what PLCAssist distributes, bridge-only. A bridge never runs git, and git ships
# with the complete CLI only (owner, openspec environment-dependency-audit 2.1; Volt.Repo.Gates/BundledGitGateTests).
$bridgeGit = @(foreach ($d in "Connector", "Codesys") { Get-ChildItem "$DIST\$d" -Recurse -Force | Where-Object { $_.Name -ieq "git.exe" -or ($_.PSIsContainer -and $_.Name -ieq "git") } | ForEach-Object { $_.FullName.Substring("$DIST\".Length) } })
if ($bridgeGit.Count -gt 0) { Write-Output "  REFUSED: a bridge bundle carries git: $($bridgeGit -join ', ') - git ships with the full CLI only (dist\Cli\git)"; exit 1 }

Write-Output "`n========================================"
Write-Output " Build complete"
Write-Output "   dist\Cli\volt.exe + git\     -> {app}\bin"
Write-Output "   dist\Connector\              -> {app}\connector"
Write-Output "   dist\Codesys\                -> {app}\codesys"
Write-Output "========================================"
