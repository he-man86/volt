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
  pipe, print its NAME, tear down — is identical, and is now written once. Tear-down goes through the IDE's own
  shutdown before any force, and `up` first reaps what its instance left (see "leftovers" below): an unclean exit
  otherwise leaves TcXaeShell's "Recovered Files" dialog for the next start, and a modal dialog blocks every COM call.

.PARAMETER Action  up (default) | down | pipe | logs
.PARAMETER Vendor  codesys | twincat
.PARAMETER Fixture Vendor-interpreted selector for WHICH committed fixture to serve:
                     codesys — a .project path (default: test/fixtures/CodesysTestProject.<CodesysVersion>.project,
                               the project native to that version; CodesysTestProject.project where none exists)
                     twincat — "13" | "14" (default) | "both", or a .sln path. "both" opens two XAE windows in
                               ONE instance, which nothing that drives a bridge accepts (the e2e harness, the
                               scripts and the LSP recorders each refuse an instance serving two pipes) - it is
                               for looking at two windows by hand. The default is 14 because it is the TwinCAT
                               fixture: the release matrix and vendor-facts serve it, and the IDE-authored
                               objects the suite needs (VltFixtureMembers, scripts/author-hidden-member-fixture-tc.ps1)
                               live only there. "both" was the default until 2026-10-16, a leftover of one worker
                               seeing every XAE; the harness then drove whichever pid sorted first.
.PARAMETER InPlace Serve the committed tree ITSELF instead of a copy. The default is a copy under the system
                   temp dir, because THE IDE WRITES THE PROJECT IT HAS OPEN: every recording and every e2e run
                   saves the fixture back to disk, and pointed at the repo that is tracked files changing under
                   you. One such run was swept into a commit before anyone noticed, which is what
                   `never-git-add-all-during-e2e` is about. Use this only when the changes are the POINT.
.PARAMETER Instance Suffix so several can run at once (per-instance pid file). Each IDE serves its own
                    `volt.bridge.<vendor>.<pid>`, so instances never collide on the wire.
.PARAMETER Production Serve as the SHIPPED build does: LD and FBD network text OFF (`VOLT_GRAPHICAL` removed from what
                    this launches), so every LD and FBD body pulls as `IMPLEMENTATION LD|FBD UNSUPPORTED`. The default
                    is ON, for development and the suites; this is for checking what a customer's bridge serves.
.PARAMETER RunScript codesys only: the runscript CODESYS starts with, in place of run_pipe_production.py. For a
                    probe that runs run_pipe_production.py itself and then arms its own read timer (e.g.
                    probe-dut-subtype-push.py (deleted; git show b2496efb4b:packages/volt-cli/scripts/probe-dut-subtype-push.py)), so the probe runs in an IDE this script launched, tracks and closes,
                    on a fixture COPY - not one started by hand.
.PARAMETER BridgeDir twincat: a folder holding the worker AS SHIPPED, of the XAE shell's bitness (VoltBridgeTwincat.exe;
                    e.g. dist\TwincatBridge or dist\stage\connector\x86 for a 32-bit shell, dist\stage\connector for a
                    64-bit one) - that exe is spawned, nothing built; a worker of the other bitness is refused by name.
                    Without it, the worker of the shell's bitness is built (-r win-x86 | win-x64) and spawned.
                    codesys: serve the bridge AS INSTALLED — a folder laid out like the installer's {app}\codesys
                    (Volt.Ide.Codesys.dll + start/stop_volt_codesys.py; e.g. dist\stage\codesys after build:installer).
                    The IDE runs THAT folder's start script with VOLT_BRIDGE_DLL removed from its environment, so the
                    script finds the DLL the way an installed one does (beside itself), not through the dev override.
                    Implies -NoBuild for CODESYS: what is served is the folder's own DLL.
.PARAMETER CodesysVersion codesys only: which installed CODESYS to launch, by its folder version
                    (`C:\Program Files\CODESYS <version>`). Default 3.5.21.40 (SP21 Patch 4), the one every recording
                    and suite is measured on. Explicit on purpose: never the newest installed — a second install
                    (3.5.22.40, the customer's SP22) must not silently move the recordings.
.PARAMETER XaeLanguage twincat only: the XAE shell's UI language, as a Windows LCID passed as `/LCID <n>` (e.g. 1031
                    German). The language TwinCAT's build writes its Output pane in follows it (environment-dependency-audit
                    2.4); a language whose shell resources are not installed is refused by name, not left to the shell
                    (which silently stays in English). Default: the shell's own setting.
.PARAMETER CodesysCulture codesys only: the UI culture CODESYS runs in, passed as its own `--culture=<name>` switch (e.g.
                    `en`). CODESYS writes its messages - build diagnostics included - in that language; without it the
                    language follows Windows', and a Windows UI language CODESYS does not ship (this machine's nl-NL)
                    makes it write German (DIALECT V9). The recorders whose oracle language is English pass `en`
                    (scripts/vendor-facts.ts). Default: none - CODESYS's own choice.
.PARAMETER CodesysBitness codesys only: 32 | 64 — which edition of -CodesysVersion, when it is installed both 64-bit
                    (`Program Files`) and 32-bit (`Program Files (x86)`). Without it a version installed in both is
                    refused by name; with it an edition that is not installed is refused by name (never the other one).
.PARAMETER XaeBitness twincat only: 32 | 64 — which registered XAE shell to open, by its exe's PE machine (TcXaeShell 15
                    is x86; TwinCAT 3.1.4026 can install the x64 TcXaeShell64). Without it the 32-bit shell is preferred
                    (the committed fixtures are 4024 projects); with it a bitness no registered shell has is refused.
.PARAMETER Reopen   twincat, up only: open this instance's project AGAIN, as an engineer does after its XAE closed - the
                    copy it recorded, exactly as it is on disk (no fresh copy, no recovery entry cleared), in a new XAE,
                    and attach that XAE's worker as the connector does. For the IDE-restart chaos test, which must serve
                    the project the engineer had open, not a fresh fixture. Refused while the instance's XAE still runs.
.PARAMETER NoBuild  Skip the pre-launch bridge build (fast re-launch when you KNOW the binary is current).
.PARAMETER Run      The run this instance belongs to (default: $VOLT_IDE_RUN, else the instance alone). A run owns the
                    instance its tag names and every `<tag>-...` one. `up` refuses to start while any CODESYS, TcXaeShell or
                    VoltBridgeTwincat runs that no instance of the run recorded, naming each by pid and command line;
                    `check` gives that answer without starting anything (exit 1 when it would refuse); `sweep` runs
                    `down` for every instance of the run that has a record.
.PARAMETER DryRun   down only: print what would be closed and what is left running, and close nothing.
.PARAMETER Wait     Block until the pipe is SERVING and print its name. Without it `up` returns as soon as the
                    IDE is launched, which is minutes before it serves — and every caller then reinvents the
                    same polling loop, badly.

.EXAMPLE
  pwsh scripts/ide.ps1 up -Vendor codesys -Wait
  pwsh scripts/ide.ps1 up -Vendor twincat -Fixture 14 -Wait
  pwsh scripts/ide.ps1 down -Vendor twincat
#>
param(
    [ValidateSet("up", "down", "logs", "pipe", "check", "sweep")] [string]$Action = "up",
    [Parameter(Mandatory = $true)] [ValidateSet("codesys", "twincat")] [string]$Vendor,
    [string]$Fixture = "",
    [string]$Instance = "",
    [string]$Run = "",
    [switch]$InPlace,
    [switch]$Production,
    [string]$RunScript = "",
    [string]$BridgeDir = "",
    [string]$CodesysVersion = "3.5.21.40",
    [ValidateSet("", "32", "64")] [string]$CodesysBitness = "",
    [ValidatePattern('^([a-z]{2}(-[A-Z]{2})?)?$')] [string]$CodesysCulture = "",
    [int]$XaeLanguage = 0,
    [ValidateSet("", "32", "64")] [string]$XaeBitness = "",
    [switch]$NoBuild,
    [switch]$Reopen,
    [switch]$Wait,
    [switch]$DryRun
)
$ErrorActionPreference = "Stop"

$ROOT     = Split-Path $PSScriptRoot -Parent
$FIXTURES = Join-Path $ROOT "test\fixtures"
$work     = Join-Path $env:LOCALAPPDATA "volt-bridge"
if (-not (Test-Path $work)) { New-Item -ItemType Directory -Force $work | Out-Null }
$sfx      = if ($Instance) { "-$Instance" } else { "" }
$pidFile  = Join-Path $work "$Vendor-ide$sfx.pids"
# The project(s) this instance's `up` OPENED, one full path per line. The e2e harness reads it with the pid file to
# prove a pipe is a fixture COPY's before it touches it (test/e2e/lib/fixture-ide.ts): it refuses any pipe whose
# instance did not open a project under %TEMP%\volt-ide-<vendor>[-<Instance>]\ — an -InPlace run included.
$projFile = Join-Path $work "$Vendor-ide$sfx.projects"

