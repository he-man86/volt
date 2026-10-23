using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using Volt.Engine;

using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Host;
using Volt.Engine.Item;
using Volt.Engine.Seam;
using System.Linq;

namespace Volt.Ide.Twincat;

/// <summary>
/// The TwinCAT/Beckhoff IDE driver: implements the Engine's <see cref="IVendorDriver"/> over a running TwinCAT
/// XAE. A thin facade — all genuine IDE access goes through <see cref="TcObjectModel"/> (the late-bound
/// COM gateway; <c>dynamic</c> lives there, never here or in Core) and all thread marshalling through
/// <see cref="StaDispatcher"/> (the COM objects are apartment-bound). Mirrors the CODESYS driver's
/// facade + object-model + dispatcher split; its tree's IEC codes (<see cref="IIecTree"/>) are what the
/// Engine's IEC helpers walk. Split across partial files by facet: this file is the session (connect / health probe / build /
/// degraded policy); <c>.Tree</c>, <c>.Content</c>, <c>.Nodes</c> and <c>.Seam</c> are the others.
/// </summary>
public sealed partial class BeckhoffDriver : VendorDriverBase, IVendorDriver, IIecTree
{
    private readonly TcObjectModel _om;
    private readonly StaDispatcher _dispatcher = new();

    public BeckhoffDriver() : this(new TcObjectModel()) { }

    /// <summary>Over a given object model — the offline tests hand one whose window is a double (<c>TcAttachTests</c>).</summary>
    internal BeckhoffDriver(TcObjectModel om) { _om = om; }

    public bool IsConnected => _om.IsConnected;

    public string Vendor => Vendors.Twincat;
    // LIVE, not the cached row: `_om.ProjectName` is the bound name held in the object model (a plain field), so this
    // never lags the ~5s health snapshot. Same value BuildProjects() reads for its `served` row.
    public string? ServedProjectName => IsConnected ? _om.ProjectName : null;

    // The identity (DIALECT V5): the build as the platform, the shell as the product, the XAE exe's maker as vendor.
    public string? IdeVersion => _om.IdeVersion;
    public string? ProductName => _om.ProductName;
    public string? ProductVersion => _om.ProductVersion;
    public string? ProductVendor => _om.ProductVendor;
    /// <summary>Set when XAE's Solution Explorer cannot be read by this worker (DIALECT C2t): every op but <c>health</c> then answers <c>IDE_UNSUPPORTED</c> with this sentence.</summary>
    public string? Unsupported => _om.Unsupported;
    public string? NotServedBecause => _om.NotServedBecause();

    /// <summary>The start check behind <see cref="Unsupported"/> (<c>TcObjectModel.CheckHierarchy</c>); run by the
    /// worker on the STA thread right after <see cref="Connect"/>.</summary>
    public void CheckHierarchy() => _om.CheckHierarchy();

    /// <summary>Per-XAE worker startup: own the ONE XAE window with this process id (the connector spawned us for it),
    /// and serve what it has open — its first TwinCAT project (<see cref="TcObjectModel.AttachFirstProject"/>), as the
    /// CODESYS attach serves its primary project. A `select` by name serves another; the connector's gate (`disconnect`,
    /// <c>BridgePipeHost._paused</c>) is independent of this and still stops it. TwinCAT has NO parameterless Connect()
    /// — a worker attaches to a specific XAE by pid, never "the IDE".</summary>
    /// <para>The worker refreshes health right after it, on the same STA thread (<c>HostLink.RefreshHealth</c>), so the
    /// binding shows in health at once.</para></summary>
    public void Connect(int xaePid) { _om.ConnectToPid(xaePid); _om.AttachFirstProject(); }
    // ponytail: never called on TwinCAT — the worker dies with its process, and the wire `disconnect` op only sets
    // BridgePipeHost._paused. The ONE production caller of the session's Disconnect() is Codesys/PipeHost.Stop().
    // Kept to satisfy the IVendorSession contract (the full record is on TcObjectModel.Disconnect).
    public void Disconnect() => _om.Disconnect();

    // ── STA thread ──────────────────────────────────────────────────
    /// <summary>The STA message loop the bridge's dedicated thread runs (started from <c>Program.cs</c>).</summary>
    public void RunStaMessageLoop(CancellationToken cancel) => _dispatcher.RunMessageLoop(cancel);

