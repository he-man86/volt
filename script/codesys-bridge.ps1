#Requires -Version 5.1
<#
.SYNOPSIS
  Drive the CODESYS Volt bridge HEADLESS — build it, launch CODESYS with no UI,
  load the in-proc bridge, and talk to it over HTTP, with zero manual clicks.

.DESCRIPTION
  Starts CODESYS.exe --runscript=run_bridge_headless.py --noUI. The script opens
  a fixture project, starts the in-proc HTTP bridge on :8556, and pumps the
  primary thread so the marshaled endpoints (/refs,/fetch,/push,/build) work —
  not just the cache-only ones (/health,/shutdown).

  This is the dev/test loop only. It runs against its OWN headless copy of the
  project, NOT the engineer's live IDE session (CODESYS exposes no external
  automation to attach to a running UI).

.PARAMETER Action
  up      build + launch + wait until healthy, leave running   (default)
  test    up, then GET /refs to prove the marshaled read path, leave running
  down    POST /shutdown, drop stop-flag, kill CODESYS, clean up
  restart down then up
  status  GET /health once
  logs    print the headless stdout/stderr logs

.PARAMETER Version  18 (3.5.18.30, default) or 21 (3.5.21.40)
.PARAMETER Project  fixture .project to open headless
.PARAMETER Port     bridge port (fixed at 8556 by Host; override only if changed)
.PARAMETER NoBuild  skip the dotnet build (reuse the existing DLL)

.EXAMPLE  pwsh script/codesys-bridge.ps1 up
.EXAMPLE  pwsh script/codesys-bridge.ps1 test
.EXAMPLE  pwsh script/codesys-bridge.ps1 down
#>
param(
    [ValidateSet("up", "test", "down", "restart", "status", "logs")]
    [string]$Action = "up",
    [ValidateSet("18", "21")]
    [string]$Version = "18",
    [string]$Project = "C:\Users\marce\OneDrive\Documenten\V71_PackML_Hauzer.project",
    [int]$Port = 8556,
    [switch]$NoBuild
)

$ErrorActionPreference = "Stop"

# ── paths ────────────────────────────────────────────────────────────────────
$repo    = Split-Path $PSScriptRoot -Parent
$proj  = Join-Path $repo "packages\volt-bridge\src\Volt.Bridge.Codesys"
$csproj  = Join-Path $proj "Volt.Bridge.Codesys.csproj"
$dll     = Join-Path $proj "bin\Release\net48\Volt.Bridge.Codesys.dll"
$scriptPy = Join-Path $repo "packages\volt-bridge\codesys-scriptcommands\run_bridge_headless.py"

$dotnet  = "C:\Program Files\dotnet\dotnet.exe"
$install = if ($Version -eq "21") { "C:\Program Files\CODESYS 3.5.21.40" } else { "C:\Program Files\CODESYS 3.5.18.30" }
$exe     = Join-Path $install "CODESYS\Common\CODESYS.exe"

$work     = Join-Path $env:LOCALAPPDATA "volt-bridge"
$logOut   = Join-Path $work "codesys-headless-out.log"
$logErr   = Join-Path $work "codesys-headless-err.log"
$stopFlag = Join-Path $work "stop.flag"
$pidFile  = Join-Path $work "codesys-headless.pid"
$base     = "http://127.0.0.1:$Port"

# Resolve the active profile from the install (the single non-Informational
# *.profile.xml), so we never hard-code a patch number that drifts.
function Get-Profile {
    $dir = Join-Path $install "CODESYS\Profiles"
    $p = Get-ChildItem -Path $dir -Filter "*.profile.xml" -File -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $p) { throw "No profile found in $dir - is CODESYS $Version installed?" }
    return ($p.Name -replace '\.profile\.xml$', '')
}

function Get-Health {
    try { return (& curl.exe -s --max-time 4 "$base/health" | ConvertFrom-Json) }
    catch { return $null }
}

# Kill ONLY the headless instance this wrapper launched (tracked by PID file).
# Never touch other CODESYS processes — the engineer may have a live IDE open.
function Stop-Codesys {
    if (-not (Test-Path $pidFile)) { return }
    $trackedId = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1) -as [int]
    if ($trackedId) {
        $p = Get-Process -Id $trackedId -ErrorAction SilentlyContinue
        if ($p -and $p.ProcessName -eq "CODESYS") {
            $p | Stop-Process -Force -ErrorAction SilentlyContinue
        }
    }
    Remove-Item $pidFile -ErrorAction SilentlyContinue
}

