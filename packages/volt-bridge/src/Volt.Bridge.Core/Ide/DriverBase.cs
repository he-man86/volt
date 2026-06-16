using System;
using Volt.Bridge.Core.Wire;

namespace Volt.Bridge.Core.Ide;

/// <summary>Shared base for a vendor driver: the degraded-state machine and the uniform health-response
/// shape — the only logic identical across vendors. A concrete driver implements <see cref="IIdeDriver"/>
/// and supplies just genuine IDE access (connect, tree, code, build) plus the degraded-policy hook.</summary>
public abstract class DriverBase
{
    private volatile bool _isDegraded;
    private string? _degradedReason;

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