    // Every operation reads the Solution Explorer snapshot afresh (lazily, on its first child access): the engineer
    // may have broken or fixed a POU in XAE since the last op, and which children are safe to open is decided by it
    // (DIALECT C2i). Dropping it costs nothing; an op that opens no child never reads it.
    // The declarations and the walk they may be indexed from go too: nothing an operation read answers the next one.
    public T MarshalToIdeThread<T>(Func<T> func) => _dispatcher.Run(() =>
    {
        _om.ForgetExplorer();
        _declarations = null;
        _walkIndex = null;
        return func();
    });

    // ── health ──────────────────────────────────────────────────────
    // The engine's session composes the response (cached list + live overlay) and owns the probe's single-flight/failure
    // machinery; what is vendor-shaped here is the cadence and the LIVENESS VERDICT (ProbeProjects' NotAnswering — only
    // this vendor has a cross-process channel that can drop silently). The cadence: throttle the (heavier) STA refresh to
    // ~5s, so a burst of polls answers from cache and only one probe runs. The engine's DEFAULT floor (1s, which CODESYS
    // takes) bounds a few in-proc reflection reads, while this snapshot is EnsureAttached + ProbeIdeAlive + OwnSolution
    // across the COM apartment boundary. Loosening it to the default would speed up exactly the cross-process round-trip
    // the throttle was written to keep off a working engineer's XAE.
    public long HealthProbeFloorMs => 5000;

    /// <summary>Read the health snapshot from the live DTE, and whether the XAE answered. MUST run on the STA thread (it
    /// reads the DTE): the engine's ambient probe and its select refresh marshal onto it; the worker's start refreshes
    /// right after <see cref="Connect"/>, already on it, so a new binding shows in health AT ONCE — not 5s later.
    /// <para>NEVER THROWS for an XAE that did not answer: the rows are returned (and published, stamping the throttle
    /// clock) UNCONDITIONALLY, and the verdict is <see cref="ProjectProbe.NotAnswering"/>. Two things depend on that.
    /// (a) The start and a select are on the request path: a throw here would turn `connect` against a dead XAE from a
    /// clean PLC_DISCONNECTED (the engine's uniform post-condition) into an opaque INTERNAL_ERROR — the exact regression
    /// <c>TcObjectModel.FindTwinCatProject</c> records in its own DO-NOT comment. (b) Publishing on the sick path keeps
    /// the throttle clock stamped, so the ~5s throttle survives a failing probe instead of firing a fresh STA round-trip
    /// at a struggling XAE on every poll.</para>
    /// <para>WHY THE AMBIENT PROBE FAILS on <see cref="ProjectProbe.NotAnswering"/>: the session's freshness clock is "the
    /// last IDE call that RESPONDED", but the thing that stamps it — the marshal onto <see cref="StaDispatcher"/> — is a
    /// round-trip of THIS worker's own in-process queue, which never consults the XAE. A probe that could not fail would
    /// re-stamp it every ~5s against a dead XAE. Measured, so the claim is not wider than the truth: against a fully
    /// dead/hung DTE <c>OwnSolution</c> already yields NO project names, so `health` reports zero rows rather than a green
    /// row; what the failure adds is the SIGNAL — a degraded flag, a log line, an honest freshness clock. <c>ProbeIdeAlive</c>
    /// also answers false for a merely BUSY XAE; degraded is not sticky (the next answering probe clears it) and gates
    /// no op, so a transient false negative self-heals.</para>
    /// <para>NO PLC-APP TOUCH: it reads only top-level state — the bound DTE/solution liveness and, for THIS worker's
    /// own XAE window, its project names/dirty (<c>OwnSolution</c>). No ROT walk (that is the connector's
    /// <c>--list-xae-pids</c> probe) and never the PLC application (no node, no LookupTreeItem, no tree walk), so a user
    /// who isn't syncing never has Volt slow or crash their IDE. Recovery — re-binding the desired project + resolving the
    /// PLC app after a close / re-registration / RPC drop — is DEFERRED to the content ops (where a read re-acquires on a
    /// transient) or a re-select; it NEVER happens on this poll.</para></summary>
    public ProjectProbe ProbeProjects()
    {
        _om.EnsureAttached();   // re-acquire our XAE by pid if the held DTE died (bare — keeps the project list live)
        bool ideAlive = _om.ProbeIdeAlive();
        return new ProjectProbe(BuildProjects(), Bound: _om.HasSelection && _om.IsConnected && ideAlive,
            NotAnswering: ideAlive ? null : "the bound TwinCAT XAE did not answer the health liveness probe");
    }

