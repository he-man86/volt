# Probe: what does TwinCAT do with a MOVE whose target is no folder? (openspec bridge-refusal-review 4.31)
#
# CODESYS accepts `Move` into `Device` / `Task Configuration` and leaves the object (merged-classes.log 225-229). Volt now
# refuses such a move in the push pre-flight by the ENGINE's rule (the deepest existing node of the target path must be
# the tree root, a folder or an Application), so TwinCAT's own answer does not decide it - it is measured once here and
# recorded in DIALECT. The move is Volt's own (TcItemArchive.RoundTrip): ExportChild from the parent, flatten the
# archive's entry paths, DeleteChild, ImportChild into the target (undo: ImportChild back into the parent). Two targets:
# a POU node (POUexecute) and the library manager (References). Afterwards the probe reads where the item is and puts
# it back in GVLs.
#
#   powershell -File scripts/ide.ps1 up -Vendor twincat -Instance bridge-refusal-review -Fixture 14 -Wait
#   powershell -File scripts/probe-tc-move-target.ps1
#
# The DTE is taken from the Running Object Table by THIS instance's XAE pid, never by GetActiveObject. ASCII only.
param([string]$Instance = "bridge-refusal-review",
      [string]$Log = "",
      [string]$RestoreZip = "")   # an archive a failed run left behind: imported back into GVLs first
$ErrorActionPreference = "Stop"
if (-not $Log) { $Log = Join-Path $PSScriptRoot "tc-move-target.log" }
Set-Content -Path $Log -Value "probe-tc-move-target.ps1 - $(Get-Date -Format 'yyyy-MM-dd HH:mm')" -Encoding UTF8
function Out([string]$s) { Add-Content -Path $Log -Value $s -Encoding UTF8; Write-Host $s }

Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Runtime.InteropServices.ComTypes;
public static class VoltRot3 {
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
$dte = [VoltRot3]::Get("!TcXaeShell.DTE.15.0:$xaePid")
if (-not $dte) { throw "XAE $xaePid has no DTE in the ROT" }
if ($dte.Solution.FullName -notlike "*volt-ide-twincat-$Instance*") { throw "not the $Instance fixture copy: $($dte.Solution.FullName)" }
Out "XAE pid ${xaePid} ($pipe): $($dte.Solution.FullName)"
$sm = $dte.Solution.Projects.Item(1).Object
function PlcRoot { return ,$sm.LookupTreeItem("TIPC").Child(1).NestedProject }
$M = [Type]::Missing
function Child($node, [string]$name) {
    for ($i = 1; $i -le $node.ChildCount; $i++) { $c = $node.Child($i); if ($c.Name -eq $name) { return ,$c } }
    return $null
}
function Single($x) { if ($x -is [object[]]) { return ,$x[0] } return ,$x }
function At([string[]]$path) { $n = PlcRoot; foreach ($p in $path) { $n = Single (Child $n $p); if (-not $n) { return $null } }; return ,$n }
function FirstLine([string]$s) { ($s -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -First 1) }
function Kids($node) { if ($node.ChildCount -eq 0) { return "<none>" }; (1..$node.ChildCount | ForEach-Object { "$($node.Child($_).Name)($($node.Child($_).ItemType))" }) -join ", " }
function Flatten([string]$zip) {
    $flat = "$zip.flat"
    $src = [System.IO.Compression.ZipFile]::OpenRead($zip)
    $dst = [System.IO.Compression.ZipFile]::Open($flat, "Create")
    foreach ($e in $src.Entries) {
        $leaf = ($e.FullName -split '[\\/]')[-1]
        $c = $dst.CreateEntry($leaf); $i = $e.Open(); $o = $c.Open(); $i.CopyTo($o); $o.Dispose(); $i.Dispose()
    }
    $dst.Dispose(); $src.Dispose(); Remove-Item $zip; Move-Item $flat $zip
}

$item = "GVL_PackML"
if ($RestoreZip) {
    if (Single (Child (At @("GVLs")) $item)) { throw "'$item' is in GVLs already; nothing to restore" }
    (At @("GVLs")).ImportChild($RestoreZip, "", $false, "")
    Out "restored '$item' into GVLs from $RestoreZip"
}
if (-not (Single (Child (At @("GVLs")) $item))) { throw "'$item' is not in GVLs - restore it first (-RestoreZip)" }
foreach ($target in @(@("POUs", "POUexecute"), @("References"))) {
    $from = At @("GVLs")
    $to = At $target
    Out ""
    Out "== move '$item' (GVLs) into '$($target -join '/')' - ItemType $($to.ItemType)"
    $zip = Join-Path $env:TEMP ("volt_probe_move_" + [guid]::NewGuid().ToString("N") + ".zip")
    $from.ExportChild($item, $zip)
    Flatten $zip
    $from.DeleteChild($item)
    try {
        $to = At $target
        $to.ImportChild($zip, "", $false, "")
        Out "   ImportChild into the target: ACCEPTED (no exception)"
    } catch {
        Out "   ImportChild into the target: REFUSED: $(FirstLine $_.Exception.Message)"
    }
    $to = At $target; $from = At @("GVLs")
    Out "   target children afterwards: $(Kids $to)"
    Out "   GVLs children afterwards:   $(Kids $from)"
    $landed = Single (Child $to $item)
    if ($landed) {
        # Put it back: export from where it landed, import into GVLs.
        $zip2 = "$zip.back.zip"
        $to.ExportChild($item, $zip2); Flatten $zip2; $to.DeleteChild($item)
        (At @("GVLs")).ImportChild($zip2, "", $false, ""); Remove-Item $zip2
        Out "   restored from the target into GVLs"
    } elseif (-not (Single (Child (At @("GVLs")) $item))) {
        (At @("GVLs")).ImportChild($zip, "", $false, "")
        Out "   restored from the archive into GVLs (the undo TcItemArchive.RoundTrip runs)"
    }
    Remove-Item $zip -ErrorAction SilentlyContinue
    Out "   GVLs children after restore: $(Kids (At @("GVLs")))"
}

# Where every object named like the item sits now (a refused import can leave one behind).
function Find($node, [string]$path) {
    for ($i = 1; $i -le $node.ChildCount; $i++) {
        $c = $node.Child($i); $p = if ($path) { "$path/$($c.Name)" } else { $c.Name }
        if ($c.Name -like "$item*") { Out "   found $p ($($c.ItemType))" }
        if ($c.ItemType -in 601, 617) { Find $c $p }
    }
}
Out ""
Out "== every '$item*' in the project afterwards"
Find (PlcRoot) ""