# THE RUN this instance is in (openspec shared-ide-machine-rules): -Run, else $VOLT_IDE_RUN, else the instance alone. A
# run owns its tag's instance and every `<tag>-...` one; `up` starts only when every running IDE is one of those
# instances' (ide-run.ps1 holds the rule, tested offline).
. (Join-Path $PSScriptRoot "ide-run.ps1")
$RunTag = Resolve-RunTag $PSBoundParameters.ContainsKey("Run") $Run $env:VOLT_IDE_RUN $Instance

# The SDK that can target what the solution targets. "Has an SDK" is not enough — this machine carries several
# dotnet installs and the .NET 8 one fails net10.0 with NETSDK1045 (see build-cli.ps1, same trap).
$DOTNET = "C:\Program Files\dotnet\dotnet.exe"

# WHERE Add-Type MAY COMPILE. Windows PowerShell's Add-Type runs the .NET Framework csc, which cannot write into a
# folder the ANSI code page cannot spell (measured 2026-10-13, environment-dependency-audit 2.5: TEMP under
# `volt-Тест-Юникод` on a code-page-1252 machine -> "cannot write to the output file ... the directory name is
# invalid"). So a run with such a TEMP - the one that measures what XAE does with a non-ASCII temp path - compiles in
# a folder the code page CAN spell, and everything else (the copy root, the IDE, the worker) keeps the caller's TEMP.
function Get-CompileTemp {
    $t = [System.IO.Path]::GetTempPath()
    $ansi = [System.Text.Encoding]::Default   # Windows PowerShell 5.1: the system's ANSI code page (GetACP)
    if ($ansi.GetString($ansi.GetBytes($t)) -eq $t) { return $t.TrimEnd([char]92) }
    $alt = Join-Path $env:ProgramData "volt-ide-compile"
    if ($ansi.GetString($ansi.GetBytes($alt)) -ne $alt) { throw "no folder to compile in: neither TEMP ($t) nor $alt is in the ANSI code page" }
    New-Item -ItemType Directory -Force $alt | Out-Null
    $alt
}

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

# WHAT `up` STARTED, one process per line as `<pid> <start time, UTC ticks>`. The start time is what makes a line
# mean ONE process: a pid is reused once its process exits, and a pid alone named whatever later got the number.
# A corrupt line is skipped, not fatal — the file is written by a previous run and read by this one, so it is the
# least trustworthy input the script has. A bare `<pid>` line (no start time) names NOTHING and is skipped, said
# aloud: as a recorded PARENT it named any process whose dead parent's number Windows had handed to a launch of ours
# — another session's TcXaeShell and every worker attached to it, closed together (ld-fbd-coverage gate 2R.3).
function Read-Records([string]$path) {
    if (-not (Test-Path $path)) { return @() }
    @(Get-Content $path | ForEach-Object {
        $f = @($_.Trim() -split '\s+')
        if ($f[0] -match '^\d+$') {
            if ($f.Count -gt 1 -and $f[1] -match '^\d+$') { [pscustomobject]@{ Pid = [int]$f[0]; Ticks = [long]$f[1] } }
            else { Write-Warning "pid record '$($_.Trim())' in $path has no start time - skipped (a bare pid names whatever later reuses the number)" }
        }
    })
}

# The process's start as UTC ticks — from CIM, so it also answers for a process this session cannot open.
function Get-StartTicks([int]$procId) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
    if ($null -eq $p -or $null -eq $p.CreationDate) { return $null }
    $p.CreationDate.ToUniversalTime().Ticks
}

# Did THIS script's `up` (for this vendor and -Instance) start the process? Only by the record: it is a process `up`
# wrote down (same pid AND same start), or a process one of them STARTED (a recorded parent, the child no older than
# it) — which is how the IDE CODESYS may re-exec into during startup is found, though `up` never sees its pid. The
# walk goes up a few generations, through parents that are still alive.
#
# It used to also count anything running this repo's build or holding a `volt-ide-*` temp copy. That took every
# IDE another session or workflow had started from this checkout — same repo, same launcher, same temp prefix —
# and `down` closed it. A process this `up` did not start is not this `down`'s to close.
function Test-Ours([int]$procId, $records) {
    $cur = $procId
    for ($depth = 0; $depth -lt 4; $depth++) {
        $p = Get-CimInstance Win32_Process -Filter "ProcessId=$cur" -ErrorAction SilentlyContinue
        if ($null -eq $p) { return $false }
        $ticks = $p.CreationDate.ToUniversalTime().Ticks
        foreach ($r in $records) {
            if ($depth -eq 0 -and $r.Pid -eq $cur -and $r.Ticks -eq $ticks) { return $true }
            # A recorded PARENT: the child must not predate it, or the parent pid is a reused number.
            if ($r.Pid -eq $p.ParentProcessId -and $r.Ticks -le $ticks) { return $true }
        }
        $cur = [int]$p.ParentProcessId
        if ($cur -le 0) { return $false }
    }
    return $false
}

# MERGE with what is already recorded, never overwrite: one `up` writes the file several times (each XAE, then each
# worker once it attaches), and replacing it left `down` closing only the last. (A second `up` on the same
# -Instance now closes the first one's processes and starts a fresh file — see the `up` verb.) A record is kept after its process exits:
# a launched process can be gone by `down` while the IDE it started is still up, and it is the parent that names
# that IDE as ours. A stale record cannot name a stranger — its start time no longer matches anything.
# `@(...)` on both sides is load-bearing: Get-Content returns a SCALAR for a one-line file, and `$a + $b` then
# concatenated strings ("22620" + 10388 → "2262010388"), which once left ten TcXaeShell windows orphaned.
# Every record carries its START TIME, read from the Process object `Start-Process -PassThru` returned — it holds the
# process handle, so the time answers even when the process has already exited (a launcher that re-execs), where CIM
# finds nothing. Truncated to the microsecond CIM's CreationDate carries, so Test-Ours compares like with like. A
# process whose start cannot be read is NOT recorded — it was written as a bare pid, which named strangers (Read-Records).
function Save-Pids([string]$path, [System.Diagnostics.Process[]]$new) {
    $lines = @(Read-Records $path | ForEach-Object { "$($_.Pid) $($_.Ticks)" })
    foreach ($proc in $new) {
        $t = $null
        try { $t = $proc.StartTime.ToUniversalTime().Ticks; $t -= $t % 10 } catch { $t = Get-StartTicks $proc.Id }
        if ($null -eq $t) { Write-Warning "pid $($proc.Id): its start time cannot be read - not recorded, so ``down`` will not close it by its pid"; continue }
        $lines = @($lines) + @("$($proc.Id) $t")
    }
    @($lines | Select-Object -Unique) | Out-File $path -Encoding ascii
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
    # The worker's attach line names the IDE it reached by its OWN identity since ide-identity-report 2 ("attached to
    # TcXaeShell 15.0 by Beckhoff (xae pid N)"); it used to read "attached to TwinCAT …", and a pattern on that word
    # never matched again, so every attach was killed after its 60 s window and retried until `up` gave up. Keyed on
    # the pid alone, which is what identifies the window.
    $hits = Select-String -Path $log -Pattern "attached to .*\(xae pid $xaePid\)" -ErrorAction SilentlyContinue
    foreach ($h in $hits) {
        if ($h.Line -match '^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})') {
            $t = [datetime]::ParseExact($Matches[1], 'yyyy-MM-dd HH:mm:ss', $null)
            if ($t -ge $since.AddSeconds(-2)) { return $true }
        }
    }
    return $false
}

# The TwinCAT worker of an XAE of this bitness: one build per bitness, each in its RID's own output folder (the
# connector resolves the same folders in a dev tree), self-contained because no x86 .NET runtime is a given. Only a
# worker of the XAE's bitness reads its Solution Explorer (DIALECT C2t).
function Get-TwincatRid([int]$bits) { if ($bits -eq 32) { "win-x86" } else { "win-x64" } }

function Build-Bridge([string]$vendor, [string]$rid = "") {
    if ($NoBuild) { return }
    # A stale Release binary silently serves the OLD wire shape — the "stale bridge" trap, which has produced
    # more than one recorded-fixture that had to be thrown away. Safe on `up`: nothing is running yet to lock it.
    $proj = if ($vendor -eq "codesys") { "src\Volt.Ide.Codesys\Volt.Ide.Codesys.csproj" } else { "src\Volt.Ide.Twincat\Volt.Ide.Twincat.csproj" }
    $ridArgs = if ($rid) { @("-r", $rid, "--self-contained", "true") } else { @() }
    Write-Host "building $(Split-Path $proj -Leaf) (Release$(if ($rid) { " $rid" })) so the bridge isn't stale..."
    & $DOTNET build (Join-Path $ROOT $proj) -c Release @ridArgs --nologo -v quiet
    if ($LASTEXITCODE -ne 0) { throw "bridge build failed (exit $LASTEXITCODE) - fix it before launching a stale binary" }
}

