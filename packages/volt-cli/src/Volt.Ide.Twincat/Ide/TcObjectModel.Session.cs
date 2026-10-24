using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using Volt.Wire;
using Volt.Engine;
using Volt.Contracts;
using Volt.Engine.Format.Body;
using Volt.Engine.Host;

namespace Volt.Ide.Twincat;

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
        var dte = BindWindow(pid) ?? throw BridgeException.PlcDisconnected($"No running TwinCAT XAE with pid {pid}.");
        SwapDte(dte);
        // The vendor is the one fact only the exe states (the DTE has no vendor member), and the exe is the XAE's —
        // through ITS pid, never this worker's own process, which would name VoltBridgeTwincat (DIALECT V4/V5).
        try { _productVendor = Stated(ReadXaeVendor(pid)); }
        catch (Exception ex) { VoltLog.Warn($"twincat: the XAE exe's version-info is unreadable, productVendor is null: {ex.GetType().Name}: {ex.Message}"); }
        Log($"attached to {_productName ?? "(product unread)"} {_productVersion ?? "(version unread)"} " +
                     $"by {_productVendor ?? "(vendor unread)"} (xae pid {pid})");
    }

    /// <summary>The XAE exe's <c>CompanyName</c> by pid — its <c>MainModule</c>'s version-info in production, a double in
    /// the offline tests (<c>TcIdentityTests</c>). Readable from the win-x64 worker for a 32-bit shell (DIALECT V5).</summary>
    internal Func<int, string?> ReadXaeVendor { get; set; } = pid =>
    {
        using var xae = System.Diagnostics.Process.GetProcessById(pid);
        return xae.MainModule?.FileVersionInfo.CompanyName;
    };

    /// <summary>A stated value, verbatim, or null when the source states nothing (empty or whitespace).</summary>
    private static string? Stated(string? value) => string.IsNullOrWhiteSpace(value) ? null : value;

    /// <summary>How this worker reaches its XAE window by pid — the ROT in production, a double in the offline tests
    /// (<c>TcAttachTests</c>). The one way in: attach, recovery and the health poll all re-acquire through it.</summary>
    internal Func<int, object?> BindWindow { get; set; } = RotInstances.BindByPid;

    /// <summary>
    /// THE ATTACH SERVES WHAT THE WINDOW HAS OPEN — its first TwinCAT project — until a client picks another by name,
    /// as the CODESYS attach serves its primary project — a consumer with no local client to send `select` (the relay)
    /// is served too (openspec <c>twincat-bind-without-a-local-client</c>).
    /// <para>What it takes up becomes the standing selection, so recovery re-establishes it after a DTE drop exactly as
    /// it would a pick — <see cref="ReattachProject"/> recovers only a selection. A pick already standing is never
    /// replaced. The resolve is the one a `select` makes (the project's system manager, never its PLC tree).</para>
    /// </summary>
    public void AttachFirstProject()
    {
        if (HasSelection || _dte == null) return;
        FindTwinCatProject(null);
        if (_sysManager == null) return;   // no TwinCAT project open yet — the health poll takes it up when one is
        _wantProject = _projectName;
        VoltLog.Info($"attach: serving the solution '{_projectName}' — system projects [{string.Join(", ", _systems.Select(s => s.Name))}]");
    }

    /// <summary>Ambient re-attach for the health poll: if our held DTE is gone or dead, re-acquire OUR window by its
    /// stable pid so the owned-window project list SURVIVES a DTE re-registration (the durability the pid model
    /// exists for) WITHOUT waiting for a `select`. While the worker serves nothing — the window had no TwinCAT project
    /// when it attached — it completes the attach (<see cref="AttachFirstProject"/>), so a project opened later is
    /// served without anyone sending `select`; that resolve touches the system manager, never the PLC tree, and stops
    /// once a project is taken up. When one IS already selected the full recovery is left to content-op
    /// <see cref="ReattachProject"/> (which re-resolves), so this no-ops then. Runs on the STA thread (SnapshotHealth
    /// calls it).</summary>
    public void EnsureAttached()
    {
        if (HasSelection) return;                       // a selected project recovers fully on the next content op
        if (_dte == null || !ProbeIdeAlive())
        {
            var dte = BindWindow(_xaePid);              // dead/gone → re-acquire our window by pid
            if (dte != null) SwapDte(dte);
        }
        AttachFirstProject();
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
        var dte = BindWindow(_xaePid);
        if (dte != null) { SwapDte(dte); if (!string.IsNullOrEmpty(project)) FindTwinCatProject(project); }
        if (_dte == null) { VoltLog.Warn($"{tag}: no running TwinCAT/VS instance to bind"); return; } // Core: not connected → refuse
        if (string.IsNullOrEmpty(project)) { FindTwinCatProject(null); return; }   // soft attach: resolve first so PLCs list

        if (_sysManager == null)
        {
            VoltLog.Warn($"{tag}: project '{project}' NOT found in our XAE (pid {_xaePid}) — it has: {SolutionName() ?? "no solution file"}");
            return;
        }
        // Bound. The PLC projects are NOT resolved here — that's content, deferred to EnsurePlc on the first content op
        // (connecting is identity-only, never a PLC pick).
        VoltLog.Info($"{tag}: bound '{_projectName}' — system projects [{string.Join(", ", _systems.Select(s => s.Name))}]");
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
        // The product: the running shell's own answer (DIALECT V5) — `TcXaeShell` / `15.0`, the form PLCAssist's
        // pre-Volt history recorded; the platform is the build (OwnSolution).
        _productName = ReadStated(() => (string?)_dte.Name, "DTE.Name");
        _productVersion = ReadStated(() => (string?)_dte.Version, "DTE.Version");
    }

    /// <summary>The OWNED XAE window's (TwinCAT build, served names) — this worker's health list, ITS window only: ONE
    /// name, the open SOLUTION's (openspec multi-application-tree, design §7: one refs holds every system project of the
    /// solution, so the solution is what is served), or none when no solution holding a TwinCAT project is open.
    /// Name-only — never touches the PLC tree (that can fault a fragile XAE in its own process). Runs on the STA thread.
    /// The build is re-read here, with the snapshot: it is the remote manager the open SOLUTION is pinned to, so it can
    /// change inside one DTE; empty with no solution open, which reads null (DIALECT V5).
    /// <para>One COM read per snapshot (the ~5 s probe): <c>GetObject("TcRemoteManager")</c> hands back a fresh RCW
    /// each time, so it is released here the way <see cref="SwapDte"/> releases a replaced DTE — never left for the
    /// finalizer to collect one per poll. A failing read stays null and never throws: this snapshot is the probe's
    /// NEVER-THROWS path (<c>BeckhoffDriver.RefreshHealthSnapshot</c>), and a dead channel is already answered there by
    /// <see cref="ProbeIdeAlive"/>, which runs first. The build is logged at the first read and on every change, so a
    /// field log names the TwinCAT build the way the CODESYS start line names its platform.</para></summary>
    public (string? Version, List<string> Projects) OwnSolution()
    {
        if (_dte != null)
        {
            var build = ReadBuild();
            if (!_buildLogged || build != _ideVersion)
                Log($"twincat build (TcRemoteManager.Version): {build ?? "(none stated — no solution open, or unreadable)"}");
            _buildLogged = true;
            _ideVersion = build;
        }
        else _ideVersion = null;
        return (_ideVersion, SolutionName() is { } name && TwinCatSystems().Count > 0 ? new List<string> { name } : new List<string>());
    }

    /// <summary>Why this window serves nothing while a TwinCAT project is open in it, or null: its solution has no file.
    /// A <c>.tsproj</c> opened with File > Open > Project where no <c>.sln</c> holds it gives a solution with an empty
    /// <c>FullName</c>, and a save then opens a modal "Save File As" that blocks COM — and a build saves before it
    /// compiles (DIALECT D44, D45). So the window is not served, and the refusal says how to serve it.</summary>
    public string? NotServedBecause()
    {
        if (_dte == null) return null;
        string? file;
        try { file = (string?)_dte.Solution.FullName; }
        catch { return null; }   // unreadable: SolutionName() logs it, and the generic refusal stands
        return string.IsNullOrEmpty(file) && TwinCatSystems().Count > 0
            ? "This TwinCAT window's solution is not saved; save it (File > Save All) to sync it."
            : null;
    }

    /// <summary>The open solution's name — its <c>.sln</c> file's, as the engineer sees it in XAE — or null when no
    /// solution file is open (nothing is served then: an unsaved solution has no name to bind a workspace to).</summary>
    private string? SolutionName()
    {
        if (_dte == null) return null;
        string? file;
        try { file = (string?)_dte.Solution.FullName; }
        catch (Exception ex)
        {
            VoltLog.Warn($"twincat: the solution's file name is unreadable — nothing is served: {ex.Message}");
            return null;
        }
        return string.IsNullOrEmpty(file) ? null : System.IO.Path.GetFileNameWithoutExtension(file);
    }

    /// <summary>Every TwinCAT system project of the solution, in solution order, each with its system manager — the
    /// projects that are no TwinCAT project (a C# ADS client, a TcHmi) passed over, as <see cref="FindTwinCatProject"/>
    /// always passed them over. Never touches a PLC tree.</summary>
    private List<(string Name, dynamic Manager)> TwinCatSystems()
    {
        var found = new List<(string, dynamic)>();
        if (_dte == null) return found;
        int count;
        try { count = (int)_dte.Solution.Projects.Count; }
        catch (Exception ex) { VoltLog.Debug($"twincat: solution project count unreadable: {ex.Message}"); return found; }
        for (int i = 1; i <= count; i++)
        {
            try
            {
                dynamic proj = _dte.Solution.Projects.Item(i);
                // See the DO-NOT on FindTwinCatProject's former loop (TcSystemManager): ASKED by capability.
                dynamic obj = proj.Object;
                dynamic? mgr = TcSystemManager.Is(obj) ? obj : TcSystemManager.Nested(obj);
                if (mgr == null) continue;
                found.Add(((string)proj.Name, mgr));
            }
            catch (Exception ex) { VoltLog.Debug($"twincat: solution project #{i} skipped ({ex.Message})"); }
        }
        return found;
    }

    private bool _buildLogged;

    private string? ReadBuild()
    {
        object? remote = null;
        try
        {
            return ReadStated(() =>
            {
                remote = (object)_dte!.GetObject("TcRemoteManager");
                return (string?)((dynamic)remote).Version;
            }, "TcRemoteManager.Version");
        }
        finally { if (remote != null) ReleaseCom(remote); }
    }

    /// <summary>How a COM handle this model obtained is let go — <c>Marshal.ReleaseComObject</c> in production (a plain
    /// object is not a COM handle and is left alone), a counting double in the offline tests (<c>TcIdentityTests</c>).</summary>
    internal Action<object> ReleaseCom { get; set; } = o => { if (Marshal.IsComObject(o)) Marshal.ReleaseComObject(o); };

    /// <summary>Where this model's Info lines go — <c>VoltLog</c> in production, a list in the offline tests.</summary>
    internal Action<string> Log { get; set; } = VoltLog.Info;

    /// <summary>One identity read off the DTE: its answer verbatim, null when empty, and null when it throws — then the
    /// log names the exception, once per source and message (it is re-read every snapshot).</summary>
    private static string? ReadStated(Func<string?> read, string source)
    {
        try { return Stated(read()); }
        catch (Exception ex)
        {
            var why = $"{ex.GetType().Name}: {ex.Message}";
            Volt.Engine.Ide.BridgeLog.WarnOnce("twincat-identity:" + source + ":" + why, $"twincat: {source} is unreadable, reported as null: {why}");
            return null;
        }
    }

    /// <summary>Bind the open SOLUTION — every TwinCAT system project in it (openspec multi-application-tree, design §7:
    /// one refs holds them all, so the solution is the bound project, named after its <c>.sln</c>). <paramref name="wantProject"/>
    /// null takes what is open; a name binds only a solution of that name.
    ///
    /// <para>Start from a CLEAN slate. This only SETS the resolved fields on a match; it never cleared them once, so a
    /// solution that isn't found left the PREVIOUS one's system manager in place — <c>IsConnected</c> wrongly true, the
    /// OLD project served while a DIFFERENT one was requested. Reset first so a miss leaves the model NOT connected.</para>
    ///
    /// <para>Resolves ONLY the system projects (their system managers) and the name. The PLC projects inside are CONTENT
    /// — NOT resolved here; <see cref="EnsurePlc"/> does that lazily on the first content op, so select/health stay out of
    /// the projects' trees.</para></summary>
    private void FindTwinCatProject(string? wantProject)
    {
        DropPlcs();
        _sysManager = null; _projectName = null; _systems = new List<(string, dynamic)>();
        var name = SolutionName();
        if (name is null || (wantProject != null && !string.Equals(name, wantProject, StringComparison.Ordinal)))
        {
            // Do NOT throw here: BindAndResolve (the connector's `select`) checks _sysManager itself, else leaves the
            // model not-connected for Core to refuse. Throwing would turn a clean PLC_DISCONNECTED into an opaque
            // INTERNAL_ERROR.
            VoltLog.Debug($"FindTwinCatProject: '{wantProject ?? "(open)"}' not resolved in the bound DTE (it has: {name ?? "no solution file"})");
            return;
        }
        var systems = TwinCatSystems();
        if (systems.Count == 0)
        {
            VoltLog.Debug($"FindTwinCatProject: the solution '{name}' holds no TwinCAT project");
            return;
        }
        _systems = systems;
        _sysManager = systems[0].Manager;
        _projectName = name;
    }

    /// <summary>The solution's active target platform (<c>TwinCAT RT (x64)</c>) — what a system project's descriptor states
    /// as its type — or null when the solution states none. A failing read propagates: it is a content read.</summary>
    public string? TargetPlatform()
    {
        if (_dte == null) return null;
        var platform = (string?)_dte.Solution.SolutionBuild.ActiveConfiguration.PlatformName;
        return string.IsNullOrWhiteSpace(platform) ? null : platform;
    }

    /// <summary>The system projects of the bound solution (<see cref="FindTwinCatProject"/>).</summary>
    private List<(string Name, dynamic Manager)> _systems = new();

    /// <summary>Every PLC project of every system project — resolved the first time a content op needs one. select and
    /// health NEVER call this, so a PLC tree is touched only when the user actually syncs (init/pull/push/build). A fault
    /// reading a <c>TIPC</c> propagates with its HRESULT (cli-bridges review B3): skipping a PLC project would answer a
    /// walk without its items, read as deleted.</summary>
    public IReadOnlyList<TcPlc> Plcs()
    {
        if (_plcs is { } known) return known;
        if (_systems.Count == 0) throw BridgeException.PlcDisconnected("no TwinCAT project bound");
        var plcs = new List<TcPlc>();
        foreach (var (system, manager) in _systems)
        {
            dynamic tipc = manager.LookupTreeItem("TIPC");
            int count = tipc.ChildCount;
            for (int i = 1; i <= count; i++)
            {
                dynamic plc = tipc.Child[i];
                string plcName = plc.Name;
                // Its inner project node is a path segment, named as the tree names it (`Untitled2 Project`).
                string nestedName = plc.NestedProject.Name;
                plcs.Add(new TcPlc(system, manager, plc, plcName, nestedName));
            }
        }
        if (plcs.Count == 0) throw BridgeException.PlcDisconnected("Cannot find a PLC project under TIPC in any system project of the solution.");
        _plcs = plcs;
        return plcs;
    }

    /// <summary>The system projects of the bound solution, by name, each with its manager — for what hangs off a system
    /// rather than a PLC project (its <c>.device</c> descriptor, its I/O tree).</summary>
    public IReadOnlyList<(string Name, object Manager)> Systems() => _systems.Select(s => (s.Name, (object)s.Manager)).ToList();

    private List<TcPlc>? _plcs;

    /// <summary>The PLC project every tree read and write addresses: the one its node belongs to, set by the driver
    /// before it touches a node (<see cref="Use"/>), and the first one until then.</summary>
    public TcPlc CurrentPlc
    {
        get
        {
            EnsurePlc();
            return _current!;
        }
    }

    private TcPlc? _current;

    /// <summary>Address <paramref name="plc"/> from here on: its system manager (task, I/O and path lookups) and its PLC
    /// node (the tree root, its settings, its library manager). Each PLC project keeps its own Solution Explorer snapshot
    /// for the operation (<see cref="TcPlc"/>), so moving between them reads none twice.</summary>
    public void Use(TcPlc plc)
    {
        if (ReferenceEquals(_current, plc)) return;
        _current = plc;
        _plcNode = plc.Node;
        _sysManager = plc.Manager;
    }

    /// <summary>Resolve the PLC projects the first time a content op needs them, and address the first. Idempotent;
    /// DropProject clears it so a reconnect re-resolves.</summary>
    private void EnsurePlc()
    {
        if (_current != null) return;
        Use(Plcs()[0]);
    }

    private void DropPlcs()
    {
        if (_plcs is not null)
            foreach (var p in _plcs) { try { Marshal.ReleaseComObject(p.Node); } catch { } }
        _plcs = null;
        _current = null;
        _plcNode = null;
    }

    public object LookupTreeItem(string path) => (object)_sysManager!.LookupTreeItem(path);

    /// <summary>A tree item of the system project <paramref name="manager"/> manages (one of <see cref="Systems"/>) — its
    /// I/O tree is its own, whichever PLC project is addressed.</summary>
    public object LookupIn(object manager, string path) => (object)((dynamic)manager).LookupTreeItem(path);

    public void Disconnect()
    {
        DropProject();
        ReleaseDte();
        VoltLog.Info("disconnected from TwinCAT");
        // NOTE: the DESIRED selection (_wantProject) is intentionally kept — a dropped IDE/DTE is transient, and the
        // next recovery must re-establish the SAME project when TwinCAT returns. Only an explicit new select changes it.
        // ponytail: on TwinCAT this method is INTERFACE-OBLIGATION ONLY — it has no production caller. The wire
        // `disconnect` op only sets BridgePipeHost._paused (it tears nothing down), and the single production caller
        // of IVendorSession.Disconnect() is the CODESYS in-proc PipeHost. Kept because BeckhoffDriver must satisfy the
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
        DropPlcs();
        foreach (var (_, manager) in _systems) { try { Marshal.ReleaseComObject(manager); } catch { } }
        _systems = new List<(string, dynamic)>();
        _sysManager = null;
        _projectName = null;
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
