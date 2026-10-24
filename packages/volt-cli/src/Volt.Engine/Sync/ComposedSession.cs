using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Library;
using Volt.Engine.Seam;

namespace Volt.Engine.Sync;

/// <summary>
/// The session every vendor shares, composed ONCE over the primitives a host supplies (<see cref="IVendorSession"/>: its
/// marshal, its probe, its probe floor; openspec <c>volt-cli-rework</c> F5): the degraded-state machine, the IDE-thread
/// liveness bracketing (<see cref="RunOnStaThread{T}"/>), the single-flight ambient health probe, the health verdict
/// helpers (<see cref="RowStatus"/> / <see cref="DeriveServedStatus"/> / <see cref="OverlayLiveHealth"/>), the whole
/// health response and the library-signature cache. A host supplies rows (<see cref="IVendorSession.ProbeProjects"/>) and
/// never a <see cref="HealthResponse"/>, so none can skip <see cref="OverlayLiveHealth"/> (health-compose-in-core).
///
/// <para>What every host's session does around its snapshot is done here, once: a live binding clears degraded, an
/// ambient probe whose cross-process IDE did not answer fails, a <c>select</c> refreshes the rows after the host's own, a
/// <c>disconnect</c> clears degraded.</para>
///
/// <para>This is not a vendor SEAM: nothing here decides a wire-visible outcome for one vendor. The policies (the select
/// post-condition, the not-connected precondition) are <c>Host/BridgePipeHost</c>'s and <c>Sync/OpGuard</c>'s, once for
/// every vendor, against the LIVE reads <see cref="IsConnected"/> and <see cref="ServedProjectName"/>.</para>
/// </summary>
public class ComposedSession
{
    public ComposedSession(IVendorDriver host) => Host = host ?? throw new ArgumentNullException(nameof(host));

    /// <summary>The host this session is composed over.</summary>
    public IVendorDriver Host { get; }

    // ── the host's state reads, forwarded (live, never the cached snapshot) ──
    public bool IsConnected => Host.IsConnected;
    public string Vendor => Host.Vendor;
    public string? ServedProjectName => Host.ServedProjectName;
    public string? IdeVersion => Host.IdeVersion;
    public string? ProductName => Host.ProductName;
    public string? ProductVersion => Host.ProductVersion;
    public string? ProductVendor => Host.ProductVendor;
    public string? Unsupported => Host.Unsupported;
    public string? NotServedBecause => Host.NotServedBecause;
    public bool ShouldMarkDegraded(Exception ex) => Host.ShouldMarkDegraded(ex);
    public void Recover() => Host.Recover();
    public void Disconnect() { Host.Disconnect(); ClearDegraded(); }

    /// <summary>The host's select, then its rows at once (both hosts refreshed on select).</summary>
    public void SelectProject(ConnectRequest sel) { Host.SelectProject(sel); Probe(); }

    /// <summary>This session's last extraction, which a DIRECTED <c>.library</c> read reuses while every library it names
    /// keeps its version (<see cref="Library.LibrarySignatureCache"/>) — one per session, i.e. per pipe host.</summary>
    public LibrarySignatureCache LibrarySignatureCache { get; } = new();

    // ── degraded state ──
    private volatile bool _isDegraded;

    public bool IsDegraded => _isDegraded;

    // The reason is logged, not stored — the wire dropped the degradedReason field (nothing read it back), and
    // RowStatus derives the row's degraded word from the _isDegraded bool alone.
    public void MarkDegraded(string reason)
    {
        if (!_isDegraded) BridgeLog.Warn($"DEGRADED: {reason}");
        _isDegraded = true;
    }

    public void ClearDegraded()
    {
        if (_isDegraded) BridgeLog.Info("DEGRADED cleared");
        _isDegraded = false;
    }

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
                                     // (Open: count only real client ops here, or bound the probe's age and treat an
                                     // over-stale in-flight probe as degraded — volt-cli-rework 3.1.)
    private const long StaleMs = 12_000; // ~3 poll intervals with no confirmed IDE response ⇒ the link is suspect.

    // The one ambient-poll refresher. `health` (liveness + the instances list) is refreshed off the request path,
    // single-flight, so a poll never marshals onto the busy IDE thread and a busy IDE never reads as a lost connection.
    private readonly SingleFlight _healthProbe = new();

    // ── the cached project ROWS (the slow-changing half of `health`) ──
    // The host reads them on ITS IDE thread (ProbeProjects) and they are published here; `health` is answered off that
    // thread from this cache, so a poll never marshals. Only the LIST is cached — the served row's verdict is overlaid
    // LIVE at read time (see OverlayLiveHealth).
    private readonly object _cacheLock = new();
    private List<ProjectEntry> _rows = new();
    private int _publishedAtTick;   // Environment.TickCount at the last PublishRows. An int, not TickCount64 —
    private bool _everPublished;    // netstandard2.0 has neither, and a 0 sentinel collides with a real tick, so
                                    // "never published" gets its own flag (same idiom as _lastOkTick/_everOk above).

