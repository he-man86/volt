using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using VoltBridge.Core;
using VoltBridge.Core.Fbd;
using VoltBridge.Core.Fbd.Vg;
using VoltBridge.Core.Models;

namespace VoltBridge.Beckhoff;

public class BeckhoffAdapter : AdapterBase, IAdapter, IInstanceProvider
{
    private readonly BlockingCollection<Action> _staQueue = new();
    private readonly object _cacheLock = new();
    private dynamic? _dte;
    private dynamic? _sysManager;
    private dynamic? _plcNode;
    private string? _projectName;
    private string? _plcProjectPath;
    private string? _ideProgId;
    private string? _ideVersion;

    private bool _cachedIdeAlive;
    private string? _cachedProjectName;
    private string? _cachedPlcProjectName;
    private bool? _cachedProjectDirty;
    private long _cachedAtMs;
    private bool _probeInFlight;

    public bool IsConnected => _dte != null && _sysManager != null && _plcProjectPath != null;

    public string? IdeName => _ideProgId switch
    {
        "VisualStudio.DTE.17.0" => "Visual Studio 2022",
        "VisualStudio.DTE.16.0" => "Visual Studio 2019",
        "TcXaeShell.DTE.15.0" => "TcXaeShell",
        _ => _ideProgId,
    };

    public string? IdeVersion => _ideVersion;

    // ── COM P/Invoke ────────────────────────────────────────────────

    [DllImport("oleaut32.dll", PreserveSig = false)]
    private static extern void GetActiveObject(ref Guid rclsid, IntPtr pvReserved,
        [MarshalAs(UnmanagedType.IUnknown)] out object ppunk);

    private static object GetComObject(string progId)
    {
        var type = Type.GetTypeFromProgID(progId, throwOnError: true)!;
        Guid clsid = type.GUID;
        GetActiveObject(ref clsid, IntPtr.Zero, out object obj);
        return obj;
    }

    // ── Connection ──────────────────────────────────────────────────

    /// <summary>All running TwinCAT instances + projects (for the connector's picker).
    /// Returns object to satisfy IInstanceProvider without Core knowing TcInstance.</summary>
    public object ListInstances() => RotInstances.Enumerate();

    public void Connect()
    {
        // Optional target (set by the connector when the user picks an instance/project).
        var targetInstance = Environment.GetEnvironmentVariable("VOLT_TC_INSTANCE");
        var targetProject = Environment.GetEnvironmentVariable("VOLT_TC_PROJECT");
        var targetPlc = Environment.GetEnvironmentVariable("VOLT_TC_PLC");

        if (!string.IsNullOrEmpty(targetInstance))
        {
            _dte = RotInstances.Bind(targetInstance);
            if (_dte != null)
            {
                _ideProgId = RotInstances.ProgId(targetInstance);
                try { _ideVersion = (string?)_dte!.Version; } catch { }
            }
        }
        if (_dte == null) // no target (or it vanished) → first active instance, today's behavior
        {
            string[] progIds = ["VisualStudio.DTE.17.0", "VisualStudio.DTE.16.0", "TcXaeShell.DTE.15.0"];
            foreach (var progId in progIds)
            {
                try
                {
                    _dte = GetComObject(progId);
                    _ideProgId = progId;
                    try { _ideVersion = (string?)_dte!.Version; } catch { }
                    break;
                }
                catch (COMException) { continue; }
            }
        }
        if (_dte == null)
            throw new InvalidOperationException("No running TwinCAT XAE instance found.");
        FindTwinCatProject(string.IsNullOrEmpty(targetProject) ? null : targetProject);
        FindPlcProject(string.IsNullOrEmpty(targetPlc) ? null : targetPlc);
    }

