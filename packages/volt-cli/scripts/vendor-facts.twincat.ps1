# THE TWINCAT VENDOR CORE of the one vendor-fact probe (openspec vendor-fact-probe 2.2). `vendor-facts.ts` starts it
# once per run and drives it; never run by hand.
#
#   powershell -File scripts/vendor-facts.twincat.ps1 -XaePid <pid> -Instance vendor-fact-probe
#
# COM on the XAE behind this instance's pipe: the DTE is taken from the Running Object Table by that pid (never
# GetActiveObject - several XAE windows may be open), and refused unless its solution is this instance's fixture COPY.
# ONE PowerShell process for the session (a DTE lookup and an Add-Type per step would cost seconds each): one JSON
# request per stdin line, one answer per stdout line, marked `@@vf ` (anything else printed is log).
#
# It implements the table's closed vocabulary ONCE, the same interface as the CODESYS core (vendor-facts.codesys.py):
# the steps that are not a push (create, find, setText, rename, move, delete, reload, invoke, editor, tryNames) and the reads
# (member, class, guid, parent, children, xml, same, process, tried, and the completeness oracle's archive and objects). `build` and `diagnostics` are the runner's on
# TwinCAT (the bridge's own build: a DTE build out of process leaves every Output pane empty). No fact has a code path
# of its own here.
#
# A VENDOR exception during a step is its outcome (`refused: <its words>`); a probe fault is an error answer and the
# runner aborts naming it. A member that is not there reads null - on COM that IS the vendor's answer (DIALECT D35).
# Handles are kept by tree PATH and re-resolved on every use: a TwinCAT tree item is invalidated by a mutation under it.
#
# ASCII only.
param([Parameter(Mandatory)] [int]$XaePid, [Parameter(Mandatory)] [string]$Instance)
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Web.Extensions
Add-Type -AssemblyName Microsoft.VisualBasic
$JS = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$JS.MaxJsonLength = [int]::MaxValue
# PowerShell wraps what it puts in a collection in a PSObject, which the serializer walks into (a cycle): every value is
# made plain .NET before it is written.
Add-Type -TypeDefinition @"
using System; using System.Collections; using System.Collections.Generic; using System.Management.Automation;
public static class VoltFactsPlain {
  public static object Of(object v) {
    var ps = v as PSObject; if (ps != null) v = ps.BaseObject;
    if (v == null || v is string) return v;
    var d = v as IDictionary;
    if (d != null) { var o = new Dictionary<string, object>(); foreach (DictionaryEntry e in d) o[Convert.ToString(e.Key)] = Of(e.Value); return o; }
    var l = v as IList;
    if (l != null) { var o = new List<object>(); foreach (var x in l) o.Add(Of(x)); return o; }
    return v;
  }
}
"@
# In ASCII, every other character a \uXXXX escape: the console writes in the OEM code page, and a non-ASCII name (C28)
# must reach the runner as itself.
function Answer($o) {
    $s = [regex]::Replace($JS.Serialize([VoltFactsPlain]::Of($o)), '[^\x00-\x7e]', { param($m) '\u{0:x4}' -f [int][char]$m.Value })
    [Console]::Out.WriteLine("@@vf " + $s); [Console]::Out.Flush()
}

class ProbeError : System.Exception { ProbeError([string]$m) : base($m) {} }
function Fault([string]$m) { throw [ProbeError]::new($m) }

$vsIde = "C:\Program Files (x86)\Beckhoff\TcXaeShell\Common7\IDE\PublicAssemblies"
$vsRefs = @("$vsIde\Microsoft.VisualStudio.OLE.Interop.dll", "$vsIde\Microsoft.VisualStudio.Shell.Interop.dll")
try {
    foreach ($r in $vsRefs) { [Reflection.Assembly]::LoadFrom($r) | Out-Null }
    # The ROT lookup by this XAE's pid, and the Solution Explorer captions (file name -> caption) - the hierarchy walk
    # the deleted probe-tc-kind-source.ps1 measured C2h with.
    Add-Type -ReferencedAssemblies $vsRefs -TypeDefinition @"
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Runtime.InteropServices.ComTypes;
using Microsoft.VisualStudio.Shell.Interop;
public static class VoltFactsRot {
  [DllImport("ole32.dll")] static extern int GetRunningObjectTable(int r, out IRunningObjectTable t);
  [DllImport("ole32.dll")] static extern int CreateBindCtx(int r, out IBindCtx c);
  public static object Get(string name) {
    IRunningObjectTable rot; GetRunningObjectTable(0, out rot); IEnumMoniker e; rot.EnumRunning(out e);
    var m = new IMoniker[1];
    while (e.Next(1, m, IntPtr.Zero) == 0) { IBindCtx c; CreateBindCtx(0, out c); string n; m[0].GetDisplayName(c, null, out n);
      if (n == name) { object o; rot.GetObject(m[0], out o); return o; } }
    return null; }
  static string P(IVsHierarchy h, uint id, int prop) { object v; int hr = h.GetProperty(id, prop, out v); return hr == 0 ? (v == null ? null : v.ToString()) : null; }
  static uint U(object v) { return v is int ? unchecked((uint)(int)v) : Convert.ToUInt32(v); }
  public static Dictionary<string, string> Captions(object dte) {
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
    object v; if (h.GetProperty(id, -2041, out v) != 0 || v == null) return;
    uint c = U(v);
    while (c != 0xFFFFFFFF) {
      string canon; h.GetCanonicalName(c, out canon);
      if (!string.IsNullOrEmpty(canon) && canon.IndexOfAny(System.IO.Path.GetInvalidPathChars()) < 0) res[System.IO.Path.GetFileName(canon)] = P(h, c, -2003);
      IntPtr pn; uint nid; Guid ih = typeof(IVsHierarchy).GUID;
      if (h.GetNestedHierarchy(c, ref ih, out pn, out nid) == 0 && pn != IntPtr.Zero) {
        var nh = (IVsHierarchy)Marshal.GetObjectForIUnknown(pn); Marshal.Release(pn); Walk(nh, nid, depth + 1, res);
      } else Walk(h, c, depth + 1, res);
      object nx; if (h.GetProperty(c, -2042, out nx) != 0 || nx == null) break;
      c = U(nx);
    } }
}
"@
    # The shipped bridge's COM message filter (Volt.Ide.Twincat ComMessageFilter, KB201600): a call the busy XAE rejects
    # with RPC_E_CALL_REJECTED is retried, not answered as an exception. Without it a DeleteChild in the middle of
    # `refused-names` failed once with "Aanroep geweigerd door aangeroepene" (measured 2026-10-11) - and a rejected
    # CreateChild would have been recorded as the NAME's refusal. Registered on this STA thread, which makes every call.
    Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class VoltFactsFilter {
  [ComImport, Guid("00000016-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMessageFilter {
    [PreserveSig] int HandleInComingCall(int t, IntPtr c, int k, IntPtr i);
    [PreserveSig] int RetryRejectedCall(IntPtr c, int k, int rejectType);
    [PreserveSig] int MessagePending(IntPtr c, int k, int p); }
  class Filter : IMessageFilter {
    public int HandleInComingCall(int t, IntPtr c, int k, IntPtr i) { return 0; }
    public int RetryRejectedCall(IntPtr c, int k, int rejectType) { return rejectType == 2 ? 100 : -1; }
    public int MessagePending(IntPtr c, int k, int p) { return 2; } }
  [DllImport("ole32.dll")] static extern int CoRegisterMessageFilter(IMessageFilter f, out IMessageFilter old);
  public static int Register() { IMessageFilter old; return CoRegisterMessageFilter(new Filter(), out old); }
}
"@
    if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne "STA") { throw "the TwinCAT core needs an STA thread for its COM message filter" }
    $hr = [VoltFactsFilter]::Register()
    if ($hr -ne 0) { throw "CoRegisterMessageFilter answered 0x$('{0:X8}' -f $hr)" }
    $script:dte = [VoltFactsRot]::Get("!TcXaeShell.DTE.15.0:$XaePid")
    if (-not $script:dte) { throw "XAE $XaePid has no DTE in the ROT" }
    if ($script:dte.Solution.FullName -notlike "*volt-ide-twincat-$Instance*") { throw "XAE $XaePid is not on the $Instance fixture copy: $($script:dte.Solution.FullName)" }
} catch {
    Answer @{ error = "the TwinCAT core could not attach: $($_.Exception.Message)" }
    exit 1
}
$M = [Type]::Missing

