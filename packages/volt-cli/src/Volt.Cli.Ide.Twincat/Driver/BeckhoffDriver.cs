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
    private bool _cachedIdeAlive;
    private string? _cachedProjectName;
    private bool? _cachedProjectDirty;
    private long _cachedAtMs;

    public override bool IsConnected => _om.IsConnected;

    // Family name only (no per-version table — see RotInstances.IdeName); the exact version is IdeVersion.
    public override string? IdeName => RotInstances.IdeName(_om.IdeProgId);
    public override string? IdeVersion => _om.IdeVersion;

    public override void Connect() => _om.Connect();
    public override void Disconnect() { _om.Disconnect(); ClearDegraded(); }

    // ── STA thread ──────────────────────────────────────────────────
    /// <summary>The STA message loop the bridge's dedicated thread runs (started from <c>Program.cs</c>).</summary>
    public void RunStaMessageLoop(CancellationToken cancel) => _dispatcher.RunMessageLoop(cancel);

    public override T RunOnStaThread<T>(Func<T> func) => _dispatcher.Run(func);

    // ── health ──────────────────────────────────────────────────────
    public override HealthResponse BuildHealthResponse()
    {
        bool ideAlive; string? projectName; bool? projectDirty; long? ageMs;
        lock (_cacheLock)
        {
            ideAlive = _cachedIdeAlive;
            projectName = _cachedProjectName;
            projectDirty = _cachedProjectDirty;
            ageMs = _cachedAtMs == 0 ? null : Environment.TickCount64 - _cachedAtMs;
        }
        if (ageMs is null || ageMs > 5000) TriggerAsyncProbe();
        return BuildHealth(Vendors.Twincat, IsConnected, ideAlive, IdeName, IdeVersion, projectName, projectDirty ?? false);
    }

    public override void TriggerAsyncProbe() => RunProbeOnce(() =>
    {
        // LIGHT BY CONTRACT. The connector polls health every tick, so it must NEVER touch project CONTENT — no PLC
        // node, no LookupTreeItem, no tree walk. A user who isn't syncing must not have Volt slow or crash their IDE.
        // All this reads is TOP-LEVEL liveness (is the bound IDE/solution still answering?) — the same thing the
        // detection poll reads, nothing about the PLC application inside. Recovery — re-binding the desired project
        // and resolving the PLC app after a close / re-registration / RPC drop — is DEFERRED to the content ops
        // (init/pull/push/build, where RunRead re-acquires on a transient) or to a re-select. It NEVER happens here.
        var r = RunOnStaThread(() =>
        {
            bool ideAlive = _om.ProbeIdeAlive(); // top-level: does the bound DTE/solution respond? (no content)
            if (_om.HasSelection && _om.IsConnected && ideAlive && IsDegraded) ClearDegraded();
            return (alive: ideAlive, project: _om.ProjectName, dirty: _om.ProjectDirty());
        });
        lock (_cacheLock)
        {
            _cachedIdeAlive = r.alive;
            _cachedProjectName = r.project;
            _cachedProjectDirty = r.dirty;
            _cachedAtMs = Environment.TickCount64;
        }
    });

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

    // ── project discovery + selection (the connector's instances / select) ──
    // Runs on the STA thread (BridgePipeHost marshals it) — RotInstances binds foreign, apartment-bound DTEs.
    public override InstancesResult EnumerateInstances()
    {
        var list = new List<IdeInstance>();
        foreach (var inst in RotInstances.Enumerate())
            list.Add(new IdeInstance(inst.InstanceId, inst.IdeName, inst.IdeVersion,
                inst.Projects.ConvertAll(p => new IdeProject(p.Project, false))));
        return new InstancesResult(list);
    }

    public override void SelectProject(SelectRequest sel)
    {
        _om.SelectProject(sel.InstanceId, sel.Project);   // re-resolve on the live DTE, no respawn
        if (_om.IsConnected) ClearDegraded();
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