    private void FindTwinCatProject(string? wantProject = null)
    {
        // Access Solution.Projects via COM type system (not dynamic)
        dynamic solution = _dte!.Solution;
        dynamic projects = solution.Projects;
        int count = projects.Count;

        for (int i = 1; i <= count; i++)
        {
            try
            {
                dynamic proj = projects.Item(i);
                if (wantProject != null) // skip until we hit the requested project
                {
                    string nm;
                    try { nm = (string)proj.Name; } catch { continue; }
                    if (nm != wantProject) continue;
                }
                // In TcXaeShell, proj.Object IS the SystemManager.
                // In full VS, proj.Object.SystemManager is the SystemManager.
                dynamic obj = proj.Object;
                try { _sysManager = obj; }
                catch { _sysManager = null; }

                if (_sysManager != null)
                {
                    _projectName = proj.Name;
                    try
                    {
                        dynamic plcProj = _sysManager.PlcProject;
                        _plcProjectPath = plcProj?.ProjectPath;
                    }
                    catch
                    {
                        // In TcXaeShell, PlcProject might not be directly accessible via dynamic.
                        // Try LookupTreeItem with the plc path.
                        try
                        {
                            var pp = _sysManager.LookupTreeItem("TIPC");
                            if (pp != null)
                            {
                                try { _plcProjectPath = pp.Child[1]?.ProjectPath ?? pp.Child[1]?.Name; }
                                catch { }
                            }
                        }
                        catch { }
                    }
                }

                if (_sysManager == null)
                {
                    // Full VS path: obj.SystemManager
                    try
                    {
                        _sysManager = obj.SystemManager;
                        _projectName = proj.Name;
                        try
                        {
                            dynamic plcProj = _sysManager.PlcProject;
                            _plcProjectPath = plcProj?.ProjectPath;
                        }
                        catch { }
                    }
                    catch { continue; }
                }

                if (_sysManager != null)
                {
                    break;
                }
            }
            catch { }
        }

        if (_sysManager == null) throw new InvalidOperationException("No TwinCAT project found in solution.");
    }

    private void FindPlcProject(string? wantPlc = null)
    {
        // Honour an explicit PLC selection even if FindTwinCatProject already set a path.
        if (wantPlc == null && _plcProjectPath != null) { _plcNode = LookupTreeItem(_plcProjectPath); return; }

        // Walk TIPC; pick the requested PLC project, or the first one.
        try
        {
            dynamic tipc = _sysManager!.LookupTreeItem("TIPC");
            int childCount = tipc.ChildCount;
            for (int i = 1; i <= childCount; i++)
            {
                try
                {
                    dynamic plc = tipc.Child[i];
                    string name = plc.Name;
                    if (wantPlc != null && name != wantPlc) continue;
                    _plcNode = plc;
                    _plcProjectPath = name;
                    break;
                }
                catch { }
            }
        }
        catch { }

        if (_plcNode == null && _plcProjectPath != null) _plcNode = LookupTreeItem(_plcProjectPath);
        if (_plcNode == null) throw new InvalidOperationException("Cannot find PLC project under TIPC.");
    }

    public dynamic LookupTreeItem(string path)
    {
        return _sysManager!.LookupTreeItem(path);
    }

    public dynamic GetPlcProjectRoot()
    {
        if (_plcNode != null)
        {
            try { return _plcNode.NestedProject; }
            catch { }
        }
        if (_plcProjectPath == null) throw new InvalidOperationException("No PLC project found");
        return LookupTreeItem(_plcProjectPath);
    }

    // ── STA Thread ──────────────────────────────────────────────────

    public void RunStaMessageLoop(CancellationToken cancel)
    {
        while (!cancel.IsCancellationRequested)
        {
            if (_staQueue.TryTake(out var action, 100))
            {
                try { action(); }
                catch { }
            }
            else
            {
                try { System.Threading.Thread.Sleep(10); } catch { }
            }
        }
    }

    public T RunOnStaThread<T>(Func<T> func)
    {
        using var evt = new ManualResetEventSlim(false);
        T result = default!;
        Exception? error = null;
        _staQueue.Add(() =>
        {
            try { result = func(); }
            catch (Exception ex) { error = ex; }
            finally { evt.Set(); }
        });
        if (!evt.Wait(TimeSpan.FromSeconds(30)))
            throw new TimeoutException("STA operation timed out");
        if (error != null) throw error;
        return result;
    }

    // ── Health + Cache ──────────────────────────────────────────────

    public HealthResponse BuildHealthResponse()
    {
        bool ideAlive; string? projectName, plcProjectName; bool? projectDirty; long? ageMs;
        lock (_cacheLock)
        {
            ideAlive = _cachedIdeAlive;
            projectName = _cachedProjectName;
            plcProjectName = _cachedPlcProjectName;
            projectDirty = _cachedProjectDirty;
            ageMs = _cachedAtMs == 0 ? null : Environment.TickCount64 - _cachedAtMs;
        }
        if (ageMs is null || ageMs > 5000) TriggerAsyncProbe();

        return BuildHealth("beckhoff", IsConnected, ideAlive, IdeName, IdeVersion,
            projectName, plcProjectName, projectDirty ?? false);
    }