function Invoke-Down {
    Write-Host "Stopping bridge ..."
    try { & curl.exe -s --max-time 4 -X POST "$base/shutdown" | Out-Null } catch {}
    New-Item -ItemType File -Path $stopFlag -Force | Out-Null   # backup signal for the pump loop
    Start-Sleep -Milliseconds 800
    Stop-Codesys
    Remove-Item $stopFlag -ErrorAction SilentlyContinue
    Write-Host "Bridge down."
}

function Invoke-Up {
    if (-not (Test-Path $exe)) { throw "CODESYS.exe not found: $exe" }
    if (-not (Test-Path $Project)) { throw "Fixture project not found: $Project" }
    if (-not (Test-Path $scriptPy)) { throw "Headless launcher not found: $scriptPy" }
    $profileName = Get-Profile

    Write-Host "CODESYS $Version  profile='$profileName'"
    Write-Host "Project: $Project"
    Write-Host "Bridge:  $base"

    # Free the DLL file-lock and the port before building/launching.
    Stop-Codesys
    New-Item -ItemType Directory -Path $work -Force | Out-Null
    Remove-Item $stopFlag -ErrorAction SilentlyContinue

    if (-not $NoBuild) {
        Write-Host "Building Volt.Bridge.Codesys (Release) ..."
        & $dotnet build $csproj -c Release --nologo -v q
        if ($LASTEXITCODE -ne 0) { throw "Build failed." }
    }
    if (-not (Test-Path $dll)) { throw "Bridge DLL missing after build: $dll" }

    # The headless launcher reads these from the environment.
    $env:VOLT_BRIDGE_DLL      = $dll
    $env:VOLT_FIXTURE_PROJECT = $Project
    $env:VOLT_STOP_FLAG       = $stopFlag

    # Pass a single verbatim command line: CODESYS needs the quotes AROUND each
    # value (--profile="A B C"); a PowerShell array drops them and the profile
    # gets truncated at the first space.
    $argline = '--profile="{0}" --runscript="{1}" --noUI' -f $profileName, $scriptPy
    Write-Host "Launching headless CODESYS ..."
    $proc = Start-Process -FilePath $exe -ArgumentList $argline -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput $logOut -RedirectStandardError $logErr
    Set-Content -Path $pidFile -Value $proc.Id
    Write-Host "  PID $($proc.Id); logs -> $work"

    Write-Host -NoNewline "Waiting for bridge to come up"
    $deadline = (Get-Date).AddSeconds(120)
    $health = $null
    while ((Get-Date) -lt $deadline) {
        if ($proc.HasExited) {
            Write-Host ""
            Write-Warning "CODESYS exited early (code $($proc.ExitCode)). Last log lines:"
            if (Test-Path $logOut) { Get-Content $logOut -Tail 20 }
            return
        }
        $health = Get-Health
        if ($health -and $health.status) { break }
        Write-Host -NoNewline "."
        Start-Sleep -Seconds 2
    }
    Write-Host ""
    if ($health -and $health.status) {
        Write-Host "Bridge UP  status=$($health.status)  connected=$($health.connected)  project='$($health.projectName)'" -ForegroundColor Green
    } else {
        Write-Warning "Bridge did not report healthy within timeout. Last log lines:"
        if (Test-Path $logOut) { Get-Content $logOut -Tail 20 }
    }
}

function Invoke-Test {
    Invoke-Up
    $health = Get-Health
    if (-not ($health -and $health.status)) { Write-Warning "Bridge not up; skipping /refs."; return }
    Write-Host "`nGET /refs (exercises the marshaled primary-thread read path) ..."
    try {
        $refs = & curl.exe -s --max-time 30 "$base/refs" | ConvertFrom-Json
        $count = if ($refs.items) { $refs.items.Count } elseif ($refs.refs) { $refs.refs.Count } else { 0 }
        Write-Host "  /refs returned $count item(s)  projectVersion=$($refs.projectVersion)" -ForegroundColor Green
    } catch {
        Write-Warning "  /refs failed: $_"
    }
    Write-Host "`nBridge left running. Tear down with:  script/codesys-bridge.ps1 down"
}

switch ($Action) {
    "up"      { Invoke-Up }
    "test"    { Invoke-Test }
    "down"    { Invoke-Down }
    "restart" { Invoke-Down; Start-Sleep -Seconds 1; Invoke-Up }
    "status"  {
        $h = Get-Health
        if ($h) { $h | ConvertTo-Json -Depth 5 } else { Write-Host "Bridge not responding on $base" }
    }
    "logs"    {
        foreach ($f in @($logOut, $logErr)) {
            Write-Host "===== $f ====="
            if (Test-Path $f) { Get-Content $f -Tail 40 } else { Write-Host "(none)" }
        }
    }
}