function Wait-ForPipe([string]$vendor, [int[]]$before) {
    # Opening a real project takes MINUTES; the pipe is the only honest "ready" signal. Report the pipe that
    # appeared during THIS call, not whatever was already serving — otherwise `up` on a second instance
    # instantly "succeeds" by finding the first one's pipe.
    #
    # NEW IS NOT ENOUGH — it must be OURS (Test-Ours against this -Instance's record). Another session's IDE that
    # finishes loading while this one waits is new too, and `up -Wait` once handed a probe ANOTHER workflow's live
    # pipe, which it would then have pushed into (openspec push-without-header-check 5Qb review).
    for ($i = 0; $i -lt 120; $i++) {
        $records = @(Read-Records $pidFile)
        $fresh = @(Get-BridgePipes $vendor | Where-Object {
            $servedBy = [int](($_ -split '\.')[-1])
            $before -notcontains $servedBy -and (Test-Ours $servedBy $records)
        })
        if ($fresh.Count -gt 0) { return $fresh[0] }
        Start-Sleep -Seconds 5
    }
    throw "$vendor IDE launched but no NEW pipe of ours after 10 minutes - see: ide.ps1 logs -Vendor $vendor"
}

# ── leftovers: close cleanly, and clear what an unclean exit leaves behind ─────────────────────────────────
#
# AN UNCLEAN EXIT IS NOT FREE. `down` used to Stop-Process -Force everything, and a crash test kills the XAE on
# purpose. TcXaeShell (Visual Studio 2017 underneath) then leaves its AutoRecover state behind, and the NEXT XAE that
# starts shows a modal "recover files?" dialog — and a modal dialog blocks every COM call, so the worker attaches to
# nothing and `up` reads as a slow or broken bridge. Worse, Windows' Restart Manager RELAUNCHES a crashed XAE with
# `/restartManager /recoveryFile <dead pid>.dat`: a window nobody started, holding this instance's copy, that no record
# names (measured 2026-10-03: XAE 41464 on volt-ide-twincat-e2e-verify, relaunched for dead 12248, still up after its
# run had ended, and colliding by project name with another workflow's Project13).
#
# So: close through the IDE's own shutdown first (TwinCAT by DTE, CODESYS through the harness's runscript), force only
# after a timeout, and before `up` opens anything, reap what this instance left and clear its recovery entries.

# Where TcXaeShell keeps AutoRecover state (measured): one `<xae pid>.dat` + `<xae pid>.suodat` per XAE that had
# unsaved changes at an autosave tick, removed on a clean exit. Keyed by PID, not path — the solution path is INSIDE
# the file — so it is cleared by content: only entries naming this instance's copy, and never a live XAE's.
$XAE_RECOVERY = Join-Path $env:APPDATA "Beckhoff\TcXaeShell\15.0_IsoShell\AutoRecoverDat"   # TcXaeShell 15's; TcXaeShell64's is unmeasured
# The XAE shells' process names: TcXaeShell 15 (32-bit) and TwinCAT 3.1.4026's 64-bit TcXaeShell64.
$XAE_SHELLS = @("TcXaeShell", "TcXaeShell64")

# The XAEs holding this instance's copy, by COMMAND LINE — how a Restart-Manager relaunch is found, since no record
# names it. Exact per instance (Get-CopyRoot ends in a separator), so another instance's window is never matched.
function Get-CopyHolders([string]$vendor, [string]$inst = $Instance) {
    if ($vendor -ne "twincat") { return @() }   # CODESYS's command line carries no project path (it travels in env)
    $root = Get-CopyRoot $vendor $inst
    @(Get-CimInstance Win32_Process -Filter "Name='TcXaeShell.exe' OR Name='TcXaeShell64.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($root, [StringComparison]::OrdinalIgnoreCase) -ge 0 } |
        ForEach-Object { [int]$_.ProcessId })
}

# Every running process of THIS instance, split into what to close and what is left alone. Ours: what Test-Ours
# names (the record), what holds this instance's copy (Get-CopyHolders), and a TwinCAT worker attached to an XAE of
# ours — including one whose XAE is gone, which serves PLC_DISCONNECTED forever and is the commonest leftover. A
# worker spawned by an `up` that was itself killed before it wrote the worker down is found that way too. Every running
# IDE of the vendor is a candidate as well, so the IDE CODESYS re-execs into counts before it serves its pipe. $inst asks
# the same of another instance (the run's siblings, Get-RunOwnPids).
function Get-OurProcesses([string]$vendor, [string]$inst = $Instance) {
    $records = @(Read-Records (Join-Path $work "$vendor-ide$(Get-Sfx $inst).pids"))
    $holders = @(Get-CopyHolders $vendor $inst)
    $images = if ($vendor -eq "codesys") { "Name='CODESYS.exe'" } else { "Name='TcXaeShell.exe' OR Name='TcXaeShell64.exe'" }
    $ides = @(Get-CimInstance Win32_Process -Filter $images -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.ProcessId })
    $candidates = @(Get-ServingPids $vendor) + @($records | ForEach-Object { $_.Pid }) + $holders + $ides
    $workers = @()
    if ($vendor -eq "twincat") {
        $workers = @(Get-CimInstance Win32_Process -Filter "Name='VoltBridgeTwincat.exe'" -ErrorAction SilentlyContinue)
        $candidates = @($workers | ForEach-Object { [int]$_.ProcessId }) + $candidates
    }
    $candidates = @($candidates | Select-Object -Unique | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
    $ours = @($candidates | Where-Object { $holders -contains $_ -or (Test-Ours $_ $records) })
    foreach ($w in $workers) {
        $wid = [int]$w.ProcessId
        if ($ours -contains $wid -or $candidates -notcontains $wid) { continue }
        if ($w.CommandLine -notmatch '--xae-pid\s+(\d+)') { continue }
        $xae = [int]$Matches[1]
        $wTicks = $w.CreationDate.ToUniversalTime().Ticks
        # Attached to an XAE we hold now, or to one the record names (the worker no older than that XAE, so a reused
        # pid number is not mistaken for ours).
        $mine = ($ours -contains $xae) -or @($records | Where-Object { $_.Pid -eq $xae -and $_.Ticks -le $wTicks }).Count -gt 0
        if ($mine) { $ours += $wid }
    }
    [pscustomobject]@{ Ours = $ours; Others = @($candidates | Where-Object { $ours -notcontains $_ }) }
}

# THE RUN'S OWN processes: what every instance of $RunTag counts as ours (Get-OurProcesses), both vendors, found
# through the pid records in $work. A record of another run is never read; a record that cannot be read names nothing,
# so what it would have named is foreign (zero fallback).
function Get-RunOwnPids {
    $own = @()
    foreach ($f in @(Get-ChildItem $work -Filter "*-ide*.pids" -File -ErrorAction SilentlyContinue)) {
        $r = Get-RecordInstance $f.Name
        if ($null -eq $r -or -not (Test-RunOwns $RunTag $r.Instance)) { continue }
        $own += @((Get-OurProcesses $r.Vendor $r.Instance).Ours)
    }
    @($own | Select-Object -Unique)
}

# Every running process of the IDE images (ide-run.ps1's $IDE_IMAGES), with the command line that says whose it is.
function Get-IdeProcesses {
    $filter = ($IDE_IMAGES | ForEach-Object { "Name='$_'" }) -join " OR "
    @(Get-CimInstance Win32_Process -Filter $filter -ErrorAction SilentlyContinue |
        ForEach-Object { [pscustomobject]@{ Pid = [int]$_.ProcessId; Name = $_.Name; CommandLine = $_.CommandLine } })
}

function Get-ForeignIdes { @(Select-Foreign (Get-IdeProcesses) (Get-RunOwnPids)) }

# THE CHECK AND THE LAUNCH ARE ONE STEP. Two cells of one run start together; between a sibling's Start-Process and its
# Save-Pids its IDE runs unrecorded, and a check in that gap would call it foreign. So `up` takes this machine-wide lock
# before its check and releases it once its IDE is recorded (Up-Codesys / Up-Twincat); Windows releases it when the
# process ends however it ends. A wait that long is a hung launch, said by name.
$script:launchLock = $null
function Enter-LaunchLock {
    $m = New-Object System.Threading.Mutex($false, "Local\volt-ide-launch")
    $held = $false
    try { $held = $m.WaitOne([TimeSpan]::FromMinutes(10)) } catch [System.Threading.AbandonedMutexException] { $held = $true }
    if (-not $held) { throw "another ide.ps1 has held the launch lock (Local\volt-ide-launch) for 10 minutes - a launch that hangs; close it, then start again" }
    $script:launchLock = $m
}
function Exit-LaunchLock { if ($script:launchLock) { $script:launchLock.ReleaseMutex(); $script:launchLock = $null } }

