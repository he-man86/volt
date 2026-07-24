using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using Volt.Engine.Diagnostics;
using Volt.Engine.Ide;
using Volt.Engine.Wire;

using Volt.Cli.Transport;

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

    private readonly object _cacheLock = new();
    private List<ProjectEntry> _cachedProjects = new(); // served off the STA thread in the health response; refreshed in SnapshotHealth
    private long _cachedAtMs;

    public override bool IsConnected => _om.IsConnected;

    public override string? IdeVersion => _om.IdeVersion;

    public override void Connect() { _om.Connect(); SnapshotHealth(); }
    public override void Disconnect() { _om.Disconnect(); ClearDegraded(); }

    // ── STA thread ──────────────────────────────────────────────────
    /// <summary>The STA message loop the bridge's dedicated thread runs (started from <c>Program.cs</c>).</summary>
    public void RunStaMessageLoop(CancellationToken cancel) => _dispatcher.RunMessageLoop(cancel);

    public override T RunOnStaThread<T>(Func<T> func) => _dispatcher.Run(func);

    // ── health ──────────────────────────────────────────────────────
    public override HealthResponse BuildHealthResponse()
    {
        List<ProjectEntry> projects; long? ageMs;
        lock (_cacheLock)
        {
            projects = _cachedProjects;
            ageMs = _cachedAtMs == 0 ? null : Environment.TickCount64 - _cachedAtMs;
        }
        // Throttle the (heavier) STA refresh to ~5s: a burst of polls answers from cache and only one probe runs.
        if (ageMs is null || ageMs > 5000) TriggerAsyncProbe();
        return new HealthResponse { Projects = projects };
    }

    public override void TriggerAsyncProbe() => RunProbeOnce(() => RunOnStaThread(() => { SnapshotHealth(); return 0; }));

    /// <summary>Refresh the cached health snapshot from the live DTE. MUST run on the STA thread (it reads the DTE):
    /// the async probe calls it via <see cref="RunOnStaThread{T}"/>; <see cref="Connect"/> / <see cref="SelectProject"/>
    /// call it directly (they already run on the STA thread), so a new binding shows in health AT ONCE — not 5s later
    /// on the next probe. Matches the CODESYS driver, which refreshes its cache on select the same way.
    /// <para>NO PLC-APP TOUCH: it reads only top-level state — the bound DTE/solution liveness, the project name/dirty,
    /// and the ROT enumeration of every running XAE + its projects (the connectable-projects list that rides in the
    /// health response). Never the PLC application (no node, no LookupTreeItem, no tree walk). The ROT walk is the one
    /// non-trivial cost, throttled to ~5s by <see cref="BuildHealthResponse"/> and single-flight, so a user who isn't
    /// syncing never has Volt slow or crash their IDE. Recovery — re-binding the desired project + resolving the PLC
    /// app after a close / re-registration / RPC drop — is DEFERRED to the content ops (where RunRead re-acquires on a
    /// transient) or a re-select; it NEVER happens on this poll.</para></summary>
    private void SnapshotHealth()
    {
        bool ideAlive = _om.ProbeIdeAlive();
        if (_om.HasSelection && _om.IsConnected && ideAlive && IsDegraded) ClearDegraded();
        var projects = BuildProjects();
        lock (_cacheLock)
        {
            _cachedProjects = projects;
            _cachedAtMs = Environment.TickCount64;
        }
    }

    // A dead/disconnected TwinCAT COM channel surfaces as specific RPC HRESULTs; those (and only those)
    // flip the driver to degraded so it can recover instead of hard-failing.
    private const uint HResultRpcServerUnavailable = 0x800706BAu;
    private const uint HResultRpcCallFailed = 0x800706BEu;
    private const uint HResultRpcCallFailedDidNotExecute = 0x800706BFu;
    private const uint HResultRpceFamilyMask = 0xFFFFFF00u;
    private const uint HResultRpceFamily = 0x80010100u;
    private const uint HResultCallRejected = 0x80010001u;
    private const uint HResultDisconnected = 0x80010108u;
    private const uint HResultServerCallRetryLater = 0x8001010Au;

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

    // ── project discovery + selection (the connector's `connect`; discovery rides on the health response) ──
    // Runs on the STA thread (SnapshotHealth calls it) — RotInstances binds foreign, apartment-bound DTEs. One flat
    // row per open project across every running XAE. EXACTLY ONE row is marked `serving` (the invariant the wire
    // relies on): the served project on the requested XAE window (WantInstance) if it's still there, else the first
    // window with that project name — so two windows that happen to share a project name never both read as serving.
    private List<ProjectEntry> BuildProjects()
    {
        var served = _om.ProjectName;
        var wantInstance = _om.WantInstance;
        bool connected = _om.IsConnected;
        bool? servedDirty = connected ? _om.ProjectDirty() : null;

        var rows = RotInstances.Enumerate()
            .SelectMany(inst => inst.Projects.Select(p => (inst.InstanceId, inst.IdeVersion, p.Project)))
            .ToList();

        // Pick the ONE serving row: prefer the exact requested instance, else the first name-match.
        int servingIdx = -1;
        if (connected && !string.IsNullOrEmpty(served))
        {
            servingIdx = rows.FindIndex(r => r.Project == served && r.InstanceId == wantInstance);
            if (servingIdx < 0) servingIdx = rows.FindIndex(r => r.Project == served);
        }

        var list = new List<ProjectEntry>(rows.Count);
        for (int i = 0; i < rows.Count; i++)
        {
            bool serving = i == servingIdx;
            list.Add(new ProjectEntry(Vendors.Twincat, rows[i].InstanceId, rows[i].IdeVersion, rows[i].Project,
                RowStatus(serving), serving, serving && (servedDirty ?? false)));
        }
        return list;
    }

    public override void SelectProject(ConnectRequest sel)
    {
        _om.SelectProject(sel.InstanceId, sel.Project);   // re-resolve on the live DTE, no respawn (runs on the STA thread)
        SnapshotHealth();                                 // reflect the new binding in health at once (parity with CODESYS)
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
    // TwinCAT has no resolved-library-signature surface yet — it inherits DriverBase's empty defaults
    // (empty fingerprint + empty extraction), so the cache is a harmless no-op here (parity boundary is the wire).
    // DEBUG (read-only): the PLCopen export (ExportPouXml — our normal code-XML transport) of a named item,
    // to inspect e.g. whether an interface property's Get/Set accessors survive the export.
    public override string DebugItemXml(string name) =>
        Lookup(name) is { } r ? _om.ExportPouXml(r.Native) : "";
}