    /// <summary>Marshal <paramref name="fn"/> onto the IDE's one work thread — bracketed so a concurrent /health poll
    /// reads "busy" (a live link) not a false drop, and STAMPING freshness on success so a silent channel drop (no op,
    /// no response) shows up as stale. The per-vendor marshalling is the host's
    /// <see cref="IVendorSession.MarshalToIdeThread{T}"/>.</summary>
    public T RunOnStaThread<T>(Func<T> fn)
    {
        Interlocked.Increment(ref _opInFlight);
        try
        {
            var r = Host.MarshalToIdeThread(fn);
            Volatile.Write(ref _lastOkTick, Environment.TickCount); // the IDE responded ⇒ link confirmed live now
            _everOk = true;
            return r;
        }
        finally { Interlocked.Decrement(ref _opInFlight); }
    }

    /// <summary>The rows, read NOW on the calling thread: the host's start, already on its IDE thread right after its
    /// connect, so the rows show at once. The liveness verdict is not acted on — a request-path refresh never fails.</summary>
    public void Refresh() => Probe();

    /// <summary>One probe: a live binding clears degraded (as each host's own snapshot did), then the rows are published.</summary>
    private ProjectProbe Probe()
    {
        var probe = Host.ProbeProjects();
        if (probe.Bound && IsDegraded) ClearDegraded();
        PublishRows(probe.Rows.ToList());
        return probe;
    }

    /// <summary>Run <paramref name="probe"/> on a background thread, single-flight: a probe already in progress is skipped
    /// (health keeps the last snapshot). A probe failure never faults the /health request — but it is never swallowed
    /// either: see <see cref="OnProbeFailed"/>.</summary>
    protected void RunProbeOnce(Action probe) => _healthProbe.Run(probe, OnProbeFailed);

    /// <summary>A background health probe threw. The request path is unaffected (health answers from the last
    /// snapshot), but the snapshot is now STALE and that must be visible: log it and mark the session degraded so
    /// /health stops reporting a confident verdict. Not sticky — the next bound probe clears it. Logged on EVERY failure,
    /// not just the first: the throttle bounds this to ~one line per poll interval, and during a real outage the
    /// repetition (with timestamps) is exactly what makes it diagnosable.</summary>
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
                try { work(); }
                catch (Exception ex) { try { onFailure(ex); } catch { /* reporting must never fault the probe */ } }
                finally { lock (_gate) _inFlight = false; }
            });
        }
    }

    /// <summary>Publish a freshly-read row snapshot and stamp the throttle clock: the instant the rows become readable on
    /// the poll thread.</summary>
    protected void PublishRows(List<ProjectEntry> rows)
    {
        lock (_cacheLock) { _rows = rows; _publishedAtTick = Environment.TickCount; _everPublished = true; }
    }

    /// <summary>The engine's floor on ambient health probing: no vendor probes more often than this, whatever its cadence
    /// would otherwise be. Every Volt frontend polls `health` on its own 4s clock — the connector's tray timer,
    /// volt-control's session poll (one per open workspace, in VS Code AND the desktop window), plus every
    /// control-plane status call — and a host with no floor marshalled a full snapshot onto the engineer's IDE thread for
    /// EVERY one of them. The floor is deliberately FAR below that 4s poll, so no client's own cadence is aliased: a poll
    /// a second or more after the last probe still probes, and only a burst that lands together collapses to one. A host
    /// states its own (<see cref="IVendorSession.HealthProbeFloorMs"/>): TwinCAT keeps 5000, because its snapshot crosses
    /// a COM apartment boundary (unify-probe-throttle).</summary>
    public const long DefaultProbeThrottleMs = 1000;

    /// <summary>The ambient poll response, composed ONCE for every vendor: serve the cached row list, kick the
    /// off-request single-flight refresh when the cache is older than the host's floor, and overlay the LIVE served-row
    /// verdict. <c>virtual</c> for the in-memory test double alone: it has no IDE to snapshot, so it answers from its live
    /// knobs instead.</summary>
    public virtual HealthResponse BuildHealthResponse()
    {
        List<ProjectEntry> rows; long ageMs; bool published;
        lock (_cacheLock)
        {
            rows = _rows;
            published = _everPublished;
            // unchecked int subtraction is correct across TickCount wraparound; TickCount64 is not on netstandard2.0.
            ageMs = (long)unchecked(Environment.TickCount - _publishedAtTick);
        }
        if (!published || ageMs > Host.HealthProbeFloorMs) TriggerAsyncProbe();
        return new HealthResponse { Projects = OverlayLiveHealth(rows) };
    }

    /// <summary>Kick the ambient refresh — the host's probe on its IDE thread, single-flight, off the request path. The
    /// probe FAILS when the host's IDE did not answer — inside the marshalled closure, so the freshness clock is not
    /// restamped, and the failure is logged and marks the session degraded. <c>virtual</c> for the test double alone.</summary>
    public virtual void TriggerAsyncProbe() =>
        RunProbeOnce(() => RunOnStaThread(() =>
        {
            if (Probe().NotAnswering is { } why) throw new BridgeException(BridgeErrorCodes.PlcDisconnected, why);
            return 0;
        }));

    /// <summary>Marks a project row as served (non-idle) or idle. The actual served-row verdict (healthy vs degraded)
    /// is NOT frozen here — it is overlaid LIVE by <see cref="OverlayLiveHealth"/> at /health time, so a cached row
    /// can never report "healthy" over a channel that dropped after the snapshot.</summary>
    public static string RowStatus(bool serving) => serving ? HealthStatus.Healthy : HealthStatus.Idle;

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
    /// current status from <see cref="DeriveServedStatus"/>; idle rows stay idle.</summary>
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
