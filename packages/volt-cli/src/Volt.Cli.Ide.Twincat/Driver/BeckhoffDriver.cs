using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using Volt.Engine;

using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Host;

namespace Volt.Cli.Ide.Twincat;

/// <summary>
/// The TwinCAT/Beckhoff IDE driver: implements the Core <see cref="IIdeDriver"/> over a running TwinCAT
/// XAE. A thin facade — all genuine IDE access goes through <see cref="TcObjectModel"/> (the late-bound
/// COM gateway; <c>dynamic</c> lives there, never here or in Core) and all thread marshalling through
/// <see cref="StaDispatcher"/> (the COM objects are apartment-bound). Mirrors the CODESYS driver's
/// facade + object-model + dispatcher split. Split across partial files by interface facet: this file is
/// the session (connect / health / build / degraded policy); <c>.Tree</c> and <c>.Code</c> are the others.
/// </summary>
public sealed partial class BeckhoffDriver : DriverBase, IIdeDriver
{
    private readonly TcObjectModel _om = new();
    private readonly StaDispatcher _dispatcher = new();

    public override bool IsConnected => _om.IsConnected;

    public override string Vendor => Vendors.Twincat;
    // LIVE, not the cached row: `_om.ProjectName` is the bound name held in the object model (a plain field), so this
    // never lags the ~5s health snapshot. Same value BuildProjects() reads for its `served` row.
    public override string? ServedProjectName => IsConnected ? _om.ProjectName : null;

    public override string? IdeVersion => _om.IdeVersion;

    /// <summary>Per-XAE worker startup: own the ONE XAE window with this process id (the connector spawned us for it).
    /// TwinCAT has NO parameterless Connect() — a worker attaches to a specific XAE by pid, never "the IDE".</summary>
    public void Connect(int xaePid) { _om.ConnectToPid(xaePid); SnapshotHealth(); }
    // ponytail: never called on TwinCAT — the worker dies with its process, and the wire `disconnect` op only sets
    // BridgePipeHost._paused. The ONE production caller of IIdeSession.Disconnect() is Codesys/PipeHost.Stop().
    // Kept to satisfy the DriverBase/IIdeSession contract (the full record is on TcObjectModel.Disconnect).
    public override void Disconnect() { _om.Disconnect(); ClearDegraded(); }

    // ── STA thread ──────────────────────────────────────────────────
    /// <summary>The STA message loop the bridge's dedicated thread runs (started from <c>Program.cs</c>).</summary>
    public void RunStaMessageLoop(CancellationToken cancel) => _dispatcher.RunMessageLoop(cancel);

    protected override T MarshalToIdeThread<T>(Func<T> func) => _dispatcher.Run(func);

    // ── health ──────────────────────────────────────────────────────
    // DriverBase composes the response (cached list + live overlay) and owns the probe's single-flight/failure
    // machinery; what is vendor-shaped here is the cadence and the LIVENESS VERDICT (see TriggerAsyncProbe below —
    // only this vendor has a cross-process channel that can drop silently). The cadence: throttle the (heavier) STA
    // refresh to ~5s, so a burst of polls answers from cache and only one probe runs.
    // This stays an OVERRIDE after unify-probe-throttle: Core's DEFAULT cadence (DriverBase's 1s, which
    // CODESYS takes — a plain virtual default an override REPLACES, not a floor anything clamps to) bounds a few
    // in-proc reflection reads, while this snapshot is EnsureAttached + ProbeIdeAlive + OwnSolution across the COM
    // apartment boundary. Loosening it back to Core's default would speed up exactly the cross-process round-trip
    // the throttle was written to keep off a working engineer's XAE.
    protected override long ProbeThrottleMs => 5000;

    /// <summary>Refresh the cached health snapshot from the live DTE and RETURN whether the XAE answered. MUST run on
    /// the STA thread (it reads the DTE): the async probe calls it via <see cref="RunOnStaThread{T}"/>;
    /// <see cref="Connect"/> / <see cref="SelectProject"/> call it through <see cref="SnapshotHealth"/> (they already
    /// run on the STA thread), so a new binding shows in health AT ONCE — not 5s later on the next probe. Matches the
    /// CODESYS driver, which refreshes its cache on select the same way.
    /// <para>NEVER THROWS, and the rows + the throttle clock are published UNCONDITIONALLY — the liveness verdict is
    /// returned, never raised. Two things depend on that. (a) <see cref="Connect"/> and <see cref="SelectProject"/>
    /// are on the request path: a throw here would escape <c>BridgePipeHost.RunOp</c> and turn `connect` against a
    /// dead XAE from a clean PLC_DISCONNECTED (Core's uniform post-condition) into an opaque INTERNAL_ERROR — the
    /// exact regression <c>TcObjectModel.FindTwinCatProject</c> records in its own DO-NOT comment, and which
    /// <c>IIdeSession.SelectProject</c> forbids ("it does NOT decide the wire outcome"). (b) publishing on the sick
    /// path keeps <c>_publishedAtTick</c> stamped, so the ~5s throttle survives a failing probe instead of firing a
    /// fresh STA round-trip at a struggling XAE on every poll.</para>
    /// <para>NO PLC-APP TOUCH: it reads only top-level state — the bound DTE/solution liveness and, for THIS worker's
    /// own XAE window, its project names/dirty (<c>OwnSolution</c>, the rows that ride in the health response). No ROT
    /// walk (that moved to the connector's <c>--list-xae-pids</c> probe) and never the PLC application (no node, no
    /// LookupTreeItem, no tree walk), throttled to ~5s by <see cref="ProbeThrottleMs"/> and single-flight, so a
    /// user who isn't syncing never has Volt slow or crash their IDE. Recovery — re-binding the desired project + resolving the PLC
    /// app after a close / re-registration / RPC drop — is DEFERRED to the content ops (where RunRead re-acquires on a
    /// transient) or a re-select; it NEVER happens on this poll.</para></summary>
    private bool RefreshHealthSnapshot()
    {
        _om.EnsureAttached();   // re-acquire our XAE by pid if the held DTE died (bare — keeps the project list live)
        bool ideAlive = _om.ProbeIdeAlive();
        if (_om.HasSelection && _om.IsConnected && ideAlive && IsDegraded) ClearDegraded();
        PublishRows(BuildProjects());   // stamps the throttle clock; the rows stay readable OFF the COM apartment
        return ideAlive;
    }

