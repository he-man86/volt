using System;
using System.Collections.Generic;
using System.Threading;
using Volt.Wire;
using Xunit;
using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Format.Task;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Volt.Engine.Seam;
using Volt.Engine.Sync;

namespace Volt.Engine.Tests;

/// <summary>The served-row health VERDICT is now a pure function of the live link signals (busy / degraded /
/// staleness), derived at /health time rather than frozen into a cached snapshot — so it can be unit-tested with no
/// live IDE, and can never report a stale "healthy" over a channel that dropped after the last snapshot.</summary>
public class HonestHealthTests
{
    // StaleMs in ComposedSession is 12_000; these straddle it well clear of the boundary.
    private const long Fresh = 3_000;
    private const long Stale = 20_000;

    [Theory]
    // An op holding the IDE thread IS a live link — busy, never a false drop — so it wins over everything, incl. a
    // long op that has outrun the staleness window and a lingering degraded flag from a prior transient.
    [InlineData(false, true, Fresh, HealthStatus.Healthy)]
    [InlineData(true, true, Stale, HealthStatus.Healthy)]
    // A recent transient (an op hit 0x800706BA) shows degraded — the fix for "health lied healthy while ops failed".
    [InlineData(true, false, Fresh, HealthStatus.Degraded)]
    // A confirmed-recent, un-degraded link is healthy.
    [InlineData(false, false, Fresh, HealthStatus.Healthy)]
    // No IDE response within the staleness window (a silent drop — IDE closed, probe can't refresh) is NOT healthy.
    [InlineData(false, false, Stale, HealthStatus.Degraded)]
    // Never confirmed at all (age = long.MaxValue) is likewise not healthy.
    [InlineData(false, false, long.MaxValue, HealthStatus.Degraded)]
    public void DeriveServedStatus_reflects_the_live_link(bool degraded, bool opInFlight, long ageMs, string expected)
    {
        Assert.Equal(expected, ComposedSession.DeriveServedStatus(degraded, opInFlight, ageMs));
    }

    /// <summary>Core throttles the ambient probe for EVERY host, so a host that declares no cadence of its own
    /// (CODESYS) can no longer marshal a snapshot onto the engineer's IDE thread once per poll per frontend. Each poll
    /// JOINS the probe it may have started before the next goes out — without that, the session's single-flight would
    /// coalesce the polls by itself and this would pass whatever the throttle was.</summary>
    [Fact]
    public void N_health_polls_inside_one_throttle_window_trigger_exactly_one_probe()
    {
        // 4 x 100ms = ~0.4s, comfortably inside ComposedSession.DefaultProbeThrottleMs (1s). The number is NOT read from
        // that const on purpose: this test has to COMPILE against the pre-fix tree to be run red first, and the const
        // arrives with the fix. Lower the floor below ~0.5s and shorten this loop with it.
        const int polls = 4, joinMs = 100;
        var host = new ProbeCountingHost();
        var session = new ComposedSession(host);

        // The first poll always probes: nothing has been published, so there is no cache to serve.
        session.BuildHealthResponse();
        Assert.True(host.Probed.Wait(5_000), "the first poll must kick a probe");

        for (var i = 0; i < polls; i++)
        {
            host.Probed.Reset();
            session.BuildHealthResponse();
            host.Probed.Wait(joinMs);   // let a probe, if one started, finish before the next poll goes out
        }

        Assert.Equal(1, host.Probes);
    }

    /// <summary>The session contract the TwinCAT host leans on: a probe whose IDE did not answer FAILS — it reaches
    /// <c>OnProbeFailed</c> (log + degraded) and does NOT stamp the freshness clock on the way, because the round-trip
    /// that stamps it (<c>StaDispatcher.Run</c>) is the worker's own in-process queue and never consults the XAE.
    /// <para>HONEST LABEL — this is a PIN, not the red-first proof for <c>dead-ide-marks-degraded</c>: the base machinery
    /// it exercises was already right. What it buys: move the stamp in <c>RunOnStaThread</c> ahead of the marshalled call,
    /// or re-swallow the probe failure, and the TwinCAT fix dies silently — here it goes red.</para></summary>
    [Fact]
    public void A_probe_whose_IDE_does_not_answer_demotes_the_served_row_to_degraded_and_does_not_restamp_freshness()
    {
        var session = new ComposedSession(new DeadIdeHost());

        session.TriggerAsyncProbe();
        Assert.True(SpinWait.SpinUntil(() => session.IsDegraded, 5_000), "a failed probe must mark the session degraded");
        Assert.Equal(HealthStatus.Degraded, session.BuildHealthResponse().Status);

        // Freshness, observed without a clock seam: clear the flag the probe just set, and the served row must STILL
        // read degraded — no IDE response was ever CONFIRMED, so the staleness branch (age = long.MaxValue) decides.
        // Had the failing round-trip stamped _lastOkTick on its way through, this would read healthy.
        session.ClearDegraded();
        Assert.Equal(HealthStatus.Degraded, session.BuildHealthResponse().Status);
    }

