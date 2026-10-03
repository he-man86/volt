# Probe: what does a running TcXaeShell state about ITSELF and its TwinCAT build? (ide-identity-report 1.3, 1.5)
#
# Read-only, no solution. It starts its OWN TcXaeShell over COM (never attaches to one another session runs), reads
# every candidate source, and quits that instance. Each source is a candidate for one health field:
#   product        DTE.Name / DTE.Version / DTE.Edition (today's IdeVersion is DTE.Version) and the shell exe's
#                  version-info (ProductName, ProductVersion, CompanyName) — the generic "host process" source
#   TwinCAT build  (a) TcRemoteManager.Version / .Versions — the XAE automation's own answer
#                  (b) the file version of `TwinCAT XAE Base.dll` as LOADED in the XAE process (the XAE build the
#                      shell runs) — found in the Beckhoff-module grouping; every Beckhoff module is listed by version
#                  (c) HKLM\...\Beckhoff\TwinCAT3\System TcVersion, read through BOTH registry views explicitly
#                      (Registry32 = WOW6432Node, Registry64), so a 32-bit run is not silently redirected — a
#                      machine setting, for comparison only
#                  (d) the open project's .tsproj TcVersion attribute — the build that last SAVED the file
# Read twice: with no solution, then with a COPY of the committed fixture (TwinCAT Project14) open, because the
# remote manager and the XAE modules are per-solution/lazy. The copy is closed without saving and deleted.
#
# "Its own" shell is the process that owns the DTE's MainWindow (GetWindowThreadProcessId on DTE.MainWindow.HWnd) —
# never "a TcXaeShell that was not running before", which could adopt (and, on a stuck quit, kill) a shell another
# session started meanwhile. No owning pid -> the probe quits its DTE and stops, by name.
#
# Run it TWICE — the shell's modules are only listable from a reader of the shell's bitness (TcXaeShell 15 is 32-bit),
# and the worker that serves TwinCAT is win-x64, so what a 64-bit reader sees is part of the measurement:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -File packages\volt-cli\scripts\probe-tc-ide-identity.ps1
#   powershell.exe -File packages\volt-cli\scripts\probe-tc-ide-identity.ps1 -Log packages\volt-cli\scripts\tc-ide-identity-64.log
param([string]$ProgId = "TcXaeShell.DTE.15.0", [string]$Log = (Join-Path $PSScriptRoot "tc-ide-identity.log"))
$ErrorActionPreference = "Continue"
$out = New-Object System.Collections.Generic.List[string]
function Say($s) { $out.Add([string]$s); Write-Host $s }
function Try-Get([scriptblock]$b) {
    try { $v = & $b; if ($null -eq $v) { "(null)" } else { ($v | ForEach-Object { [string]$_ }) -join ", " } }
    catch { $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }; "<raised $($e.GetType().Name): $($e.Message.Split([char]10)[0])>" }
}

