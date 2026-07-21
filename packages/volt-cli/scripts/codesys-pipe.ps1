#Requires -Version 5.1
<#
.SYNOPSIS
  Launch the Volt CLI pipe host HEADLESS in CODESYS (no UI), for live smoke of
  the C# toolchain. Loads Volt.Cli.Ide.Codesys.dll and serves the pipe `volt.bridge.codesys`.

.PARAMETER Action   up (launch, default) | down (stop + kill CODESYS) | logs
.PARAMETER Version  18 or 21 (default 21)
.PARAMETER Project  fixture .project to open headless
.PARAMETER Instance name suffix so MULTIPLE headless CODESYS can run at once (per-instance stop-flag/pid/logs). Each
                    process serves its own volt.bridge.codesys.<pid> pipe (no VOLT_PIPE set), so two instances never
                    collide — this is how the multi-instance path is smoke-tested end to end.
#>
param(
    [ValidateSet("up", "down", "logs")]
    [string]$Action = "up",
    [ValidateSet("18", "21")]
    [string]$Version = "21",
    [string]$Project = "$PSScriptRoot\..\test\CodesysTestProject.project",
    [string]$Instance = ""
)
$ErrorActionPreference = "Stop"

$dll      = Join-Path $PSScriptRoot "..\src\Volt.Cli.Ide.Codesys\bin\Release\net48\Volt.Cli.Ide.Codesys.dll"
$scriptPy = Join-Path $PSScriptRoot "run_pipe_headless.py"
$install  = if ($Version -eq "21") { "C:\Program Files\CODESYS 3.5.21.40" } else { "C:\Program Files\CODESYS 3.5.18.30" }
$exe      = Join-Path $install "CODESYS\Common\CODESYS.exe"

$work     = Join-Path $env:LOCALAPPDATA "volt-bridge"
if (-not (Test-Path $work)) { New-Item -ItemType Directory -Force $work | Out-Null }
$sfx      = if ($Instance) { "-$Instance" } else { "" }   # per-instance file suffix so two can run concurrently
$logOut   = Join-Path $work "codesys-pipe$sfx-out.log"
$logErr   = Join-Path $work "codesys-pipe$sfx-err.log"
$stopFlag = Join-Path $work "stop$sfx.flag"
$pidFile  = Join-Path $work "codesys-pipe$sfx.pid"
if (-not (Test-Path $work)) { New-Item -ItemType Directory -Force $work | Out-Null }

function Get-Profile {
    $dir = Join-Path $install "CODESYS\Profiles"
    $p = Get-ChildItem -Path $dir -Filter "*.profile.xml" -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $p) { throw "No profile found in $dir" }
    return ($p.Name -replace '\.profile\.xml$', '')
}

switch ($Action) {
    "down" {
        New-Item -ItemType File -Force $stopFlag | Out-Null
        Start-Sleep -Seconds 2
        if (Test-Path $pidFile) {
            $procId = Get-Content $pidFile
            try { Stop-Process -Id $procId -Force -ErrorAction Stop; Write-Host "killed CODESYS pid $procId" } catch {}
            Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
        }
        Remove-Item $stopFlag -Force -ErrorAction SilentlyContinue
    }
    "logs" {
        Get-Content (Join-Path $work "headless-launcher.log") -Tail 40 -ErrorAction SilentlyContinue
    }
    "up" {
        if (-not (Test-Path $exe))     { throw "CODESYS.exe not found: $exe" }
        if (-not (Test-Path $dll))     { throw "Pipe DLL missing (build Volt.Cli.Ide.Codesys): $dll" }
        if (-not (Test-Path $Project)) { throw "Fixture project not found: $Project" }
        Remove-Item $stopFlag -Force -ErrorAction SilentlyContinue

        $env:VOLT_BRIDGE_DLL      = (Resolve-Path $dll).Path
        $env:VOLT_FIXTURE_PROJECT = (Resolve-Path $Project).Path
        $env:VOLT_STOP_FLAG       = $stopFlag

        $profileName = Get-Profile
        $argline = '--profile="{0}" --runscript="{1}" --noUI' -f $profileName, (Resolve-Path $scriptPy).Path
        Write-Host "Profile: $profileName"
        Write-Host "DLL:     $($env:VOLT_BRIDGE_DLL)"
        Write-Host "Project: $($env:VOLT_FIXTURE_PROJECT)"
        $proc = Start-Process -FilePath $exe -ArgumentList $argline -PassThru -WindowStyle Hidden `
            -RedirectStandardOutput $logOut -RedirectStandardError $logErr
        $proc.Id | Out-File $pidFile
        Write-Host "CODESYS launched (pid $($proc.Id)). Pipe: volt.bridge.codesys"
        Write-Host "Tail launcher log with: codesys-pipe.ps1 logs"
    }
}
