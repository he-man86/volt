#Requires -Version 5.1
<#
.SYNOPSIS
  Open the committed TwinCAT fixture solutions in TcXaeShell - the TwinCAT analogue of codesys-pipe.ps1, for the
  live multi-XAE e2e. Unlike CODESYS, TwinCAT has NO in-proc pipe host: the connector's VoltBridgeTwincat worker
  attaches to whatever XAE windows are running over the COM ROT. So this script only OPENS the IDEs; the worker
  (already supervised by the connector) discovers them. TcXaeShell is Visual-Studio-based and has no headless mode,
  so this is a LOCAL live-bridge tier - deterministic (committed fixtures) but not CI.

.PARAMETER Action  up (open, default) | down (close the ones this script opened)
.PARAMETER Which   both (default) | 13 | 14 - which fixture(s) to open. 'both' is the multi-XAE scenario.
#>
param(
    [ValidateSet("up", "down")] [string]$Action = "up",
    [ValidateSet("both", "13", "14")] [string]$Which = "both"
)
$ErrorActionPreference = "Stop"

$ide  = "C:\Program Files (x86)\Beckhoff\TcXaeShell\Common7\IDE\TcXaeShell.exe"
$test = Join-Path $PSScriptRoot "..\test\fixtures"
$slns = [ordered]@{
    "13" = Join-Path $test "TwinCAT Project13\TwinCAT Project13.sln"
    "14" = Join-Path $test "TwinCAT Project14\TwinCAT Project14.sln"
}
$pick = if ($Which -eq "both") { @("13", "14") } else { @($Which) }

$work    = Join-Path $env:LOCALAPPDATA "volt-bridge"
if (-not (Test-Path $work)) { New-Item -ItemType Directory -Force $work | Out-Null }
$pidFile = Join-Path $work "twincat-instances.pids"

switch ($Action) {
    "down" {
        if (Test-Path $pidFile) {
            foreach ($procId in Get-Content $pidFile) {
                try { Stop-Process -Id $procId -Force -ErrorAction Stop; Write-Host "closed TcXaeShell pid $procId" } catch {}
            }
            Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
        } else { Write-Host "no tracked TcXaeShell instances to close" }
    }
    "up" {
        if (-not (Test-Path $ide)) { throw "TcXaeShell.exe not found: $ide" }
        $pids = @()
        foreach ($k in $pick) {
            $sln = $slns[$k]
            if (-not (Test-Path $sln)) { throw "fixture solution missing: $sln" }
            $p = Start-Process -FilePath $ide -ArgumentList ('"{0}"' -f (Resolve-Path $sln).Path) -PassThru
            $pids += $p.Id
            Write-Host "opened TwinCAT Project$k (TcXaeShell pid $($p.Id))"
        }
        # MERGE with the instances already tracked, never overwrite. `up -Which 13` then `up -Which 14` used to
        # replace the file, so `down` closed only the second and left the first running — an orphan XAE holding the
        # fixture open, which is precisely the state the teardown rule exists to avoid. Dead pids are dropped on the
        # way through so the file cannot grow stale entries.
        $live = @()
        if (Test-Path $pidFile) {
            $live = Get-Content $pidFile | Where-Object { $_ } | Where-Object {
                (Get-Process -Id $_ -ErrorAction SilentlyContinue) -ne $null
            }
        }
        ($live + $pids | Select-Object -Unique) | Out-File $pidFile
        Write-Host ""
        Write-Host "TcXaeShell is loading; give it ~30-60s to open the PLC project(s). The connector worker then"
        Write-Host "attaches over the COM ROT. Run the multi-XAE e2e from packages/volt-cli:"
        Write-Host '  $env:VOLT_PIPE="volt.bridge.twincat"; $env:VOLT_VENDOR="twincat"; bun test test/e2e'
    }
}
