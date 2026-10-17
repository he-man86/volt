# THE NATIVE CORPUS RECORDER (openspec twincat-inproc-host 2.2): every PLCopen document in
# test/fixtures/tc-native-corpus/import (`<name>.plcopen.xml`, written by
# `VOLT_WRITE_TC_CORPUS=1 dotnet test test/Volt.Ide.Twincat.Tests --filter FullyQualifiedName~TcNativeCorpus`) is imported
# into a scratch POU of the XAE behind this instance's pipe - `PlcOpenImport(<file>, 0)` on the PLC project - and the
# archive TwinCAT serializes for it (`ImplementationText`) is written beside it as `<name>.nwl.xml`; the scratch is
# deleted. A document the importer refuses, or one it builds nothing from, is recorded as `<name>.refused.txt` with the
# vendor's message - a fact about the importer, kept.
#
# PLCopen is an AUTHORING TOOL here and nothing more: the archive is TwinCAT's own serialization of what its importer
# built, which is what makes it a template for the native writer (TcArchiveWriter / TcArchiveBuilder). Re-run it on
# another TwinCAT version to re-make the corpus there.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ide.ps1 up -Vendor twincat -Instance <yours> -Fixture 14 -Wait
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tc-native-corpus.ps1 -XaePid <pid> -Instance <yours>
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ide.ps1 down -Vendor twincat -Instance <yours>
#
# The DTE is taken from the Running Object Table by the XAE's pid (never GetActiveObject: several XAE windows may be
# open) and refused unless its solution is this instance's fixture COPY. It saves nothing. ASCII only.
param([Parameter(Mandatory)] [int]$XaePid, [Parameter(Mandatory)] [string]$Instance)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName Microsoft.VisualBasic

Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Runtime.InteropServices.ComTypes;
public static class VoltCorpusRot {
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
# The shipped bridge's COM message filter (ComMessageFilter, KB201600): a call the busy XAE rejects is retried.
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class VoltCorpusFilter {
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
if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne "STA") { throw "needs an STA thread (Windows PowerShell)" }
$hr = [VoltCorpusFilter]::Register()
if ($hr -ne 0) { throw "CoRegisterMessageFilter answered 0x$('{0:X8}' -f $hr)" }

$dte = [VoltCorpusRot]::Get("!TcXaeShell.DTE.15.0:$XaePid")
if (-not $dte) { throw "XAE $XaePid has no DTE in the ROT" }
if ($dte.Solution.FullName -notlike "*volt-ide-twincat-$Instance*") { throw "XAE $XaePid is not on the $Instance fixture copy: $($dte.Solution.FullName)" }
$sm = $dte.Solution.Projects.Item(1).Object
$plc = $sm.LookupTreeItem("TIPC").Child(1).NestedProject
Write-Host "solution: $($dte.Solution.FullName); PLC project: $($plc.PathName)"

$dir = Join-Path $PSScriptRoot "..\test\fixtures\tc-native-corpus\import" | Resolve-Path
$docs = @(Get-ChildItem $dir -Filter "*.plcopen.xml" | Sort-Object Name)
if ($docs.Count -eq 0) { throw "no PLCopen documents in $dir - write them first (VOLT_WRITE_TC_CORPUS=1)" }
Get-ChildItem $dir -File | Where-Object { $_.Name -like "*.nwl.xml" -or $_.Name -like "*.refused.txt" } | Remove-Item -Confirm:$false
$ok = 0; $refused = 0
foreach ($doc in $docs) {
    $name = $doc.Name -replace '\.plcopen\.xml$', ''
    $path = "$($plc.PathName)^$name"
    try { $sm.LookupTreeItem($path) | Out-Null; throw "$path already exists - a scratch of an earlier run; down/up the instance" } catch [System.Runtime.InteropServices.COMException] {}
    try {
        [Microsoft.VisualBasic.Interaction]::CallByName($plc, "PlcOpenImport", [Microsoft.VisualBasic.CallType]::Method, $doc.FullName, 0) | Out-Null
        $item = $null
        try { $item = $sm.LookupTreeItem($path) } catch [System.Runtime.InteropServices.COMException] {}
        if (-not $item) { throw "the import built no POU" }
        $text = [string][Microsoft.VisualBasic.Interaction]::CallByName($item, "ImplementationText", [Microsoft.VisualBasic.CallType]::Get)
        if (-not $text) { throw "the import answered no ImplementationText" }
        [IO.File]::WriteAllText((Join-Path $dir "$name.nwl.xml"), $text, (New-Object Text.UTF8Encoding $false))
        $ok++
        Write-Host "${name}: $($text.Length) chars"
    } catch {
        [IO.File]::WriteAllText((Join-Path $dir "$name.refused.txt"), "$($_.Exception.Message)`n", (New-Object Text.UTF8Encoding $false))
        $refused++
        Write-Host "${name}: REFUSED $($_.Exception.Message)"
    } finally {
        try { $sm.LookupTreeItem($path) | Out-Null; $plc.DeleteChild($name) } catch {}
    }
}
Write-Host "done: $ok recorded, $refused refused, of $($docs.Count)"