    public void TriggerAsyncProbe()
    {
        lock (_cacheLock) { if (_probeInFlight) return; _probeInFlight = true; }
        Task.Run(() =>
        {
            try
            {
                var r = RunOnStaThread(() =>
                {
                    if (_dte == null) { try { Connect(); } catch { } }   // (re)attach when TwinCAT appears
                    bool alive = ProbeIdeAlive();
                    if (!alive && _dte != null) { try { Disconnect(); } catch { } }
                    else if (alive && IsDegraded) { ClearDegraded(); }
                    bool? dirty = null;
                    try { dirty = !_dte!.Solution.Saved; } catch { }
                    return (alive, _projectName, _plcProjectPath, dirty);
                });
                lock (_cacheLock)
                {
                    _cachedIdeAlive = r.alive;
                    _cachedProjectName = r._projectName;
                    _cachedPlcProjectName = r._plcProjectPath;
                    _cachedProjectDirty = r.dirty;
                    _cachedAtMs = Environment.TickCount64;
                }
            }
            catch { }
            finally { lock (_cacheLock) { _probeInFlight = false; } }
        });
    }

    private bool ProbeIdeAlive()
    {
        if (_dte == null) return false;
        try { var _ = (int)_dte.Solution.Count; return true; }
        catch { return false; }
    }

    // A dead/disconnected TwinCAT COM channel surfaces as specific RPC HRESULTs;
    // those (and only those) flip the bridge to degraded so it can recover instead
    // of hard-failing. (Degraded-state plumbing itself is inherited from AdapterBase.)
    private const uint HResultRpcServerUnavailable = 0x800706BAu;
    private const uint HResultRpcCallFailed = 0x800706BEu;
    private const uint HResultRpcCallFailedDidNotExecute = 0x800706BFu;
    private const uint HResultRpceFamilyMask = 0xFFFFFF00u;
    private const uint HResultRpceFamily = 0x80010100u;       // RPC_E_* (server died, disconnected, …)
    private const uint HResultCallRejected = 0x80010001u;        // RPC_E_CALL_REJECTED
    private const uint HResultDisconnected = 0x80010108u;        // RPC_E_DISCONNECTED
    private const uint HResultServerCallRetryLater = 0x8001010Au; // RPC_E_SERVERCALL_RETRYLATER

    public override bool ShouldMarkDegraded(Exception ex)
    {
        for (var e = ex; e != null; e = e.InnerException)
        {
            if (e is not COMException com) continue;
            var hr = unchecked((uint)com.HResult);
            if (hr == HResultRpcServerUnavailable) return true;
            if (hr == HResultRpcCallFailed || hr == HResultRpcCallFailedDidNotExecute) return true;
            if ((hr & HResultRpceFamilyMask) == HResultRpceFamily) return true;
            if (hr == HResultCallRejected || hr == HResultDisconnected || hr == HResultServerCallRetryLater) return true;
        }
        return false;
    }

    public void Disconnect()
    {
        if (_sysManager != null) { try { Marshal.ReleaseComObject(_sysManager); } catch { } _sysManager = null; }
        if (_dte != null) { try { Marshal.ReleaseComObject(_dte); } catch { } _dte = null; }
        _projectName = null; _plcProjectPath = null;
        ClearDegraded();
    }

    // ── Tree Walking ────────────────────────────────────────────────

    public List<TreeItemVisit> WalkAllItems(HashSet<string>? onlyNames = null)
    {
        var items = new List<TreeItemVisit>();
        var found = 0;
        WalkInner(GetPlcProjectRoot(), "", items, onlyNames, ref found);
        if (onlyNames == null || found < onlyNames.Count)
            WalkIoDevices(items);
        return items;
    }

