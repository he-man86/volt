using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using Volt.Bridge.Core.Ide;
using Volt.Bridge.Core.Wire;
using Volt.Bridge.Core.Workspace;

namespace Volt.Bridge.Beckhoff;

/// <summary>
/// Access to the live TwinCAT/Beckhoff project through the XAE automation model — the DTE plus the
/// system manager and PLC tree — reached out-of-process over COM. The COM objects are late-bound through
/// <c>dynamic</c>; that lives ONLY here, behind the typed <see cref="ItemRef"/>/<c>object</c> boundary,
/// so the <c>BeckhoffDriver</c> facets (and Core) stay dynamic-free. This is the Beckhoff analogue of the
/// CODESYS bridge's <c>CodesysObjectModel</c>: the driver holds one of these and delegates all genuine
/// IDE access to it.
///
/// <para>Every member here must be invoked on the bridge's STA thread (see <c>StaDispatcher</c>) —
/// the COM objects are apartment-bound.</para>
/// </summary>
internal sealed class TcObjectModel
{
    private dynamic? _dte;
    private dynamic? _sysManager;
    private dynamic? _plcNode;
    private string? _projectName;
    private string? _plcProjectPath;
    private string? _ideProgId;
    private string? _ideVersion;

    public bool IsAttached => _dte != null;
    public bool IsConnected => _dte != null && _sysManager != null && _plcProjectPath != null;
    public string? IdeProgId => _ideProgId;
    public string? IdeVersion => _ideVersion;
    public string? ProjectName => _projectName;
    public string? PlcProjectName => _plcProjectPath;

    /// <summary>All running TwinCAT instances + projects (for the connector's picker).</summary>
    public object ListInstances() => RotInstances.Enumerate();

    // ── COM attach ──────────────────────────────────────────────────
    public void Connect()
    {
        var targetInstance = Environment.GetEnvironmentVariable("VOLT_TC_INSTANCE");
        var targetProject = Environment.GetEnvironmentVariable("VOLT_TC_PROJECT");
        var targetPlc = Environment.GetEnvironmentVariable("VOLT_TC_PLC");

        // Attach to the requested instance, else fall back to the first running one. BOTH paths go through
        // the Running Object Table (RotInstances), which matches any "VisualStudio.DTE.*" / "TcXaeShell.DTE.*"
        // moniker by substring — so a NEWER Visual Studio or TcXaeShell attaches with no code change. (The
        // old fallback probed a hardcoded ProgID list and silently failed on any unlisted version.)
        string? instanceId = string.IsNullOrEmpty(targetInstance) ? null : targetInstance;
        if (instanceId != null) _dte = RotInstances.Bind(instanceId);
        if (_dte == null)   // no target, or it vanished → first running instance
        {
            var first = RotInstances.First();
            if (first != null) { _dte = first.Value.Dte; instanceId = first.Value.InstanceId; }
        }
        if (_dte == null) throw new InvalidOperationException("No running TwinCAT XAE / Visual Studio instance found.");

        _ideProgId = instanceId == null ? null : RotInstances.ProgId(instanceId);
        try { _ideVersion = (string?)_dte!.Version; } catch { /* version is cosmetic */ }

        FindTwinCatProject(string.IsNullOrEmpty(targetProject) ? null : targetProject);
        FindPlcProject(string.IsNullOrEmpty(targetPlc) ? null : targetPlc);
    }

    private void FindTwinCatProject(string? wantProject)
    {
        dynamic solution = _dte!.Solution;
        dynamic projects = solution.Projects;
        int count = projects.Count;
        for (int i = 1; i <= count; i++)
        {
            try
            {
                dynamic proj = projects.Item(i);
                if (wantProject != null)
                {
                    string nm;
                    try { nm = (string)proj.Name; } catch { continue; }
                    if (nm != wantProject) continue;
                }
                dynamic obj = proj.Object;   // TcXaeShell: proj.Object IS the SystemManager
                try { _sysManager = obj; } catch { _sysManager = null; }

                if (_sysManager != null)
                {
                    _projectName = proj.Name;
                    try { dynamic plcProj = _sysManager.PlcProject; _plcProjectPath = plcProj?.ProjectPath; }
                    catch
                    {
                        try
                        {
                            var pp = _sysManager.LookupTreeItem("TIPC");
                            if (pp != null) { try { _plcProjectPath = pp.Child[1]?.ProjectPath ?? pp.Child[1]?.Name; } catch { } }
                        }
                        catch { }
                    }
                }
                if (_sysManager == null)   // full VS: obj.SystemManager
                {
                    try
                    {
                        _sysManager = obj.SystemManager;
                        _projectName = proj.Name;
                        try { dynamic plcProj = _sysManager.PlcProject; _plcProjectPath = plcProj?.ProjectPath; } catch { }
                    }
                    catch { continue; }
                }
                if (_sysManager != null) break;
            }
            catch { }
        }
        if (_sysManager == null) throw new InvalidOperationException("No TwinCAT project found in solution.");
    }

