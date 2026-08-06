using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Volt.Engine.Wire;

using Volt.Cli.Transport;

namespace Volt.Engine.Ide;

/// <summary>Shared base for a vendor driver: <see cref="IIdeSession"/>'s degraded-state machine, the IDE-thread
/// liveness bracketing (<see cref="RunOnStaThread{T}"/>), the single-flight ambient health probe, and the health
/// verdict helpers (<see cref="RowStatus"/> / <see cref="DeriveServedStatus"/> / <see cref="OverlayLiveHealth"/>) —
/// the logic identical across vendors. A concrete driver overrides the abstract members for genuine IDE access
/// (connect, tree, code, build), supplies its own <see cref="IdeVersion"/>, and composes its own
/// <see cref="BuildHealthResponse"/> rows.
/// <para>ARCH FOLLOW-UP: because <c>BuildHealthResponse</c> is abstract, the wire-visible health shape is composed
/// TWICE (once per vendor) — against "parity-critical decisions live in Core, once". It belongs here (cache read +
/// throttle + <see cref="OverlayLiveHealth"/>) with the vendor supplying only the row snapshot.</para></summary>
public abstract class DriverBase : IIdeSession
{
    private volatile bool _isDegraded;

    // ── honest-health signals (all lock-free reads; no IDE thread needed to answer /health) ──
    // The health VERDICT is derived from these LIVE at read time, never from a frozen snapshot — so the cache can
    // carry the (slow-changing) project LIST, but can never report "healthy" over a channel that has since dropped.
    private int _lastOkTick;         // Environment.TickCount of the last IDE call that RESPONDED. Staleness demotes.
                                     // Read/written via Volatile (like _opInFlight) — written on the IDE/probe thread,
                                     // read on the pipe thread; an int field alone gives no barrier.
    private volatile bool _everOk;   // has any IDE call ever responded (distinguishes "never" from a tick of 0).
    private int _opInFlight;         // >0 while a call holds the IDE thread — that IS a live link (busy, not a false drop).
                                     // NB the ambient probe marshals through RunOnStaThread too, so it counts here as
                                     // well — and neither dispatcher can time out. A probe that never returns (wedged
                                     // IDE thread) therefore pins this >0 forever, and DeriveServedStatus keeps
                                     // answering "healthy": the probe meant to DETECT the hang is what masks it.
                                     // ARCH FOLLOW-UP: count only real client ops here (or bound the probe's age and
                                     // treat an over-stale in-flight probe as degraded).
    private const long StaleMs = 12_000; // ~3 poll intervals with no confirmed IDE response ⇒ the link is suspect.

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
    /// <summary>See <see cref="IIdeSession.Vendor"/> — a per-driver constant.</summary>
    public abstract string Vendor { get; }
    /// <summary>See <see cref="IIdeSession.ServedProjectName"/> — the LIVE served project, never the cached snapshot.</summary>
    public abstract string? ServedProjectName { get; }
    /// <summary>The IDE version, shown in the connector's project label (per instance). Not on the wire top-level.</summary>
    public abstract string? IdeVersion { get; }
    // No abstract Connect(): startup attach is vendor-shaped (CODESYS Connect() vs TwinCAT Connect(int xaePid)), each
    // driver declares its own and its own host calls it — Core never connects. See IIdeSession.
    public abstract void Disconnect();
    public abstract void TriggerAsyncProbe();
    public abstract HealthResponse BuildHealthResponse();
    public abstract bool ShouldMarkDegraded(Exception ex);
    /// <summary>Default no-op: an in-proc driver (CODESYS) has no cross-process channel to re-acquire. TwinCAT
    /// overrides to re-establish the desired binding by stable name.</summary>
    public virtual void Recover() { }

    /// <summary>Marshal <paramref name="fn"/> onto the IDE's one work thread — bracketed so a concurrent /health poll
    /// reads "busy" (a live link) not a false drop, and STAMPING freshness on success so a silent channel drop (no op,
    /// no response) shows up as stale. The actual per-vendor marshalling is <see cref="MarshalToIdeThread"/>.</summary>
    public T RunOnStaThread<T>(Func<T> fn)
    {
        Interlocked.Increment(ref _opInFlight);
        try
        {
            var r = MarshalToIdeThread(fn);
            Volatile.Write(ref _lastOkTick, Environment.TickCount); // the IDE responded ⇒ link confirmed live now
            _everOk = true;
            return r;
        }
        finally { Interlocked.Decrement(ref _opInFlight); }
    }

    /// <summary>Per-vendor thread marshalling (CODESYS primary thread / TwinCAT STA). Called only through
    /// <see cref="RunOnStaThread{T}"/>, which owns the busy/freshness bracketing.</summary>
    protected abstract T MarshalToIdeThread<T>(Func<T> fn);

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

