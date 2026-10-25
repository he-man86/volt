#Requires -Version 5.1
# THE RUN an `ide.ps1` instance belongs to, and the IDE processes that run does not own. Pure: no process, file or
# CIM access, so `test/unit/ide-run.test.ts` proves it offline. `ide.ps1` dot-sources this file and feeds it the live
# answers (its pid records, Test-Ours, the running IDE images).

# The IDE images a run may only start beside its own: an engineer's CODESYS, another session's XAE and the worker
# serving it (the connector's included) all count.
$IDE_IMAGES = @("CODESYS.exe", "TcXaeShell.exe", "TcXaeShell64.exe", "VoltBridgeTwincat.exe")

# Does run $Tag own instance $Inst? A run owns the instance its tag names and every `<tag>-...` (the matrix is run
# `release-matrix`, its cells `release-matrix-<cell>`). The empty tag is the default instance's own run and owns only
# the default instance — never every instance, which `StartsWith("-")` would not say but an empty prefix would.
function Test-RunOwns([string]$Tag, [string]$Inst) {
    if ($Tag -eq "") { return $Inst -eq "" }
    return ($Inst -eq $Tag) -or $Inst.StartsWith("$Tag-", [StringComparison]::Ordinal)
}

# The vendor and instance a pid record's FILE NAME names: `<vendor>-ide.pids` is the default instance,
# `<vendor>-ide-<instance>.pids` that instance. Any other name is no record ($null).
function Get-RecordInstance([string]$FileName) {
    if ($FileName -cmatch '^(codesys|twincat)-ide(?:-(.+))?\.pids$') {
        return [pscustomobject]@{ Vendor = $Matches[1]; Instance = $(if ($Matches[2]) { $Matches[2] } else { "" }) }
    }
    return $null
}

# The run an invocation is in: -Run when given, else $VOLT_IDE_RUN, else the instance alone. An instance outside the
# run it is told it is in is refused by name: a run that cannot tell its own instances cannot tell a stranger's.
function Resolve-RunTag([bool]$RunGiven, [string]$Run, [string]$EnvRun, [string]$Inst) {
    $tag = if ($RunGiven) { $Run } elseif ($EnvRun) { $EnvRun } else { $Inst }
    if (-not (Test-RunOwns $tag $Inst)) {
        $name = if ($Inst) { $Inst } else { "(default)" }
        throw "instance $name is not in run '$tag' (a run owns the instance '$tag' and '$tag-...') - name the run with -Run or VOLT_IDE_RUN, or pick an instance under it"
    }
    $tag
}

# The run an `ide.ps1` invocation acts in, by verb. `sweep` and `check` act on a WHOLE run, both vendors: they take
# no instance and no vendor, and the run must be named (-Run or $VOLT_IDE_RUN) — a run verb with no run, or with an
# instance or a vendor that would mean nothing to it, is refused by name. Every other verb acts on ONE instance of one
# vendor, under Resolve-RunTag's rule.
function Resolve-RunScope([string]$Action, [bool]$RunGiven, [string]$Run, [string]$EnvRun, [string]$Inst, [string]$Vendor) {
    if ($Action -in @("sweep", "check")) {
        if ($Inst -or $Vendor) { throw "$Action acts on a whole run, both vendors - name the run with -Run (or VOLT_IDE_RUN), not -Instance or -Vendor" }
        $tag = if ($RunGiven) { $Run } else { $EnvRun }
        if (-not $tag) { throw "$Action needs the run it acts on - name it with -Run or VOLT_IDE_RUN" }
        return $tag
    }
    if (-not $Vendor) { throw "$Action needs -Vendor codesys|twincat" }
    Resolve-RunTag $RunGiven $Run $EnvRun $Inst
}

# The running IDE processes ($Processes: objects with Pid, Name, CommandLine) whose pid is not one the run owns. No
# process at all arrives as $null (a function's empty list), which a pipeline would carry as one process with no pid.
function Select-Foreign($Processes, [int[]]$OwnPids) {
    @($Processes | Where-Object { $null -ne $_ -and $OwnPids -notcontains [int]$_.Pid })
}

# The refusal `up` and `check` give, or $null when nothing foreign runs: every foreign process by pid, image and command
# line, so the user can tell whose it is. The selection stays an array HERE: returned from a function, a one-element
# array arrives as its bare element, whose .Count Windows PowerShell's [pscustomobject] does not answer.
function Get-ForeignRefusal([string]$Tag, $Processes, [int[]]$OwnPids) {
    $Foreign = @(Select-Foreign $Processes $OwnPids)
    if ($Foreign.Count -eq 0) { return $null }
    $lines = @($Foreign | ForEach-Object { "  pid $($_.Pid) $($_.Name): $(if ($_.CommandLine) { $_.CommandLine } else { '(command line not readable)' })" })
    "run '$Tag' will not start beside an IDE it does not own - $($Foreign.Count) running:`n$($lines -join "`n")`n" +
        "Close them (or wait for the run that owns them), then start again. Volt never drives or closes them."
}
