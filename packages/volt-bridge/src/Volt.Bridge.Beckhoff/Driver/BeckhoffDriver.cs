using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using Volt.Bridge.Core.Ide;
using Volt.Bridge.Core.Wire;

namespace Volt.Bridge.Beckhoff;

/// <summary>
/// The TwinCAT/Beckhoff IDE driver: implements the Core <see cref="IIdeDriver"/> over a running TwinCAT
/// XAE. A thin facade — all genuine IDE access goes through <see cref="TcObjectModel"/> (the late-bound
/// COM gateway; <c>dynamic</c> lives there, never here or in Core) and all thread marshalling through
/// <see cref="StaDispatcher"/> (the COM objects are apartment-bound). Mirrors the CODESYS driver's
/// facade + object-model + dispatcher split. Split across partial files by interface facet: this file is
/// the session (connect / health / build / degraded policy); <c>.Tree</c> and <c>.Code</c> are the others.
/// </summary>
public sealed partial class BeckhoffDriver : DriverBase, IIdeDriver, IInstanceProvider
{
    private readonly TcObjectModel _om = new();
    private readonly StaDispatcher _dispatcher = new();

    private readonly object _cacheLock = new();
    private bool _cachedIdeAlive;
    private string? _cachedProjectName;
    private string? _cachedPlcProjectName;
    private bool? _cachedProjectDirty;
    private long _cachedAtMs;

    public override bool IsConnected => _om.IsConnected;

    // Family name only (no per-version table — see RotInstances.IdeName); the exact version is IdeVersion.
    public override string? IdeName => RotInstances.IdeName(_om.IdeProgId);
    public override string? IdeVersion => _om.IdeVersion;

    public override void Connect() => _om.Connect();
    public override void Disconnect() { _om.Disconnect(); ClearDegraded(); }

    /// <summary>All running TwinCAT instances + projects (for the connector's picker).</summary>
    public object ListInstances() => _om.ListInstances();

    // ── STA thread ──────────────────────────────────────────────────
    /// <summary>The STA message loop the bridge's dedicated thread runs (started from <c>Program.cs</c>).</summary>
    public void RunStaMessageLoop(CancellationToken cancel) => _dispatcher.RunMessageLoop(cancel);

    public override T RunOnStaThread<T>(Func<T> func) => _dispatcher.Run(func);

    // ── health ──────────────────────────────────────────────────────
    public override HealthResponse BuildHealthResponse()
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
        return BuildHealth("beckhoff", IsConnected, ideAlive, IdeName, IdeVersion, projectName, plcProjectName, projectDirty ?? false);
    }

    public override void TriggerAsyncProbe() => RunProbeOnce(() =>
    {
        var r = RunOnStaThread(() =>
        {
            if (!_om.IsAttached) { try { Connect(); } catch { } }   // (re)attach when TwinCAT appears
            bool alive = _om.ProbeIdeAlive();
            if (!alive && _om.IsAttached) { try { Disconnect(); } catch { } }
            else if (alive && IsDegraded) ClearDegraded();
            return (alive, _om.ProjectName, _om.PlcProjectName, _om.ProjectDirty());
        });
        lock (_cacheLock)
        {
            _cachedIdeAlive = r.alive;
            _cachedProjectName = r.Item2;
            _cachedPlcProjectName = r.Item3;
            _cachedProjectDirty = r.Item4;
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

    // ── build ───────────────────────────────────────────────────────
    public override void FlushPendingWrites() => _om.FlushPendingWrites();
    public override bool Build() => _om.Build();
    public override IReadOnlyList<BridgeDiagnostic> GetBuildDiagnostics() => _om.GetBuildDiagnostics();
}