Say "probe process: $([IntPtr]::Size * 8)-bit"
Add-Type -AssemblyName Microsoft.VisualBasic
Add-Type -Namespace VoltProbe -Name Win -MemberDefinition '[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint pid);'
$t = [Type]::GetTypeFromProgID($ProgId)
if ($null -eq $t) { Say "no ProgID $ProgId"; $out | Set-Content $Log -Encoding utf8; exit 1 }
$dte = [Activator]::CreateInstance($t)
$deadline = (Get-Date).AddSeconds(120)
$mine = $null
while (-not $mine -and (Get-Date) -lt $deadline) {
    # The pid that owns THIS DTE's main window — tied to the instance created above, not guessed from a process diff.
    try {
        # HWnd sits on a non-default interface: a late-bound `$dte.MainWindow.HWnd` reads null, CallByName reaches it.
        $hwnd = [IntPtr][long][Microsoft.VisualBasic.Interaction]::CallByName($dte.MainWindow, 'HWnd', [Microsoft.VisualBasic.CallType]::Get)
        [uint32]$ownerPid = 0
        if ($hwnd -ne [IntPtr]::Zero -and [VoltProbe.Win]::GetWindowThreadProcessId($hwnd, [ref]$ownerPid) -ne 0 -and $ownerPid -ne 0) {
            $mine = Get-Process -Id $ownerPid -ErrorAction Stop
        }
    } catch {}
    if (-not $mine) { Start-Sleep -Milliseconds 500 }
}
try {
    if (-not $mine) { Say "own XAE pid: <DTE.MainWindow.HWnd has no owning process within 120 s> - stopping, nothing measured"; return }
    Say "own XAE pid: $($mine.Id) (owner of DTE.MainWindow.HWnd, image $($mine.ProcessName))"
    Say "DTE.Name     : $(Try-Get { $dte.Name })"
    Say "DTE.Version  : $(Try-Get { $dte.Version })"
    Say "DTE.Edition  : $(Try-Get { $dte.Edition })"
    Say "DTE.FullName : $(Try-Get { $dte.FullName })"
    if ($mine) {
        $fvi = $mine.MainModule.FileVersionInfo
        Say "shell exe version-info: ProductName='$($fvi.ProductName)' ProductVersion='$($fvi.ProductVersion)' FileVersion='$($fvi.FileVersion)' CompanyName='$($fvi.CompanyName)' FileDescription='$($fvi.FileDescription)'"
    }
    function Read-Build($when) {
        Say "--- $when"
        Say "TcRemoteManager.Version  : $(Try-Get { $dte.GetObject('TcRemoteManager').Version })"
        Say "TcRemoteManager.Versions : $(Try-Get { $dte.GetObject('TcRemoteManager').Versions })"
        $mods = @()
        try { $mine.Refresh(); $mods = @($mine.Modules) } catch { Say "Modules: <raised $($_.Exception.Message)>" }
        Say "modules listed: $($mods.Count)"
        # Every Beckhoff-signed module, grouped by file version: which build the shell actually LOADED.
        foreach ($g in $mods | Where-Object { $_.FileVersionInfo.CompanyName -match 'Beckhoff' } | Group-Object { $_.FileVersionInfo.FileVersion } | Sort-Object Count -Descending) {
            Say ("  {0} Beckhoff module(s) at FileVersion '{1}': {2}" -f $g.Count, $g.Name, (($g.Group | Select-Object -First 6 | ForEach-Object ModuleName) -join ', '))
        }
        # Source (b): the XAE base module the build number was found on (the Beckhoff grouping above), in full.
        foreach ($m in $mods | Where-Object { $_.ModuleName -match '^TwinCAT XAE Base' } | Sort-Object ModuleName) {
            Say ("  loaded {0}: FileVersion='{1}' ProductVersion='{2}' Product='{3}' Company='{4}' ({5})" -f $m.ModuleName, $m.FileVersionInfo.FileVersion, $m.FileVersionInfo.ProductVersion, $m.FileVersionInfo.ProductName, $m.FileVersionInfo.CompanyName, $m.FileName)
        }
    }
    if ($mine) { Read-Build "no solution open" }
    if ($mine) {
        $src = Join-Path (Split-Path $PSScriptRoot -Parent) "test\fixtures\TwinCAT Project14"
        $copy = Join-Path ([IO.Path]::GetTempPath()) ("volt-probe-tc-identity-" + [Guid]::NewGuid().ToString("N"))
        Copy-Item -Recurse $src $copy
        try {
            $dte.Solution.Open((Join-Path $copy "TwinCAT Project14.sln"))
            $until = (Get-Date).AddSeconds(120)
            while ((Get-Date) -lt $until) { try { if ($dte.Solution.Projects.Count -ge 1 -and $dte.Solution.Projects.Item(1).Object) { break } } catch {}; Start-Sleep -Seconds 1 }
            Start-Sleep -Seconds 5
            Say "solution open: $(Try-Get { $dte.Solution.FullName }) projects=$(Try-Get { $dte.Solution.Projects.Count })"
            Read-Build "with the fixture solution open"
            $ts = Get-ChildItem $copy -Recurse -Filter *.tsproj | Select-Object -First 1
            Say "tsproj TcVersion attribute: $(Try-Get { ([xml](Get-Content $ts.FullName -Raw)).TcSmProject.TcVersion })"
            try { $dte.Solution.Close($false) } catch {}
        } finally { Start-Sleep -Seconds 2; Remove-Item -Recurse -Force $copy -ErrorAction SilentlyContinue }
    }
    # Explicit views: a plain HKLM:\SOFTWARE read from a 32-bit process is redirected to WOW6432Node by WOW64, which
    # would print the 32-bit value under the 64-bit key's name.
    foreach ($view in 'Registry32', 'Registry64') {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey('LocalMachine', $view)
        $k = $base.OpenSubKey('SOFTWARE\Beckhoff\TwinCAT3\System')
        Say "registry HKLM\SOFTWARE\Beckhoff\TwinCAT3\System ($view view) TcVersion: $(if ($null -eq $k) { '<key absent>' } else { Try-Get { $k.GetValue('TcVersion') } })"
        if ($k) { $k.Close() }; $base.Close()
    }
}
finally {
    try { $dte.Quit() } catch {}
    if ($mine) { if (-not $mine.WaitForExit(30000)) { Stop-Process -Id $mine.Id -Force; Say "own XAE did not quit in 30 s; killed pid $($mine.Id)" } }
    $out | Set-Content $Log -Encoding utf8
}
