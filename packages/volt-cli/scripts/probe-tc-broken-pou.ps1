# Probe: can TwinCAT answer a POU whose text declares nothing the way CODESYS does? (openspec bridge-refusal-review 8.4)
#
# CODESYS reads such a POU (`(* Motor` + FUNCTION_BLOCK X ..., the opening comment never closed) by its class and
# fetches it back as written; TwinCAT lists it `unreadable` because touching its tree item after a load crashes XAE
# (DIALECT C2i) and the snapshot refuses it by its bare caption, in the session that wrote it too. The vendor paths
# measured here, none of which touches a tree item loaded broken:
#   A1  the .TcPOU file, read from disk through the hierarchy's canonical name - does it hold the text and the kind?
#   A2  the tree item IN THE SESSION THAT WROTE IT (DIALECT: such a touch does not crash) - its ItemType and texts
#   A3  what the DTE project model says about the file without the tree (ProjectItem properties), before and after a
#       solution reload - is there a POU type anywhere once XAE has loaded it broken?
# The item is the matrix's own: push it first (it must be in the PLC project root, written by this XAE session):
#   bun <scratch>/probe-ucfb.ts keep      (pushes VltE2E_ref_probe to both fixture IDEs)
#   powershell -File scripts/probe-tc-broken-pou.ps1 [-Reload]
# -Reload saves, closes and reopens the solution and repeats A1/A3 only (A2 after a reload is the measured crash). The
# DTE is taken from the ROT by THIS instance's XAE pid. ASCII only.
param([string]$Instance = "bridge-refusal-review",
      [string]$Item = "VltE2E_ref_probe",
      [string]$Typed = "PLC_PRG",
      [switch]$Reload,
      [string]$Log = "")
