using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Volt.Bridge.Core.Diagnostics;
using Volt.Bridge.Core.Wire;

namespace Volt.Bridge.Core.Ide;

/// <summary>Shared base for a vendor driver: implements <see cref="IIdeSession"/>'s degraded-state machine,
/// version, and uniform health-response shape — the only logic identical across vendors. A concrete
/// driver overrides the abstract members for genuine IDE access (connect, tree, code, build).</summary>
public abstract class DriverBase : IIdeSession
{
    private volatile bool _isDegraded;
    private string? _degradedReason;

    private readonly object _probeGate = new();
    private bool _probeInFlight;

    private readonly object _changeGate = new();
    private Timer? _changeDebounce;

    public bool IsDegraded => _isDegraded;
    public string? DegradedReason => _degradedReason;

    public void MarkDegraded(string reason)
    {
        if (!_isDegraded) { Console.Error.WriteLine($"[bridge] DEGRADED: {reason}"); VoltLog.Warn($"degraded: {reason}"); }
        _isDegraded = true;
        _degradedReason = reason;
    }

    public void ClearDegraded()
    {
        if (_isDegraded) { Console.Error.WriteLine("[bridge] DEGRADED cleared"); VoltLog.Info("degraded cleared"); }
        _isDegraded = false;
        _degradedReason = null;
    }

    public virtual string Version => "1.0.0";

    // ── project-change notification (→ SSE /events) ──────────────────
    public event Action? ProjectChanged;

    /// <summary>Signal an IDE change, COALESCED (trailing-edge, ~300 ms): a paste or a multi-object edit fires
    /// many native events but only ONE <see cref="ProjectChanged"/> — so a client refreshes once, not per object.
    /// Drivers call this from their IDE event handlers.</summary>
    protected void RaiseProjectChanged()
    {
        lock (_changeGate)
        {
            _changeDebounce ??= new Timer(_ =>
            {
                try { ProjectChanged?.Invoke(); } catch { /* a subscriber throw must not kill the timer */ }
            }, null, Timeout.Infinite, Timeout.Infinite);
            _changeDebounce.Change(300, Timeout.Infinite); // (re)start the trailing-edge window
        }
    }

    // ── abstract — vendor must implement ──
    public abstract bool IsConnected { get; }
    public abstract string? IdeName { get; }
    public abstract string? IdeVersion { get; }
    public abstract void Connect();
    public abstract void Disconnect();
    public abstract void TriggerAsyncProbe();
    public abstract HealthResponse BuildHealthResponse();
    public abstract bool ShouldMarkDegraded(Exception ex);
    public abstract T RunOnStaThread<T>(Func<T> fn);
    public abstract void FlushPendingWrites();
    public abstract bool Build();
    public abstract IReadOnlyList<BridgeDiagnostic> GetBuildDiagnostics();
    public abstract IReadOnlyList<Library.LibSignature> ExtractLibrarySignatures();

    // Debug-only introspection; drivers without a signature model (TwinCAT) inherit this empty default.
    public virtual IReadOnlyList<IReadOnlyDictionary<string, string>> DebugLibrarySignatures(string? nameFilter) =>
        Array.Empty<IReadOnlyDictionary<string, string>>();

    // Debug-only raw item XML; drivers without one (CODESYS) inherit the empty default.
    public virtual string DebugItemXml(string name) => "";

    // Debug-only reflection of the change-detection surface; overridden by CODESYS to inspect its object model.
    public virtual string DebugReflect(string target) => "";

    /// <summary>Run <paramref name="probe"/> on a background thread, single-flight: a probe already in
    /// progress is skipped (health keeps the last snapshot). Best-effort — any probe failure is swallowed
    /// here so a transient IDE hiccup never faults the /health request.</summary>
    protected void RunProbeOnce(Action probe)
    {
        lock (_probeGate) { if (_probeInFlight) return; _probeInFlight = true; }
        Task.Run(() =>
        {
            try { probe(); }
            catch { /* probe is best-effort — health keeps the last snapshot */ }
            finally { lock (_probeGate) _probeInFlight = false; }
        });
    }

    /// <summary>Build the uniform health response; the vendor supplies its snapshot values.</summary>
    protected HealthResponse BuildHealth(string platform, bool connected, bool ideAlive,
        string? ideName, string? ideVersion, string? projectName, string? plcProjectName, bool projectDirty) =>
        new()
        {
            Status = connected ? (_isDegraded ? "degraded" : "healthy") : "unavailable",
            Platform = platform,
            PlatformVariant = null,
            Connected = connected,
            IdeAlive = ideAlive,
            Degraded = _isDegraded,
            DegradedReason = _degradedReason,
            IdeName = ideName,
            IdeVersion = ideVersion,
            Version = Version,
            ProjectName = projectName,
            PlcProjectName = plcProjectName,
            ProjectDirty = projectDirty,
        };
}