    /// <summary>A host whose IDE does not answer, shaped like <c>BeckhoffDriver</c>: its probe states its rows and that the
    /// IDE did not answer. The floor is parked far above the test's own duration so only the explicit
    /// <c>TriggerAsyncProbe</c> ever probes — no second probe can be in flight while the row is read.</summary>
    private sealed class DeadIdeHost : HealthOnlyHost
    {
        public override long HealthProbeFloorMs => 600_000;
        public override string? ServedProjectName => "P";

        public override ProjectProbe ProbeProjects() =>
            new(new List<ProjectEntry> { new("fake", "P", HealthStatus.Healthy, false) }, Bound: false,
                NotAnswering: "the IDE did not answer the liveness probe");
    }

    /// <summary>The minimum host: it counts probes and states an empty row list (which, published, stamps the throttle
    /// clock). Everything else is inert — no IDE, no marshalling.</summary>
    private sealed class ProbeCountingHost : HealthOnlyHost
    {
        private int _probes;
        public int Probes => Volatile.Read(ref _probes);
        public ManualResetEventSlim Probed { get; } = new(false);

        public override ProjectProbe ProbeProjects()
        {
            Interlocked.Increment(ref _probes);
            Probed.Set();
            return new ProjectProbe(new List<ProjectEntry>(), Bound: false);
        }
    }

    /// <summary>A host that answers only what the session asks: its tree and store are no part of a health test.</summary>
    private abstract class HealthOnlyHost : VendorDriverBase, IVendorDriver
    {
        public abstract ProjectProbe ProbeProjects();
        public virtual long HealthProbeFloorMs => ComposedSession.DefaultProbeThrottleMs;
        public virtual string? ServedProjectName => null;

        public T MarshalToIdeThread<T>(Func<T> fn) => fn();
        public bool IsConnected => true;
        public string Vendor => "fake";
        public string? IdeVersion => "0";
        public string? ProductName => null;
        public string? ProductVersion => null;
        public string? ProductVendor => null;
        public string? Unsupported => null;
        public string? NotServedBecause => null;
        public void Disconnect() { }
        public bool ShouldMarkDegraded(Exception ex) => false;
        public void Recover() { }
        public void SelectProject(ConnectRequest sel) { }
        public bool Build(IReadOnlyCollection<string>? applications) => true;
        public IReadOnlyList<BridgeDiagnostic> GetBuildDiagnostics(Func<HostWalk> walk) => Array.Empty<BridgeDiagnostic>();
        public override string? RefusedLanguageChange(string site, string from, string to) =>
            throw new NotSupportedException("a health double writes no body");
        public IReadOnlyList<Volt.Engine.Library.LibSignature> ExtractLibrarySignatures() =>
            throw new NotSupportedException("a health double reads no library");

        private static NotSupportedException NoTree() => new("a health double has no project");
        public VendorDeclaration Declaration => throw NoTree();
        public HostWalk Walk(WalkObserver? observer = null) => throw NoTree();
        public ItemRef Root => throw NoTree();
        public IReadOnlyList<ItemRef> Children(ItemRef node) => throw NoTree();
        public ItemRef Parent(ItemRef node) => throw NoTree();
        public string Name(ItemRef node) => throw NoTree();
        public NodeClass Classify(ItemRef node) => throw NoTree();
        public bool HandlesSurviveStructureChange => throw NoTree();
        public ItemRef CreateFolder(ItemRef parent, string name) => throw NoTree();
        public ItemRef CreateChild(ItemRef parent, string name, string kind, CreateArgs args) => throw NoTree();
        public void Delete(ItemRef parent, string name) => throw NoTree();
        public void Rename(ItemRef node, string newName) => throw NoTree();
        public void Move(ItemRef node, ItemRef target) => throw NoTree();
        public Content Read(ItemRef item) => throw NoTree();
        public void Write(ItemRef item, Content content, IReadOnlyList<PushedBody> bodies) => throw NoTree();
        public string ReadManifest(ItemRef item, string kind) => throw NoTree();
        public void WriteTask(ItemRef task, TaskSettings settings) => throw NoTree();
    }
}