$ErrorActionPreference = "Stop"
if (-not $Log) { $Log = Join-Path $PSScriptRoot "tc-broken-pou.log" }
if (-not $Reload) { Set-Content -Path $Log -Value "probe-tc-broken-pou.ps1 - $(Get-Date -Format 'yyyy-MM-dd HH:mm')" -Encoding UTF8 }
function Out([string]$s) { Add-Content -Path $Log -Value $s -Encoding UTF8; Write-Host $s }

Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Runtime.InteropServices.ComTypes;
public static class VoltRot4 {
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
$dte = [VoltRot4]::Get("!TcXaeShell.DTE.15.0:$xaePid")
if (-not $dte) { throw "XAE $xaePid has no DTE in the ROT" }
$sln = $dte.Solution.FullName
if ($sln -notlike "*volt-ide-twincat-$Instance*") { throw "not the $Instance fixture copy: $sln" }
Out ""
Out "== XAE pid ${xaePid} ($pipe): $sln  (reload: $Reload)"

if ($Reload) {
    $dte.ExecuteCommand("File.SaveAll")
    $dte.Solution.Close($true)
    Out "   solution closed (saved); reopening"
    $dte.Solution.Open($sln)
    $t0 = Get-Date
    while (((Get-Date) - $t0).TotalSeconds -lt 120) { try { if ($dte.Solution.Projects.Count -ge 1) { break } } catch {}; Start-Sleep 2 }
    Start-Sleep 10
    Out "   reopened: $($dte.Solution.Projects.Count) project(s)"
}

# The DTE project model: find the PLC project (the nested project under the TwinCAT project) and its items by NAME.
function Walk($items, [string]$path, [scriptblock]$visit) {
    if (-not $items) { return }
    foreach ($pi in $items) {
        & $visit $pi $path
        try { Walk $pi.ProjectItems "$path/$($pi.Name)" $visit } catch {}
        try { if ($pi.SubProject) { Walk $pi.SubProject.ProjectItems "$path/$($pi.Name)" $visit } } catch {}
    }
}
$found = @{}
$proj = $dte.Solution.Projects.Item(1)
Out "-- A3 DTE project '$($proj.Name)' lists $(try { $proj.ProjectItems.Count } catch { "<refused>" }) ProjectItem(s) - the model a file could be read through without the tree"
Walk $proj.ProjectItems "" {
    param($pi, $path)
    $n = $pi.Name
    if ($n -like "$Item*" -or $n -like "$Typed*") { $found["$path/$n"] = $pi }
}
foreach ($k in $found.Keys | Sort-Object) {
    $pi = $found[$k]
    Out ""
    Out "-- A3 DTE ProjectItem $k  Kind=$($pi.Kind)"
    try { Out "   FileNames(1) = $($pi.FileNames(1))" } catch { Out "   FileNames(1) refused: $($_.Exception.Message)" }
    try {
        foreach ($p in $pi.Properties) {
            $v = $null; try { $v = $p.Value } catch { $v = "<refused>" }
            Out ("   prop {0} = {1}" -f $p.Name, $v)
        }
    } catch { Out "   Properties refused: $($_.Exception.Message)" }
    # A1: the file itself
    try {
        $file = $pi.FileNames(1)
        if ($file -and (Test-Path $file) -and $file -like "*.TcPOU") {
            [xml]$x = Get-Content -Raw $file
            $pou = $x.TcPlcObject.POU
            Out "-- A1 $file"
            Out ("   POU attributes: " + (($pou.Attributes | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join " "))
            Out ("   Declaration: " + ($pou.Declaration.'#cdata-section' -replace "`r?`n", "\n"))
            Out ("   Implementation: " + ($pou.Implementation.InnerXml -replace "`r?`n", "\n"))
        }
    } catch { Out "   A1 read failed: $($_.Exception.Message)" }
}

# A1 without the DTE model (TcXaeShell lists no ProjectItems): the .TcPOU files of the item and of a typed POU, found
# under the solution folder by NAME (Volt reads the same path off the hierarchy's canonical name), and the .plcproj
# entries that list them - is a POU type stored anywhere a load could take it from?
$root = Split-Path $sln -Parent
foreach ($n in @($Item, $Typed)) {
    foreach ($file in Get-ChildItem $root -Recurse -Filter "$n.TcPOU" | Select-Object -ExpandProperty FullName) {
        [xml]$x = Get-Content -Raw $file
        $pou = $x.TcPlcObject.POU
        Out ""
        Out "-- A1 $file"
        Out ("   POU attributes: " + (($pou.Attributes | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join " "))
        Out ("   Declaration: " + ($pou.Declaration.'#cdata-section' -replace "`r?`n", "\n"))
        Out ("   Implementation: " + ($pou.Implementation.InnerXml -replace "`r?`n", "\n"))
    }
    foreach ($plcproj in Get-ChildItem $root -Recurse -Filter "*.plcproj" | Select-Object -ExpandProperty FullName) {
        $lines = Select-String -Path $plcproj -Pattern "$n.TcPOU" -Context 0,2 | ForEach-Object { ($_.Line + " " + ($_.Context.PostContext -join " ")).Trim() }
        foreach ($l in $lines) { Out "   plcproj: $($l -replace '\s+', ' ')" }
    }
}

if (-not $Reload) {
    # A2: the tree item in the session that wrote it. Never after a reload (DIALECT C2i: crashes XAE).
    $sm = $dte.Solution.Projects.Item(1).Object
    $plc = $sm.LookupTreeItem("TIPC").Child(1).NestedProject
    for ($i = 1; $i -le $plc.ChildCount; $i++) {
        $c = $plc.Child($i)
        if ($c.Name -ne $Item) { continue }
        Out ""
        Out "-- A2 tree item '$($c.Name)' (in the session that wrote it): ItemType=$($c.ItemType)"
        try { Out ("   DeclarationText: " + ($c.DeclarationText -replace "`r?`n", "\n")) } catch { Out "   DeclarationText refused: $($_.Exception.Message)" }
        try { Out ("   ImplementationText: " + ($c.ImplementationText -replace "`r?`n", "\n")) } catch { Out "   ImplementationText refused: $($_.Exception.Message)" }
    }
}
Out ""
Out "== XAE alive afterwards: $([bool](Get-Process -Id $xaePid -ErrorAction SilentlyContinue))"