    /// <summary>Run <paramref name="probe"/> on a background thread, single-flight: a probe already in
    /// progress is skipped (health keeps the last snapshot). A probe failure never faults the /health request — but
    /// it is never swallowed either: see <see cref="OnProbeFailed"/>.</summary>
    protected void RunProbeOnce(Action probe) => _healthProbe.Run(probe, OnProbeFailed);

    /// <summary>A background health probe threw. The request path is unaffected (health answers from the last
    /// snapshot), but the snapshot is now STALE and that must be visible: log it and mark the session degraded so
    /// /health stops reporting a confident verdict. Not sticky — the next successful <c>SnapshotHealth</c> clears it.
    /// Logged on EVERY failure, not just the first: the throttle bounds this to ~one line per poll interval, and
    /// during a real outage the repetition (with timestamps) is exactly what makes it diagnosable.</summary>
    private void OnProbeFailed(Exception ex)
    {
        VoltLog.Warn($"health probe failed — the cached snapshot is stale until the next successful probe: {ex.Message}");
        MarkDegraded($"health probe failed: {ex.Message}");
    }

    /// <summary>A best-effort background action that never overlaps itself: a call made while one is in flight is
    /// dropped and the cache just keeps its last snapshot.</summary>
    private sealed class SingleFlight
    {
        private readonly object _gate = new();
        private bool _inFlight;
        public void Run(Action work, Action<Exception> onFailure)
        {
            lock (_gate) { if (_inFlight) return; _inFlight = true; }
            Task.Run(() =>
            {
                // Best-effort for the REQUEST (a probe failure must never fault /health — the cache keeps its last
                // snapshot), but NEVER silent. A bare catch here meant a failed re-attach after an IDE returned left
                // health repeating a stale "nothing serving" forever with no log and no degraded flag — a real
                // failure masked by a fallback, and it cost three live debugging cycles with nothing to read.
                // Degraded is not sticky: the next successful SnapshotHealth clears it.
                try { work(); }
                catch (Exception ex) { try { onFailure(ex); } catch { /* reporting must never fault the probe */ } }
                finally { lock (_gate) _inFlight = false; }
            });
        }
    }

    /// <summary>Marks a project row as served (non-idle) or idle. The actual served-row verdict (healthy vs degraded)
    /// is NOT frozen here — it is overlaid LIVE by <see cref="OverlayLiveHealth"/> at /health time, so a cached row
    /// can never report "healthy" over a channel that dropped after the snapshot. "Is it serving" derives from the
    /// wire status at the edge (status != idle), so there is no separate serving flag.</summary>
    protected string RowStatus(bool serving) => serving ? HealthStatus.Healthy : HealthStatus.Idle;

    /// <summary>The LIVE verdict for the one served row, derived from the current link signals — the pure decision,
    /// unit-tested without an IDE. An op holding the thread is a live link (busy → healthy); a recent transient is
    /// <c>degraded</c>; no IDE response within the staleness window (and no op in flight) is a suspect/dropped link
    /// (→ degraded), never a stale "healthy" — except while something is in flight, which is unbounded today (see the
    /// <c>_opInFlight</c> note: a wedged probe defeats this).</summary>
    public static string DeriveServedStatus(bool degraded, bool opInFlight, long lastOkAgeMs)
    {
        if (opInFlight) return HealthStatus.Healthy;
        if (degraded) return HealthStatus.Degraded;
        if (lastOkAgeMs > StaleMs) return HealthStatus.Degraded;
        return HealthStatus.Healthy;
    }

    /// <summary>Overlay the live served-row verdict onto a cached project list: the served (non-idle) row gets the
    /// current status from <see cref="DeriveServedStatus"/>; idle rows stay idle. The vendor caches only the slow
    /// project LIST (identity/version/dirty) + which one is served; the health VERDICT is always live.</summary>
    protected List<ProjectEntry> OverlayLiveHealth(List<ProjectEntry> cached)
    {
        // unchecked int subtraction is correct across TickCount wraparound; TickCount64 is not on netstandard2.0.
        var ageMs = _everOk ? (long)unchecked(Environment.TickCount - Volatile.Read(ref _lastOkTick)) : long.MaxValue;
        var live = DeriveServedStatus(_isDegraded, Volatile.Read(ref _opInFlight) > 0, ageMs);
        var result = new List<ProjectEntry>(cached.Count);
        foreach (var p in cached) result.Add(p.Status == HealthStatus.Idle ? p : p with { Status = live });
        return result;
    }
}