# The DTE close, run in a CHILD process: a modal dialog in the XAE blocks a COM call forever, and that must cost a
# timeout, not hang ide.ps1. Close the solution WITHOUT saving (the copy is thrown away; saving would only write a
# fixture copy nobody reads), then Quit — the exit path that removes the XAE's own AutoRecover entry.
$XAE_CLOSE = @'
$ErrorActionPreference = "Stop"
$env:TEMP = $env:TMP = "__COMPILE_TEMP__"   # see Get-CompileTemp
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Runtime.InteropServices.ComTypes;
public static class VoltRotClose {
    [DllImport("ole32.dll")] static extern int GetRunningObjectTable(int r, out IRunningObjectTable t);
    [DllImport("ole32.dll")] static extern int CreateBindCtx(int r, out IBindCtx c);
    public static object Find(string suffix) {
        IRunningObjectTable rot; GetRunningObjectTable(0, out rot); IEnumMoniker e; rot.EnumRunning(out e);
        var m = new IMoniker[1];
        while (e.Next(1, m, IntPtr.Zero) == 0) {
            IBindCtx ctx; CreateBindCtx(0, out ctx); string name; m[0].GetDisplayName(ctx, null, out name);
            if (name.EndsWith(suffix) && name.Contains("DTE")) { object o; rot.GetObject(m[0], out o); return o; }
        }
        return null;
    }
}
"@
$dte = [VoltRotClose]::Find(":__PID__")
if ($null -eq $dte) { exit 2 }
# A busy XAE REJECTS a call (RPC_E_CALL_REJECTED / RPC_E_SERVERCALL_RETRYLATER) rather than queueing it.
function Retry([scriptblock]$b) {
    for ($i = 0; ; $i++) {
        try { return (& $b) } catch {
            $hr = $_.Exception.HResult
            if ($i -ge 40 -or ($hr -ne -2147418111 -and $hr -ne -2147417846)) { throw }
            Start-Sleep -Milliseconds 500
        }
    }
}
Retry { $dte.SuppressUI = $true }
Retry { $dte.Solution.Close($false) }
Retry { $dte.Quit() }
exit 0
'@

# CODESYS has no automation server to call from outside. The harness runscript (run_pipe_production.py) watches
# %LOCALAPPDATA%\volt-bridge\codesys-native\<pid>\ already; a `quit` file there makes it close the project WITHOUT
# saving and answer `quit.done`. With no project open, the main window's close is CODESYS's normal exit, no prompt.
function Close-CodesysClean([System.Diagnostics.Process]$p, [int]$timeoutSec) {
    $dir = Join-Path $work "codesys-native\$($p.Id)"
    if (Test-Path $dir) {
        Remove-Item (Join-Path $dir "quit.*") -Force -ErrorAction SilentlyContinue
        New-Item -ItemType File -Force (Join-Path $dir "quit") | Out-Null
        $deadline = (Get-Date).AddSeconds([Math]::Min(30, $timeoutSec))
        while ((Get-Date) -lt $deadline -and -not (Test-Path (Join-Path $dir "quit.*"))) { Start-Sleep -Milliseconds 300 }
        $err = Join-Path $dir "quit.error"
        if (Test-Path $err) { Write-Warning "CODESYS $($p.Id) could not close its project: $(Get-Content $err -Raw)" }
        elseif (-not (Test-Path (Join-Path $dir "quit.done"))) { Write-Warning "CODESYS $($p.Id) did not answer the quit request (a modal dialog, or a runscript without the quit handler)" }
    }
    $p.Refresh()
    if ($p.MainWindowHandle -ne [IntPtr]::Zero) { [void]$p.CloseMainWindow() }
}

# Close ONE process of ours: cleanly if it is an IDE, then wait, then force — the force is the last resort, and it is
# reported, because it is exactly the exit that leaves recovery state behind.
function Close-Ours([int]$procId, [int]$timeoutSec = 90) {
    $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($null -eq $p) { return }
    $name = $p.ProcessName
    $child = $null
    if ($XAE_SHELLS -contains $name) {
        $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($XAE_CLOSE.Replace("__PID__", "$procId").Replace("__COMPILE_TEMP__", (Get-CompileTemp))))
        $child = Start-Process powershell -ArgumentList "-NoProfile", "-NonInteractive", "-EncodedCommand", $enc -WindowStyle Hidden -PassThru
    } elseif ($name -eq "CODESYS") {
        Close-CodesysClean $p $timeoutSec
    }
    # A worker has nothing to recover and nothing to save: it is not "closed cleanly", it is just stopped (below).
    if (($XAE_SHELLS -contains $name) -or $name -eq "CODESYS") {
        if ($p.WaitForExit($timeoutSec * 1000)) {
            Write-Host "closed $name $procId cleanly"
            if ($child -and -not $child.HasExited) { Stop-Process -Id $child.Id -Force -ErrorAction SilentlyContinue }
            return
        }
        if ($child -and -not $child.HasExited) { Stop-Process -Id $child.Id -Force -ErrorAction SilentlyContinue }
        Write-Warning "$name $procId did not exit within $timeoutSec s of a clean close - forcing it (its recovery state is cleared on the next up)"
    }
    try { Stop-Process -Id $procId -Force -ErrorAction Stop; Write-Host "closed $name $procId" } catch {}
}

# Close every process of this instance: workers FIRST (each holds COM references into its XAE, and nothing of a worker
# needs saving), then the IDEs. Returns the pids it closed.
function Close-Instance([string]$vendor, [switch]$DryRun, [switch]$Quiet) {
    $found = Get-OurProcesses $vendor
    if (-not $Quiet) { foreach ($procId in $found.Others) { Write-Host "left pid $procId running — not started by this script" } }
    if ($found.Ours.Count -eq 0) { Write-Host "nothing of ours to close for $vendor$(if ($Instance) { " (instance $Instance)" })"; return @() }
    $ordered = @($found.Ours | Sort-Object { if ((Get-Process -Id $_ -ErrorAction SilentlyContinue).ProcessName -eq "VoltBridgeTwincat") { 0 } else { 1 } })
    foreach ($procId in $ordered) {
        if ($DryRun) { Write-Host "would close pid $procId ($((Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName))"; continue }
        Close-Ours $procId
    }
    return $ordered
}

