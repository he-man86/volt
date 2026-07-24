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

    // The one ambient-poll refresher. `health` (liveness + the instances list) is refreshed off the request path,
    // single-flight, so a poll never marshals onto the busy IDE thread and a busy IDE never reads as a lost connection.
    private readonly SingleFlight _healthProbe = new();

    public bool IsDegraded => _isDegraded;

    // The reason is logged, not stored — the wire dropped the degradedReason field (nothing read it back), and
    // RowStatus derives the row's degraded word from the _isDegraded bool alone.
    public void MarkDegraded(string reason)
    {
        if (!_isDegraded) { Console.Error.WriteLine($"[bridge] DEGRADED: {reason}"); VoltLog.Warn($"degraded: {reason}"); }
        _isDegraded = true;
    }

    public void ClearDegraded()
    {
        if (_isDegraded) { Console.Error.WriteLine("[bridge] DEGRADED cleared"); VoltLog.Info("degraded cleared"); }
        _isDegraded = false;
    }

    // ── abstract — vendor must implement ──
    public abstract bool IsConnected { get; }
    /// <summary>The IDE version, shown in the connector's project label (per instance). Not on the wire top-level.</summary>
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
    public abstract void SelectProject(ConnectRequest sel);
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
    protected void RunProbeOnce(Action probe) => _healthProbe.Run(probe);

    /// <summary>A best-effort background action that never overlaps itself: a call made while one is in flight is
    /// dropped and the cache just keeps its last snapshot.</summary>
    private sealed class SingleFlight
    {
        private readonly object _gate = new();
        private bool _inFlight;
        public void Run(Action work)
        {
            lock (_gate) { if (_inFlight) return; _inFlight = true; }
            Task.Run(() =>
            {
                try { work(); }
                catch { /* best-effort — the cache keeps its last snapshot */ }
                finally { lock (_gate) _inFlight = false; }
            });
        }
    }

    /// <summary>Build the uniform health response; the vendor supplies its cached snapshot values. Liveness collapses
    /// into the single <c>status</c> word (degraded is folded in), and the connectable-projects list rides along so
    /// the connector's one ambient poll gets both.</summary>
    /// <summary>The per-row <c>status</c> for a project row: the SERVING row reflects the driver's degraded state; a
    /// listed-but-not-served row is just alive (healthy). Degraded only ever attaches to the one project this bridge
    /// is actually talking to.</summary>
    protected string RowStatus(bool serving) => serving && _isDegraded ? HealthStatus.Degraded : HealthStatus.Healthy;
}
