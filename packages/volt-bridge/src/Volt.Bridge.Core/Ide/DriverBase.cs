using System;
using System.Collections.Generic;
using System.Threading.Tasks;
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

    public bool IsDegraded => _isDegraded;
    public string? DegradedReason => _degradedReason;

    public void MarkDegraded(string reason)
    {
        if (!_isDegraded) Console.Error.WriteLine($"[bridge] DEGRADED: {reason}");
        _isDegraded = true;
        _degradedReason = reason;
    }

    public void ClearDegraded()
    {
        if (_isDegraded) Console.Error.WriteLine("[bridge] DEGRADED cleared");
        _isDegraded = false;
        _degradedReason = null;
    }

    public virtual string Version => "1.0.0";

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
