# Probe: WHERE does TwinCAT keep an item's kind (DUT subtype; POU kind), and which of those sources is right
# right after an in-place change, after a build, after a save, after a solution reload?
#
# openspec `push-without-header-check` section 5 (pull reads the kind from the IDE, never from the text) and the
# owner's question "the IDE must store the correct info": TwinCAT shows enum/struct/union/alias DUTs as different
# tree items, so this dumps EVERY source the Automation Interface reaches for one item of every kind and compares
# them side by side - the tree item's whole dispatch surface (ItemType, ItemSubType, ItemSubTypeName, ...),
# ProduceXml, the DUT/POU's DocumentXml, the on-disk .TcDUT/.TcPOU/.TcGVL/.TcIO after a save, the .plcproj entry,
# the TMC data type after a build (ITcPlcProject.CompileProject), the PLC project's ITcPlcProjectInternal.LanguageModel,
# and the build's error list (the compiler's reading). DIALECT C2e/C2h.
#
# Phases (each a separate run, so the IDE can be screenshotted / reloaded between them):
#   create  - make folder VltKind with one item of every kind (native tree codes AND Volt's 606 seed), dump
#   dump    - dump only
#   change  - rewrite DUTs in place to another subtype (C2e), dump
#   build   - CompileProject, list the error list + TMC entries, dump
#   save    - File.SaveAll, dump incl. on-disk files
#   reload  - SaveAll + Solution.Close + Solution.Open (same .sln), dump
#
# Run against a FIXTURE COPY only: `ide.ps1 up -Vendor twincat -Fixture 14 -Instance kind-probe`. Writes go
# straight through COM (CreateChild / DeclarationText), the calls `TcObjectModel` makes. ASCII only.
param([ValidateSet("create", "dump", "walk", "lookup", "captions", "change", "build", "save", "reload")] [string]$Phase = "dump",
      [string[]]$Names = @(),
      [string]$Log = "")
$ErrorActionPreference = "Stop"
if (-not $Log) { $Log = Join-Path $PSScriptRoot "tc-kind-source.log" }
function Out([string]$s) { Add-Content -Path $Log -Value $s -Encoding UTF8; Write-Host $s }

