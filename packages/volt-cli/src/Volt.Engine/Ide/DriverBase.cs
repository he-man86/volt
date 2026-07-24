using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Volt.Engine.Diagnostics;
using Volt.Engine.Wire;

using Volt.Cli.Transport;

namespace Volt.Engine.Ide;

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

    // ── abstract — vendor must implement ──
    public abstract bool IsConnected { get; }
    public abstract string? IdeName { get; }
    public abstract string? IdeVersion { get; }
    public abstract void Connect();
    public abstract void Disconnect();
    public abstract void TriggerAsyncProbe();
    public abstract HealthResponse BuildHealthResponse();
    public abstract bool ShouldMarkDegraded(Exception ex);
    /// <summary>Default no-op: an in-proc driver (CODESYS) has no cross-process channel to re-acquire. TwinCAT
    /// overrides to re-establish the desired binding by stable name.</summary>
    public virtual void Recover() { }
    public abstract T RunOnStaThread<T>(Func<T> fn);
    public abstract InstancesResult EnumerateInstances();
    public abstract void SelectProject(SelectRequest sel);
    public abstract void FlushPendingWrites();
    public abstract bool Build();
    public abstract IReadOnlyList<BridgeDiagnostic> GetBuildDiagnostics();

    /// <summary>Precompile + read the referenced-library signatures. FetchService calls this ONLY when a referenced
    /// library's `.library` version changed (the client sends the versions it has in knownItems; the `.library` files
    /// are hashed like any other file), so the precompile runs only on a real library change. Default empty
    /// (TwinCAT has no library signatures yet).</summary>
    public virtual IReadOnlyList<Library.LibSignature> ExtractLibrarySignatures() =>
        Array.Empty<Library.LibSignature>();

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
        string? ideName, string? ideVersion, string? projectName, bool projectDirty) =>
        new()
        {
            Status = connected ? (_isDegraded ? HealthStatus.Degraded : HealthStatus.Healthy) : HealthStatus.Unavailable,
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
            ProjectDirty = projectDirty,
        };
}