    private void WalkInner(dynamic node, string folderPath, List<TreeItemVisit> items,
        HashSet<string>? onlyNames, ref int found)
    {
        // Short-circuit: all requested items found
        if (onlyNames != null && found >= onlyNames.Count) return;

        int count;
        try { count = (int)node.ChildCount; } catch { return; }
        for (int i = 1; i <= count; i++)
        {
            if (onlyNames != null && found >= onlyNames.Count) return;
            dynamic child;
            try { child = node.Child[i]; } catch { continue; }
            string name;
            try { name = (string)child.Name; } catch { continue; }
            int itemType = GetItemType(child);

            if (itemType == ItemKind.Folder || itemType == ItemKind.LibraryManager)
            {
                var nested = string.IsNullOrEmpty(folderPath) ? name : $"{folderPath}/{name}";
                WalkInner(child, nested, items, onlyNames, ref found);
                continue;
            }
            if (ItemKind.IsInlinedInPou(itemType)) continue;

            int childCount = 0;
            try { childCount = (int)child.ChildCount; } catch { }
            bool isTopLevelCrud = ItemKind.IsTopLevelCrud(itemType);
            bool isHybrid = childCount > 0 && !isTopLevelCrud;
            string emitFolder = isHybrid ? (string.IsNullOrEmpty(folderPath) ? name : $"{folderPath}/{name}") : folderPath;

            items.Add(new TreeItemVisit(name, child, itemType, isTopLevelCrud, emitFolder));
            if (onlyNames != null && onlyNames.Contains(name)) found++;
            if (isHybrid) WalkInner(child, emitFolder, items, onlyNames, ref found);
        }
    }

    private void WalkIoDevices(List<TreeItemVisit> items)
    {
        if (_sysManager == null) return;
        dynamic tiid;
        try { tiid = _sysManager.LookupTreeItem("TIID"); } catch { return; }
        int count;
        try { count = (int)tiid.ChildCount; } catch { return; }
        for (int i = 1; i <= count; i++)
        {
            dynamic device;
            try { device = tiid.Child[i]; } catch { continue; }
            string name;
            try { name = (string)device.Name; } catch { continue; }
            items.Add(new TreeItemVisit(name, device, GetItemType(device), false, "I/O Devices"));
        }
    }

    public int GetItemType(dynamic item) { try { return (int)item.ItemType; } catch { return 0; } }

    public int GetChildCount(dynamic parent) { try { return (int)parent.ChildCount; } catch { return 0; } }

    public dynamic GetChildAt(dynamic parent, int index) { return parent.Child[index]; }

    public dynamic GetParent(dynamic item) { return item.Parent; }

    public string GetItemName(dynamic item) { try { return (string)item.Name ?? ""; } catch { return ""; } }

    /// <summary>FBD/LD body → editable VG, mirroring CODESYS: export the POU as PLCopenXML, parse the
    /// graphical body (<see cref="PlcOpenReader"/>) and render VG (<see cref="VgWriter"/>). CFC/SFC →
    /// read-only marker; ST/IL → null. The cheap language check uses the in-memory
    /// <c>ImplementationText</c> endpoint so textual bodies never trigger an export.</summary>
    public override GraphicalBody? ReadGraphicalBody(dynamic item)
    {
        string impl;
        try { impl = ReadImplementation(item); } catch { return null; }
        var lang = TcPouReader.LanguageOf(impl);
        if (lang is null) return null;                                  // textual ST/IL
        if (lang is "CFC" or "SFC") return new GraphicalBody(lang, ""); // read-only marker (not transpiled)

        var pou = EnclosingPou(item);
        if (pou is null) return new GraphicalBody(lang, "");
        try
        {
            string xml = TcPlcOpen.ExportXmlString(GetPlcProjectRoot(), PouSelectionPath(pou));  // string, not dynamic
            var fbd = PlcOpenDocument.FindFbdLdBody(xml);
            if (fbd is null) return new GraphicalBody(lang, "");
            // Use the authoritative language (DefaultViewMode via LanguageOf) for the VG header —
            // TwinCAT serializes an LD body with an <FBD> wrapper, so the wrapper alone lies.
            var body = PlcOpenReader.ReadBody(fbd) with { Language = lang };
            var vg = VgWriter.Write(body);
            return new GraphicalBody(lang, vg, "vg");
        }
        catch { return new GraphicalBody(lang, ""); }                   // export failed → read-only (parity w/ CODESYS)
    }

    // ── Write Operations (COM) ─────────────────────────────────────

    /// <summary>Write an editable VG body, mirroring CODESYS: VG → graph → PLCopenXML body, spliced
    /// into the POU's exported PLCopen, re-imported (same-name replace). On import failure the
    /// original is re-imported so a bad edit can't lose the POU. Throws on non-convertible VG.</summary>
    public override void WriteGraphicalBody(dynamic item, string vgText, string declaration)
    {
        var graph = VgParser.Parse(vgText);                            // throws on invalid VG
        var types = PlcOpenDocument.InstanceTypes(declaration);
        var newBody = PlcOpenWriter.WriteBody(graph, inst => types.TryGetValue(inst, out var t) ? t : null);

        var pou = EnclosingPou(item) ?? throw new InvalidOperationException("TwinCAT: no enclosing POU for graphical write");
        var plc = GetPlcProjectRoot();
        var selection = PouSelectionPath(pou);
        var exported = TcPlcOpen.ExportXmlString(plc, selection);              // full POU PLCopen (also the restore copy)
        var outXml = PlcOpenDocument.SpliceFbdLdBody(exported, newBody); // throws if no FBD/LD body

        try { TcPlcOpen.ImportXmlString(plc, outXml); }
        catch { try { TcPlcOpen.ImportXmlString(plc, exported); } catch { } throw; }
    }

