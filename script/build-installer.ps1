#Requires -Version 5.1
<#
.SYNOPSIS
  Build the distributable Volt installer (VoltConnector-Setup-<ver>.exe).

.DESCRIPTION
  1. Builds the connector bundle (build-bridges.ps1).
  2. Builds + packages the editor extension (.vsix).
  3. Compiles installer\volt-connector.iss with Inno Setup (ISCC), passing the
     version and exact .vsix path as /D defines.

  If Inno Setup isn't installed, it prints the artifacts it built and the exact
  ISCC command to run after you install Inno Setup (https://jrsoftware.org/isdl.php).

.PARAMETER SkipBuild
  Reuse existing dist\Connector and the newest .vsix instead of rebuilding.
#>
[CmdletBinding()]
param([switch] $SkipBuild)
$ErrorActionPreference = "Stop"

$repo    = Split-Path $PSScriptRoot -Parent
$bridges = Join-Path $repo "packages\volt-bridges"
$vscode  = Join-Path $repo "packages\volt-vscode"
$iss     = Join-Path $bridges "installer\volt-connector.iss"

# --- version (single source of truth: the extension package.json) ---
$pkg = Get-Content (Join-Path $vscode "package.json") -Raw | ConvertFrom-Json
$version = $pkg.version
Write-Host "Volt version: $version"

if (-not $SkipBuild) {
    Write-Host "`n[1/3] Building connector bundle..."
    & (Join-Path $bridges "build-bridges.ps1")
    if ($LASTEXITCODE -ne 0) { throw "build-bridges.ps1 failed" }

    Write-Host "`n[2/3] Building + packaging the extension..."
    Push-Location $vscode
    try {
        & bun run build
        if ($LASTEXITCODE -ne 0) { throw "extension build failed" }
        & vsce package --no-dependencies --allow-missing-repository
        if ($LASTEXITCODE -ne 0) { throw "vsce package failed" }
    } finally { Pop-Location }
}

# --- locate the exact .vsix for this version ---
$vsix = Join-Path $vscode "volt-vscode-$version.vsix"
if (-not (Test-Path $vsix)) {
    $newest = Get-ChildItem (Join-Path $vscode "volt-vscode-*.vsix") -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending | Select-Object -First 1
    if (-not $newest) { throw "No .vsix found in $vscode - build it first (omit -SkipBuild)." }
    $vsix = $newest.FullName
}
$connector = Join-Path $bridges "dist\Connector"
if (-not (Test-Path (Join-Path $connector "VoltConnector.exe"))) { throw "Connector bundle missing - run without -SkipBuild." }

# --- compile with Inno Setup, or tell the user how ---
$iscc = Get-Command iscc -ErrorAction SilentlyContinue
if (-not $iscc) {
    foreach ($p in "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe") {
        if (Test-Path $p) { $iscc = Get-Command $p; break }
    }
}

Write-Host "`n[3/3] Compiling the installer..."
if (-not $iscc) {
    Write-Warning "Inno Setup (ISCC.exe) not found. Artifacts are built and ready."
    Write-Host  "Install Inno Setup 6 (https://jrsoftware.org/isdl.php), then run:"
    Write-Host  "  ISCC.exe /DVoltVersion=$version /DVsixGlob=`"$vsix`" `"$iss`""
    exit 0
}

& $iscc.Source "/DVoltVersion=$version" "/DVsixGlob=$vsix" $iss
if ($LASTEXITCODE -ne 0) { throw "ISCC failed" }

$out = Join-Path $bridges "installer\dist\installer\VoltConnector-Setup-$version.exe"
Write-Host "`nInstaller: $out"