# ---- the tree --------------------------------------------------------------------------------------------------------

# The system manager. TcXaeShell answers null for it now and then between two COM calls with nothing reloading (measured
# 2026-10-11: once mid-way through 1494 creates, `You cannot call a method on a null-valued expression`), the way it does
# for a moment after a reload. The wait is the probe's own, never an outcome: it is printed, and past 30 s it is a fault.
function Sm {
    $t0 = Get-Date
    while ($true) {
        $o = $null
        try { $o = $script:dte.Solution.Projects.Item(1).Object } catch {}
        if ($null -ne $o) {
            $ms = [int]((Get-Date) - $t0).TotalMilliseconds
            if ($ms -gt 0 -and $script:SmWaited) { [Console]::Out.WriteLine("waited $ms ms for the system manager"); $script:SmWaited = $false }
            return ,$o
        }
        $script:SmWaited = $true
        if (((Get-Date) - $t0).TotalSeconds -gt 30) { Fault "the solution's system manager stayed null for 30 s" }
        Start-Sleep -Milliseconds 200
    }
}
function PlcItem { return ,(Sm).LookupTreeItem("TIPC").Child(1) }
function Root { return ,(PlcItem).NestedProject }
function Single($x) { if ($x -is [object[]]) { return ,$x[0] } return ,$x }

$script:H = @{}          # handle -> @{ path; created; kind }
$script:Order = New-Object System.Collections.ArrayList
$script:Cache = @{}
$script:Reloaded = $false

function Resolve([string]$handle) {
    if ($handle -eq "root") { return ,(Root) }
    if ($handle.StartsWith("tree:")) { return ,(Sm).LookupTreeItem($handle.Substring(5)) }
    $h = $script:H[$handle]
    if (-not $h) { Fault "no handle '$handle' in this row" }
    try { return ,(Sm).LookupTreeItem($h.path) } catch { Fault "handle '$handle' ($($h.path)) is not in the tree: $($_.Exception.Message)" }
}

function Keep([string]$handle, $item, [string]$created, [string]$kind) {
    $script:H[$handle] = @{ path = [string](Single $item).PathName; created = $created; kind = $kind }
    [void]$script:Order.Add($handle)
}

function Walk($node, [int]$depth) {
    $out = New-Object System.Collections.ArrayList
    if ($depth -gt 20) { return ,$out }
    for ($i = 1; $i -le $node.ChildCount; $i++) {
        $c = $node.Child($i); [void]$out.Add($c)
        foreach ($d in (Walk $c ($depth + 1))) { [void]$out.Add($d) }
    }
    return ,$out
}

function FindItem([string]$name, $under) {
    $base = if ($under) { Resolve $under } else { Root }
    $hits = @((Walk (Single $base) 0) | Where-Object { $_.Name -eq $name })
    if ($hits.Count -gt 1) {
        # A task's call entry (650) shares its program's name; the object itself is the one asked for (as on CODESYS).
        $objects = @($hits | Where-Object { $_.ItemType -ne 650 })
        if ($objects.Count -gt 0) { $hits = $objects }
    }
    if ($hits.Count -ne 1) { Fault "find '$name'$(if ($under) { " under $under" }): $($hits.Count) items have that name" }
    return ,$hits[0]
}

$CODES = @{ folder = 601; program = 602; function = 603; function_block = 604; gvl = 615; interface = 618; method = 609
            property = 611; action = 608; task_plc = 621; task_system = 1 }
$DUTS = @{ struct = 606; enum = 605; union = 607; alias = 623 }

# The tree code and vInfo of one create: the driver's (TcObjectModel.CreateChild) - none for a FUNCTION, a task item
# or a system task, null for an interface, the TYPE for an interface's method or property (610/612), the body
# language otherwise.
function CodeOf($step, [string]$parentKind) {
    $kind = $step["kind"]
    if ($kind -eq "dut") {
        $seed = if ($step["seed"]) { $step["seed"] } else { "struct" }
        if (-not $DUTS.ContainsKey($seed)) { Fault "unknown DUT seed '$seed'" }
        $vInfo = if ($seed -eq "alias") { "INT" } else { $M }      # 623 takes the alias's BASE type as vInfo
        return @($DUTS[$seed], $vInfo)
    }
    if ($parentKind -eq "interface" -and $kind -eq "method") { return @(610, "INT") }
    if ($parentKind -eq "interface" -and $kind -eq "property") { return @(612, "INT") }
    if (-not $CODES.ContainsKey($kind)) { Fault "TwinCAT has no create for kind '$kind'" }
    $lang = if ($step["language"]) { [string]$step["language"] } else { "ST" }
    $vInfo = switch ($kind) { "function" { $M } "task_plc" { $M } "task_system" { $M } "interface" { $null } default { $lang } }
    # A property's vInfo is its TYPE to TwinCAT: a step that names one passes it (else the driver's language, as above).
    if ($kind -eq "property" -and $step["dataType"]) { $vInfo = [string]$step["dataType"] }
    return @($CODES[$kind], $vInfo)
}

