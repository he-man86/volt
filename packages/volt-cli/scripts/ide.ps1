#Requires -Version 5.1
<#
.SYNOPSIS
  Serve a committed FIXTURE project over the Volt pipe, on either vendor, with one verb set.

  This replaced `codesys-pipe.ps1` + `twincat-instances.ps1`. They were not two scripts because the vendors
  need two workflows — they were two scripts because only one of them was ever finished. CODESYS could build
  its bridge, wait for the pipe and print its name; TwinCAT opened an IDE and told you to sleep 30-60s and
  find the pipe yourself, having never started the thing that serves it. Every one of those gaps cost a
  debugging round the last time the TwinCAT tier was run by hand.

  What is genuinely vendor-specific is ONE step — how the bridge gets into the IDE:

    CODESYS   in-proc. The IDE runs the SHIPPED `start_volt_codesys.py` (via `run_pipe_production.py`, which
              adds only the fixture open and dialog suppression), and the IDE's own message loop answers the
              pipe. Nothing else to launch.
    TwinCAT   out-of-process. TcXaeShell has no scripting host to load a DLL into, so a separate
              `VoltBridgeTwincat --xae-pid <pid>` worker attaches over the COM ROT and serves the pipe. In
              production the CONNECTOR spawns that worker; here this script does, so the tier does not
              silently depend on a tray app being up.

  Everything around that step — build first so the bridge is never stale, track what we launched, wait for the
  pipe, print its NAME, tear down — is identical, and is now written once.

.PARAMETER Action  up (default) | down | pipe | logs
.PARAMETER Vendor  codesys | twincat
.PARAMETER Fixture Vendor-interpreted selector for WHICH committed fixture to serve:
                     codesys — a .project path (default: test/fixtures/CodesysTestProject.project)
                     twincat — "13" | "14" | "both" (default), or a .sln path
.PARAMETER InPlace Serve the committed tree ITSELF instead of a copy. The default is a copy under the system
                   temp dir, because THE IDE WRITES THE PROJECT IT HAS OPEN: every recording and every e2e run
                   saves the fixture back to disk, and pointed at the repo that is tracked files changing under
                   you. One such run was swept into a commit before anyone noticed, which is what
                   `never-git-add-all-during-e2e` is about. Use this only when the changes are the POINT.
.PARAMETER Instance Suffix so several can run at once (per-instance pid file). Each IDE serves its own
                    `volt.bridge.<vendor>.<pid>`, so instances never collide on the wire.
.PARAMETER NoBuild  Skip the pre-launch bridge build (fast re-launch when you KNOW the binary is current).
.PARAMETER Wait     Block until the pipe is SERVING and print its name. Without it `up` returns as soon as the
                    IDE is launched, which is minutes before it serves — and every caller then reinvents the
                    same polling loop, badly.

.EXAMPLE
  pwsh scripts/ide.ps1 up -Vendor codesys -Wait
  pwsh scripts/ide.ps1 up -Vendor twincat -Fixture 14 -Wait
  pwsh scripts/ide.ps1 down -Vendor twincat
#>
param(
    [ValidateSet("up", "down", "logs", "pipe")] [string]$Action = "up",
    [Parameter(Mandatory = $true)] [ValidateSet("codesys", "twincat")] [string]$Vendor,
    [string]$Fixture = "",
    [string]$Instance = "",
    [switch]$InPlace,
    [switch]$NoBuild,
    [switch]$Wait
)
$ErrorActionPreference = "Stop"

$ROOT     = Split-Path $PSScriptRoot -Parent
$FIXTURES = Join-Path $ROOT "test\fixtures"
$work     = Join-Path $env:LOCALAPPDATA "volt-bridge"
if (-not (Test-Path $work)) { New-Item -ItemType Directory -Force $work | Out-Null }
$sfx      = if ($Instance) { "-$Instance" } else { "" }
$pidFile  = Join-Path $work "$Vendor-ide$sfx.pids"

# The SDK that can target what the solution targets. "Has an SDK" is not enough — this machine carries several
# dotnet installs and the .NET 8 one fails net10.0 with NETSDK1045 (see build-cli.ps1, same trap).
$DOTNET = "C:\Program Files\dotnet\dotnet.exe"

# ── shared plumbing ────────────────────────────────────────────────────────────────────────────────────────