# Several XAE windows may be open (other sessions serve their own fixture copies), so the DTE is taken from the
# Running Object Table by the moniker that names THIS solution's process, never by GetActiveObject (which hands
# back whichever registered first).
# The Solution Explorer node of each item, read through the VS hierarchy (IVsSolution -> IVsHierarchy over the
# DTE's IServiceProvider - works out of process): its CAPTION carries a kind suffix ("X (ENUM)", "X (PRG)") and
# its IconHandle is the icon the tree draws.
$vsIde = "C:\Program Files (x86)\Beckhoff\TcXaeShell\Common7\IDE\PublicAssemblies"
$vsRefs = @("$vsIde\Microsoft.VisualStudio.OLE.Interop.dll", "$vsIde\Microsoft.VisualStudio.Shell.Interop.dll")
foreach ($r in $vsRefs) { [Reflection.Assembly]::LoadFrom($r) | Out-Null }
Add-Type -ReferencedAssemblies $vsRefs -TypeDefinition @"
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Runtime.InteropServices.ComTypes;
using Microsoft.VisualStudio.Shell.Interop;
public static class VoltRot {
  [DllImport("ole32.dll")] static extern int GetRunningObjectTable(int r, out IRunningObjectTable t);
  [DllImport("ole32.dll")] static extern int CreateBindCtx(int r, out IBindCtx c);
  public static object Get(string name) {
    IRunningObjectTable rot; GetRunningObjectTable(0, out rot); IEnumMoniker e; rot.EnumRunning(out e);
    var m = new IMoniker[1];
    while (e.Next(1, m, IntPtr.Zero) == 0) { IBindCtx c; CreateBindCtx(0, out c); string n; m[0].GetDisplayName(c, null, out n);
      if (n == name) { object o; rot.GetObject(m[0], out o); return o; } }
    return null; }
  static string P(IVsHierarchy h, uint id, int prop) { object v; int hr = h.GetProperty(id, prop, out v); return hr == 0 ? (v == null ? "null" : v.ToString()) : ("hr" + hr.ToString("X")); }
  static uint U(object v) { return v is int ? unchecked((uint)(int)v) : Convert.ToUInt32(v); }
  // file name (canonical) -> "caption | IconHandle"
  public static Dictionary<string, string> Nodes(object dte) {
    var res = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    var sp = (Microsoft.VisualStudio.OLE.Interop.IServiceProvider)dte;
    Guid sid = typeof(SVsSolution).GUID, iid = typeof(IVsSolution).GUID; IntPtr p;
    if (sp.QueryService(ref sid, ref iid, out p) != 0) return res;
    var sol = (IVsSolution)Marshal.GetObjectForIUnknown(p);
    IEnumHierarchies en; Guid g = Guid.Empty; sol.GetProjectEnum((uint)__VSENUMPROJFLAGS.EPF_ALLPROJECTS, ref g, out en);
    var hs = new IVsHierarchy[1]; uint got;
    while (en.Next(1, hs, out got) == 0 && got == 1) Walk(hs[0], 0xFFFFFFFE, 0, res);
    return res; }
  static void Walk(IVsHierarchy h, uint id, int depth, Dictionary<string, string> res) {
    if (depth > 12) return;
    object v; if (h.GetProperty(id, -2041 /*FirstVisibleChild*/, out v) != 0 || v == null) return;
    uint c = U(v);
    while (c != 0xFFFFFFFF) {
      string canon; h.GetCanonicalName(c, out canon);
      if (!string.IsNullOrEmpty(canon) && canon.IndexOfAny(System.IO.Path.GetInvalidPathChars()) < 0) res[System.IO.Path.GetFileName(canon)] = P(h, c, -2003) + " | IconHandle " + P(h, c, -2013);
      IntPtr pn; uint nid; Guid ih = typeof(IVsHierarchy).GUID;
      if (h.GetNestedHierarchy(c, ref ih, out pn, out nid) == 0 && pn != IntPtr.Zero) {
        var nh = (IVsHierarchy)Marshal.GetObjectForIUnknown(pn); Marshal.Release(pn); Walk(nh, nid, depth + 1, res);
      } else Walk(h, c, depth + 1, res);
      object nx; if (h.GetProperty(c, -2042 /*NextVisibleSibling*/, out nx) != 0 || nx == null) break;
      c = U(nx);
    } }
}
"@
function Get-XaeDte {
    $mine = @(Get-CimInstance Win32_Process -Filter "Name='TcXaeShell.exe'" | Where-Object { $_.CommandLine -like "*volt-ide-twincat-kind-probe*" })
    if ($mine.Count -ne 1) { throw "expected exactly one TcXaeShell on the kind-probe copy, found $($mine.Count)" }
    $d = [VoltRot]::Get("!TcXaeShell.DTE.15.0:$($mine[0].ProcessId)")
    if (-not $d) { throw "XAE $($mine[0].ProcessId) has no DTE in the ROT" }
    return $d
}
$dte = Get-XaeDte
if ($dte.Solution.FullName -notlike "*volt-ide-twincat-kind-probe*") { throw "not the kind-probe fixture copy: $($dte.Solution.FullName)" }
$sm = $dte.Solution.Projects.Item(1).Object
$plc = $sm.LookupTreeItem("TIPC").Child(1)          # 56: the PLC project (ITcPlcProject)
$root = $plc.NestedProject                           # 600: the IEC project
$M = [Type]::Missing

function Child($node, [string]$name) {
    for ($i = 1; $i -le $node.ChildCount; $i++) { $c = $node.Child($i); if ($c.Name -eq $name) { return ,$c } }
    return $null
}