function KindOf([string]$handle) { if ($script:H.ContainsKey($handle)) { return [string]$script:H[$handle].kind } return "" }

function CreateItem($step) {
    $parent = Single (Resolve $step["parent"])
    $kind = $step["kind"]; $name = $step["name"]
    $code, $vInfo = CodeOf $step (KindOf $step["parent"])
    $made = Single ($parent.CreateChild($name, $code, "", $vInfo))
    Keep $step["as"] $made "script" $kind
    # The text goes to the item CreateChild handed back, never to a re-resolve by path: a POU beside a same-named
    # folder (D34's folder-first cell) has the folder's PathName, and LookupTreeItem answers the folder.
    if ($null -ne $step["decl"]) { $made.DeclarationText = $step["decl"] }
    if ($null -ne $step["impl"]) { $made.ImplementationText = $step["impl"] }
}

# ---- paths -----------------------------------------------------------------------------------------------------------

function SplitPath([string]$path) {
    $out = New-Object System.Collections.ArrayList; $cur = ""; $depth = 0; $quote = $false
    foreach ($ch in $path.ToCharArray()) {
        if ($ch -eq '"') { $quote = -not $quote }
        if (-not $quote -and $ch -eq '(') { $depth++ }
        if (-not $quote -and $ch -eq ')') { $depth-- }
        if ($ch -eq '.' -and $depth -eq 0 -and -not $quote) { [void]$out.Add($cur); $cur = "" } else { $cur += $ch }
    }
    [void]$out.Add($cur)
    return ,$out
}

function FileOf($item) {
    $x = [xml]$item.ProduceXml()
    $file = ($x.TreeItem.VSProperties.VSProperty | Where-Object { $_.Name -eq "FullPath" }).Value
    return $file
}

# The file an item is stored in. Its own FullPath when it publishes one; a task item (621) publishes none, so its file is
# the one entry of the PLC project's .plcproj whose leaf name is the item's (`<Compile Include="PlcTask.TcTTO">`). Any
# other count is refused by name - never a guessed path.
function BackingFile($item) {
    $file = FileOf $item
    if ($file) { return $file }
    $plc = [string](PlcItem).Name
    $dir = Split-Path -Parent $script:dte.Solution.FullName
    $projs = @(Get-ChildItem -Path $dir -Recurse -Filter "$plc.plcproj" -File)
    if ($projs.Count -ne 1) { Fault "$($item.Name) publishes no FullPath, and $($projs.Count) files under $dir are named $plc.plcproj" }
    $doc = [xml](Get-Content -Raw -Encoding UTF8 $projs[0].FullName)
    $hits = @($doc.SelectNodes("//*[local-name()='Compile']") | ForEach-Object { $_.GetAttribute("Include") } |
        Where-Object { [IO.Path]::GetFileNameWithoutExtension($_) -eq [string]$item.Name })
    if ($hits.Count -ne 1) { Fault "$($item.Name) publishes no FullPath, and $($hits.Count) Compile entries of $($projs[0].Name) carry its name" }
    return (Join-Path $projs[0].DirectoryName $hits[0])
}

# A path's value travels in $script:R, never down the pipeline: PowerShell unrolls whatever a function emits, and a
# TwinCAT tree item is itself enumerable (over its children), so an emitted item arrives as its children.
function RootOf([string]$head, $on) {
    if ($head -eq "item") { if (-not $on) { Fault "path root 'item' needs a subject (on)" }; $script:R = Single (Resolve $on); return }
    if ($head.StartsWith("tree:")) { $script:R = Single ((Sm).LookupTreeItem($head.Substring(5))); return }
    if ($head -eq "plc") { $script:R = Single (PlcItem); return }
    if ($head -eq "root") { $script:R = Single (Root); return }
    if ($head -eq "dte") { $script:R = $script:dte; return }
    if ($head -match '^project:(\d+)$') { $script:R = $script:dte.Solution.Projects.Item([int]$Matches[1]); return }
    if ($head -eq "caption") {
        if (-not $on) { Fault "path root 'caption' needs a subject (on)" }
        $file = FileOf (Single (Resolve $on))
        $caps = [VoltFactsRot]::Captions($script:dte)
        $leaf = if ($file) { [IO.Path]::GetFileName($file) } else { "" }
        $script:R = if ($caps.ContainsKey($leaf)) { $caps[$leaf] } else { $null }
        return
    }
    Fault "unknown path root '$head' (item, tree:<path>, plc, root, dte, project:<n>, caption)"
}

function Why($e) {
    while ($e.InnerException) { $e = $e.InnerException }
    $msg = ([string]$e.Message).Replace("`r`n", "`n").Trim()
    # A refused import quotes the move's archive path, which lives under this account's TEMP: the snapshot holds the
    # token, so the fact reads the same on every machine and account.
    if ($script:MoveArchive) { $msg = $msg.Replace($script:MoveArchive, "<archive>") }
    # A refusal on disk quotes the file's path, under this instance's fixture copy: the token likewise.
    $sln = Split-Path -Parent ([string]$script:dte.Solution.FullName)
    if ($sln) { $msg = $msg.Replace($sln, "<solution>") }
    return "$($e.GetType().Name): $msg"
}

# A call through PowerShell's COM adapter, else late-bound by name; a member that is not there is null (D35).
function CallMember($target, [string]$name, [object[]]$argv) {
    $m = $target.PSObject.Methods[$name]
    if ($m) { $script:R = $m.Invoke($argv); return }
    try { $script:R = [Microsoft.VisualBasic.Interaction]::CallByName($target, $name, [Microsoft.VisualBasic.CallType]::Method, $argv) }
    catch [System.MissingMemberException] { $script:R = $null }
}