# THE live bridge pipes for this vendor, as NAMES. Three traps live in these four lines and each cost real time:
#   - Git Bash cannot enumerate the pipe namespace at all (`ls //./pipe/` returns empty, SILENTLY), so a caller
#     in bash must ask PowerShell rather than looking itself;
#   - the path cannot be passed in from a shell without the backslashes being eaten on the way;
#   - `Split-Path -Leaf` returns NOTHING for entries under it, because it reads '\.\pipe' as a UNC root.
# All three look identical from outside — a pipe that never appears, i.e. an IDE that seems slow to start.
function Get-BridgePipes([string]$vendor) {
    @([System.IO.Directory]::GetFiles('\\.\pipe\') |
        Where-Object { $_ -like "*volt.bridge.$vendor.*" } |
        ForEach-Object { $_.Substring($_.LastIndexOf('\') + 1) })
}

# The pid a pipe is SERVED BY — which is not always the pid we launched. CODESYS re-execs during startup, so
# the process that ends up holding the pipe has a different id than Start-Process returned. Teardown that
# trusted the launch record killed a pid that was already gone and left the real IDE running, holding the
# fixture open with unsaved changes. The pipe name carries the truth, so read it from there.
function Get-ServingPids([string]$vendor) {
    @(Get-BridgePipes $vendor | ForEach-Object { ($_ -split '\.')[-1] } | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [int]$_ })
}

# The tracked pids, as INTS, skipping anything that is not one. A corrupt entry must not stop the rest from
# being closed — the file is written by a previous run and read by this one, so it is the least trustworthy
# input the script has.
function Read-Pids([string]$path) {
    if (-not (Test-Path $path)) { return @() }
    @(Get-Content $path | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [int]$_ })
}

# Did THIS script start the process? It is tracked by `up`, or it runs this repo's build (the worker `up` spawns, a
# CODESYS started on this repo's launcher script), or it has one of this script's fixture copies open (the IDE `up`
# opened, and the one CODESYS re-execs into, which `up` never saw). Anything else — an engineer's own IDE, a bridge
# they downloaded — is not ours to close, whatever vendor it shares. A plain substring test, not `-like`: a path
# holding `[` or `]` is a wildcard pattern to `-like`.
function Test-Ours([int]$procId, [int[]]$tracked) {
    if ($tracked -contains $procId) { return $true }
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
    if ($null -eq $p) { return $false }
    $text = "$($p.ExecutablePath) $($p.CommandLine)"
    foreach ($mark in @($ROOT, (Join-Path ([System.IO.Path]::GetTempPath()) "volt-ide-"))) {
        if ($text.IndexOf($mark, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
    }
    return $false
}

# MERGE with what is already tracked, never overwrite: `up -Fixture 13` then `up -Fixture 14` used to replace
# the file, so `down` closed only the second and left the first running.
# `@(...)` on BOTH sides is load-bearing. `$live + $new` did STRING concatenation whenever the file held
# exactly ONE pid, because Get-Content returns a scalar for a one-line file: "22620" + 10388 wrote
# "2262010388", a number too large for Int32. `down` then killed nothing — which is how ten orphaned
# TcXaeShell windows accumulated before anyone noticed.
function Save-Pids([string]$path, [int[]]$new) {
    $live = @(Read-Pids $path | Where-Object { (Get-Process -Id $_ -ErrorAction SilentlyContinue) -ne $null })
    (@($live) + @($new) | Select-Object -Unique) | Out-File $path -Encoding ascii
}

# Has a worker ATTACHED to this XAE? The worker announces it in its own durable log, and that line is the
# first moment it can answer an op — the pipe is bound well before it (see Up-Twincat). Matching on the xae pid
# is what keeps a previous run's line from answering for this one.
# Has the worker WE spawned attached? Two things make that harder than grepping for the line:
#
#   THE LOG IS SHARED AND DAY-LONG. `twincat-<date>.log` is written by every worker - ours, the connector's, and
#   every one from earlier today. A bare grep answers YES for somebody else's worker, and for our own previous
#   run against a reused pid. That is how `up` printed "worker attached" on 2026-09-20 while the worker it had
#   launched sat DEGRADED and the connector's 11-day-old one was actually serving the pipe.
#
#   SO: the line must be NEWER than the worker we started, and that worker must still be alive.
function Test-TwincatAttached([int]$xaePid, [System.Diagnostics.Process]$worker, [datetime]$since) {
    if ($worker -and $worker.HasExited) { return $false }
    $log = Join-Path $env:LOCALAPPDATA "Volt\logs\twincat-$(Get-Date -Format yyyy-MM-dd).log"
    if (-not (Test-Path $log)) { return $false }
    $hits = Select-String -Path $log -Pattern "attached to TwinCAT.*xae pid $xaePid\)" -ErrorAction SilentlyContinue
    foreach ($h in $hits) {
        if ($h.Line -match '^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})') {
            $t = [datetime]::ParseExact($Matches[1], 'yyyy-MM-dd HH:mm:ss', $null)
            if ($t -ge $since.AddSeconds(-2)) { return $true }
        }
    }
    return $false
}

function Build-Bridge([string]$vendor) {
    if ($NoBuild) { return }
    # A stale Release binary silently serves the OLD wire shape — the "stale bridge" trap, which has produced
    # more than one recorded-fixture that had to be thrown away. Safe on `up`: nothing is running yet to lock it.
    $proj = if ($vendor -eq "codesys") { "src\Volt.Ide.Codesys\Volt.Ide.Codesys.csproj" } else { "src\Volt.Ide.Twincat\Volt.Ide.Twincat.csproj" }
    Write-Host "building $(Split-Path $proj -Leaf) (Release) so the bridge isn't stale..."
    & $DOTNET build (Join-Path $ROOT $proj) -c Release --nologo -v quiet
    if ($LASTEXITCODE -ne 0) { throw "bridge build failed (exit $LASTEXITCODE) - fix it before launching a stale binary" }
}

function Wait-ForPipe([string]$vendor, [int[]]$before) {
    # Opening a real project takes MINUTES; the pipe is the only honest "ready" signal. Report the pipe that
    # appeared during THIS call, not whatever was already serving — otherwise `up` on a second instance
    # instantly "succeeds" by finding the first one's pipe.
    for ($i = 0; $i -lt 120; $i++) {
        $fresh = @(Get-BridgePipes $vendor | Where-Object { $before -notcontains [int](($_ -split '\.')[-1]) })
        if ($fresh.Count -gt 0) { return $fresh[0] }
        Start-Sleep -Seconds 5
    }
    throw "$vendor IDE launched but no NEW pipe after 10 minutes - see: ide.ps1 logs -Vendor $vendor"
}

# ── serve a COPY ───────────────────────────────────────────────────────────────────────────────────────────

<#
.SYNOPSIS Copy a fixture out of the repo and return the copy's path (or the original under -InPlace).
.DESCRIPTION A CODESYS project is one file; a TwinCAT solution is a tree, so the whole folder travels. The copy
is refreshed on every `up`, so it is the committed fixture every time — a stale scratch tree is its own bug.
#>
function Copy-FixtureOut([string]$path, [string]$vendor) {
    if ($InPlace) { return $path }
    # PER INSTANCE. `-Instance` exists so several can run at once, and a work dir keyed on the vendor alone means
    # the second `up` deletes the solution tree the first one's IDE has OPEN (a partial delete, then a copy into
    # the wreckage) — or overwrites the .project file it is holding. The pipe is already per-pid; so is this.
    $work = Join-Path ([System.IO.Path]::GetTempPath()) ("volt-ide-$vendor" + $(if ($Instance) { "-$Instance" } else { "" }))
    if ($path -like "*.sln") {
        # `<fixtures>\<name>\<name>.sln`: the solution FOLDER is the unit that travels, PLC projects and all.
        $srcDir = Split-Path -Parent $path
        $dst = Join-Path $work (Split-Path -Leaf $srcDir)
        if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
        New-Item -ItemType Directory -Force -Path $work | Out-Null
        Copy-Item $srcDir $dst -Recurse -Force
        return Join-Path $dst (Split-Path -Leaf $path)
    }
    New-Item -ItemType Directory -Force -Path $work | Out-Null
    $dst = Join-Path $work (Split-Path -Leaf $path)
    Copy-Item $path $dst -Force
    return $dst
}

# ── codesys: in-proc host ──────────────────────────────────────────────────────────────────────────────────

function Up-Codesys {
    $install = "C:\Program Files\CODESYS 3.5.21.40"
    $exe     = Join-Path $install "CODESYS\Common\CODESYS.exe"
    $dll     = Join-Path $ROOT "src\Volt.Ide.Codesys\bin\Release\net48\Volt.Ide.Codesys.dll"
    $scriptPy = Join-Path $PSScriptRoot "run_pipe_production.py"
    $project = if ($Fixture) { $Fixture } else { Join-Path $FIXTURES "CodesysTestProject.project" }

    if (-not (Test-Path $exe))     { throw "CODESYS.exe not found: $exe" }
    if (-not (Test-Path $project)) { throw "Fixture project not found: $project" }   # the CALLER's path, before the copy
    $project = Copy-FixtureOut $project "codesys"
    Build-Bridge "codesys"
    if (-not (Test-Path $dll))     { throw "Bridge DLL missing (build Volt.Ide.Codesys): $dll" }

    $profileDir = Join-Path $install "CODESYS\Profiles"
    $pf = Get-ChildItem -Path $profileDir -Filter "*.profile.xml" -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $pf) { throw "No profile found in $profileDir" }
    $profileName = $pf.Name -replace '\.profile\.xml$', ''

    # VOLT_BRIDGE_DLL is why this script exists rather than "just open CODESYS and run the script". The shipped
    # `start_volt_codesys.py` resolves the DLL as: $VOLT_BRIDGE_DLL -> beside the script -> the INSTALL dir. The
    # env is read in-process, so it must be set BEFORE launch — you cannot set it from inside a running IDE.
    # Without it you are testing the INSTALLED bridge while believing you are testing your working tree.
    $env:VOLT_BRIDGE_DLL      = (Resolve-Path $dll).Path
    $env:VOLT_FIXTURE_PROJECT = (Resolve-Path $project).Path

    # No --noUI: the production host does not pump a message loop, so without the IDE's own loop nothing serves
    # the pipe. NO stdout/stderr redirect either — CODESYS's UI process wants its own console handles and
    # redirecting them can wedge startup, which is why the host script writes its own file log (see `logs`).
    $argline = '--profile="{0}" --runscript="{1}"' -f $profileName, (Resolve-Path $scriptPy).Path
    Write-Host "Profile: $profileName"
    Write-Host "DLL:     $($env:VOLT_BRIDGE_DLL)"
    Write-Host "Project: $($env:VOLT_FIXTURE_PROJECT)"
    $proc = Start-Process -FilePath $exe -ArgumentList $argline -PassThru -WindowStyle Normal
    Save-Pids $pidFile @($proc.Id)
    Write-Host "CODESYS launched (pid $($proc.Id))."
}

# ── twincat: out-of-process worker ─────────────────────────────────────────────────────────────────────────

function Up-Twincat {
    $ide    = "C:\Program Files (x86)\Beckhoff\TcXaeShell\Common7\IDE\TcXaeShell.exe"
    $worker = Join-Path $ROOT "src\Volt.Ide.Twincat\bin\Release\net10.0-windows\VoltBridgeTwincat.exe"
    if (-not (Test-Path $ide)) { throw "TcXaeShell.exe not found: $ide" }
    Build-Bridge "twincat"
    if (-not (Test-Path $worker)) { throw "Worker missing (build Volt.Ide.Twincat): $worker" }

    $slns = [ordered]@{
        "13" = Join-Path $FIXTURES "TwinCAT Project13\TwinCAT Project13.sln"
        "14" = Join-Path $FIXTURES "TwinCAT Project14\TwinCAT Project14.sln"
    }
    $sel = if ($Fixture) { $Fixture } else { "both" }
    # An explicit .sln replaces the fixture picks entirely: a caller that names one wants THAT open and nothing
    # else, and silently adding the fixtures beside it would give the worker two windows to choose between.
    $open = if ($sel -like "*.sln") {
        [ordered]@{ "scratch" = $sel }
    } elseif ($sel -eq "both") {
        $slns
    } else {
        if (-not $slns.Contains($sel)) { throw "unknown -Fixture '$sel' - use 13, 14, both, or a .sln path" }
        $picked = [ordered]@{}; $picked[$sel] = $slns[$sel]; $picked
    }

    # Volt identifies a project by vendor + NAME, so two XAE windows serving same-named projects collapse onto
    # one identity and the tier wedges on a `select`. That is not hypothetical — it is what happens when these
    # fixtures are opened while an engineer already has the same project open. Say so BEFORE launching, because
    # after the hang it reads as a bridge bug.
    # Validate what the CALLER named, then copy: checking after would test the copy and report a temp path the
    # user never typed, behind a raw Copy-Item failure.
    foreach ($k in @($open.Keys)) {
        if (-not (Test-Path $open[$k])) { throw "solution missing: $($open[$k])" }
        $open[$k] = Copy-FixtureOut $open[$k] "twincat"
    }

    $already = @(Get-Process TcXaeShell -ErrorAction SilentlyContinue | ForEach-Object { $_.MainWindowTitle })
    foreach ($k in $open.Keys) {
        $name = [System.IO.Path]::GetFileNameWithoutExtension($open[$k])
        if ($already -match [regex]::Escape($name)) {
            Write-Warning "an XAE window is ALREADY serving '$name' — two instances with the same project name collapse to one identity. Close it first, or the suite will hang on select."
        }
    }

    $launched = @()
    foreach ($k in $open.Keys) {
        $sln = $open[$k]
        $p = Start-Process -FilePath $ide -ArgumentList ('"{0}"' -f (Resolve-Path $sln).Path) -PassThru
        $launched += $p.Id
        Write-Host "opened $([System.IO.Path]::GetFileNameWithoutExtension($sln)) (TcXaeShell pid $($p.Id))"
    }
    Save-Pids $pidFile $launched

    # WHEN is the XAE ready for a worker? Not when the process exists, and — measured — not when it appears in
    # the COM ROT either: `--list-xae-pids` answers within a second of launch, while the PLC project is still
    # opening, and a worker spawned then blocks inside COM forever rather than failing. (It stayed at 0.4s CPU
    # for ten minutes, logging nothing.) TcXaeShell is Visual-Studio-based and exposes no "project loaded"
    # signal we can ask for.
    #
    # So do not predict it: spawn, give it a window, and if it has not come up, kill it and try again.
    #
    # And the readiness signal is the ATTACH, not the pipe. `PipeServer.Start` binds synchronously and BEFORE
    # the COM attach, so `volt.bridge.twincat.<pid>` appears on a worker that cannot answer a single op — which
    # is not a theory either: a run that trusted the pipe handed the suite a worker wedged in COM, and it sat
    # there for minutes looking like a bridge bug. The worker's own log line is the first moment it can serve.
    foreach ($procId in $launched) {
        $pipe = "volt.bridge.twincat.$procId"
        $ready = $false
        for ($attempt = 1; $attempt -le 10 -and -not $ready; $attempt++) {
            Write-Host "attaching a worker to XAE $procId (attempt $attempt)..."
            # One worker per XAE window, exactly as the connector spawns them.
            $spawnedAt = Get-Date
            $w = Start-Process -FilePath $worker -ArgumentList "--xae-pid", "$procId" -WindowStyle Hidden -PassThru
            for ($i = 0; $i -lt 12; $i++) {
                Start-Sleep -Seconds 5
                if (Test-TwincatAttached $procId $w $spawnedAt) { $ready = $true; break }
                if ($w.HasExited) { break }   # died outright (no XAE, name collision) — respawn rather than wait out the window
            }
            if (-not $ready) { Stop-Process -Id $w.Id -Force -ErrorAction SilentlyContinue }
        }
        if (-not $ready) { throw "no worker could ATTACH to XAE $procId after 10 tries - is the PLC project actually opening? (ide.ps1 logs -Vendor twincat)" }
        Write-Host "worker attached to XAE $procId -> $pipe"
    }
}

# ── verbs ──────────────────────────────────────────────────────────────────────────────────────────────────

switch ($Action) {
    "pipe" {
        $p = Get-BridgePipes $Vendor
        if ($p.Count -gt 0) { $p } else { Write-Error "no volt.bridge.$Vendor.* pipe - is an IDE up?" }
    }
    "logs" {
        $log = if ($Vendor -eq "codesys") { Join-Path $work "bridge-launcher.log" }
               else { Join-Path $env:LOCALAPPDATA "Volt\logs\twincat-$(Get-Date -Format yyyy-MM-dd).log" }
        Get-Content $log -Tail 40 -ErrorAction SilentlyContinue
    }
    "down" {
        # Kill what is SERVING as well as what we launched. The two are not the same set: CODESYS re-execs, so
        # the serving pid was never tracked, and a worker we spawned is not an IDE at all.
        #
        # BUT ONLY WHAT IS OURS (Test-Ours). This used to close every serving IDE and every VoltBridgeTwincat on the
        # machine — and on 2026-09-26 it closed an engineer's own TcXaeShell and the production bridge serving it,
        # which merely shared the vendor. A process `up` did not start is reported and left running.
        $tracked = @(Read-Pids $pidFile)
        $candidates = @(Get-ServingPids $Vendor) + $tracked
        if ($Vendor -eq "twincat") {
            $candidates = @(Get-Process VoltBridgeTwincat -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) + $candidates
        }
        $candidates = @($candidates | Select-Object -Unique)
        $targets = @($candidates | Where-Object { Test-Ours $_ $tracked })
        foreach ($procId in @($candidates | Where-Object { $targets -notcontains $_ })) {
            Write-Host "left pid $procId running — not started by this script"
        }
        if ($targets.Count -eq 0) { Write-Host "nothing of ours to close for $Vendor" }
        foreach ($procId in $targets) {
            try { Stop-Process -Id $procId -Force -ErrorAction Stop; Write-Host "closed pid $procId" } catch {}
        }
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }
    "up" {
        $before = Get-ServingPids $Vendor
        if ($Vendor -eq "codesys") { Up-Codesys } else { Up-Twincat }
        Write-Host "Tail the launcher log with: ide.ps1 logs -Vendor $Vendor"
        if ($Wait) { Wait-ForPipe $Vendor $before }
    }
}