    private void FindPlcProject(string? wantPlc)
    {
        if (wantPlc == null && _plcProjectPath != null) { _plcNode = LookupTreeItemDynamic(_plcProjectPath); return; }
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
                    _plcNode = plc; _plcProjectPath = name; break;
                }
                catch { }
            }
        }
        catch { }
        if (_plcNode == null && _plcProjectPath != null) _plcNode = LookupTreeItemDynamic(_plcProjectPath);
        if (_plcNode == null) throw new InvalidOperationException("Cannot find PLC project under TIPC.");
    }

    private dynamic LookupTreeItemDynamic(string path) => _sysManager!.LookupTreeItem(path);

    public object LookupTreeItem(string path) => LookupTreeItemDynamic(path);

    public void Disconnect()
    {
        if (_sysManager != null) { try { Marshal.ReleaseComObject(_sysManager); } catch { } _sysManager = null; }
        if (_dte != null) { try { Marshal.ReleaseComObject(_dte); } catch { } _dte = null; }
        _projectName = null; _plcProjectPath = null;
    }

    // ── health ──────────────────────────────────────────────────────
    public bool ProbeIdeAlive()
    {
        if (_dte == null) return false;
        try { var _ = (int)_dte.Solution.Count; return true; }
        catch { return false; }
    }

    /// <summary>Whether the solution has unsaved changes, or null if it can't be read.</summary>
    public bool? ProjectDirty()
    {
        try { return !_dte!.Solution.Saved; } catch { return null; }
    }

    // ── tree primitives ─────────────────────────────────────────────
    /// <summary>The PLC project root (its NestedProject), the default parent for new POUs.</summary>
    public object PlcRoot()
    {
        if (_plcNode != null)
        {
            try { return _plcNode.NestedProject; } catch { /* fall through to lookup */ }
        }
        if (_plcProjectPath == null) throw new InvalidOperationException("No PLC project found");
        return LookupTreeItemDynamic(_plcProjectPath);
    }

    // Raw COM reads — these THROW on failure; the tree-walk callers catch and skip/continue (that
    // skip-on-failure is part of the walk algorithm, so it stays in the facet, not here).
    public int ChildCount(object node) => (int)((dynamic)node).ChildCount;
    public object ChildAt(object node, int index1Based) => (object)((dynamic)node).Child[index1Based];
    public object Parent(object node) => (object)((dynamic)node).Parent;
    public string GetName(object node) => (string)((dynamic)node).Name ?? "";

    // TwinCAT's native ItemType IS the vendor-neutral code. A read failure returns ItemKind.Unknown (not 0
    // — that's the real SystemRoot code), so an unreadable node is skipped, never phantom-emitted.
    public int ItemType(object node) { try { return (int)((dynamic)node).ItemType; } catch { return ItemKind.Unknown; } }

    public object CreateChild(object parent, string name, int kindCode, string? language = null)
    {
        // The 4th arg (vInfo) is the implementation language for a POU body. TwinCAT rejects ANY String
        // vInfo for a FUNCTION ("vInfo (Type: String) not supported"); a function takes no body-language
        // vInfo, so omit it (Type.Missing) for functions and pass the language for everything else.
        // TC normalises LD → FBD (the PLCopen export wraps both in <FBD>; ladder is a view mode).
        var lang = language is "LD" ? "FBD" : (language ?? "ST");
        return kindCode == ItemKind.Function
            ? (object)((dynamic)parent).CreateChild(name, kindCode, "", System.Type.Missing)
            : (object)((dynamic)parent).CreateChild(name, kindCode, "", lang);
    }
    public void DeleteChild(object parent, string name) => ((dynamic)parent).DeleteChild(name);
    public void Rename(object node, string newName) => ((dynamic)node).Name = newName;

    // ── source text ─────────────────────────────────────────────────
    public string ReadDeclaration(object node) => (string)((dynamic)node).DeclarationText ?? "";
    public string ReadImplementation(object node) => (string)((dynamic)node).ImplementationText ?? "";

    public void WriteText(object node, string? declaration, string? implementation)
    {
        // No silent catch: a failed COM assignment must surface. A NULL declaration means the item has no
        // declaration slot at all (an action) — don't touch DeclarationText, which a TwinCAT action's COM
        // object doesn't even expose. A null/empty implementation is likewise simply not written.
        dynamic n = node;
        if (declaration != null) n.DeclarationText = declaration;
        if (!string.IsNullOrEmpty(implementation)) n.ImplementationText = implementation;
    }

    /// <summary>The item's raw item-metadata XML (ProduceXml), or "" if it produces none.</summary>
    public string ProduceXml(object node) => (string)((dynamic)node).ProduceXml() ?? "";

    // ── PLCopen XML transport ───────────────────────────────────────
    /// <summary>Export the enclosing POU of <paramref name="item"/> as a PLCopen XML string (via a temp
    /// file). Throws if the item has no enclosing graphical POU.</summary>
    public string ExportPouXml(object item)
    {
        var pou = EnclosingPou(item) ?? throw new InvalidOperationException("TwinCAT: no enclosing POU to export");
        return TcPlcOpen.ExportXmlString(PlcRoot(), PouSelectionPath(pou));
    }

    /// <summary>Import a full PLCopen POU back into the PLC project (same-name replace).</summary>
    public void ImportPlcOpenXml(string xml) => TcPlcOpen.ImportXmlString(PlcRoot(), xml);

    /// <summary>Walk up to the enclosing POU (FB / function / program / interface). Only called for items
    /// the language gate already classified as graphical POUs, so the POU is found at/near hop 0.</summary>
    private dynamic? EnclosingPou(dynamic item)
    {
        dynamic node = item;
        for (var hops = 0; hops < 32; hops++)
        {
            int t;
            try { t = (int)node.ItemType; } catch { t = 0; }
            if (t is ItemKind.Program or ItemKind.Function or ItemKind.FunctionBlock or ItemKind.Interface) return node;
            node = node.Parent;
            if (node == null) return null;
        }
        return null;
    }

    /// <summary>PLC-project-relative selection path for PlcOpenExport ('.'-separated, folder-qualified).
    /// NEEDS LIVE VERIFICATION: if a bare/qualified name is rejected this must change.</summary>
    private string PouSelectionPath(dynamic pou)
    {
        try
        {
            string pouPath = (string)pou.PathName;
            string plcPath = (string)((dynamic)PlcRoot()).PathName;
            if (pouPath.StartsWith(plcPath + "^", StringComparison.Ordinal))
                return pouPath.Substring(plcPath.Length + 1).Replace('^', '.');
            return pouPath.Replace('^', '.');
        }
        catch { try { return (string)pou.Name; } catch { return ""; } }
    }

    // ── build / diagnostics ─────────────────────────────────────────
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
            try { for (int i = 0; i < 100; i++) { if ((int)sb.BuildState != 2) break; System.Threading.Thread.Sleep(100); } } catch { }
            sb.Build(true);
            try { for (int i = 0; i < 100; i++) { if ((int)sb.BuildState != 2) break; System.Threading.Thread.Sleep(100); } } catch { }
            int failed;
            try { failed = sb.LastBuildInfo; } catch { failed = 0; }
            return failed == 0;
        }
        catch { return false; }
    }

    public IReadOnlyList<BridgeDiagnostic> GetBuildDiagnostics()
    {
        var result = new List<BridgeDiagnostic>();
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
                var regex = new Regex(
                    @"^(.+?)(?:\((\d+)(?:,(\d+))?\))?\s*:\s*(error|warning|message)\s*:\s*(.+)$",
                    RegexOptions.IgnoreCase | RegexOptions.Multiline);
                foreach (Match m in regex.Matches(text))
                {
                    int lineNum = 0, colNum = 0;
                    if (m.Groups[2].Success) int.TryParse(m.Groups[2].Value, out lineNum);
                    if (m.Groups[3].Success) int.TryParse(m.Groups[3].Value, out colNum);
                    var sev = m.Groups[4].Value.ToLowerInvariant();
                    result.Add(new BridgeDiagnostic
                    {
                        Severity = sev == "message" ? "info" : sev,
                        Message = m.Groups[5].Value.Trim(),
                        Line = lineNum,
                        Column = colNum,
                    });
                }
            }
        }
        catch { }
        return result;
    }
}