# What an unclean exit left for THIS instance, once nothing of it runs: the XAE AutoRecover entries naming its copy
# (any other entry — a live XAE's, another instance's, an engineer's own project — is left exactly as it is), and the
# copy itself, which still carries the dead session's .vs/.suo, `.~u` project locks (TwinCAT and CODESYS alike) and
# CODESYS's per-user .opt files. The copy is rebuilt from the committed fixture right after, so deleting it all is the
# whole of "fresh"; a delete that fails means a process this script does not own holds it, and that is said loudly.
function Clear-InstanceLeftovers([string]$vendor) {
    $root = Get-CopyRoot $vendor
    if ($vendor -eq "twincat" -and (Test-Path $XAE_RECOVERY)) {
        foreach ($dat in @(Get-ChildItem $XAE_RECOVERY -Filter "*.dat" -File -ErrorAction SilentlyContinue)) {
            $owner = $dat.BaseName
            if ($owner -match '^\d+$' -and (Get-Process -Id ([int]$owner) -ErrorAction SilentlyContinue | Where-Object { $XAE_SHELLS -contains $_.ProcessName })) { continue }
            $bytes = [IO.File]::ReadAllBytes($dat.FullName)
            $text = [Text.Encoding]::Unicode.GetString($bytes) + [Text.Encoding]::UTF8.GetString($bytes)
            # WITH the separator: the default instance's `volt-ide-twincat` is a prefix of every other instance's copy.
            if ($text.IndexOf($root, [StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
            Remove-Item $dat.FullName, (Join-Path $XAE_RECOVERY "$owner.suodat") -Force -ErrorAction SilentlyContinue
            Write-Host "cleared XAE recovery entry $($dat.Name) (it named this instance's copy)"
        }
    }
    if (-not $InPlace -and (Test-Path $root)) {
        try { Remove-Item $root -Recurse -Force -ErrorAction Stop }
        catch { throw "could not clear this instance's copy $root - a process this script did not start holds it: $($_.Exception.Message)" }
    }
}

# ── the safety net: a Recovered Files dialog that appears anyway ───────────────────────────────────────────
#
# Clear-InstanceLeftovers removes what it can SEE. A recovery entry it could not attribute (or one written between the
# clear and the launch) still opens TcXaeShell on a modal "TcXaeShell Recovered Files" dialog, and the worker then
# blocks in COM until `up` gives up. So while `up` waits for the attach it also watches this instance's XAE windows,
# and answers exactly THAT dialog with "&Do Not Recover" — the copy is thrown away on the next `up`, there is nothing
# in it to recover — logging the instance, the pid and the files it listed. Nothing else is ever clicked: any other
# modal dialog on those windows is logged (title + buttons) once, and `up` keeps waiting and times out as before.
# Only windows OWNED by this instance's XAE pids are looked at; another instance's IDE is never touched.
$XAE_RECOVERY_TITLE  = "TcXaeShell Recovered Files"
$XAE_RECOVERY_BUTTON = "&Do Not Recover"
# Compiled on first use (the attach wait), so `down`, `pipe`, `logs` and CODESYS never pay for it.
$XAE_DIALOGS_SRC = @"
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text;
public static class VoltXaeDialogs {
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr p, EnumProc f, IntPtr l);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessageTimeout(IntPtr h, uint m, IntPtr w, StringBuilder l, uint f, uint t, out IntPtr r);
    [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h, uint m, IntPtr w, IntPtr l, uint f, uint t, out IntPtr r);
    const uint WM_GETTEXT = 0x000D, BM_CLICK = 0x00F5, SMTO_ABORTIFHUNG = 0x0002;
    public static string ClassOf(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, s.Capacity); return s.ToString(); }
    // WM_GETTEXT, not GetWindowText: the latter returns nothing for a control in another process.
    public static string TextOf(IntPtr h) { var s = new StringBuilder(1024); IntPtr r; SendMessageTimeout(h, WM_GETTEXT, (IntPtr)s.Capacity, s, SMTO_ABORTIFHUNG, 2000, out r); return s.ToString(); }
    /// <summary>The visible top-level dialogs (#32770) owned by one process.</summary>
    public static IntPtr[] Dialogs(int pid) {
        var found = new List<IntPtr>();
        EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p);
            if (p == (uint)pid && IsWindowVisible(h) && ClassOf(h) == "#32770") found.Add(h); return true; }, IntPtr.Zero);
        return found.ToArray();
    }
    public static IntPtr[] Children(IntPtr parent) {
        var found = new List<IntPtr>();
        EnumChildWindows(parent, (h, l) => { found.Add(h); return true; }, IntPtr.Zero);
        return found.ToArray();
    }
    public static void Click(IntPtr button) { IntPtr r; SendMessageTimeout(button, BM_CLICK, IntPtr.Zero, IntPtr.Zero, SMTO_ABORTIFHUNG, 5000, out r); }

    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint a, bool i, uint pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll")] static extern bool IsWow64Process(IntPtr h, out bool w);
    [DllImport("kernel32.dll")] static extern IntPtr VirtualAllocEx(IntPtr p, IntPtr a, UIntPtr s, uint t, uint pr);
    [DllImport("kernel32.dll")] static extern bool VirtualFreeEx(IntPtr p, IntPtr a, UIntPtr s, uint t);
    [DllImport("kernel32.dll")] static extern bool WriteProcessMemory(IntPtr p, IntPtr a, byte[] b, UIntPtr s, out UIntPtr w);
    [DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr p, IntPtr a, byte[] b, UIntPtr s, out UIntPtr r);
    /// <summary>The rows of a list view in ANOTHER process, each as its non-empty column texts joined by " / ". The
    /// text comes back through a buffer in the target's address space (LVM_GETITEMTEXTW carries a pointer), laid out
    /// for the target's bitness — TcXaeShell is 32-bit under a 64-bit shell. Measured on the Recovered Files dialog:
    /// column 0 is the checkbox (empty), 1 the project, 2 the file. An empty array when the process cannot be opened.</summary>
    public static string[] ListRows(IntPtr lv, int columns) {
        var rows = new List<string>();
        IntPtr r; SendMessageTimeout(lv, 0x1004 /*LVM_GETITEMCOUNT*/, IntPtr.Zero, IntPtr.Zero, SMTO_ABORTIFHUNG, 2000, out r);
        int count = (int)r.ToInt64();
        uint pid; GetWindowThreadProcessId(lv, out pid);
        IntPtr proc = OpenProcess(0x0008 | 0x0010 | 0x0020 | 0x0400, false, pid);   // VM_OPERATION|VM_READ|VM_WRITE|QUERY_INFORMATION
        if (proc == IntPtr.Zero) return rows.ToArray();
        try {
            bool wow; IsWow64Process(proc, out wow);
            bool is32 = wow || IntPtr.Size == 4;
            const int ITEM = 128, TEXT = 1024;
            IntPtr mem = VirtualAllocEx(proc, IntPtr.Zero, (UIntPtr)(ITEM + TEXT), 0x3000, 0x04);
            if (mem == IntPtr.Zero) return rows.ToArray();
            try {
                long textAddr = mem.ToInt64() + ITEM;
                for (int i = 0; i < count; i++) {
                    var cells = new List<string>();
                    for (int sub = 0; sub < Math.Max(columns, 1); sub++) {
                        // LVITEMW: mask, iItem, iSubItem, state, stateMask (5 x int), pszText (pointer), cchTextMax (int).
                        var item = new byte[ITEM];
                        BitConverter.GetBytes(1).CopyTo(item, 0);
                        BitConverter.GetBytes(i).CopyTo(item, 4);
                        BitConverter.GetBytes(sub).CopyTo(item, 8);
                        if (is32) { BitConverter.GetBytes((int)textAddr).CopyTo(item, 20); BitConverter.GetBytes(TEXT / 2).CopyTo(item, 24); }
                        else      { BitConverter.GetBytes(textAddr).CopyTo(item, 24);      BitConverter.GetBytes(TEXT / 2).CopyTo(item, 32); }
                        UIntPtr n; WriteProcessMemory(proc, mem, item, (UIntPtr)ITEM, out n);
                        SendMessageTimeout(lv, 0x1073 /*LVM_GETITEMTEXTW*/, (IntPtr)i, mem, SMTO_ABORTIFHUNG, 2000, out r);
                        var buf = new byte[TEXT]; ReadProcessMemory(proc, (IntPtr)textAddr, buf, (UIntPtr)TEXT, out n);
                        var s = Encoding.Unicode.GetString(buf); int z = s.IndexOf('\0'); if (z >= 0) s = s.Substring(0, z);
                        if (s.Length > 0) cells.Add(s);
                    }
                    rows.Add(string.Join(" / ", cells));
                }
            } finally { VirtualFreeEx(proc, mem, UIntPtr.Zero, 0x8000); }
        } finally { CloseHandle(proc); }
        return rows.ToArray();
    }
    public static int HeaderColumns(IntPtr header) { IntPtr r; SendMessageTimeout(header, 0x1200 /*HDM_GETITEMCOUNT*/, IntPtr.Zero, IntPtr.Zero, SMTO_ABORTIFHUNG, 2000, out r); return (int)r.ToInt64(); }
}
"@

# The files the dialog lists — read from its own list view, so the log says what the dialog said, not a guess from
# the AutoRecover entries. Best effort: an unreadable list logs "(none listed)" and the dialog is still answered.
function Get-RecoveredFiles([IntPtr]$dlg, $kids) {
    $lv = @($kids | Where-Object { $_.Class -eq "SysListView32" }) | Select-Object -First 1
    if (-not $lv) { return @() }
    $hdr = @([VoltXaeDialogs]::Children($lv.H) | Where-Object { [VoltXaeDialogs]::ClassOf($_) -eq "SysHeader32" }) | Select-Object -First 1
    $cols = if ($hdr) { [VoltXaeDialogs]::HeaderColumns($hdr) } else { 3 }
    @([VoltXaeDialogs]::ListRows($lv.H, $cols) | Where-Object { $_ })
}
$script:dialogsSeen = @{}