    /// <summary>Raw PLCopen of the whole POU (corpus capture / coverage). Same export the graphical
    /// read uses; null on failure or for non-exportable items.</summary>
    public override string? ExportRawPou(dynamic item)
    {
        try
        {
            var pou = EnclosingPou(item);
            if (pou is null) return null;
            string xml = TcPlcOpen.ExportXmlString(GetPlcProjectRoot(), PouSelectionPath(pou));
            return xml;
        }
        catch { return null; }
    }

    /// <summary>Walk up to the enclosing POU (FB / function / program / interface).</summary>
    private dynamic? EnclosingPou(dynamic item)
    {
        dynamic node = item;
        for (var hops = 0; hops < 32; hops++)
        {
            int t; try { t = GetItemType(node); } catch { return null; }
            if (t is ItemKind.Program or ItemKind.Function or ItemKind.FunctionBlock or ItemKind.Interface) return node;
            try { node = GetParent(node); } catch { return null; }
            if (node == null) return null;
        }
        return null;
    }

    /// <summary>PLC-project-relative selection path for PlcOpenExport (the POU name today).
    /// NEEDS LIVE VERIFICATION: the exact selection grammar (possibly folder-qualified,
    /// '.'-separated) isn't confirmed; if a bare name is rejected this must include the folder chain.</summary>
    private string PouSelectionPath(dynamic pou)
    {
        // PlcOpenExport wants the item path RELATIVE to the PLC project, '.'-separated
        // (e.g. "POUs.PLC_PRG"). TwinCAT PathName is "^"-separated and absolute
        // ("TIPC^Untitled2^Untitled2 Project^POUs^PLC_PRG"); strip the PLC-project prefix.
        try
        {
            string pouPath = (string)pou.PathName;
            string plcPath = (string)GetPlcProjectRoot().PathName;
            if (pouPath.StartsWith(plcPath + "^", System.StringComparison.Ordinal))
                return pouPath.Substring(plcPath.Length + 1).Replace('^', '.');
            return pouPath.Replace('^', '.');
        }
        catch { try { return (string)pou.Name; } catch { return ""; } }
    }

    public void FlushPendingWrites()
    {
        if (_dte == null) return;
        try { _dte.Documents.SaveAll(); } catch { }
    }

    public bool Build()
    {
        if (_dte == null) return false;
        try
        {
            dynamic sb = _dte.Solution.SolutionBuild;
            try { for (int i = 0; i < 100; i++) { if ((int)sb.BuildState != 2) break; Thread.Sleep(100); } } catch { }
            sb.Build(true);
            try { for (int i = 0; i < 100; i++) { if ((int)sb.BuildState != 2) break; Thread.Sleep(100); } } catch { }
            int failed;
            try { failed = sb.LastBuildInfo; } catch { failed = 0; }
            return failed == 0;
        }
        catch { return false; }
    }

    public List<object> GetBuildDiagnostics()
    {
        var result = new List<object>();
        if (_dte == null) return result;
        try
        {
            dynamic output = _dte.Windows.Item("{34E76E81-EE4A-11D0-AE2E-00A0C90FFFC3}").Object;
            int paneCount = output.OutputWindowPanes.Count;
            for (int p = 1; p <= paneCount; p++)
            {
                dynamic pane;
                try { pane = output.OutputWindowPanes.Item(p); } catch { continue; }
                string name = (string)pane.Name;
                if (!name.Contains("Build") && !name.Contains("TwinCAT")) continue;
                dynamic td = pane.TextDocument;
                dynamic ep = td.StartPoint.CreateEditPoint();
                string text = (string)ep.GetText(td.EndPoint);
                if (string.IsNullOrEmpty(text)) continue;
                var regex = new Regex(@"^(.+?)(?:\((\d+)\))?\s*:\s*(error|warning|message)\s*:\s*(.+)$",
                    RegexOptions.IgnoreCase | RegexOptions.Multiline);
                foreach (Match m in regex.Matches(text))
                {
                    int lineNum = 0;
                    if (m.Groups[2].Success) int.TryParse(m.Groups[2].Value, out lineNum);
                    var sev = m.Groups[3].Value.ToLowerInvariant();
                    result.Add(new Dictionary<string, object?>
                    {
                        ["severity"] = sev == "message" ? "info" : sev,
                        ["message"] = m.Groups[4].Value.Trim(),
                        ["line"] = lineNum,
                    });
                }
            }
        }
        catch { }
        return result;
    }

