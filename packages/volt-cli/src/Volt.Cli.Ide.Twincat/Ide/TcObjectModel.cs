using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using Volt.Cli.Transport;
using Volt.Engine;
using Volt.Engine.Ide;
using Volt.Engine.Wire;
using Volt.Engine.Workspace;

namespace Volt.Cli.Ide.Twincat;

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
    private string? _ideVersion;

    // The ONE XAE window this worker owns, by its stable process id. Selection and recovery re-acquire THIS pid
    // (stable across a DTE re-registration), never search other windows. Set once at startup by ConnectToPid.
    private int _xaePid;

    // The DESIRED selection — the project name the user last explicitly picked (the connector's `select`). Recovery
    // (ReattachProject, after a project close / re-registration / RPC drop) re-establishes THIS, by its stable
    // NAME, instead of resolving the first-available. Without it, any hiccup silently flipped a two-XAE setup to the
    // other project. Set only by an explicit project select; cleared by Disconnect.
    private string? _wantProject;

    // "Connected" = a project is BOUND: its DTE + TwinCAT project (system manager) are resolved. It deliberately
    // does NOT require the PLC node — that is CONTENT, resolved lazily on the first content op (see EnsurePlc), so a
    // select/health never has to walk into the PLC application. Plain field reads — safe off the STA thread.
    public bool IsConnected => _dte != null && _sysManager != null;
    public string? IdeVersion => _ideVersion;
    public string? ProjectName => _projectName;

    /// <summary>Whether the user has explicitly picked a project (the connector's `select`). When true, recovery
    /// re-establishes THAT project by its stable name; when false, nothing is bound (health shows no project).</summary>
    public bool HasSelection => !string.IsNullOrEmpty(_wantProject);

    // ── COM attach ──────────────────────────────────────────────────
    /// <summary>Per-XAE attach: OWN the one XAE window with process id <paramref name="pid"/> and bind its DTE. The
    /// worker serves only this window; <see cref="SelectProject"/>/<see cref="ReattachProject"/> re-acquire THIS pid
    /// (stable) instead of searching windows by name. Throws if that XAE isn't running (the connector spawned us for
    /// a pid it saw; a race where it closed first surfaces here and the connector reaps us).</summary>
    public void ConnectToPid(int pid)
    {
        _xaePid = pid;
        var dte = RotInstances.BindByPid(pid) ?? throw new InvalidOperationException($"No running TwinCAT XAE with pid {pid}.");
        SwapDte(dte);
        VoltLog.Info($"attached to TwinCAT {_ideVersion ?? "?"} (xae pid {pid}) — no project selected");
    }

    /// <summary>Ambient re-attach for the health poll: if our held DTE is gone or dead, re-acquire OUR window by its
    /// stable pid so the owned-window project list SURVIVES a DTE re-registration (the durability the pid model
    /// exists for) WITHOUT waiting for a `select`. A BARE bind only — it never resolves a project (no `_sysManager`,
    /// no PLC walk), so the health poll's "no resolution" invariant holds. When a project IS already selected the
    /// full recovery is left to content-op <see cref="ReattachProject"/> (which re-resolves), so this no-ops then.
    /// Runs on the STA thread (SnapshotHealth calls it).</summary>
    public void EnsureAttached()
    {
        if (HasSelection) return;                       // a selected project recovers fully on the next content op
        if (_dte != null && ProbeIdeAlive()) return;    // held DTE still answers — nothing to do
        var dte = RotInstances.BindByPid(_xaePid);      // dead/gone → re-acquire our window by pid (bare, no resolve)
        if (dte != null) SwapDte(dte);
    }

    /// <summary>Bind a project by NAME within OUR XAE window — the connector's `select`. Re-acquires our window (by
    /// pid) and resolves the named project inside it (no worker respawn, no IDE restart). Does NOT throw: it attaches
    /// what it can and leaves the model connected or not. The Core `select` handler (BridgePipeHost) enforces the
    /// post-condition uniformly — a select that leaves the bridge NOT connected is refused there with the shared
    /// PLC_DISCONNECTED, identically for both vendors. This method's job is only the vendor-specific attach +
    /// diagnostics; it must not decide the wire outcome.</summary>
    public void SelectProject(string? project)
    {
        VoltLog.Info($"select: project='{project}'");
        // Persist the DESIRED selection so recovery re-establishes exactly this by name. Only an explicit project
        // pick updates it — a soft/empty select must not erase it, and re-establishes the standing selection.
        if (!string.IsNullOrEmpty(project)) _wantProject = project;
        BindAndResolve(string.IsNullOrEmpty(project) ? _wantProject : project, "select");
    }

    /// <summary>Re-acquire OUR XAE window (by its stable pid) and resolve <paramref name="project"/> inside it — the
    /// ONE resolution path, shared by <see cref="SelectProject"/> and the recovery <see cref="ReattachProject"/>.
    /// Re-acquires by PID because TcXaeShell re-registers its DTE with a fresh cookie and the held handle can go dead
    /// (<c>0x800706BA</c>) — the window pid is the only durable key, and unlike a name search it never drifts to
    /// another window. Leaves the model connected on success, not-connected on a miss (Core refuses). Never throws
    /// for a not-found project.</summary>
    private void BindAndResolve(string? project, string tag)
    {
        // Re-acquire OUR window by its stable pid, then resolve the project inside it. The DTE re-registers with a
        // fresh cookie/moniker but keeps its pid, so this survives a re-registration AND never drifts to another
        // window (a name search could). Both a project select and the soft attach re-bind the same one window.
        var dte = RotInstances.BindByPid(_xaePid);
        if (dte != null) { SwapDte(dte); if (!string.IsNullOrEmpty(project)) FindTwinCatProject(project); }
        if (_dte == null) { VoltLog.Warn($"{tag}: no running TwinCAT/VS instance to bind"); return; } // Core: not connected → refuse
        if (string.IsNullOrEmpty(project)) { FindTwinCatProject(null); return; }   // soft attach: resolve first so PLCs list

        if (_sysManager == null)
        {
            VoltLog.Warn($"{tag}: project '{project}' NOT found in our XAE (pid {_xaePid}) — it has: [{string.Join(", ", SolutionProjectNames())}]");
            return;
        }
        // Bound. The PLC application is NOT resolved here — that's content, deferred to EnsurePlc on the first
        // content op, which takes the first/default PLC project (connecting is identity-only, never a PLC pick).
        VoltLog.Info($"{tag}: bound '{_projectName}' on instance serving [{string.Join(", ", SolutionProjectNames())}]");
    }

    // Retarget the DTE, releasing the previous handle when it's a DIFFERENT object. Re-binding our pid after a
    // re-registration yields a NEW DTE COM object for the same window; dropping the old one avoids both a leak
    // and keeping a dead reference alive.
    private void SwapDte(dynamic newDte)
    {
        if (_dte != null && !ReferenceEquals(_dte, newDte))
        {
            try { Marshal.ReleaseComObject(_dte); } catch { }
        }
        _dte = newDte;
        try { _ideVersion = (string?)_dte.Version; } catch { /* version is cosmetic */ }
    }

    /// <summary>The OWNED XAE window's (version, project names) — this worker's health list, ITS window only.
    /// Name-only — never touches the PLC tree (that can fault a fragile XAE in its own process). Runs on the STA thread.</summary>
    public (string? Version, List<string> Projects) OwnSolution() => (_ideVersion, SolutionProjectNames().ToList());

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
        // Start from a CLEAN slate. This method only SETS the resolved-project fields on a match; it never cleared
        // them, so a project that isn't found (or a fallback to a different DTE after a failed instance Bind) left
        // the PREVIOUS project's _sysManager in place — making IsConnected wrongly true and silently serving the OLD
        // project while a DIFFERENT one was requested. Reset first so a miss leaves the model NOT connected.
        _sysManager = null; _plcNode = null; _projectName = null; _plcProjectPath = null;
        dynamic solution = _dte!.Solution;
        dynamic projects = solution.Projects;
        int count = projects.Count;
        VoltLog.Debug($"FindTwinCatProject: want='{wantProject ?? "(first)"}' among {count} project(s) in the bound DTE");
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
                // Resolve ONLY the TwinCAT project (its system manager) + name. The PLC application inside is CONTENT
                // — NOT resolved here; EnsurePlc does that lazily on the first content op, so select/health stay out
                // of the project's tree. TcXaeShell: proj.Object IS the SystemManager; full VS: obj.SystemManager.
                dynamic obj = proj.Object;
                try { _sysManager = obj; } catch { _sysManager = null; }
                if (_sysManager == null) { try { _sysManager = obj.SystemManager; } catch { continue; } }
                if (_sysManager != null) { _projectName = proj.Name; break; }
            }
            catch (Exception ex) { VoltLog.Debug($"FindTwinCatProject: project #{i} skipped ({ex.Message})"); }
        }
        // Do NOT throw here: BindAndResolve (the connector's `select`) checks _sysManager itself and recovers by
        // project name, else leaves the model not-connected for Core to refuse. Throwing would turn a clean
        // PLC_DISCONNECTED into an opaque INTERNAL_ERROR.
        if (_sysManager == null)
            VoltLog.Debug($"FindTwinCatProject: '{wantProject ?? "(first)"}' not resolved in the bound DTE (has: [{string.Join(", ", SolutionProjectNames())}])");
    }

    private void FindPlcProject()
    {
        if (_plcProjectPath != null) { _plcNode = LookupTreeItemDynamic(_plcProjectPath); return; }
        try
        {
            dynamic tipc = _sysManager!.LookupTreeItem("TIPC");
            int childCount = tipc.ChildCount;
            for (int i = 1; i <= childCount; i++)
            {
                try
                {
                    dynamic plc = tipc.Child[i];
                    _plcNode = plc; _plcProjectPath = (string)plc.Name; break;
                }
                catch { }
            }
        }
        catch { }
        if (_plcNode == null && _plcProjectPath != null) _plcNode = LookupTreeItemDynamic(_plcProjectPath!);
        if (_plcNode == null) throw new InvalidOperationException("Cannot find PLC project under TIPC.");
    }

    /// <summary>Resolve the PLC application node the FIRST time a content op needs it. select/health NEVER call this,
    /// so the PLC tree is touched only when the user actually syncs (init/pull/push/build). Idempotent — a no-op once
    /// resolved; DropProject clears it so a reconnect re-resolves. Resolves the first/default PLC project.</summary>
    private void EnsurePlc()
    {
        if (_plcNode != null) return;
        if (_sysManager == null) throw new InvalidOperationException("no TwinCAT project bound");
        FindPlcProject();
    }

    private dynamic LookupTreeItemDynamic(string path) => _sysManager!.LookupTreeItem(path);

    public object LookupTreeItem(string path) => LookupTreeItemDynamic(path);

    public void Disconnect()
    {
        DropProject();
        ReleaseDte();
        VoltLog.Info("disconnected from TwinCAT");
        // NOTE: the DESIRED selection (_want*) is intentionally kept — a dropped IDE/DTE is transient, and the next
        // recovery must re-establish the SAME project when TwinCAT returns. Only an explicit new select changes it.
    }

    // Release the DTE handle and forget it. The moniker is ephemeral and the handle can go dead (0x800706BA), so
    // recovery re-acquires a FRESH one by project name rather than resolving on a stale/dead reference.
    private void ReleaseDte()
    {
        if (_dte != null) { try { Marshal.ReleaseComObject(_dte); } catch { } _dte = null; }
    }

    /// <summary>Drop the project + PLC binding (keeps the DTE). Nulls the fields <see cref="IsConnected"/> reads, so
    /// it reports "not connected" until the next <c>select</c> or content-op recovery re-resolves. Used by that
    /// recovery (<see cref="ReattachProject"/>) — never by the health poll, which does no resolution.</summary>
    public void DropProject()
    {
        if (_plcNode != null) { try { Marshal.ReleaseComObject(_plcNode); } catch { } _plcNode = null; }
        if (_sysManager != null) { try { Marshal.ReleaseComObject(_sysManager); } catch { } _sysManager = null; }
        _projectName = null; _plcProjectPath = null;
    }

    /// <summary>Recovery: re-establish the DESIRED selection (the user's last explicit pick) after a project
    /// close / re-registration / RPC drop. Re-acquires a FRESH DTE for the project by its STABLE name — the held
    /// <see cref="_dte"/> may be dead (<c>0x800706BA</c>) and its moniker ephemeral, so it re-binds rather than
    /// reusing. No-op when nothing was ever selected (stays in the soft/list state). Never throws; leaves the model
    /// not-connected if the desired project is no longer open, so Core refuses cleanly.</summary>
    public void ReattachProject()
    {
        DropProject();
        if (string.IsNullOrEmpty(_wantProject)) return;   // nothing selected yet → nothing to recover to
        // The current handle is why we're recovering — release it so BindAndResolve re-acquires a FRESH DTE for the
        // desired project by name, rather than resolving on a dead/stale reference.
        ReleaseDte();
        BindAndResolve(_wantProject, "reattach");
    }

    // ── health (TOP-LEVEL liveness only — no content) ────────────────
    /// <summary>Does the bound IDE/solution still respond? A single top-level read (project count) — no PLC node, no
    /// tree walk. This is the ONLY thing the health poll touches.</summary>
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
    /// <summary>The PLC project root (its NestedProject), the default parent for new POUs. Lazily resolves the PLC
    /// node on first use (EnsurePlc) — this is THE point where a content op reaches into the PLC application.</summary>
    public object PlcRoot()
    {
        EnsurePlc();
        try { return _plcNode!.NestedProject; } catch { /* fall through to lookup */ }
        return LookupTreeItemDynamic(_plcProjectPath!);
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
    /// <summary>Commit applied writes to TwinCAT's own store. <c>DTE.Documents.SaveAll()</c> saves open editor tabs,
    /// but tree operations (create/delete/rename) change the project structure on disk, so the solution is persisted
    /// too — otherwise a later rename collides with stale files from async tree deletions.
    /// <para>A failure here is NOT swallowed. Durability is this method's entire purpose: `push` calls it and then
    /// reports success, so a silently-failed save means Volt tells the engineer their work is committed while it
    /// exists only in the IDE's memory — and an IDE crash loses it. Fail loud instead, and let the push fail.</para></summary>
    public void FlushPendingWrites()
    {
        if (_dte == null)
            throw new BridgeException(BridgeErrorCodes.PlcDisconnected,
                "cannot commit writes — no IDE is attached");
        // ponytail: saves the whole solution + ALL open documents, which also commits the engineer's unrelated dirty
        // editors — a side effect on data Volt does not own. DECIDED (2026-07-30) to scope this to only what Volt
        // wrote; not yet implemented because a write here targets a system-manager TREE NODE
        // (n.DeclarationText/ImplementationText), and a tree node exposes no DTE document or file path, so the
        // node -> document/project mapping has to be found against the live COM model first. Until then the broad
        // save stays, because it is what makes `push` durable at all (CODESYS commits on write, so dropping it would
        // leave push durable on one vendor and not the other). Upgrade path in
        // openspec/changes/fix-push-data-loss tasks §4.
        // `Solution.Save()` DOES NOT EXIST. EnvDTE's solution interface exposes SaveAs, not Save, so this line threw
        // `'System.__ComObject' does not contain a definition for 'Save'` on EVERY push — and because it threw
        // FIRST, `Documents.SaveAll()` never ran either. Under the old bare `catch { }` the whole method was a
        // silent no-op, which is why a 90-pass TwinCAT baseline was recorded against a save that never happened;
        // making the failure loud (838c4140e1) turned that into 63 red e2e tests, exactly the diagnostic that
        // commit predicted. `File.SaveAll` is the shell command behind File > Save All: it persists open documents,
        // every dirty PROJECT (including the `.plcproj` whose missing registration is the orphan bug,
        // openspec/changes/fix-push-data-loss §3) and the solution, in one call that actually exists.
        try
        {
            _dte.ExecuteCommand("File.SaveAll");
        }
        catch (Exception ex)
        {
            VoltLog.Warn($"File.SaveAll failed — applied writes may not be on disk: {ex.Message}");
            throw new BridgeException(BridgeErrorCodes.InternalError,
                $"the IDE could not save the applied changes, so they are NOT committed to disk: {ex.Message}", ex);
        }
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