$DECL = @{
    struct = "TYPE {0} :`nSTRUCT`n`talpha : INT;`n`tbeta : BOOL;`nEND_STRUCT`nEND_TYPE`n"
    enum   = "TYPE {0} :`n(`n`tRed,`n`tGreen,`n`tBlue`n);`nEND_TYPE`n"
    enumb  = "{{attribute 'qualified_only'}}`n{{attribute 'strict'}}`nTYPE {0} :`n(`n`tOne := 1,`n`tTwo := 2`n) UDINT;`nEND_TYPE`n"
    union  = "TYPE {0} :`nUNION`n`ti : INT;`n`trv : REAL;`nEND_UNION`nEND_TYPE`n"
    alias  = "TYPE {0} : STRING(80);`nEND_TYPE`n"
    unclosed = "(* doc`nTYPE {0} :`nSTRUCT`n`talpha : INT;`nEND_STRUCT`nEND_TYPE`n"
    typeend  = "TYPE {0} : END_TYPE`n"
    empty    = ""
}
# name -> [tree code to create with, vInfo, declaration key]. The first five are what the IDE's own "Add DUT"
# dialog makes (one code per subtype); the V* are Volt's push-create (606 seed, declaration written after).
$DUTS = [ordered]@{
    VltK_S   = @(606, $M, "struct");  VltK_E  = @(605, $M, "enum");   VltK_EB = @(605, $M, "enumb")
    VltK_U   = @(607, $M, "union");   VltK_A  = @(623, "INT", "alias")
    VltK_VE  = @(606, $M, "enum");    VltK_VU = @(606, $M, "union");  VltK_VA = @(606, $M, "alias")
    VltK_BC  = @(606, $M, "unclosed"); VltK_BT = @(606, $M, "typeend"); VltK_BE = @(606, $M, "empty")
}
# The in-place subtype changes (C2e), applied by -Phase change.
$CHANGE = [ordered]@{ VltK_S = "enum"; VltK_E = "struct"; VltK_U = "alias"; VltK_A = "struct"; VltK_VE = "struct"; VltK_EB = "union" }
$POUS = [ordered]@{
    VltK_P  = @(602, "ST", "PROGRAM VltK_P`nVAR`nEND_VAR`n")
    VltK_F  = @(603, $M,   "FUNCTION VltK_F : INT`nVAR_INPUT`nEND_VAR`n")
    VltK_FB = @(604, "ST", "FUNCTION_BLOCK VltK_FB`nVAR`nEND_VAR`n")
    VltK_I  = @(618, $null, "INTERFACE VltK_I`n")
    VltK_BP = @(602, "ST", "(* doc`nPROGRAM VltK_BP`nVAR`nEND_VAR`n")
    VltK_PF = @(602, "ST", "FUNCTION_BLOCK VltK_PF`nVAR`nEND_VAR`n")   # a program holding FB text (C2f)
    VltK_G  = @(615, "ST", "VAR_GLOBAL`n`tgS : VltK_S;`n`tgE : VltK_E;`n`tgEB : VltK_EB;`n`tgU : VltK_U;`n`tgA : VltK_A;`n`tgVE : VltK_VE;`n`tgVU : VltK_VU;`n`tgVA : VltK_VA;`n`tgFB : VltK_FB;`nEND_VAR`n")
}

# A read that crashes XAE (measured: after a reload, see the log) leaves no exception to catch - the process is
# gone. KIND_TRACE names a file every read is announced in BEFORE it is made, so the last line names the read.
function Trace([string]$s) { if ($env:KIND_TRACE) { Add-Content -Path $env:KIND_TRACE -Value $s } }

function Props($c) {
    $o = [ordered]@{}
    foreach ($p in (Get-Member -InputObject $c -MemberType Property)) {
        $n = $p.Name
        if ($n -in @("Parent", "SystemManager", "VSProjectItem", "ChildItems", "DocumentationTopics", "DeclarationText", "DocumentXml", "ImplementationText", "ImplementationXml", "PathName")) { continue }
        Trace "  prop $n"
        try { $o[$n] = "$($c.$n)" } catch { $o[$n] = "!" }
    }
    return $o
}