# One look at this instance's XAE windows (the pids `up` launched, plus any XAE holding this instance's copy — a
# Restart-Manager relaunch adopted as ours). Cheap enough to run every second of the attach wait.
function Watch-XaeDialogs([int[]]$xaePids) {
    if (-not ("VoltXaeDialogs" -as [type])) {
        $saved = $env:TEMP, $env:TMP
        $env:TEMP = $env:TMP = Get-CompileTemp
        try { Add-Type -TypeDefinition $XAE_DIALOGS_SRC } finally { $env:TEMP, $env:TMP = $saved }
    }
    $pids =@(@($xaePids) + @(Get-CopyHolders "twincat") | Select-Object -Unique)
    foreach ($xae in $pids) {
        foreach ($dlg in [VoltXaeDialogs]::Dialogs($xae)) {
            $title = [VoltXaeDialogs]::TextOf($dlg)
            $kids = @([VoltXaeDialogs]::Children($dlg) | ForEach-Object {
                [pscustomobject]@{ H = $_; Class = [VoltXaeDialogs]::ClassOf($_); Text = [VoltXaeDialogs]::TextOf($_) } })
            $buttons = @($kids | Where-Object { $_.Class -eq "Button" -and $_.Text })
            $dismiss = @($buttons | Where-Object { $_.Text -ceq $XAE_RECOVERY_BUTTON })
            if ($title -ceq $XAE_RECOVERY_TITLE -and $dismiss.Count -eq 1) {
                # Clicked once already and still there: say so once, and do not click it every second.
                if ($script:dialogsSeen.ContainsKey("clicked $dlg")) {
                    if (-not $script:dialogsSeen.ContainsKey("stuck $dlg")) {
                        $script:dialogsSeen["stuck $dlg"] = $true
                        Write-Warning "'$XAE_RECOVERY_TITLE' on XAE $xae is still open after '$XAE_RECOVERY_BUTTON' was clicked - left as is"
                    }
                    continue
                }
                $script:dialogsSeen["clicked $dlg"] = $true
                $files = @(Get-RecoveredFiles $dlg $kids)
                [VoltXaeDialogs]::Click($dismiss[0].H)
                Write-Host "dismissed '$XAE_RECOVERY_TITLE' on XAE $xae (instance $(if ($Instance) { $Instance } else { '(default)' })) with '$XAE_RECOVERY_BUTTON' - files: $(if ($files.Count) { $files -join '; ' } else { '(none listed)' })"
                continue
            }
            if ($script:dialogsSeen.ContainsKey([string]$dlg)) { continue }
            $script:dialogsSeen[[string]$dlg] = $true
            Write-Warning "XAE $xae shows a modal dialog '$title' (buttons: $(($buttons | ForEach-Object { $_.Text }) -join ', ')) - not one ide.ps1 answers; left as is"
        }
    }
}

# ── serve a COPY ───────────────────────────────────────────────────────────────────────────────────────────

<#
.SYNOPSIS Copy a fixture out of the repo and return the copy's path (or the original under -InPlace).
.DESCRIPTION A CODESYS project is one file; a TwinCAT solution is a tree, so the whole folder travels. The copy
is refreshed on every `up`, so it is the committed fixture every time — a stale scratch tree is its own bug.
#>
# PER INSTANCE. `-Instance` exists so several can run at once, and a work dir keyed on the vendor alone means
# the second `up` deletes the solution tree the first one's IDE has OPEN (a partial delete, then a copy into
# the wreckage) — or overwrites the .project file it is holding. The pipe is already per-pid; so is this.
# Returned WITH its trailing separator, so `volt-ide-twincat\` never matches inside `volt-ide-twincat-e2e\`.
function Get-Sfx([string]$inst) { if ($inst) { "-$inst" } else { "" } }

function Get-CopyRoot([string]$vendor, [string]$inst = $Instance) {
    (Join-Path ([System.IO.Path]::GetTempPath()) "volt-ide-$vendor$(Get-Sfx $inst)") + "\"
}

function Copy-FixtureOut([string]$path, [string]$vendor) {
    if ($InPlace) { return $path }
    $work = (Get-CopyRoot $vendor).TrimEnd('\')
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

# What `up` opened, for the harness (see $projFile). Written without a BOM: it is read by another runtime.
function Save-Projects([string[]]$paths) {
    [System.IO.File]::WriteAllLines($projFile, [string[]]@($paths | ForEach-Object { (Resolve-Path $_).Path }))
}

# ── codesys: in-proc host ──────────────────────────────────────────────────────────────────────────────────

function Up-Codesys {
    # A CODESYS version installs 64-bit under "Program Files" or 32-bit under "Program Files (x86)" (2026-10-13: the
    # dev machine gained 32-bit 3.5.21.60). The version names one edition; one installed in BOTH is refused by name
    # rather than guessed, and -CodesysBitness picks one (environment-dependency-audit 2.6).
    $roots = [ordered]@{ "64" = "C:\Program Files\CODESYS $CodesysVersion"; "32" = "C:\Program Files (x86)\CODESYS $CodesysVersion" }
    $installed = @($roots.Keys | Where-Object { Test-Path (Join-Path $roots[$_] "CODESYS\Common\CODESYS.exe") })
    if ($CodesysBitness) {
        if ($installed -notcontains $CodesysBitness) { throw "CODESYS $CodesysVersion is not installed $CodesysBitness-bit (no $($roots[$CodesysBitness]); installed: $(if ($installed) { ($installed | ForEach-Object { "$_-bit" }) -join ', ' } else { 'neither' }))" }
        $install = $roots[$CodesysBitness]
    } elseif ($installed.Count -gt 1) {
        throw "CODESYS $CodesysVersion is installed both 64-bit and 32-bit ($($roots.Values -join ', ')) - name one with -CodesysBitness 32|64"
    } elseif ($installed.Count -eq 1) {
        $install = $roots[$installed[0]]
    } else {
        throw "CODESYS $CodesysVersion is not installed (neither $($roots.Values -join ' nor '))"
    }
    $exe     = Join-Path $install "CODESYS\Common\CODESYS.exe"
    Write-Host ("CODESYS edition: " + $(if ($install -like "*(x86)*") { "32-bit" } else { "64-bit" }))
    # The SHIPPED bridge: the merged one-assembly bundle (Volt.Ide.Codesys.csproj, target VoltBundle), never the
    # build output beside it, whose loose Volt/System.Text.Json DLLs no user ever receives.
    $dll     = Join-Path $ROOT "src\Volt.Ide.Codesys\bin\Release\net48\bundle\Volt.Ide.Codesys.dll"
    $scriptPy = if ($RunScript) { $RunScript } else { Join-Path $PSScriptRoot "run_pipe_production.py" }
    # The fixture NATIVE to the version served (environment-dependency-audit 2.5b; owner: "you need to have 1 project for
    # each CS version" / "you can't reuse them"): `CodesysTestProject.<version>.project`, made in that version by
    # scripts/author-version-fixture.py. A version without one serves the source project, which only 3.5.21.40 made -
    # any other version opens it upgraded, and the line below says so. An explicit -Fixture always wins.
    $native = Join-Path $FIXTURES "CodesysTestProject.$CodesysVersion.project"
    $project = if ($Fixture) { $Fixture } elseif (Test-Path $native) { $native } else {
        Write-Warning "no fixture native to CODESYS $CodesysVersion ($native) - serving CodesysTestProject.project, made in 3.5.21.40 (scripts/author-version-fixture.py makes one)"
        Join-Path $FIXTURES "CodesysTestProject.project"
    }

    if (-not (Test-Path $exe))     { throw "CODESYS.exe not found: $exe" }
    if (-not (Test-Path $project)) { throw "Fixture project not found: $project" }   # the CALLER's path, before the copy
    if ($BridgeDir) {
        # Served as INSTALLED: the folder's own DLL, found by its own start script — nothing built, no override.
        foreach ($f in "Volt.Ide.Codesys.dll", "start_volt_codesys.py", "stop_volt_codesys.py") {
            if (-not (Test-Path (Join-Path $BridgeDir $f))) { throw "-BridgeDir $BridgeDir is not an installed codesys folder: no $f" }
        }
    }
    $project = Copy-FixtureOut $project "codesys"
    Save-Projects @($project)
    if (-not $BridgeDir) {
        Build-Bridge "codesys"
        if (-not (Test-Path $dll))     { throw "Bridge DLL missing (build Volt.Ide.Codesys): $dll" }
    }

    $profileDir = Join-Path $install "CODESYS\Profiles"
    $pf = Get-ChildItem -Path $profileDir -Filter "*.profile.xml" -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $pf) { throw "No profile found in $profileDir" }
    $profileName = $pf.Name -replace '\.profile\.xml$', ''

    # VOLT_BRIDGE_DLL is why this script exists rather than "just open CODESYS and run the script". The shipped
    # `start_volt_codesys.py` resolves the DLL as: $VOLT_BRIDGE_DLL -> beside the script -> the INSTALL dir. The
    # env is read in-process, so it must be set BEFORE launch — you cannot set it from inside a running IDE.
    # Without it you are testing the INSTALLED bridge while believing you are testing your working tree.
    # With -BridgeDir the override is REMOVED instead (an inherited one would win over the folder), and the harness
    # runscript is pointed at that folder's start script (VOLT_START_SCRIPT), which then resolves the DLL beside itself.
    if ($BridgeDir) {
        Remove-Item Env:\VOLT_BRIDGE_DLL -ErrorAction SilentlyContinue
        $env:VOLT_START_SCRIPT = (Resolve-Path (Join-Path $BridgeDir "start_volt_codesys.py")).Path
    } else {
        $env:VOLT_BRIDGE_DLL = (Resolve-Path $dll).Path
        Remove-Item Env:\VOLT_START_SCRIPT -ErrorAction SilentlyContinue
    }
    $env:VOLT_FIXTURE_PROJECT = (Resolve-Path $project).Path

    # No --noUI: the production host does not pump a message loop, so without the IDE's own loop nothing serves
    # the pipe. NO stdout/stderr redirect either — CODESYS's UI process wants its own console handles and
    # redirecting them can wedge startup, which is why the host script writes its own file log (see `logs`).
    $argline = '--profile="{0}" --runscript="{1}"' -f $profileName, (Resolve-Path $scriptPy).Path
    if ($CodesysCulture) { $argline += (' --culture="{0}"' -f $CodesysCulture); Write-Host "CODESYS culture: $CodesysCulture" }
    Write-Host "CODESYS: $exe"
    Write-Host "Profile: $profileName"
    if ($BridgeDir) { Write-Host "Bridge:  as installed, $($env:VOLT_START_SCRIPT) (no VOLT_BRIDGE_DLL)" }
    else { Write-Host "DLL:     $($env:VOLT_BRIDGE_DLL)" }
    Write-Host "Project: $($env:VOLT_FIXTURE_PROJECT)"
    $proc = Start-Process -FilePath $exe -ArgumentList $argline -PassThru -WindowStyle Normal
    Save-Pids $pidFile @($proc)
    Exit-LaunchLock
    Write-Host "CODESYS launched (pid $($proc.Id))."
}

# ── twincat: out-of-process worker ─────────────────────────────────────────────────────────────────────────

# The installed XAE shells, found the way COM finds them: each `TcXaeShell*.DTE.<ver>` ProgID's CLSID ->
# LocalServer32, in both registry views. It was one hard-coded path to the 32-bit TcXaeShell 15; TwinCAT 3.1.4026 can
# install the 64-bit TcXaeShell64 instead, somewhere else. The 32-bit shell sorts first: the committed fixtures are
# TwinCAT 4024 projects.
function Resolve-XaeShells {
    $found = @()
    foreach ($view in [Microsoft.Win32.RegistryView]::Registry32, [Microsoft.Win32.RegistryView]::Registry64) {
        $hkcr = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::ClassesRoot, $view)
        foreach ($progId in @($hkcr.GetSubKeyNames() | Where-Object { $_ -match '^TcXaeShell(64)?\.DTE\.\d+\.\d+$' })) {
            $clsid = $hkcr.OpenSubKey("$progId\CLSID")
            if (-not $clsid) { continue }
            $server = $hkcr.OpenSubKey("CLSID\$($clsid.GetValue(''))\LocalServer32")
            if (-not $server) { continue }
            $exe = ([string]$server.GetValue('')).Trim()
            if ($exe -match '^"([^"]+)"') { $exe = $Matches[1] } elseif ($exe -match '^(\S+\.exe)') { $exe = $Matches[1] }
            if ((Test-Path $exe) -and ($found -notcontains $exe)) { $found += $exe }
        }
    }
    @($found | Sort-Object { [IO.Path]::GetFileNameWithoutExtension($_) -ne "TcXaeShell" }, { $_ })
}