function Seg($v, [string]$seg) {
    if ($seg.StartsWith('$')) {
        switch -regex ($seg) {
            '^\$type$' { $script:R = $v.GetType().FullName; return }
            '^\$count$' { $script:R = @($v).Count; return }
            '^\$extension$' { $script:R = [IO.Path]::GetExtension([string]$v); return }
            # The element names of an XML string, in document order - its skeleton without the attribute values.
            '^\$xmlElements$' { $script:R = [string[]]@(([xml][string]$v).SelectNodes("//*") | ForEach-Object { $_.LocalName }); return }
            '^\$interfaces$' { $script:R = [string[]]@($v.GetType().GetInterfaces() | ForEach-Object { $_.Name } | Sort-Object -Unique); return }
            default { Fault "unknown path segment '$seg' on TwinCAT" }
        }
    }
    $index = $null
    if ($seg -match '^(.*)\[(\d+)\]$') { $seg = $Matches[1]; $index = [int]$Matches[2] }
    if ($seg -match '^([^(]*)\((.*)\)$') {
        $argv = if ($Matches[2].Trim()) { [object[]]$JS.DeserializeObject("[" + $Matches[2] + "]") } else { [object[]]@() }
        CallMember $v $Matches[1] $argv
    } else {
        $script:R = $v.$seg
    }
    if ($null -ne $index -and $null -ne $script:R) { $script:R = @($script:R)[$index] }
}

function EvalPath([string]$path, $on) {
    $segs = SplitPath $path
    RootOf $segs[0] $on
    for ($i = 1; $i -lt $segs.Count; $i++) {
        $v = $script:R
        if ($null -eq $v) { return }
        try { Seg $v $segs[$i] }
        catch [ProbeError] { throw }
        catch { $script:R = @{ raised = (Why $_.Exception) }; return }
    }
}

# The JSON form of a value, in $script:RV. A vendor object that is not a collection renders as its type name. A value
# that would not render WHOLE is a probe fault, never a cut: a collection of more than $MaxItems items (read `$count`
# or a narrower path), or one nested deeper than two levels.
$MaxItems = 500
function Render($v, [int]$depth = 0) {
    if ($null -eq $v -or $v -is [hashtable] -or $v -is [bool] -or $v -is [string]) { $script:RV = $v; return }
    if ($v -is [int] -or $v -is [long] -or $v -is [double] -or $v -is [single] -or $v -is [decimal] -or $v -is [int16] -or $v -is [byte] -or $v -is [uint32] -or $v -is [uint16]) { $script:RV = $v; return }
    if ($v -is [enum] -or $v -is [guid]) { $script:RV = [string]$v; return }
    if ($v -is [System.Collections.IEnumerable]) {
        if ($depth -ge 2) { Fault "a $($v.GetType().FullName) collection nested deeper than two levels does not render whole: read a narrower path" }
        $list = New-Object System.Collections.ArrayList
        foreach ($x in $v) {
            if ($list.Count -ge $MaxItems) { Fault "a $($v.GetType().FullName) of more than $MaxItems items does not render whole: read `$count or a narrower path" }
            Render $x ($depth + 1); [void]$list.Add($script:RV)
        }
        $script:RV = $list
        return
    }
    $script:RV = "<$($v.GetType().FullName)>"
}

function ArgValue($a) {
    if ($a -is [System.Collections.IDictionary]) { Fault "TwinCAT takes no enum or callback argument" }
    return $a
}

# ---- steps -----------------------------------------------------------------------------------------------------------

function Invoke-Step($step) {
    $segs = SplitPath $step["path"]
    if ($segs.Count -lt 2) { Fault "invoke $($step["path"]): a path names an owner and a member" }
    $ownerPath = ($segs[0..($segs.Count - 2)]) -join "."
    $last = $segs[$segs.Count - 1]
    EvalPath $ownerPath $step["on"]
    $owner = $script:R
    if ($null -eq $owner -or $owner -is [hashtable]) { Fault "invoke $($step["path"]): '$ownerPath' reads nothing" }
    if ($step.ContainsKey("set")) { $owner.$last = ArgValue $step["set"]; return }
    $argv = New-Object System.Collections.ArrayList
    if ($step["args"]) { foreach ($a in $step["args"]) { [void]$argv.Add((ArgValue $a)) } }
    CallMember $owner $last ([object[]]$argv.ToArray())
}

# A reload is the probe's own act, not a question to the vendor: a failure in it is a probe fault (the run aborts naming
# where), never a `refused:` outcome. One live run (2026-10-11) recorded `reload: refused: RuntimeException: You cannot
# call a method on a null-valued expression.` and the next four reloaded clean.
function Reload {
    try { Reload-Solution } catch [ProbeError] { throw } catch { Fault "reload failed: $(Why $_.Exception)`n$($_.ScriptStackTrace)" }
}

function Reload-Solution {
    $sln = $script:dte.Solution.FullName
    $script:dte.ExecuteCommand("File.SaveAll")
    $script:dte.Solution.Close($true)
    $script:dte.Solution.Open($sln)
    # Reopened = the PLC project's root resolves on two polls in a row. One poll was not enough: the system manager
    # answers once and then goes null again for a moment while the PLC project loads (a live run read null right after
    # the wait had broken on a non-null answer).
    $until = (Get-Date).AddSeconds(240); $streak = 0
    while ((Get-Date) -lt $until -and $streak -lt 2) {
        Start-Sleep -Milliseconds 500
        $ok = $false
        # Asked directly, not through Sm (which waits out a null): here a null is the answer "not yet".
        try { $ok = $script:dte.Solution.Projects.Count -ge 1 -and $null -ne $script:dte.Solution.Projects.Item(1).Object.LookupTreeItem("TIPC").Child(1).NestedProject } catch {}
        $streak = if ($ok) { $streak + 1 } else { 0 }
    }
    if ($streak -lt 2) { Fault "the solution did not reopen within 240 s" }
    $script:Reloaded = $true
}

# Each name alone: CreateChild under the parent (re-resolved every time: a TwinCAT tree item is invalidated by a mutation
# under it), the name read back, DeleteChild. A vendor exception is the NAME's verdict; a failed delete is a probe fault
# (it would leave the name taken for the next one).
$script:Tried = New-Object System.Collections.ArrayList
function TryNames($step) {
    $script:Tried = New-Object System.Collections.ArrayList
    $code, $vInfo = CodeOf $step (KindOf $step["parent"])
    foreach ($name in $step["names"]) {
        $parent = Single (Resolve $step["parent"])
        try { $made = Single ($parent.CreateChild([string]$name, $code, "", $vInfo)); $got = [string]$made.Name }
        catch [ProbeError] { throw }
        catch { $why = "refused: " + (Why $_.Exception); [void]$script:Tried.Add(@([string]$name, $why)); continue }
        $verdict = if ($got -ceq $name) { "created" } else { "created as $got" }
        [void]$script:Tried.Add(@([string]$name, $verdict))
        try { (Single (Resolve $step["parent"])).DeleteChild($got) }
        catch { Fault "tryNames: '$got' was created and could not be deleted: $(Why $_.Exception)" }
    }
}

