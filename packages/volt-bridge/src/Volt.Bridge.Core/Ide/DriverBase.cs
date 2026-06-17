using System;
using System.Threading.Tasks;
using Volt.Bridge.Core.Wire;

namespace Volt.Bridge.Core.Ide;

/// <summary>Shared base for a vendor driver: the degraded-state machine, the uniform health-response
/// shape, and the single-flight health-probe runner — the only logic identical across vendors. A concrete
/// driver implements <see cref="IIdeDriver"/> and supplies just genuine IDE access (connect, tree, code,
/// build) plus the degraded-policy hook and the vendor probe body.</summary>
public abstract class DriverBase
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

    /// <summary>Run <paramref name="probe"/> on a background thread, single-flight: a probe already in
    /// progress is skipped (health keeps the last snapshot). Best-effort — any probe failure is swallowed
    /// here so a transient IDE hiccup never faults the /health request. Both vendors' <c>TriggerAsyncProbe</c>
    /// route through this; only the probe body (what to refresh) differs.</summary>
    protected void RunProbeOnce(Action probe)
    {
        lock (_probeGate) { if (_probeInFlight) return; _probeInFlight = true; }
        Task.Run(() =>
        {
            try { probe(); }
            catch { /* probe is best-effort — health keeps the last snapshot (sanctioned degraded-state plumbing) */ }
            finally { lock (_probeGate) _probeInFlight = false; }
        });
    }

    /// <summary>Vendor hook: should this transport/RPC exception flip the driver to degraded?</summary>
    public abstract bool ShouldMarkDegraded(Exception ex);

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