# An exe's bitness from its PE header (IMAGE_FILE_HEADER.Machine): 0x014C x86 -> 32, 0x8664 x64 -> 64; anything else
# is refused by name rather than read as either.
function Get-PeBits([string]$exe) {
    $b = [IO.File]::ReadAllBytes($exe)
    $pe = [BitConverter]::ToInt32($b, 0x3C)
    switch ([BitConverter]::ToUInt16($b, $pe + 4)) { 0x014C { 32 } 0x8664 { 64 } default { throw "$exe is neither x86 nor x64 (PE machine 0x$('{0:X4}' -f $_))" } }
}

function Up-Twincat {
    $shells = @(Resolve-XaeShells)
    if ($shells.Count -eq 0) { throw "no TwinCAT XAE shell is registered (no TcXaeShell*.DTE.* ProgID with an existing LocalServer32)" }
    if ($XaeBitness) {
        $picked = @($shells | Where-Object { (Get-PeBits $_) -eq [int]$XaeBitness })
        if ($picked.Count -eq 0) { throw "no $XaeBitness-bit XAE shell is registered (registered: $(($shells | ForEach-Object { "$_ ($(Get-PeBits $_)-bit)" }) -join ', '))" }
        $shells = $picked
    }
    $ide    = $shells[0]
    if ($shells.Count -gt 1) { Write-Host "XAE shells installed: $($shells -join ', ') - using $ide" }
    $xaeBits = Get-PeBits $ide
    Write-Host "XAE shell: $ide ($xaeBits-bit)"
    # The worker of the shell's bitness, as the connector picks it (TwincatWorkers): the other one cannot read this
    # XAE's Solution Explorer (DIALECT C2t).
    if ($BridgeDir) {
        # The worker AS SHIPPED (e.g. dist\TwincatBridge, the single-file bundle PLCAssist ships): its own exe, no build.
        $worker = Join-Path (Resolve-Path $BridgeDir).Path "VoltBridgeTwincat.exe"
        if (-not (Test-Path $worker)) { throw "-BridgeDir $BridgeDir holds no VoltBridgeTwincat.exe" }
        $workerBits = Get-PeBits $worker
        if ($workerBits -ne $xaeBits) { throw "-BridgeDir $BridgeDir holds a $workerBits-bit worker and the XAE shell is $xaeBits-bit: only a worker of the XAE's bitness reads its Solution Explorer (DIALECT C2t)" }
        Write-Host "Worker:  as shipped, $worker"
    } else {
        $rid = Get-TwincatRid $xaeBits
        $worker = Join-Path $ROOT "src\Volt.Ide.Twincat\bin\Release\net10.0-windows\$rid\VoltBridgeTwincat.exe"
        Build-Bridge "twincat" $rid
        if (-not (Test-Path $worker)) { throw "Worker missing (build Volt.Ide.Twincat -r $rid): $worker" }
        Write-Host "Worker:  $worker"
    }

    $slns = [ordered]@{
        "13" = Join-Path $FIXTURES "TwinCAT Project13\TwinCAT Project13.sln"
        "14" = Join-Path $FIXTURES "TwinCAT Project14\TwinCAT Project14.sln"
    }
    $sel = if ($Fixture) { $Fixture } else { "14" }
    if ($Reopen) { $sel = $script:reopenSln }
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
        if (-not $Reopen) { $open[$k] = Copy-FixtureOut $open[$k] "twincat" }
    }
    Save-Projects @($open.Values)

    $already = @(Get-Process $XAE_SHELLS -ErrorAction SilentlyContinue | ForEach-Object { $_.MainWindowTitle })
    foreach ($k in $open.Keys) {
        $name = [System.IO.Path]::GetFileNameWithoutExtension($open[$k])
        if ($already -match [regex]::Escape($name)) {
            Write-Warning "an XAE window is ALREADY serving '$name' — two instances with the same project name collapse to one identity. Close it first, or the suite will hang on select."
        }
    }

    # A UI language the shell has no resources for is ignored by it, silently - the run would then measure English
    # while claiming another language. The shell's per-language resources are `Common7\IDE\<lcid>\`.
    $lcidArg = ""
    if ($XaeLanguage) {
        $res = Join-Path (Split-Path $ide -Parent) "$XaeLanguage"
        if (-not (Test-Path $res)) { throw "-XaeLanguage ${XaeLanguage}: $ide has no resources for it (no $res)" }
        $lcidArg = "/LCID $XaeLanguage "
        Write-Host "XAE UI language: LCID $XaeLanguage"
    }

    $launched = @()
    $launchedProcs = @()
    foreach ($k in $open.Keys) {
        $sln = $open[$k]
        $p = Start-Process -FilePath $ide -ArgumentList ('{0}"{1}"' -f $lcidArg, (Resolve-Path $sln).Path) -PassThru
        $launched += $p.Id
        $launchedProcs += $p
        Write-Host "opened $([System.IO.Path]::GetFileNameWithoutExtension($sln)) (TcXaeShell pid $($p.Id))"
    }
    Save-Pids $pidFile $launchedProcs
    Exit-LaunchLock

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
                # Watch EVERY XAE this `up` launched (not only the one being attached), once a second, for the
                # Recovered Files dialog (see Watch-XaeDialogs) — the window is the same 60 s as before.
                for ($s = 0; $s -lt 5; $s++) { Start-Sleep -Seconds 1; Watch-XaeDialogs $launched }
                if (Test-TwincatAttached $procId $w $spawnedAt) { $ready = $true; break }
                if ($w.HasExited) { break }   # died outright (no XAE, name collision) — respawn rather than wait out the window
            }
            if (-not $ready) { Stop-Process -Id $w.Id -Force -ErrorAction SilentlyContinue }
        }
        if (-not $ready) { throw "no worker could ATTACH to XAE $procId after 10 tries - is the PLC project actually opening? (ide.ps1 logs -Vendor twincat)" }
        Save-Pids $pidFile @($w)   # the worker is ours too — its parent is this shell, not a recorded IDE
        Write-Host "worker attached to XAE $procId -> $pipe"
    }
}