# Whether an outcome is TwinCAT's refusal of the NAME - its own sentence for exactly that name, the one every reserved
# word and every non-identifier shape answered (vendor-facts.twincat.json, identifier-shapes). A SubType mismatch (the
# kind), a rejected or failed COM call, a timeout: no verdict on the name.
function NameRefusal([string]$name, [string]$outcome) {
    return $outcome.StartsWith("refused: ") -and $outcome.Contains("Creating the child named '$name' is not possible on node (Name mismatch)")
}

function Tried([string]$what) {
    $sorted = { param($xs) $l = New-Object System.Collections.Generic.List[string]; foreach ($x in $xs) { $l.Add([string]$x) }; $l.Sort([StringComparer]::Ordinal); ,$l }
    switch ($what) {
        "outcomes" { $o = @{}; foreach ($t in $script:Tried) { $o[$t[0]] = $t[1] }; return $o }
        "verdicts" {
            return @{
                accepted = & $sorted @($script:Tried | Where-Object { $_[1] -eq "created" } | ForEach-Object { $_[0] })
                refused = & $sorted @($script:Tried | Where-Object { NameRefusal $_[0] $_[1] } | ForEach-Object { $_[0] })
                other = & $sorted @($script:Tried | Where-Object { $_[1].StartsWith("created as ") } | ForEach-Object { "$($_[0]) -> $($_[1].Substring(11))" })
                unexplained = & $sorted @($script:Tried | Where-Object { $_[1].StartsWith("refused: ") -and -not (NameRefusal $_[0] $_[1]) } | ForEach-Object { "$($_[0]): $($_[1].Substring(9))" })
            }
        }
        default { Fault "unknown tried read '$what'" }
    }
}

# TwinCAT's one move, the archive round trip Volt's driver makes (D4f, TcItemArchive.RoundTrip): ExportChild from the
# parent, the archive's entry paths flattened, DeleteChild, ImportChild into the target. No undo - what the vendor did
# with a refused import is what the row reads.
function MoveItem($step) {
    $item = Single (Resolve $step["on"]); $from = Single $item.Parent; $name = [string]$item.Name
    # A refused import quotes the archive path; `Why` writes it as `<archive>` (the path is this account's TEMP).
    $zip = Join-Path $env:TEMP "volt-vendor-facts-move.zip"
    $script:MoveArchive = $zip
    Remove-Item $zip, "$zip.flat" -ErrorAction SilentlyContinue
    try {
        $from.ExportChild($name, $zip)
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $flat = "$zip.flat"
        $src = [System.IO.Compression.ZipFile]::OpenRead($zip)
        $dst = [System.IO.Compression.ZipFile]::Open($flat, "Create")
        foreach ($e in $src.Entries) {
            $c = $dst.CreateEntry(($e.FullName -split '[\\/]')[-1]); $i = $e.Open(); $o = $c.Open(); $i.CopyTo($o); $o.Dispose(); $i.Dispose()
        }
        $dst.Dispose(); $src.Dispose(); Remove-Item $zip; Move-Item $flat $zip
        $from.DeleteChild($name)
        $target = Single (Resolve $step["to"])
        $target.ImportChild($zip, "", $false, "")
        $script:H[$step["on"]].path = "$([string]$target.PathName)^$name"
    } finally { Remove-Item $zip -ErrorAction SilentlyContinue }
}

# The object's own editor opened in XAE and closed again, saving (ld-fbd-coverage 2R.1, C1): the backing file's DTE
# ProjectItem opened in its primary view, the window given time to load, then closed with vsSaveChangesYes. A file
# the solution does not hold, or a window the shell does not open, is a probe fault, never an outcome.
function Open-Editor($step) {
    $item = Single (Resolve $step["on"])
    $path = BackingFile $item
    $pi = $script:dte.Solution.FindProjectItem($path)
    if ($null -eq $pi) { Fault "the solution holds no project item for $path" }
    $win = $pi.Open("{00000000-0000-0000-0000-000000000000}")
    if ($null -eq $win) { Fault "$path opened no window" }
    $win.Activate()
    Start-Sleep -Seconds 3
    $win.Close(1)
    Start-Sleep -Seconds 1
}

function Do-Step($step) {
    switch ($step["op"]) {
        "create" { if ($step["via"] -ne "script") { Fault "a push create is the runner's, not the core's" }; CreateItem $step }
        "find" { Keep $step["as"] (FindItem $step["name"] $step["under"]) "found" "" }
        "setText" {
            $item = Single (Resolve $step["on"])
            if ($null -ne $step["decl"]) { $item.DeclarationText = $step["decl"] }
            if ($null -ne $step["impl"]) { $item.ImplementationText = $step["impl"] }
            if ($null -ne $step["appendImpl"]) { $item.ImplementationText = $item.ImplementationText + $step["appendImpl"] }
            if ($null -ne $step["implFrom"]) { $item.ImplementationText = [string](Single (Resolve $step["implFrom"])).ImplementationText }
        }
        "tryNames" { if ($step["via"] -ne "script") { Fault "tryNames is script-only" }; TryNames $step }
        "move" { if ($step["via"] -ne "script") { Fault "a push move is the runner's, not the core's" }; MoveItem $step }
        "rename" {
            $item = Single (Resolve $step["on"]); $item.Name = $step["to"]
            $script:H[$step["on"]].path = [string](Single $item).PathName
        }
        "delete" {
            $item = Single (Resolve $step["on"]); $parent = Single $item.Parent
            $parent.DeleteChild($item.Name)
        }
        "reload" { Reload }
        "invoke" { Invoke-Step $step }
        "editor" { Open-Editor $step }
        default { Fault "TwinCAT has no step '$($step["op"])' (open/close have no TwinCAT row; build is the runner's)" }
    }
}

# ---- reads -----------------------------------------------------------------------------------------------------------

