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
    private bool _everProbed;
    private long _lastChangeRaisedMs;

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
            // 1) No DTE yet → (re)bind + resolve the selected project. "No project selected" is expected until
            //    the user picks one (never a silent auto-attach); keep it as the reason instead of thrashing.
            if (!_om.IsAttached)
            {
                try { Connect(); }
                catch (NoProjectSelectedException ex) { MarkDegraded(ex.Message); }
                catch (Exception ex) { MarkDegraded($"waiting for TwinCAT XAE ({ex.Message})"); }
            }

            bool ideAlive = _om.ProbeIdeAlive();
            if (!ideAlive)
            {
                // The IDE itself went away → drop everything; the next probe re-binds when it returns.
                if (_om.IsAttached) { try { _om.Disconnect(); } catch { } }
            }
            else if (_om.IsConnected)
            {
                // We hold a project binding — is it STILL the open project? A close/switch leaves stale COM refs
                // that would otherwise report a false "connected" with the old project name (the bug this fixes).
                if (!_om.ProbeProjectAlive())
                {
                    try { _om.DropProject(); } catch { }                 // stop reporting the stale project
                    try { _om.ReattachProject(); } catch { /* not open → fall to "no project" */ }
                }
                if (_om.IsConnected && IsDegraded) ClearDegraded();
            }
            else if (_om.IsAttached)
            {
                // DTE alive but no project bound (a prior close, or the project opened after we attached the DTE)
                // → re-resolve the SELECTED project under the existing DTE, no full re-attach, no IDE restart.
                try { _om.ReattachProject(); } catch { /* still not open → stay "no project" */ }
                if (_om.IsConnected && IsDegraded) ClearDegraded();
            }

            return (alive: ideAlive, project: _om.ProjectName, plc: _om.PlcProjectName, dirty: _om.ProjectDirty());
        });
        bool raise;
        lock (_cacheLock)
        {
            // TwinCAT has no cheaply-bindable DTE change event via our late-bound COM, so the probe IS the change
            // source. Raise on any dirty/project-identity TRANSITION immediately; ALSO raise while the project
            // stays dirty (at most every 30s) — `dirty` is a level, so a second unsaved edit doesn't re-transition
            // it, and this catches those consecutive edits without a per-probe refresh storm. Coarser than
            // CODESYS's per-edit events, but behind the identical wire.
            var now = Environment.TickCount64;
            raise = _everProbed && r.alive && (
                _cachedProjectDirty != r.dirty || _cachedProjectName != r.project || _cachedPlcProjectName != r.plc
                || (r.dirty == true && now - _lastChangeRaisedMs > 30_000));
            if (raise) _lastChangeRaisedMs = now;
            _everProbed = true;
            _cachedIdeAlive = r.alive;
            _cachedProjectName = r.project;
            _cachedPlcProjectName = r.plc;
            _cachedProjectDirty = r.dirty;
            _cachedAtMs = Environment.TickCount64;
        }
        if (raise) RaiseProjectChanged();
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
    // TwinCAT has no resolved-library-signature surface yet — return none (parity boundary is the wire).
    public override IReadOnlyList<Volt.Bridge.Core.Library.LibSignature> ExtractLibrarySignatures() =>
        new List<Volt.Bridge.Core.Library.LibSignature>();
    // DEBUG (read-only): the PLCopen export (ExportPouXml — our normal code-XML transport) of a named item,
    // to inspect e.g. whether an interface property's Get/Set accessors survive the export.
    public override string DebugItemXml(string name) =>
        Lookup(name) is { } r ? _om.ExportPouXml(r.Native) : "";
}