    // A dead/disconnected TwinCAT COM channel surfaces as RPC HRESULTs: the WHOLE RPC_E_ family (0x800101xx —
    // 256 codes, which already covers RPC_E_DISCONNECTED 0x80010108 and RPC_E_SERVERCALL_RETRYLATER 0x8001010A),
    // plus the three 0x800706Bx RPC failures and RPC_E_CALL_REJECTED. Those flip the driver to degraded so it can
    // recover instead of hard-failing.
    private const uint HResultRpcServerUnavailable = 0x800706BAu;
    private const uint HResultRpcCallFailed = 0x800706BEu;
    private const uint HResultRpcCallFailedDidNotExecute = 0x800706BFu;
    private const uint HResultRpceFamilyMask = 0xFFFFFF00u;
    private const uint HResultRpceFamily = 0x80010100u;
    private const uint HResultCallRejected = 0x80010001u;

    public bool ShouldMarkDegraded(Exception ex) => IsRpcFault(ex);

    /// <summary>Is this a dead/hung COM CHANNEL rather than a failed operation?
    ///
    /// <para>ONE definition, because there are now two callers and a second copy of this HRESULT list would be
    /// the thing that silently drifts. <see cref="ShouldMarkDegraded"/> is the pipe host's question — should the
    /// session degrade and recover — and <c>TcObjectModel.Build</c> asks the same one for the opposite reason:
    /// to let an RPC fault PROPAGATE to that classifier instead of flattening it into "the build failed".</para></summary>
    internal static bool IsRpcFault(Exception ex)
    {
        for (var e = ex; e != null; e = e.InnerException)
        {
            if (e is not COMException com) continue;
            var hr = unchecked((uint)com.HResult);
            if (hr == HResultRpcServerUnavailable) return true;
            if (hr == HResultRpcCallFailed || hr == HResultRpcCallFailedDidNotExecute) return true;
            if ((hr & HResultRpceFamilyMask) == HResultRpceFamily) return true;
            if (hr == HResultCallRejected) return true;
        }
        return false;
    }

    // ── project discovery + selection (the connector's `connect`; discovery rides on the health response) ──
    // Runs on the STA thread (ProbeProjects calls it). This worker OWNS ONE XAE window (per-XAE model), so it lists
    // ONLY that window's projects — the connector merges every worker's single-window rows into the flat vendor list.
    // EXACTLY ONE row is marked `serving` (the invariant the wire relies on): the row whose project NAME matches the
    // bound project. (Two windows on an identically-named project are two workers/pipes; the connector collapses them
    // to one row by identity — the accepted limit of name-based identity.)
    private List<ProjectEntry> BuildProjects()
    {
        var served = _om.ProjectName;
        bool connected = _om.IsConnected;
        bool? servedDirty = connected ? _om.ProjectDirty() : null;

        var own = _om.OwnSolution();
        // IndexOf, not a per-row name test: the FIRST match serves, so two identically-named projects in the one
        // window still yield EXACTLY ONE serving row (the invariant above).
        int servingIdx = connected && !string.IsNullOrEmpty(served) ? own.Projects.IndexOf(served!) : -1;

        var list = new List<ProjectEntry>(own.Projects.Count);
        for (int i = 0; i < own.Projects.Count; i++)
        {
            bool serving = i == servingIdx;
            list.Add(new ProjectEntry(Vendors.Twincat, own.Version, own.Projects[i],
                Volt.Engine.Sync.ComposedSession.RowStatus(serving), serving && (servedDirty ?? false)));
        }
        return list;
    }

    /// <summary>Re-resolve by name on a live DTE, no respawn (runs on the STA thread); the engine refreshes the rows right
    /// after, so the new binding shows in health at once.</summary>
    public void SelectProject(ConnectRequest sel) => _om.SelectProject(sel.Project);

    // Op-level recovery (the retry wrapper calls this on the STA thread after a transient dead-channel error): drop
    // the dead handle and re-acquire the DESIRED project by its stable name. No-op if nothing was selected. Never
    // throws — a failed recovery just leaves the retry to fail cleanly.
    public void Recover()
    {
        try { if (_om.HasSelection) _om.ReattachProject(); }
        catch (Exception ex) { VoltLog.Warn($"recover failed: {ex.Message}"); }
    }