    public dynamic? LookupItemByName(string name) => FindItemByName(GetPlcProjectRoot(), name);

    private dynamic? FindItemByName(dynamic parent, string name)
    {
        // Bound by ChildCount (1-based COM) — accessing Child[ChildCount+1], or
        // Child[1] on an empty node, throws a NON-COM out-of-range error
        // ("Index out of range (1...ChildCount)!") that the old COMException-only
        // catch let escape and kill every create. Mirrors WalkInner/FindOrCreateFolder.
        int count;
        try { count = (int)parent.ChildCount; } catch { return null; }
        for (int i = 1; i <= count; i++)
        {
            dynamic child;
            try { child = parent.Child[i]; } catch { continue; }
            string childName;
            try { childName = (string)child.Name; } catch { continue; }
            if (string.Equals(childName, name, StringComparison.OrdinalIgnoreCase))
            {
                int itemType = GetItemType(child);
                if (ItemKind.IsTopLevelCrud(itemType)) return child;
            }
            if (GetItemType(child) == ItemKind.Folder)
            {
                var found = FindItemByName(child, name);
                if (found != null) return found;
            }
        }
        return null;
    }

    public dynamic CreateChild(dynamic parent, string name, int itemType)
    {
        return parent.CreateChild(name, itemType, "", "ST");
    }

    public void DeleteChild(dynamic parent, string name)
    {
        parent.DeleteChild(name);
    }

    public void WriteSourceText(dynamic item, string declaration, string implementation)
    {
        try { item.DeclarationText = declaration ?? ""; } catch { }
        if (!string.IsNullOrEmpty(implementation))
            try { item.ImplementationText = implementation; } catch { }
    }

    public void RenameItem(dynamic item, string newName)
    {
        item.Name = newName;
    }

    public override string ReadDeclaration(dynamic item) { try { return (string)item.DeclarationText ?? ""; } catch { return ""; } }
    public override string ReadImplementation(dynamic item) { try { return (string)item.ImplementationText ?? ""; } catch { return ""; } }

    // Version hashing + MapItemType are inherited from AdapterBase (shared parity).

    // ── Config Manifest ──────────────────────────────────────────────

    public string ReadManifestText(dynamic item, string kind)
    {
        try
        {
            string xml;
            try { xml = (string)item.ProduceXml(); } catch { return "?\n"; }
            if (string.IsNullOrEmpty(xml)) return "?\n";

            var name = ExtractTag(xml, "ItemName") ?? ExtractTag(xml, "LibItemName") ?? "?";
            var sb = new StringBuilder();
            sb.Append("Name=").Append(name).Append('\n');

            if (kind == "task")
            {
                var linked = ExtractTag(xml, "LinkedTask");
                if (linked != null) sb.Append("linked-task=").Append(linked).Append('\n');
            }

            if (kind == "library")
            {
                var ns = ExtractTag(xml, "Namespace");
                if (ns != null) sb.Append("namespace=").Append(ns).Append('\n');
                var def = ExtractTag(xml, "DefaultResolution");
                if (def != null) sb.Append("default-resolution=").Append(def).Append('\n');
                var ver = ExtractTag(xml, "Version");
                if (ver != null) sb.Append("version=").Append(ver).Append('\n');
                var dist = ExtractTag(xml, "Distributor");
                if (dist != null) sb.Append("distributor=").Append(dist).Append('\n');
            }

            return sb.ToString();
        }
        catch { return "?\n"; }
    }

    private static string? ExtractTag(string xml, string tag)
    {
        var m = System.Text.RegularExpressions.Regex.Match(xml, $@"<{tag}[^>]*>([^<]*)</{tag}>");
        if (m.Success)
        {
            var val = m.Groups[1].Value.Trim();
            if (val.Length > 0) return val;
        }
        return null;
    }
}