function DumpItem($c) {
    $n = $c.Name
    Trace "item $n"
    Out ""
    Out "-- $n"
    $p = Props $c
    Out ("   props: " + (($p.Keys | ForEach-Object { "$_=$($p[$_])" }) -join "; "))
    Trace "  ProduceXml"
    $x = $c.ProduceXml($false)
    # ItemId and the VSProperties paths are bookkeeping; everything else in the TreeItem is printed.
    $x2 = $x -replace "<VSProperties>.*</VSProperties>", "<VSProperties/>" -replace "<PathName>[^<]*</PathName>", ""
    Out "   ProduceXml: $x2"
    Trace "  DocumentXml"
    try {
        $d = [xml]$c.DocumentXml
        $obj = $d.DocumentElement.ChildNodes | Where-Object { $_.NodeType -eq "Element" } | Select-Object -First 1
        $attrs = ($obj.Attributes | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join " "
        $kids = ($obj.ChildNodes | Where-Object { $_.NodeType -eq "Element" } | ForEach-Object { $_.Name }) -join ","
        Out "   DocumentXml: <$($obj.LocalName) $attrs> children [$kids]"
    } catch { Out "   DocumentXml: ! $($_.Exception.Message)" }
    Trace "  DeclarationText"
    try { $dt = $c.DeclarationText; Out ("   DeclarationText: " + (($dt -split "`n" | Where-Object { $_.Trim() } | Select-Object -First 3) -join " | ")) } catch { Out "   DeclarationText: !" }
    $file = ([xml]$x).TreeItem.VSProperties.VSProperty | Where-Object { $_.Name -eq "FullPath" } | ForEach-Object { $_.Value }
    if ($file -and (Test-Path $file)) {
        $f = [xml](Get-Content $file -Raw)
        $obj = $f.DocumentElement.ChildNodes | Where-Object { $_.NodeType -eq "Element" } | Select-Object -First 1
        $attrs = ($obj.Attributes | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join " "
        $decl = ($obj.Declaration.'#cdata-section' -split "`n" | Where-Object { $_.Trim() } | Select-Object -First 2) -join " | "
        Out "   file $([IO.Path]::GetFileName($file)) ($((Get-Item $file).LastWriteTime.ToString('HH:mm:ss'))): <$($obj.LocalName) $attrs>  decl: $decl"
    } else { Out "   file: (not on disk: $file)" }
    $leaf = if ($file) { [IO.Path]::GetFileName($file) } else { "" }
    Out "   Solution Explorer node: $(if ($script:nodes.ContainsKey($leaf)) { $script:nodes[$leaf] } else { '(none)' })"
}

function Dump([string]$title) {
    Out ""
    Out "==== $title  ($(Get-Date -Format 'HH:mm:ss'))"
    $script:nodes = [VoltRot]::Nodes($dte)
    $folder = Child $root "VltKind"
    if (-not $folder) { Out "   no VltKind folder"; return }
    for ($i = 1; $i -le $folder.ChildCount; $i++) { DumpItem $folder.Child($i) }
    $dutsFolder = Child $root "DUTs"
    if ($dutsFolder) { $e = Child $dutsFolder "E_PackML_Mode"; if ($e) { DumpItem $e } }   # an IDE-authored 605 as a control
    # The PLC project's language model (ITcPlcProjectInternal, an IUnknown interface - reflection, not dispatch).
    try {
        Add-Type -Path "C:\TwinCAT\3.1\Components\TcBlockDiagram\Common\TCatSysManagerLib.dll"
        $lm = [TCatSysManagerLib.ITcPlcProjectInternal].GetMethod("get_LanguageModel").Invoke($plc, $null)
        Out ""
        Out "   ITcPlcProjectInternal.LanguageModel: length $($lm.Length)$(if ($lm) { ': ' + $lm.Substring(0, [Math]::Min(400, $lm.Length)) })"
    } catch { Out "   LanguageModel: ! $($_.Exception.InnerException.Message)" }
}

function Tmc {
    $tmc = Get-ChildItem (Split-Path $dte.Solution.FullName) -Recurse -Filter *.tmc | Where-Object { $_.FullName -notlike "*_Libraries*" } | Select-Object -First 1
    Out ""
    Out "   TMC $($tmc.Name) ($($tmc.LastWriteTime.ToString('HH:mm:ss'))):"
    $s = Get-Content $tmc.FullName -Raw
    foreach ($m in [regex]::Matches($s, "<DataType>(.*?)</DataType>", "Singleline")) {
        $b = $m.Groups[1].Value
        $n = [regex]::Match($b, "<Name[^>]*>([^<]*)</Name>").Groups[1].Value
        if ($n -notlike "VltK_*" -and $n -ne "E_PackML_Mode") { continue }
        $base = [regex]::Match($b, "<BaseType[^>]*>([^<]*)</BaseType>").Groups[1].Value
        $enum = ([regex]::Matches($b, "<EnumInfo>")).Count
        $sub = [regex]::Matches($b, "<SubItem><Name>([^<]*)</Name>.*?<BitOffs>(\d+)</BitOffs>") | ForEach-Object { "$($_.Groups[1].Value)@$($_.Groups[2].Value)" }
        $bits = [regex]::Match($b, "^.*?<BitSize>(\d+)</BitSize>", "Singleline").Groups[1].Value
        $props = ([regex]::Matches($b, "<Property><Name>([^<]*)</Name>") | ForEach-Object { $_.Groups[1].Value }) -join ","
        Out "     $n  bits=$bits base='$base' enumInfo=$enum subItems=[$($sub -join ' ')] props=[$props]"
    }
}

function Errors {
    # Every Output pane, as TcObjectModel.GetBuildDiagnostics reads them (ToolWindows.ErrorList is null out of
    # process); only lines that name a probe item are kept.
    $output = $dte.Windows.Item("{34E76E81-EE4A-11D0-AE2E-00A0C90FFFC3}").Object
    for ($p = 1; $p -le $output.OutputWindowPanes.Count; $p++) {
        $pane = $output.OutputWindowPanes.Item($p)
        try { $td = $pane.TextDocument; $text = $td.StartPoint.CreateEditPoint().GetText($td.EndPoint) } catch { continue }
        $hits = @($text -split "`r?`n" | Where-Object { $_ -match "VltK_|E_PackML" -and $_ -match "error|warning" })
        if ($hits.Count) { Out "   pane '$($pane.Name)': $($hits.Count) line(s) naming a probe item"; $hits | Select-Object -Unique | ForEach-Object { Out "     $($_.Trim())" } }
    }
}

switch ($Phase) {
    "create" {
        Out "probe-tc-kind-source.ps1 - $(Get-Date -Format 'yyyy-MM-dd HH:mm') - $($dte.Solution.FullName)"
        
        $folder = Child $root "VltKind"
        if (-not $folder) { $folder = $root.CreateChild("VltKind", 601, "", $M) }
        foreach ($k in $DUTS.Keys) {
            $spec = $DUTS[$k]
            try { $c = $folder.CreateChild($k, $spec[0], "", $spec[1]) } catch { Out "create $k ($($spec[0])) ! $($_.Exception.Message)"; continue }
            $code0 = $c.ItemType
            try { $c.DeclarationText = ($DECL[$spec[2]] -f $k) } catch { Out "write $k ! $($_.Exception.Message)" }
            Out "created $k as $($spec[0]) (read back $code0), declaration '$($spec[2])' written -> ItemType now $($c.ItemType)"
        }
        foreach ($k in $POUS.Keys) {
            $spec = $POUS[$k]
            try { $c = $folder.CreateChild($k, $spec[0], "", $spec[1]) } catch { Out "create $k ($($spec[0])) ! $($_.Exception.Message)"; continue }
            try { $c.DeclarationText = $spec[2] } catch { Out "write $k ! $($_.Exception.Message)" }
            Out "created $k as $($spec[0]) -> ItemType now $($c.ItemType)"
        }
        # A text-list enumeration (658) - the TwinCAT twin of CODESYS's ITextListEnumerationObject, if CreateChild takes it.
        try { $c = $folder.CreateChild("VltK_TL", 658, "", $M); Out "created VltK_TL as 658 -> ItemType $($c.ItemType)" } catch { Out "create VltK_TL (658) ! $($_.Exception.Message)" }
        Dump "after create (live, unsaved)"
    }
    "dump" { Dump "dump" }
    "captions" {
        # The Solution Explorer nodes only - no ITcSmTreeItem is touched.
        Out ""
        Out "==== captions  ($(Get-Date -Format 'HH:mm:ss'))"
        $nodes = [VoltRot]::Nodes($dte)
        foreach ($k in ($nodes.Keys | Where-Object { $_ -like "VltK_*" } | Sort-Object)) { Out "   $k -> $($nodes[$k])" }
    }
    "lookup" {
        # One named item at a time through LookupChild (no index walk), each read announced to KIND_TRACE first.
        $folder = Child $root "VltKind"
        Out ""
        Out "==== lookup $($Names -join ',')  ($(Get-Date -Format 'HH:mm:ss'))"
        foreach ($n in ($Names -split ",")) {
            Trace "LookupChild($n)"; $c = $folder.LookupChild($n)
            Trace "$n.ItemType"; $t = $c.ItemType
            Trace "$n.DeclarationText"; $d = (($c.DeclarationText -split "`n" | Where-Object { $_.Trim() } | Select-Object -First 2) -join " | ")
            Out "   $n ItemType=$t ItemSubTypeName=$($c.ItemSubTypeName)  decl: $d"
        }
    }
    "walk" {
        # The minimum: Child(i), then Name and ItemType - to pin which read a crash belongs to.
        $folder = Child $root "VltKind"
        Out ""
        Out "==== walk  ($(Get-Date -Format 'HH:mm:ss')): VltKind has $($folder.ChildCount) children"
        for ($i = 1; $i -le $folder.ChildCount; $i++) {
            Trace "Child($i)"; $c = $folder.Child($i)
            Trace "Child($i).Name"; $n = $c.Name
            Trace "$n.ItemType"; Out "   $i $n $($c.ItemType)"
        }
    }
    "change" {
        $folder = Child $root "VltKind"
        foreach ($k in $CHANGE.Keys) {
            $c = Child $folder $k
            $c.DeclarationText = ($DECL[$CHANGE[$k]] -f $k)
            Out "in place: $k <- $($CHANGE[$k]) declaration (accepted), ItemType now $($c.ItemType)"
        }
        Dump "after in-place subtype change (live, unsaved)"
    }
    "build" {
        # The bridge's own build (TcObjectModel.Build): SolutionBuild.Build(true), synchronous. CompileProject on the
        # PLC node returned in 2 s with no error list and no TMC update - it is not the build the bridge runs.
        $sb = $dte.Solution.SolutionBuild
        $sb.Build($true)
        Out ""
        Out "==== SolutionBuild.Build(true): LastBuildInfo (failed projects) = $($sb.LastBuildInfo)  ($(Get-Date -Format 'HH:mm:ss'))"
        Errors
        Tmc
        Dump "after build"
    }
    "save" {
        $dte.ExecuteCommand("File.SaveAll")
        Dump "after File.SaveAll"
    }
    "reload" {
        $sln = $dte.Solution.FullName
        $dte.ExecuteCommand("File.SaveAll")
        $dte.Solution.Close($true)
        $dte.Solution.Open($sln)
        Start-Sleep -Seconds 20
        $sm = $dte.Solution.Projects.Item(1).Object
        $plc = $sm.LookupTreeItem("TIPC").Child(1)
        $root = $plc.NestedProject
        Dump "after SaveAll + Solution.Close + Solution.Open"
    }
}
