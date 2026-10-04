# Probe: what does TwinCAT's OWN View switch (FBD/LD/IL -> View as ladder logic / function block diagram) do to a
# network? (openspec bridge-refusal-review 3.10, DIALECT N23's open half; the CODESYS half is probe-view-switch.py.)
#
# Volt flips a body's view by writing the archive's DefaultViewMode in place and the same network (TcNetworkWriter).
# This asks the vendor command itself - `FBDLDIL.Viewasfunctionblockdiagram` / `FBDLDIL.Viewasladderlogic`, the DTE
# names of the NWL editor's ViewAsFBD / ViewAsLD (same command GUIDs as CODESYS's) - on two POUs the bridge creates:
#   VltE2E_vs_ld  (LD):  out := (a OR b)  [two contacts in parallel - the LD-only drawing a TwinCAT body can be GIVEN:
#                        a PARALLEL cannot be created on this vendor (D30, TcUnmeasured.RefuseImport) and no committed
#                        archive holds one], out3 := (a AND b)
#   VltE2E_vs_fbd (FBD): iout := (i1 + i2), out := ((i1 + i2) > i3)  [data boxes, no contact/coil drawing], out3
# For each: open the POU's editor (ItemOperations.OpenFile), run the command, SAVE, then compare the .TcPOU archive
# (line diff) and the bridge's pull against the state before; back again; leave it switched, close, and build.
#
#   powershell -File scripts/ide.ps1 up -Vendor twincat -Instance bridge-refusal-review -Fixture 14 -Wait
#   powershell -File scripts/probe-tc-view-switch.ps1
#
# The DTE is taken from the ROT by THIS instance's XAE pid, resolved like probe-tc-refusal-measure.ps1. ASCII only.
param([string]$Instance = "bridge-refusal-review", [string]$Log = "")
$ErrorActionPreference = "Stop"
if (-not $Log) { $Log = Join-Path $PSScriptRoot "tc-view-switch.log" }
Set-Content -Path $Log -Value "probe-tc-view-switch.ps1 - $(Get-Date -Format 'yyyy-MM-dd HH:mm')" -Encoding UTF8
function Out([string]$s) { Add-Content -Path $Log -Value $s -Encoding UTF8; Write-Host $s }

Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Runtime.InteropServices.ComTypes;
public static class VoltRotVs {
  [DllImport("ole32.dll")] static extern int GetRunningObjectTable(int r, out IRunningObjectTable t);
  [DllImport("ole32.dll")] static extern int CreateBindCtx(int r, out IBindCtx c);
  public static object Get(string name) {
    IRunningObjectTable rot; GetRunningObjectTable(0, out rot); IEnumMoniker e; rot.EnumRunning(out e);
    var m = new IMoniker[1];
    while (e.Next(1, m, IntPtr.Zero) == 0) { IBindCtx c; CreateBindCtx(0, out c); string n; m[0].GetDisplayName(c, null, out n);
      if (n == name) { object o; rot.GetObject(m[0], out o); return o; } }
    return null; }
}
"@
$resolver = (Resolve-Path (Join-Path $PSScriptRoot "../test/e2e/lib/fixture-ide.ts")).Path
$pipe = (& bun $resolver twincat $Instance | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw "no fixture XAE for instance '$Instance'" }
$xaePid = [int]($pipe -split '\.')[-1]
$dte = [VoltRotVs]::Get("!TcXaeShell.DTE.15.0:$xaePid")
if (-not $dte) { throw "XAE $xaePid has no DTE in the ROT" }
if ($dte.Solution.FullName -notlike "*volt-ide-twincat-$Instance*") { throw "not the $Instance fixture copy: $($dte.Solution.FullName)" }
Out "XAE pid ${xaePid} ($pipe): $($dte.Solution.FullName)"

$env:VOLT_VENDOR = "twincat"; $env:VOLT_E2E_INSTANCE = $Instance
$helper = Join-Path $PSScriptRoot "probe-tc-view-switch.ts"
function Bridge([string[]]$a) {
    $o = & bun $helper @a | Out-String
    if ($LASTEXITCODE -ne 0) { throw "bridge helper $($a -join ' ') failed: $o" }
    return $o
}
function Pump([int]$ms = 1500) { Start-Sleep -Milliseconds $ms }
function ArchiveDiff([string]$label, [string[]]$a, [string[]]$b) {
    $d = Compare-Object $a $b
    if (-not $d) { Out "      archive ${label}: IDENTICAL"; return }
    Out "      archive ${label}: $(@($d).Count) line(s) differ"
    foreach ($x in $d) { Out "        $($x.SideIndicator) $($x.InputObject.Trim())" }
}
function PullDiff([string]$label, [string]$a, [string]$b) {
    if ($a -eq $b) { Out "      pull ${label}: IDENTICAL"; return }
    Out "      pull ${label}: DIFFERENT"
    $d = Compare-Object ($a -split "`n") ($b -split "`n")
    foreach ($x in $d) { Out "        $($x.SideIndicator) $($x.InputObject)" }
}