    /// <summary>The request-path refresh (connect / select): same snapshot, verdict deliberately IGNORED — those two
    /// callers must not throw (see <see cref="RefreshHealthSnapshot"/>). Only the ambient probe acts on it.</summary>
    protected override void SnapshotHealth() => RefreshHealthSnapshot();

    /// <summary>The ambient probe FAILS when the bound XAE does not answer, instead of discarding that verdict.
    /// <para>Why: <c>DriverBase._lastOkTick</c> is "the last IDE call that RESPONDED", but the thing that stamps it —
    /// <c>RunOnStaThread</c> → <see cref="MarshalToIdeThread{T}"/> → <c>StaDispatcher.Run</c> — is a round-trip of
    /// THIS worker's own in-process queue, which never consults the XAE. With the verdict discarded the probe could
    /// not fail, so the one ambient writer of the freshness clock re-stamped it every ~5s against a dead XAE and
    /// <c>DriverBase.DeriveServedStatus</c>'s staleness branch was unreachable in production. Throwing INSIDE the
    /// marshalled closure means <c>RunOnStaThread</c> never reaches its stamp, and <c>OnProbeFailed</c> logs and marks
    /// degraded — the "never swallow a background failure" rule applied to the verdict, not just to exceptions.</para>
    /// <para>Measured, so the claim in the log is not wider than the truth: against a fully dead/hung DTE
    /// <c>OwnSolution</c> already yields NO project names, so `health` reported zero rows (the client reads
    /// "unavailable") rather than a green row. What changes is therefore the SIGNAL — a degraded flag, a log line, and
    /// an honest freshness clock — not a row that starts claiming to be connected.</para>
    /// <para>Coded, not bare: <c>ProbeIdeAlive</c> is a cross-process COM read that also returns false for a merely
    /// BUSY XAE, and if this ever escaped the probe it must still carry PLC_DISCONNECTED rather than an opaque
    /// INTERNAL_ERROR. Degraded is not sticky (the next answering probe clears it) and gates no op — it is a health
    /// report only — so a transient false negative self-heals. CODESYS is untouched: in-proc, no cross-process channel
    /// to drop, and <c>ShouldMarkDegraded</c> already returns false there.</para></summary>
    public override void TriggerAsyncProbe() =>
        RunProbeOnce(() => RunOnStaThread(() =>
        {
            if (!RefreshHealthSnapshot())
                throw new BridgeException(BridgeErrorCodes.PlcDisconnected,
                    "the bound TwinCAT XAE did not answer the health liveness probe");
            return 0;
        }));

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

    public override bool ShouldMarkDegraded(Exception ex)
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
    // Runs on the STA thread (SnapshotHealth calls it). This worker OWNS ONE XAE window (per-XAE model), so it lists
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
                RowStatus(serving), serving && (servedDirty ?? false)));
        }
        return list;
    }

    public override void SelectProject(ConnectRequest sel)
    {
        _om.SelectProject(sel.Project);   // re-resolve by name on a live DTE, no respawn (runs on the STA thread)
        SnapshotHealth();                 // reflect the new binding in health at once (parity with CODESYS)
    }

    // Op-level recovery (the retry wrapper calls this on the STA thread after a transient dead-channel error): drop
    // the dead handle and re-acquire the DESIRED project by its stable name. No-op if nothing was selected. Never
    // throws — a failed recovery just leaves the retry to fail cleanly.
    public override void Recover()
    {
        try { if (_om.HasSelection) _om.ReattachProject(); }
        catch (Exception ex) { VoltLog.Warn($"recover failed: {ex.Message}"); }
    }

    // ── build ───────────────────────────────────────────────────────
    public override void FlushPendingWrites() => _om.FlushPendingWrites();
    public override bool Build() => _om.Build();
    public override IReadOnlyList<BridgeDiagnostic> GetBuildDiagnostics() => _om.GetBuildDiagnostics();
    // TwinCAT has no resolved-library-signature surface yet — it inherits DriverBase's empty
    // ExtractLibrarySignatures, so `verbose` fetch returns no signatures here (a documented parity gap; the
    // parity boundary is the wire). There is no fingerprint and no signature cache: FetchService reuses the
    // `.library` files' own per-file version hashes as the change signal.
}
