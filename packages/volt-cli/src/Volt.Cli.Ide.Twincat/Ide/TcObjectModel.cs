using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using Volt.Engine.Diagnostics;
using Volt.Engine.Ide;
using Volt.Engine.Wire;
using Volt.Engine.Workspace;

namespace Volt.Cli.Ide.Twincat;

/// <summary>Thrown by <see cref="TcObjectModel.Connect"/> when no attach target is selected — the worker must
/// not guess a project. Surfaced as the driver's degraded reason; health then reports "no project loaded".</summary>
public sealed class NoProjectSelectedException : InvalidOperationException
{
    public NoProjectSelectedException()
        : base("No project selected — pick a TwinCAT instance/project from the Volt tray (or set VOLT_TC_PROJECT).") { }
    public NoProjectSelectedException(string message) : base(message) { }
}

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
    // "Connected" = a live project is bound. Keyed on the resolved PLC node (not just _plcProjectPath, which can
    // linger as a stale string after the project is closed), so a close/reopen is reflected once the probe drops
    // the node. These are plain field reads — safe to call off the STA thread (health serves from the cache).
    public bool IsConnected => _dte != null && _sysManager != null && _plcNode != null;
    public string? IdeProgId => _ideProgId;
    public string? IdeVersion => _ideVersion;
    public string? ProjectName => _projectName;

    // ── COM attach ──────────────────────────────────────────────────
    public void Connect()
    {
        var targetInstance = Environment.GetEnvironmentVariable("VOLT_TC_INSTANCE");
        var targetProject = Environment.GetEnvironmentVariable("VOLT_TC_PROJECT");

        // Attach to the requested instance, else fall back to the first running one.
        string? instanceId = string.IsNullOrEmpty(targetInstance) ? null : targetInstance;
        if (instanceId != null) _dte = RotInstances.Bind(instanceId);
        if (_dte == null)
        {
            var first = RotInstances.First();
            if (first != null) { _dte = first.Value.Dte; instanceId = first.Value.InstanceId; }
        }
        if (_dte == null) throw new InvalidOperationException("No running TwinCAT XAE / Visual Studio instance found.");

        _ideProgId = instanceId == null ? null : RotInstances.ProgId(instanceId);
        try { _ideVersion = (string?)_dte!.Version; } catch { /* version is cosmetic */ }

        // Only resolve a specific project if a target was explicitly set. Without one, the DTE is attached
        // (health shows "no project loaded") and the PLC project list is available for the picker.
        if (!string.IsNullOrEmpty(targetProject))
        {
            ResolveSelectedProject();
            VoltLog.Info($"attached to TwinCAT {_ideVersion ?? "?"} — {_projectName} / {_plcProjectPath}");
        }
        else
        {
            // Soft attach: find the TwinCAT project so PLCs can be listed, but don't bind a specific one.
            try { FindTwinCatProject(null); } catch { /* no project → will list nothing */ }
            VoltLog.Info($"attached to TwinCAT {_ideVersion ?? "?"} — no project selected");
        }
    }

    /// <summary>Resolve the selected project + PLC project under the current DTE (from the VOLT_TC_* target).
    /// Shared by first <see cref="Connect"/> and the soft re-resolve <see cref="ReattachProject"/>; throws if
    /// the requested project isn't currently open.</summary>
    private void ResolveSelectedProject()
    {
        var targetProject = Environment.GetEnvironmentVariable("VOLT_TC_PROJECT");
        var targetPlc = Environment.GetEnvironmentVariable("VOLT_TC_PLC");
        FindTwinCatProject(string.IsNullOrEmpty(targetProject) ? null : targetProject);
        FindPlcProject(string.IsNullOrEmpty(targetPlc) ? null : targetPlc);
    }

    /// <summary>Bind a SPECIFIC instance/project/PLC project — the connector's `select`. Re-binds the DTE if a
    /// different running instance is named, then re-resolves the chosen project on that live DTE (no worker
    /// respawn, no IDE restart). Throws <see cref="NoProjectSelectedException"/> if no DTE / project is open.</summary>
    public void SelectProject(string? instance, string? project, string? plcProject)
    {
        VoltLog.Info($"select: instance='{instance}' project='{project}' plc='{plcProject}'");
        if (!string.IsNullOrEmpty(instance))
        {
            var dte = RotInstances.Bind(instance!);
            if (dte != null) { _dte = dte; _sysManager = null; _plcNode = null; _projectName = null; _plcProjectPath = null; VoltLog.Info($"select: bound instance '{instance}'"); }
            else
                // Diagnostic for the multi-TcXaeShell case: Bind couldn't resolve the requested instance in the ROT,
                // so we fall through on the OLD dte and then fail to find `project` in it → "Unavailable" → 0 items.
                // Log the instances the ROT DOES list right now so a mismatch (or a vanished instance) is visible.
                VoltLog.Warn($"select: Bind('{instance}') returned NULL — ROT lists: [{string.Join(" | ", RotInstances.Enumerate().Select(x => x.InstanceId))}]");
        }
        if (_dte == null)
        {
            var first = RotInstances.First();
            if (first != null) _dte = first.Value.Dte;
        }
        if (_dte == null) throw new NoProjectSelectedException();
        FindTwinCatProject(string.IsNullOrEmpty(project) ? null : project);
        FindPlcProject(string.IsNullOrEmpty(plcProject) ? null : plcProject);
        if (_sysManager == null)
        {
            // A specific project was asked for and it isn't on the bound instance — FAIL LOUD. Returning here
            // silently left the bridge not-connected, so the eventual fetch came back with zero items and the CLI
            // reported a misleading "is the project open?" instead of "that project isn't in this IDE instance".
            // This is the multi-XAE trap: selecting a project that lives in a DIFFERENT instance than the one bound.
            var open = string.Join(", ", SolutionProjectNames());
            VoltLog.Warn($"select: project '{project}' NOT found on the bound instance (solution has: [{open}])");
            if (!string.IsNullOrEmpty(project))
                throw new NoProjectSelectedException(
                    $"'{project}' is not open in the selected TwinCAT instance (it has: {(string.IsNullOrEmpty(open) ? "no projects" : open)}).");
        }
        else
            VoltLog.Info($"select: resolved '{_projectName}' plc='{_plcProjectPath}'");
    }

    // The IDE-project names in the currently bound DTE's solution — a diagnostic for a select that finds no match.
    private IEnumerable<string> SolutionProjectNames()
    {
        if (_dte == null) yield break;
        int count;
        try { count = (int)_dte.Solution.Projects.Count; } catch { yield break; }
        for (int i = 1; i <= count; i++)
        {
            string? nm = null;
            try { nm = (string)_dte.Solution.Projects.Item(i).Name; } catch { }
            if (nm != null) yield return nm;
        }
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
        if (_plcNode == null && _plcProjectPath != null) _plcNode = LookupTreeItemDynamic(_plcProjectPath!);
        if (_plcNode == null) throw new InvalidOperationException("Cannot find PLC project under TIPC.");
    }

    private dynamic LookupTreeItemDynamic(string path) => _sysManager!.LookupTreeItem(path);

    public object LookupTreeItem(string path) => LookupTreeItemDynamic(path);

    public void Disconnect()
    {
        DropProject();
        if (_dte != null) { try { Marshal.ReleaseComObject(_dte); } catch { } _dte = null; }
        VoltLog.Info("disconnected from TwinCAT");
    }

    /// <summary>Drop the project binding but KEEP the DTE — for a project close/switch while the IDE stays open,
    /// so the next probe can re-resolve the selected project without a full re-attach. Nulls the fields
    /// <see cref="IsConnected"/> reads, so it correctly reports "not connected" until re-resolved.</summary>
    public void DropProject()
    {
        if (_plcNode != null) { try { Marshal.ReleaseComObject(_plcNode); } catch { } _plcNode = null; }
        if (_sysManager != null) { try { Marshal.ReleaseComObject(_sysManager); } catch { } _sysManager = null; }
        _projectName = null; _plcProjectPath = null;
    }

    /// <summary>Re-resolve the selected project under the CURRENT DTE (no re-bind). Called only when a target was
    /// selected (so <see cref="_dte"/> is bound) — never a silent first attach. Throws if the project isn't open
    /// yet, leaving the worker in the "no project" state until it is.</summary>
    public void ReattachProject()
    {
        if (_dte == null) throw new InvalidOperationException("no IDE bound");
        DropProject();
        ResolveSelectedProject();
    }

    // ── health ──────────────────────────────────────────────────────
    public bool ProbeIdeAlive()
    {
        if (_dte == null) return false;
        try { var _ = (int)_dte.Solution.Count; return true; }
        catch { return false; }
    }

    /// <summary>Whether the bound project is STILL the open project. Touches the PLC node — a closed/reloaded
    /// project leaves a stale COM ref that throws here, which is how a close is detected (the DTE-level
    /// <see cref="ProbeIdeAlive"/> stays true through a project close, so it can't). Must run on the STA thread.</summary>
    public bool ProbeProjectAlive()
    {
        if (_plcNode == null) return false;
        try { var _ = (string)_plcNode.Name; return true; }
        catch (COMException com)
        {
            // A momentarily busy IDE (mid-build / modal / reload) is NOT a closed project — ComMessageFilter
            // usually retries these before they surface, but if one leaks through, treat it as "still alive,
            // just busy" so a build doesn't flap us to "no project". Anything else = the ref is gone (closed).
            var hr = unchecked((uint)com.HResult);
            return hr == 0x8001010Au   // RPC_E_SERVERCALL_RETRYLATER
                || hr == 0x80010001u;  // RPC_E_CALL_REJECTED
        }
        catch { return false; }        // non-COM read failure → treat as gone and re-resolve (self-heals)
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
        // vInfo for a FUNCTION ("vInfo (Type: String) not supported") — omit it (Type.Missing).
        // Interfaces and their children have no body language — pass null (TC rejects "ST" for these).
        // TC does not accept "LD" directly — create as FBD; the ladder view is stored as
        // DefaultViewMode metadata in the NWL archive, which TcPouReader preserves on read-back.
        var lang = language is "LD" ? "FBD" : (language ?? "ST");
        object? vInfo = kindCode switch
        {
            ItemKind.PlcPouFunc => System.Type.Missing,
            ItemKind.PlcItf => null,
            // Interface method/property: TC wants the return/data type as a STRING vInfo (carried in the
            // `language` arg by PushService, null when untyped) — NOT a body language. Matches the working
            // Beckhoff sample (BuildChildVInfo): method→returnType, property→dataType, else null.
            ItemKind.PlcItfMeth or ItemKind.PlcItfProp => (object?)language,
            // Interface property accessors: "ST" body language (per the Beckhoff CreateChild sample).
            ItemKind.PlcItfPropGet or ItemKind.PlcItfPropSet => "ST",
            _ => lang,
        };
        return (object)((dynamic)parent).CreateChild(name, kindCode, "", vInfo);
    }
    public void DeleteChild(object parent, string name) => ((dynamic)parent).DeleteChild(name);
    public void Rename(object node, string newName) => ((dynamic)node).Name = newName;

    // ── source text ─────────────────────────────────────────────────
    public string ReadDeclaration(object node) => (string)((dynamic)node).DeclarationText ?? "";
    public string ReadImplementation(object node)
    {
        try { return (string)((dynamic)node).ImplementationText ?? ""; }
        catch { return ""; }
    }

    public void WriteText(object node, string? declaration, string? implementation)
    {
        // No silent catch: a failed COM assignment must surface. A NULL declaration means the item has no
        // declaration slot at all (an action) — don't touch DeclarationText, which a TwinCAT action's COM
        // object doesn't even expose. NULL implementation means the same (no impl slot — interface). An
        // EMPTY-STRING implementation is a REAL body value ("") and MUST be written to CLEAR the existing
        // body — skipping it (the old `!IsNullOrEmpty` guard) left a stale body when a POU was emptied,
        // diverging from CODESYS's `WriteSourceText` (which writes on `implementation != null`).
        dynamic n = node;
        if (declaration != null) n.DeclarationText = declaration;
        if (implementation != null) n.ImplementationText = implementation;
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
            if (t is ItemKind.PlcPouProg or ItemKind.PlcPouFunc or ItemKind.PlcPouFb or ItemKind.PlcItf) return node;
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
        // DTE.Documents.SaveAll() saves open editor tabs, but tree operations
        // (create/delete/rename) change the project structure on disk. Force
        // the solution to persist so subsequent rename ops don't collide with
        // stale files from async tree deletions.
        try { _dte.Solution.Save(); } catch { }
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
