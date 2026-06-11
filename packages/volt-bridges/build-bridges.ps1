#Requires -Version 5.1
param([switch]$SkipCodesys)

$ErrorActionPreference = "Stop"
$ROOT = $PSScriptRoot
$DIST = "$ROOT\dist"
$DOTNET = "C:\Program Files\dotnet\dotnet.exe"
$PACKAGE_SRC = "$ROOT\codesys-package"
$VERSION = "1.0.0"

Write-Output "========================================"
Write-Output " Volt Bridges Build"
Write-Output "========================================"

# Clean
Remove-Item -Recurse -Force $DIST -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$DIST\Beckhoff", "$DIST\Codesys" | Out-Null

# ── Beckhoff Bridge ────────────────────────────────────────────
Write-Output ""
Write-Output "[1/3] VoltBridge.Beckhoff"
& $DOTNET publish "$ROOT\src\VoltBridge.Beckhoff\VoltBridge.Beckhoff.csproj" -c Release -o "$DIST\Beckhoff" --nologo -v q 2>&1 | Select-Object -Last 1
if ($LASTEXITCODE -ne 0) { Write-Output "  FAILED"; exit 1 }
Write-Output "  OK -> dist\Beckhoff\BeckhoffBridge.exe"

# ── CODESYS Console (dev/testing) ──────────────────────────────
Write-Output ""
Write-Output "[2/3] VoltBridge.Codesys (console)"
& $DOTNET publish "$ROOT\src\VoltBridge.Codesys\VoltBridge.Codesys.csproj" -c Release -o "$DIST\Codesys" --nologo -v q 2>&1 | Select-Object -Last 1
if ($LASTEXITCODE -ne 0) { Write-Output "  FAILED"; exit 1 }
Write-Output "  OK -> dist\Codesys\VoltBridge.Codesys.exe"

# ── CODESYS Package ────────────────────────────────────────────
Write-Output ""
Write-Output "[3/3] VoltBridge.Codesys.Plugin + .package"
$TMP = "$env:TEMP\volt-package-build"
Remove-Item -Recurse -Force $TMP -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$TMP\PlugIns", "$TMP\ScriptLib\Stubs\scriptengine" | Out-Null

# Try building Plugin DLL (needs CODESYS SDK)
if (-not $SkipCodesys) {
    & $DOTNET build "$ROOT\src\VoltBridge.Codesys.Plugin\VoltBridge.Codesys.Plugin.csproj" -c Release -o "$TMP\PlugIns" --nologo -v q 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Output "  Plugin DLL skipped (CODESYS not installed)" }
    else { Write-Output "  Plugin DLL built" }
}

# Copy console EXE to package (under PlugIns/ as manifest expects)
Copy-Item -Recurse "$DIST\Codesys\*" -Destination "$TMP\PlugIns\" -Force
if (Test-Path "$PACKAGE_SRC\PlugIns\install.bat") { Copy-Item "$PACKAGE_SRC\PlugIns\install.bat" -Destination "$TMP\PlugIns\" -Force }

# Copy manifest + stubs
Copy-Item "$PACKAGE_SRC\package.manifest" -Destination "$TMP\" -Force
Copy-Item -Recurse "$PACKAGE_SRC\ScriptLib\*" -Destination "$TMP\ScriptLib\" -Force

# Zip with node (clean ZIP, CODESYS-compatible)
$PKG = "$DIST\VoltBridge-$VERSION.package"
$ZIP_BUILDER = "$PSScriptRoot\codesys-package\zip-builder.cjs"
node $ZIP_BUILDER $TMP $PKG
$size = if (Test-Path $PKG) { [math]::Round((Get-Item $PKG).Length / 1KB) } else { 0 }
Remove-Item -Recurse -Force $TMP -ErrorAction SilentlyContinue
Write-Output "  OK -> dist\VoltBridge-$VERSION.package ($size KB)"

Write-Output ""
Write-Output "========================================"
Write-Output " Build complete"
Write-Output "   dist\Beckhoff\BeckhoffBridge.exe"
Write-Output "   dist\Codesys\VoltBridge.Codesys.exe"
Write-Output "   dist\VoltBridge-$VERSION.package"
Write-Output "========================================"