# ── verbs ──────────────────────────────────────────────────────────────────────────────────────────────────

# ONE `up` OR `down` AT A TIME PER INSTANCE. Two `up`s started together both saw the instance down, and the second's
# Clear-InstanceLeftovers deleted the copy the first had just opened. A named mutex, released by Windows when this
# process ends however it ends; a second caller is refused by name, never queued behind a launch it cannot see.
if ($Action -in @("up", "down")) {
    $instanceLock = New-Object System.Threading.Mutex($false, "Local\volt-ide-$Vendor$sfx")
    $held = $false
    try { $held = $instanceLock.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $held = $true }
    if (-not $held) { throw "another ide.ps1 is bringing instance $(if ($Instance) { $Instance } else { '(default)' }) of $Vendor up or down right now - wait for it, or use another -Instance" }
}

switch ($Action) {
    "pipe" {
        # THIS instance's pipes only — the ones its `up` started (Test-Ours). It printed every volt.bridge.<vendor>.*
        # on the machine, and a caller that took the first line drove whichever IDE sorted first: an engineer's own,
        # on 2026-10-03 (an e2e run created and deleted items in a project that was nobody's fixture).
        $records = @(Read-Records $pidFile)
        $p = @(Get-BridgePipes $Vendor | Where-Object { Test-Ours ([int](($_ -split '\.')[-1])) $records })
        if ($p.Count -gt 0) { $p } else { Write-Error "no pipe of instance $(if ($Instance) { $Instance } else { '(default)' }) for $Vendor - start it with: ide.ps1 up -Vendor $Vendor$(if ($Instance) { " -Instance $Instance" }) -Wait" }
    }
    "sweep" {
        # `down` for EVERY instance of the run that has a record, both vendors: what a run does at its start (a previous
        # run of it killed outright ran no exit hook) and from its signal handler. Each `down` is its own process, so it
        # takes that instance's lock and closes, empties and removes exactly as `down` does.
        foreach ($f in @(Get-ChildItem $work -Filter "*-ide*.pids" -File -ErrorAction SilentlyContinue)) {
            $r = Get-RecordInstance $f.Name
            if ($null -eq $r -or -not (Test-RunOwns $RunTag $r.Instance)) { continue }
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath down -Vendor $r.Vendor -Instance $r.Instance -Run $RunTag
            if ($LASTEXITCODE -ne 0) { throw "sweep: down of $($r.Vendor) instance $($r.Instance) failed (exit $LASTEXITCODE)" }
        }
    }
    "check" {
        # What `up` would refuse, without starting anything (the matrix asks once, before any cell). Exit 1 names them.
        $foreign = Get-ForeignIdes
        if ($foreign.Count -gt 0) { Write-Host (Format-ForeignRefusal $RunTag $foreign); exit 1 }
        Write-Host "run '$RunTag': no IDE it does not own is running"
    }
    "logs" {
        $log = if ($Vendor -eq "codesys") { Join-Path $work "bridge-launcher.log" }
               else { Join-Path $env:LOCALAPPDATA "Volt\logs\twincat-$(Get-Date -Format yyyy-MM-dd).log" }
        Get-Content $log -Tail 40 -ErrorAction SilentlyContinue
    }
    "down" {
        # Close what THIS `up` started (per -Vendor and -Instance) and nothing else — see Get-OurProcesses for what
        # "ours" is. Serving pids are candidates because CODESYS can re-exec, so the IDE that serves may not be the pid
        # `up` launched — it is found through its recorded parent.
        #
        # This used to close every serving IDE on the machine (on 2026-09-26 an engineer's own TcXaeShell and the
        # production bridge serving it), and then anything run from this repo or a `volt-ide-*` copy — which is
        # every IDE ANOTHER session or workflow started here. A process this `up` did not record is left running.
        # And it used to close by Stop-Process -Force, which left the XAE's recovery dialog for the next start; an IDE
        # is now closed through its own shutdown first (Close-Ours).
        [void](Close-Instance $Vendor -DryRun:$DryRun)
        if (-not $DryRun) { Remove-Item $pidFile, $projFile -Force -ErrorAction SilentlyContinue }
        # The copy goes too. Left behind it never shrinks: XAE adds a ~1.8 MB `_CompileInfo` file per build and deletes
        # none, and every agent names its own instance — 80 copies, one of them 3.8 GB, filled C: on 2026-10-18 and
        # crashed an XAE mid-run. `up` rebuilds the copy from the committed fixture anyway.
        $copy = Get-CopyRoot $Vendor
        if (-not $DryRun -and -not $InPlace -and (Test-Path $copy)) {
            try { Remove-Item $copy -Recurse -Force -ErrorAction Stop }
            catch { Write-Warning "could not remove this instance's copy $copy (a process still holds it): $($_.Exception.Message)" }
        }
    }
    "up" {
        # LD and FBD network text ON for what this launches (openspec implementation-keyword 3c). The bridge reads the
        # switch from its OWN process environment — CODESYS runs it in-proc, TwinCAT in the worker — and both inherit
        # this one, so it must be set before either starts. The shipped build does not set it: a customer's bridge shows
        # every LD and FBD body as `IMPLEMENTATION LD|FBD UNSUPPORTED`. `-Production` serves exactly that — REMOVED rather
        # than left alone, because a shell that set it once would otherwise hand it on and the check would prove nothing.
        if ($Production) { Remove-Item Env:VOLT_GRAPHICAL -ErrorAction SilentlyContinue }
        else { $env:VOLT_GRAPHICAL = "1" }
        # AN INSTANCE THAT IS UP IS SOMEBODY'S. A second `up` on it used to REPLACE it: close its IDE, then delete its
        # copy file by file — under a run still driving it (two agents of one workflow share an -Instance; the copy was
        # found gutted, its .plcproj listing files already deleted, ld-fbd-coverage gate 2R.3). An IDE of this instance
        # still running is now refused by name; `down` is the one verb that ends an instance.
        # NEVER BESIDE AN IDE THIS RUN DOES NOT OWN (openspec shared-ide-machine-rules): an engineer's IDE, another
        # session's run, the connector's worker. Checked under the launch lock, so a sibling cell's launch is either not
        # started or already recorded. Volt neither drives nor closes a foreign IDE: the user decides.
        Enter-LaunchLock
        $foreign = Get-ForeignIdes
        if ($foreign.Count -gt 0) { throw (Format-ForeignRefusal $RunTag $foreign) }
        $live = @((Get-OurProcesses $Vendor).Ours | Where-Object { (Get-Process -Id $_ -ErrorAction SilentlyContinue).ProcessName -ne "VoltBridgeTwincat" })
        if ($live.Count -gt 0) {
            throw "instance $(if ($Instance) { $Instance } else { '(default)' }) of $Vendor is UP (pid $($live -join ', ')) - another run may be driving it. If it is a leftover: ide.ps1 down -Vendor $Vendor$(if ($Instance) { " -Instance $Instance" }); else use another -Instance."
        }
        # FIRST what this instance left last time: a worker whose XAE is gone (closed as `down` closes it), the XAE
        # recovery entries naming this copy, and the copy itself. Without this, the IDE about to open shows a modal
        # recovery dialog and the worker attaches to nothing.
        if ($Reopen) {
            # The project this instance opened, as the engineer left it: its ONE recorded copy, read before the record goes.
            if ($Vendor -ne "twincat") { throw "-Reopen is TwinCAT only: a CODESYS bridge runs in-proc and dies with its IDE" }
            $recorded = @(if (Test-Path $projFile) { Get-Content $projFile | Where-Object { $_ } })
            if ($recorded.Count -ne 1 -or $recorded[0] -notlike "*.sln" -or -not (Test-Path $recorded[0])) {
                throw "-Reopen: instance $(if ($Instance) { $Instance } else { '(default)' }) recorded $($recorded.Count) project(s) ($($recorded -join ', ')) - it reopens exactly one existing .sln copy"
            }
            $script:reopenSln = $recorded[0]
        }
        [void](Close-Instance $Vendor -Quiet)
        Remove-Item $pidFile, $projFile -Force -ErrorAction SilentlyContinue
        if (-not $Reopen) { Clear-InstanceLeftovers $Vendor }
        $before = Get-ServingPids $Vendor
        if ($Vendor -eq "codesys") { Up-Codesys } else { Up-Twincat }
        Write-Host "Tail the launcher log with: ide.ps1 logs -Vendor $Vendor"
        if ($Wait) { Wait-ForPipe $Vendor $before }
    }
}
