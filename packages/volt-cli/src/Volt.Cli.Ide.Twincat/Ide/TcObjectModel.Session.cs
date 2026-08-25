using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using Volt.Wire;
using Volt.Engine;
using Volt.Contracts;
using Volt.Engine.Vocabulary;
using Volt.Engine.Host;

namespace Volt.Cli.Ide.Twincat;

/// <summary>The DTE attach and project-selection state machine: acquiring our XAE window by its stable pid,
/// resolving a project inside it by NAME, and re-acquiring both after TcXaeShell re-registers.
/// <para>Separated because it is the one part of this gateway that is about LIVENESS rather than content —
/// ~230 lines whose whole subject is that an out-of-process COM target can go away and come back. Everything
/// else here assumes a live handle; this is what makes that assumption hold.</para></summary>
internal sealed partial class TcObjectModel
{
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
        // pick updates it — a soft/empty select must not erase it, it re-establishes the standing selection instead.
        if (!string.IsNullOrEmpty(project)) _wantProject = project;
        BindAndResolve(_wantProject, "select");
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
    // re-registration yields a NEW DTE COM object for the same window; dropping the old one avoids both a leak and
    // keeping a dead reference alive.
    // NB (audit batch 8): releasing UNCONDITIONALLY may be the correct balance — RotInstances.BindByPid marshals a
    // fresh reference out of the ROT, so the RCW cache returns the same wrapper with its ref count bumped, and
    // skipping the release would leak one reference per select/reattach. That is a behaviour change and belongs in
    // its own commit with its own reasoning; escalated to arch-notes.md rather than taken as a cleanup.
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
            // A project the user can SEE in the IDE but that we cannot name would simply not appear in the
            // connect list, with nothing said. Still skipped (one bad entry must not empty the list), but named.
            try { nm = (string)_dte.Solution.Projects.Item(i).Name; }
            catch (Exception ex) { VoltLog.Warn($"twincat: solution project #{i} name unreadable — omitted from the project list: {ex.Message}"); }
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
                catch { /* not this child - keep looking; a total miss throws below */ }
            }
        }
        catch (Exception ex) { VoltLog.Warn($"twincat: the TIPC walk failed: {ex.Message}"); }
        // No re-lookup fallback on _plcProjectPath: it and _plcNode are only ever written in the SAME statement
        // (the TIPC walk above) and only ever cleared together, and EnsurePlc calls this only when _plcNode is
        // null — so "path known, node missing" cannot occur and any such branch was unreachable.
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
        // NOTE: the DESIRED selection (_wantProject) is intentionally kept — a dropped IDE/DTE is transient, and the
        // next recovery must re-establish the SAME project when TwinCAT returns. Only an explicit new select changes it.
        // ponytail: on TwinCAT this method is INTERFACE-OBLIGATION ONLY — it has no production caller. The wire
        // `disconnect` op only sets BridgePipeHost._paused (it tears nothing down), and the single production caller
        // of IIdeSession.Disconnect() is the CODESYS in-proc PipeHost. Kept because BeckhoffDriver must satisfy the
        // abstract override; read the NOTE above as the contract it WOULD honour, not as a live invariant.
    }

    // Release the DTE handle and forget it. The moniker is ephemeral and the handle can go dead (0x800706BA), so
    // recovery re-acquires a FRESH one for OUR window by its stable pid, then resolves the project by name, rather
    // than resolving on a stale/dead reference.
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
    /// close / re-registration / RPC drop. Re-acquires a FRESH DTE for OUR window by its STABLE pid and then resolves
    /// the project by name — the held <see cref="_dte"/> may be dead (<c>0x800706BA</c>) and its moniker ephemeral, so
    /// it re-binds rather than reusing. No-op when nothing was ever selected (stays in the soft/list state). Never
    /// throws; leaves the model not-connected if the desired project is no longer open, so Core refuses cleanly.</summary>
    public void ReattachProject()
    {
        DropProject();
        if (string.IsNullOrEmpty(_wantProject)) return;   // nothing selected yet → nothing to recover to
        // The current handle is why we're recovering — release it so BindAndResolve re-acquires a FRESH DTE for OUR
        // window by its stable pid and then resolves the desired project by name, rather than resolving on a
        // dead/stale reference.
        ReleaseDte();
        BindAndResolve(_wantProject, "reattach");
    }
}