# The nodes an XPath selects in the item's ProduceXml: none = null, one = its text (an element with element children
# reads `<name>`), several = `name=text` each. In $script:RV.
function XmlRead($item, [string]$xpath, $file) {
    if ($file) {
        $path = BackingFile $item
        if (-not $path -or -not (Test-Path $path)) { Fault "$($item.Name) has no backing file to read ($path)" }
        $x = [xml](Get-Content -Raw -Encoding UTF8 $path)
    } else { $x = [xml]$item.ProduceXml() }
    $nodes = @($x.SelectNodes($xpath))
    # An attribute reads its Value: PowerShell's XML adapter answers an XmlAttribute's InnerText empty (measured
    # 2026-10-13, openspec bridge-one-to-one 1.3 - `@SpecialFunc` read "" where the file says "None").
    $text = { param($n) if ($n -is [System.Xml.XmlAttribute]) { $n.Value } elseif (@($n.ChildNodes | Where-Object { $_.NodeType -eq "Element" }).Count -gt 0) { "<$($n.LocalName)>" } else { $n.InnerText } }
    if ($nodes.Count -eq 0) { $script:RV = $null; return }
    if ($nodes.Count -eq 1) { $script:RV = [string](& $text $nodes[0]); return }
    $list = New-Object System.Collections.ArrayList
    foreach ($n in $nodes) { [void]$list.Add("$($n.LocalName)=$(& $text $n)") }
    $script:RV = $list
}

# ---- the NWL body (openspec ld-fbd-coverage 2.2: the probe-table rows) ----
# The subject's graphical body as its backing file archives it - the `<XmlArchive><Data>` object graph under `<NWL>` -
# flattened to the member paths the CODESYS core reads off the live archive (`NetworkList[0].NetworkItems[1].RValue.
# Flags.Fixed`; DIALECT N1: one model): an object `<its class>` then its members, a list `#count` and `[i]`, a null
# `null`, a scalar its value - a quoted string unquoted, `true`/`false` a boolean, an Int64 (`11L`) or an Int32 a
# number, anything else (an enum member, a parameter type) its text. Into $script:RV; the runner filters.
function NwlScalar([string]$t) {
    if ($t.Length -ge 2 -and $t.StartsWith('"') -and $t.EndsWith('"')) { return $t.Substring(1, $t.Length - 2) }
    if ($t -ceq "true") { return $true }
    if ($t -ceq "false") { return $false }
    if ($t -match '^-?\d+L?$') { return [long]$t.TrimEnd('L') }
    return $t
}

function NwlFlat($el, [string]$path, $out) {
    foreach ($c in $el.ChildNodes) {
        if ($c.NodeType -ne "Element") { continue }
        $p = if ($path) { "$path.$($c.GetAttribute('n'))" } else { $c.GetAttribute("n") }
        NwlNode $c $p "" $out
    }
}

# One archive element at `$p`: `cet` is its list's element class (a list item names none of its own).
function NwlNode($c, [string]$p, [string]$cet, $out) {
    switch ($c.LocalName) {
        "v" { $out[$p] = NwlScalar $c.InnerText }
        "n" { $out[$p] = $null }
        "o" {
            $t = $c.GetAttribute("t"); if (-not $t) { $t = $cet }
            $out[$p] = "<$t>"
            NwlFlat $c $p $out
        }
        { $_ -in @("l", "l2", "a") } {
            $items = @($c.ChildNodes | Where-Object { $_.NodeType -eq "Element" })
            $out[$p] = "<$($c.LocalName)>"
            $out["$p#count"] = $items.Count
            for ($i = 0; $i -lt $items.Count; $i++) { NwlNode $items[$i] "$p[$i]" $c.GetAttribute("cet") $out }
        }
        default { Fault "nwl: an archive element <$($c.LocalName)> at '$p' this read has no form for" }
    }
}

function NwlRead($item) {
    # What the IDE holds in memory reaches the file on save (as ArchiveRead): without it a read after a build is what
    # the disk held BEFORE it, so @built/@rebuilt would not observe the build at all (gate 2-2).
    $script:dte.ExecuteCommand("File.SaveAll")
    $path = BackingFile $item
    if (-not $path -or -not (Test-Path $path)) { Fault "$($item.Name) has no backing file to read ($path)" }
    $x = [xml](Get-Content -Raw -Encoding UTF8 $path)
    $root = $x.SelectSingleNode("//NWL/XmlArchive/Data/o")
    if (-not $root) { Fault "nwl: $($item.Name) holds no NWL body" }
    $out = [ordered]@{}
    NwlFlat $root "" $out
    $script:RV = $out
}

# ---- the archive (openspec bridge-one-to-one 2.1: the completeness oracle) ----
# The vendor's OWN archive of an item - the FILE TwinCAT stores it in (its backing .TcPOU/.TcDUT/.TcGVL/.TcIO/.TcTTO,
# every element and attribute) and its `.plcproj` `<Compile>` entry - the 0.1 census walk made permanent. Paths in the
# census notation: `TcPlcObject/POU/@SpecialFunc`, `TcPlcObject/POU/Declaration#text`; an element with a `Name`
# attribute is `Method[Run]`, a repeated unnamed sibling `LineId[2]`; a graphical implementation (anything but ST under
# `Implementation`) is its element alone (ld-fbd-coverage's); an `ObjectProperties` carrier its element and the SHA-1 of
# its inner XML. `$class` is `<extension>.<object element>` (`TcPOU.POU`). Into $script:RV, keyed "" (one file holds the
# item and its members).
#
# BYTE FIDELITY of the stored text (review fix, gate step 2): the file is parsed WITHOUT end-of-line normalization
# (`[xml]` turns every CRLF of a text and a CDATA into LF, so a push that rewrote a CRLF body as LF compared equal), and
# the framing `[xml]` drops is read as members of its own: `$file#bom`, `$file#declaration` (encoding included) and
# `$file#comments`. A `#text` is the element's Text / CDATA / significant-whitespace nodes, verbatim - the formatting
# whitespace between elements is no content.
function Sha1([string]$s) {
    $h = [Security.Cryptography.SHA1]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($s))
    return -join ($h | ForEach-Object { $_.ToString("x2") })
}

function TextOf($el) {
    $sb = New-Object System.Text.StringBuilder
    foreach ($n in $el.ChildNodes) {
        if ($n.NodeType -eq "Text" -or $n.NodeType -eq "CDATA" -or $n.NodeType -eq "SignificantWhitespace") {
            [void]$sb.Append($n.Value)
        }
    }
    return $sb.ToString()
}