# EVERY diagnostic is logged (review 3c: the first version printed only those whose JSON named a probe POU, so a
# project-level diagnostic the switched POUs caused would have been counted as unrelated, unseen). A baseline build
# BEFORE the probe POUs exist is the control: the build after the switches must report exactly its diagnostics.
$cli = (Resolve-Path (Join-Path $PSScriptRoot "../test/e2e/lib/pipe.ts")).Path -replace "\\", "/"
function Build {
    $js = "import { callOn } from '$cli'; const r: any = await Promise.race([callOn('$pipe', 'build', {}), " +
          "new Promise((_, j) => setTimeout(() => j(new Error('build timed out after 600 s')), 600000))]); " +
          "const all = r.diagnostics ?? []; " +
          "const d = all.filter((x: any) => /VltE2E_vs_/.test(JSON.stringify(x))); " +
          "console.log('build: success=' + r.success + ', ' + all.length + ' diagnostic(s), ' + d.length + ' naming the probe POUs'); " +
          "for (const x of all) console.log('DIAG ' + JSON.stringify(x)); process.exit(0)"
    $o = @(& bun -e $js 2>&1 | ForEach-Object { "$_" })
    if ($LASTEXITCODE -ne 0) { throw "build failed: $($o -join ' ')" }
    foreach ($l in $o) { Out "   $l" }
    return (@($o | Where-Object { $_ -like "DIAG *" }) -join "`n")
}

Out ""
Out "=== baseline build, before the probe POUs exist ==="
$baseline = Build
Out ""
Out (Bridge @("create")).Trim()
$dir = Split-Path $dte.Solution.FullName
$cmds = @{ FBD = "FBDLDIL.Viewasfunctionblockdiagram"; LD = "FBDLDIL.Viewasladderlogic" }

foreach ($case in @(@{ Pou = "VltE2E_vs_ld"; First = "FBD"; Back = "LD" }, @{ Pou = "VltE2E_vs_fbd"; First = "LD"; Back = "FBD" })) {
    $pou = $case.Pou
    $file = (Get-ChildItem $dir -Recurse -Filter "$pou.TcPOU" | Select-Object -First 1).FullName
    Out ""
    Out "=== ${pou}: View as $($case.First), then $($case.Back) ($file) ==="
    $a0 = Get-Content $file; $p0 = Bridge @("fetch", "$pou.pou")
    $win = $dte.ItemOperations.OpenFile($file)
    Pump 3000
    Out "   editor: document $($dte.ActiveDocument.Name)"
    # THE CONTROL: opened and saved with NO command. First run: opening the editor alone re-resolves every operand
    # (Type "" -> "BOOL"/"INT", LValue false -> true, the empty importer OutputItems dropped) - the editor's symbol
    # pass, not the View switch. So the switches are compared against this state, not against what the bridge wrote.
    $dte.ActiveDocument.Save() | Out-Null
    Pump
    $ao = Get-Content $file; $po = Bridge @("fetch", "$pou.pou")
    ArchiveDiff "authored -> opened+saved (no command)" $a0 $ao
    PullDiff "authored -> opened+saved (no command)" $p0 $po
    $states = @()
    foreach ($v in @($case.First, $case.Back, $case.First)) {
        $dte.ExecuteCommand($cmds[$v], "")
        Pump
        $dte.ActiveDocument.Save() | Out-Null
        Pump
        $states += , @{ View = $v; Archive = (Get-Content $file); Pull = (Bridge @("fetch", "$pou.pou")) }
        Out "   ran $($cmds[$v]); saved; DefaultViewMode in the archive: $((Select-String -Path $file -Pattern 'DefaultViewMode' | Select-Object -First 1).Line.Trim())"
    }
    ArchiveDiff "opened -> $($case.First)" $ao $states[0].Archive
    PullDiff "opened -> $($case.First)" $po $states[0].Pull
    ArchiveDiff "$($case.First) -> $($case.Back)" $states[0].Archive $states[1].Archive
    ArchiveDiff "round trip (opened vs. back)" $ao $states[1].Archive
    PullDiff "round trip (opened vs. back)" $po $states[1].Pull
    ArchiveDiff "switched again == first switch" $states[0].Archive $states[2].Archive
    $dte.ActiveWindow.Close(1)   # vsSaveChanges.Yes (already saved)
    Pump
}

Out ""
Out "=== build with both POUs switched (the bridge's build op) ==="
$after = Build
Out "   the same diagnostics as the baseline build before the probe POUs existed: $($after -eq $baseline)"
Out (Bridge @("cleanup")).Trim()