    // ── build ───────────────────────────────────────────────────────
    /// <summary>The whole solution, or the named PLC projects alone, each by its own <c>BuildProject</c> (DIALECT D46).</summary>
    public bool Build(IReadOnlyCollection<string>? applications) =>
        applications is null
            ? _om.Build()
            : _om.Build(_om.Plcs().Where(p => applications.Contains(p.Path, StringComparer.OrdinalIgnoreCase)).ToList());
    /// <summary>The build's diagnostics, each item named by its folder and bare name where the file the compiler named
    /// lies in one PLC project's directory and that PLC project holds exactly one item of the name — so the same message
    /// in two PLC projects is two diagnostics, each on its own item (openspec multi-application-tree, design §6). The item
    /// is any the wire addresses (<see cref="Volt.Engine.Item.ItemKind.IsAddressableItem"/>), the task too: a task that calls
    /// a program its PLC project does not hold is an error the compiler writes on `…\PlcTask.TcTTO`, and CODESYS names the
    /// same fault by the task's path (measured 2026-10-17, both vendors). Anything
    /// else keeps the bare name, which the engine resolves when it is unique and answers with no name when it is not.
    /// <para>NAMING IS DECORATION, NOT THE BUILD: it walks the tree and reads each PLC project's directory — COM reads that
    /// fault on an everyday XAE (<c>RPC_E_CALL_REJECTED</c>). A fault there leaves the compiler's diagnostics with their
    /// bare names (logged), never replaces them: the build ran, and nameless diagnostics beat no diagnostics
    /// (BuildService).</para></summary>
    public IReadOnlyList<BridgeDiagnostic> GetBuildDiagnostics(Func<HostWalk> walk)
    {
        var diagnostics = _om.GetBuildDiagnostics();
        try { NameByPath(diagnostics, walk); }
        catch (Exception ex)
        {
            VoltLog.Warn($"build: could not name the diagnostics by path ({ex.Message}) — reporting them with the " +
                         "compiler's bare names");
        }
        return diagnostics;
    }

    private void NameByPath(IReadOnlyList<BridgeDiagnostic> diagnostics, Func<HostWalk> walk)
    {
        var named = diagnostics.Where(d => d.Name is not null && _om.LastDiagnosticFiles.ContainsKey(d)).ToList();
        if (named.Count == 0) return;
        var directories = _om.Plcs().Select(p => (Plc: p, Directory: _om.PlcProjectDirectory(p))).ToList();
        var items = walk().Items;
        // Every path is worked out before any is set, so a fault part-way leaves ALL the bare names, not a mix.
        var paths = new List<(BridgeDiagnostic Diagnostic, string Path)>();
        foreach (var d in named)
        {
            var file = System.IO.Path.GetFullPath(_om.LastDiagnosticFiles[d]);
            var home = directories.FirstOrDefault(x => file.StartsWith(x.Directory + System.IO.Path.DirectorySeparatorChar,
                                                                        StringComparison.OrdinalIgnoreCase)).Plc;
            if (home is null) continue;
            var candidates = items.Where(i => ItemPath.IsUnder(i.Folder, home.Path)
                                              && string.Equals(i.Name, d.Name, StringComparison.OrdinalIgnoreCase)
                                              && Volt.Engine.Item.ItemKind.IsAddressableItem(i.Kind)).ToList();
            if (candidates.Count == 1) paths.Add((d, ItemPath.Of(candidates[0].Folder, candidates[0].Name)));
        }
        foreach (var (d, path) in paths) d.Name = path;
    }
    // ── referenced-library signatures ───────────────────────────────
    /// <summary>The public declarations of every referenced library, for the LSP to resolve a <c>TON</c> or a
    /// <c>CONCAT</c> against.
    ///
    /// <para>This used to be absent — the driver inherited the old shared driver base's empty implementation, so a
    /// verbose fetch returned no signatures and completion, hover and go-to-definition on library code silently
    /// did nothing on this vendor while working on the other. The reason on record was that "TwinCAT has no
    /// equivalent surface", and DIALECT C2c had already measured that to be false: this very call returns
    /// 181,179 characters on the fixture. What was missing was the FORMAT, which only the live IDE could
    /// supply.</para>
    ///
    /// <para>There is still no fingerprint and no signature cache: <c>FetchService</c> reuses the
    /// <c>.library</c> files' own per-file version hashes as the change signal, so extraction runs only when a
    /// referenced library's version actually moved.</para></summary>
    public IReadOnlyList<Volt.Engine.Library.LibSignature> ExtractLibrarySignatures() =>
        _om.ExtractLibrarySignatures();
}