# A file as the vendor stored it: UTF-8 only (any other declared encoding is refused by name), invalid bytes refused,
# no end-of-line normalization, whitespace kept. Answers the document and its BOM.
function ReadXmlExact([string]$path) {
    $bytes = [IO.File]::ReadAllBytes($path)
    $bom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
    $skip = $(if ($bom) { 3 } else { 0 })
    try { $text = (New-Object System.Text.UTF8Encoding($false, $true)).GetString($bytes, $skip, $bytes.Length - $skip) }
    catch { Fault "$([IO.Path]::GetFileName($path)) is not UTF-8: $($_.Exception.Message)" }
    $r = New-Object System.Xml.XmlTextReader (New-Object System.IO.StringReader $text)
    $r.Normalization = $false
    $r.WhitespaceHandling = [System.Xml.WhitespaceHandling]::All
    $r.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
    $doc = New-Object System.Xml.XmlDocument
    $doc.PreserveWhitespace = $true
    try { $doc.Load($r) } finally { $r.Close() }
    $decl = $doc.ChildNodes | Where-Object { $_.NodeType -eq "XmlDeclaration" } | Select-Object -First 1
    if ($decl -and $decl.Encoding -and $decl.Encoding -notmatch '^(?i)utf-8$') {
        Fault "$([IO.Path]::GetFileName($path)) declares encoding '$($decl.Encoding)': only UTF-8 is read"
    }
    return @{ doc = $doc; bom = $bom; declaration = $(if ($decl) { $decl.OuterXml } else { $null }) }
}

function FlatXml($el, [string]$path, $out) {
    $out[$path] = "(element)"
    foreach ($a in $el.Attributes) { $out["$path/@$($a.Name)"] = [string]$a.Value }
    $kids = @($el.ChildNodes | Where-Object { $_.NodeType -eq "Element" })
    if ($kids.Count -eq 0) { $out["$path#text"] = TextOf $el; return }
    if ($el.LocalName -eq "ObjectProperties") { $out["$path#xml"] = Sha1 $el.InnerXml; return }
    $isImpl = $el.LocalName -eq "Implementation"
    $count = @{}
    foreach ($k in $kids) { $count[$k.LocalName] = 1 + [int]$count[$k.LocalName] }
    $seen = @{}
    foreach ($k in $kids) {
        $seg = $k.LocalName
        $nm = $k.GetAttribute("Name")
        if ($nm) { $seg = "$seg[$nm]" }
        elseif ($count[$k.LocalName] -gt 1) { $i = [int]$seen[$k.LocalName]; $seen[$k.LocalName] = $i + 1; $seg = "$seg[$i]" }
        if ($isImpl -and $k.LocalName -ne "ST") { $out["$path/$seg"] = "(element)"; continue }
        FlatXml $k "$path/$seg" $out
    }
}

function PlcProjFile {
    $plc = [string](PlcItem).Name
    $dir = Split-Path -Parent $script:dte.Solution.FullName
    $projs = @(Get-ChildItem -Path $dir -Recurse -Filter "$plc.plcproj" -File)
    if ($projs.Count -ne 1) { Fault "$($projs.Count) files under $dir are named $plc.plcproj" }
    return $projs[0]
}

function ArchiveRead($item) {
    # What the IDE holds in memory reaches the file on save; the push writes through the IDE.
    $script:dte.ExecuteCommand("File.SaveAll")
    $file = BackingFile $item
    if (-not $file -or -not (Test-Path $file)) { Fault "$($item.Name) has no backing file to read ($file)" }
    $exact = ReadXmlExact $file
    $doc = $exact.doc
    $out = New-Object 'System.Collections.Generic.Dictionary[string,object]'
    $out['$file#bom'] = [bool]$exact.bom
    $out['$file#declaration'] = $exact.declaration
    $out['$file#comments'] = [string[]]@($doc.SelectNodes("//comment()") | ForEach-Object { $_.Value })
    $root = $doc.DocumentElement
    $obj = @($root.ChildNodes | Where-Object { $_.NodeType -eq "Element" })[0]
    $out['$class'] = "$([IO.Path]::GetExtension($file).TrimStart('.')).$($obj.LocalName)"
    FlatXml $root $root.LocalName $out
    $proj = PlcProjFile
    $rel = ([IO.Path]::GetFullPath($file)).Substring(([IO.Path]::GetFullPath($proj.DirectoryName)).TrimEnd('\').Length + 1)
    $pdoc = (ReadXmlExact $proj.FullName).doc
    $entries = @($pdoc.SelectNodes("//*[local-name()='Compile']") | Where-Object { $_.GetAttribute("Include") -eq $rel })
    if ($entries.Count -ne 1) { Fault "$($item.Name): $($entries.Count) Compile entries of $($proj.Name) name '$rel'" }
    FlatXml $entries[0] "plcproj/Compile" $out
    $all = New-Object 'System.Collections.Generic.Dictionary[string,object]'
    $all[""] = $out
    $script:RV = $all
}

# Every item below the PLC project root: name, tree code, path and the file it is stored in (null for one with none).
function ObjectsRead {
    $list = New-Object System.Collections.ArrayList
    foreach ($c in (Walk (Single (Root)) 0)) {
        $file = $null
        # A file that cannot be read FAILS the read, naming the item - never an item silently dropped from the pick.
        if ([int]$c.ItemType -ne 650) {
            try { $file = FileOf $c } catch { Fault "objects: $($c.PathName): its FullPath cannot be read: $($_.Exception.Message)" }
        }
        # A task item (621) publishes no FullPath: its file is its .plcproj entry (BackingFile, which refuses by name).
        if (-not $file -and [int]$c.ItemType -eq 621) { $file = BackingFile $c }
        [void]$list.Add(@{ name = [string]$c.Name; itemType = [int]$c.ItemType; path = [string]$c.PathName
                           file = $(if ($file) { [IO.Path]::GetFileName([string]$file) } else { $null }) })
    }
    $script:RV = $list
}

function GuidOf($item) {
    $file = FileOf $item
    if (-not $file -or -not (Test-Path $file)) { Fault "$($item.Name) has no backing file to read its Id from ($file)" }
    $doc = [xml](Get-Content -Raw -Encoding UTF8 $file)
    $obj = $doc.DocumentElement.ChildNodes | Where-Object { $_.NodeType -eq "Element" } | Select-Object -First 1
    $g = $obj.GetAttribute("Id")
    if (-not $g) { Fault "$($item.Name): <$($obj.LocalName)> in $([IO.Path]::GetFileName($file)) has no Id" }
    return @{ '$guid' = $g }
}

function ProcessRead([string]$what) {
    switch ($what) {
        "exe" {
            $fvi = (Get-Process -Id $XaePid).MainModule.FileVersionInfo
            return @{ exe = [IO.Path]::GetFileName($fvi.FileName); ProductName = $fvi.ProductName; ProductVersion = $fvi.ProductVersion
                      FileVersion = $fvi.FileVersion; CompanyName = $fvi.CompanyName; DteName = $script:dte.Name; DteVersion = $script:dte.Version }
        }
        "automation" { return @{ TcRemoteManagerVersion = [string]$script:dte.GetObject("TcRemoteManager").Version } }
        # The XAE shell's own UI language (DTE.LocaleID), and this core's (the same user's) UI culture: the refusal
        # texts the COM answers carry are verbatim in the IDE's language.
        "culture" {
            return @{ DteLocale = [Globalization.CultureInfo]::GetCultureInfo([int]$script:dte.LocaleID).Name
                      CurrentUICulture = [Globalization.CultureInfo]::CurrentUICulture.Name }
        }
        default { Fault "TwinCAT has no '$what' process read" }
    }
}

# A read's JSON value, in $script:RV.
function Do-Read($r) {
    $on = $r["on"]
    switch ($r["op"]) {
        "member" {
            EvalPath $r["path"] $on
            if (-not $script:Cache.ContainsKey($r["key"])) { $script:Cache[$r["key"]] = $script:R }
            Render $script:R
        }
        "class" {
            EvalPath $(if ($r["path"]) { $r["path"] } else { "item" }) $on
            $v = $script:R
            $script:RV = if ($null -eq $v) { $null } elseif ($null -ne $v.ItemType) { "ItemType $($v.ItemType)" } else { $v.GetType().FullName }
        }
        "guid" { $script:RV = GuidOf (Single (Resolve $on)) }
        "parent" { $p = (Single (Resolve $on)).Parent; $script:RV = if ($p) { [string]$p.Name } else { $null } }
        "children" {
            $item = Single (Resolve $on)
            $names = New-Object System.Collections.ArrayList
            for ($i = 1; $i -le $item.ChildCount; $i++) { [void]$names.Add([string]$item.Child($i).Name) }
            $script:RV = $names
        }
        "xml" { XmlRead (Single (Resolve $on)) $r["xpath"] $r["file"] }
        "archive" { ArchiveRead (Single (Resolve $on)) }
        "nwl" { NwlRead (Single (Resolve $on)) }
        "objects" { ObjectsRead }
        "same" {
            if (-not $script:Cache.ContainsKey($r["as"])) { Fault "same: no earlier member read '$($r["as"])' in this row" }
            EvalPath $r["path"] $on
            $script:RV = [object]::ReferenceEquals($script:R, $script:Cache[$r["as"]])
        }
        "process" { $script:RV = ProcessRead $r["what"] }
        "tried" { $script:RV = Tried $r["what"] }
        default { Fault "TwinCAT has no read '$($r["op"])'$(if ($r["op"] -eq 'diagnostics') { ' (the runner reads it from the bridge build)' })" }
    }
}

function PathOf([string]$on) {
    $item = Single (Resolve $on)
    $rootPath = [string](Root).PathName
    $p = [string]$item.PathName
    $list = New-Object System.Collections.ArrayList
    if ($p -ne $rootPath) {
        if (-not $p.StartsWith($rootPath + "^")) { Fault "$on ($p) is not below the PLC project root ($rootPath)" }
        foreach ($n in $p.Substring($rootPath.Length + 1).Split("^")) { [void]$list.Add($n) }
    }
    $script:RV = $list
}

function Cleanup {
    for ($i = $script:Order.Count - 1; $i -ge 0; $i--) {
        $h = $script:H[$script:Order[$i]]
        if ($h.created -ne "script") { continue }
        try { $item = Single (Sm).LookupTreeItem($h.path) } catch { continue }   # deleted by the row, or with its parent
        $parent = Single $item.Parent
        $parent.DeleteChild($item.Name)
    }
    # What a vendor put where no handle points - a refused archive import deposits the item at the PLC project root
    # (C2q) - is the row's too: every root child the row began without goes.
    if ($null -ne $script:RootBefore) {
        RootChildren; foreach ($n in $script:RC.ToArray()) { if (-not $script:RootBefore.Contains($n)) { (Root).DeleteChild($n) } }
    }
    if ($script:Reloaded) { $script:dte.ExecuteCommand("File.SaveAll") }
    Begin-Row
}

# The PLC project root's child names, in $script:RC (a List[string]: never emitted - PowerShell would unroll it).
function RootChildren {
    $root = Root; $script:RC = New-Object System.Collections.Generic.List[string]
    for ($i = 1; $i -le $root.ChildCount; $i++) { $script:RC.Add([string]$root.Child($i).Name) }
}

function Begin-Row {
    $script:H = @{}; $script:Order = New-Object System.Collections.ArrayList; $script:Cache = @{}; $script:Reloaded = $false
    $script:RootBefore = $null
}

# ---- the request loop ------------------------------------------------------------------------------------------------

Answer @{ ready = $true; solution = [IO.Path]::GetFileName($script:dte.Solution.FullName) }
while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if (-not $line.Trim()) { continue }
    $req = $JS.DeserializeObject($line)
    $seq = $req["seq"]
    try {
        switch ($req["kind"]) {
            "begin" { Begin-Row; RootChildren; $script:RootBefore = [System.Collections.Generic.HashSet[string]]::new($script:RC); Answer @{ seq = $seq } }
            "step" {
                $outcome = "accepted"; $made = $false
                $as = $req["step"]["as"]
                $before = if ($as -and $script:H.ContainsKey($as)) { $script:H[$as] } else { $null }
                try { Do-Step $req["step"] }
                catch [ProbeError] { throw }
                catch {
                    $outcome = "refused: " + (Why $_.Exception)
                    # A create that raised AFTER the object was made (its declaration write threw): the object is there.
                    $made = $req["step"]["op"] -eq "create" -and $as -and $script:H.ContainsKey($as) -and -not [object]::ReferenceEquals($script:H[$as], $before)
                }
                Answer @{ seq = $seq; outcome = $outcome; made = $made }
            }
            "read" { $script:RV = $null; Do-Read $req["read"]; Answer @{ seq = $seq; value = $script:RV } }
            "path" { PathOf $req["on"]; Answer @{ seq = $seq; value = $script:RV } }
            "adopt" { Keep $req["as"] (FindItem $req["name"] $null) "adopted" ""; Answer @{ seq = $seq } }
            "cleanup" { Cleanup; Answer @{ seq = $seq } }
            default { Fault "unknown request '$($req["kind"])'" }
        }
    } catch {
        Answer @{ seq = $seq; error = "$(Why $_.Exception)`n$($_.ScriptStackTrace)" }
    }
}
