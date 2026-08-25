using System;
using System.Collections.Generic;
using System.Threading;
using Volt.Wire;
using Xunit;
using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Ide;

namespace Volt.Engine.Tests;

/// <summary>The served-row health VERDICT is now a pure function of the live link signals (busy / degraded /
/// staleness), derived at /health time rather than frozen into a cached snapshot — so it can be unit-tested with no
/// live IDE, and can never report a stale "healthy" over a channel that dropped after the last snapshot.</summary>
public class HonestHealthTests
{
    // StaleMs in DriverBase is 12_000; these straddle it well clear of the boundary.
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
        Assert.Equal(expected, DriverBase.DeriveServedStatus(degraded, opInFlight, ageMs));
    }

    /// <summary>Core throttles the ambient probe for EVERY driver, so a driver that declares no cadence of its own
    /// (CODESYS) can no longer marshal a snapshot onto the engineer's IDE thread once per poll per frontend. Each poll
    /// JOINS the probe it may have started before the next goes out — without that, <c>DriverBase.SingleFlight</c>
    /// would coalesce the polls by itself and this would pass whatever the throttle was.</summary>
    [Fact]
    public void N_health_polls_inside_one_throttle_window_trigger_exactly_one_probe()
    {
        // 4 x 100ms = ~0.4s, comfortably inside DriverBase.DefaultProbeThrottleMs (1s). The number is NOT read from
        // that const on purpose: this test has to COMPILE against the pre-fix tree to be run red first, and the const
        // arrives with the fix. Lower the floor below ~0.5s and shorten this loop with it.
        const int polls = 4, joinMs = 100;
        var driver = new ProbeCountingDriver();

        // The first poll always probes: nothing has been published, so there is no cache to serve.
        driver.BuildHealthResponse();
        Assert.True(driver.Probed.Wait(5_000), "the first poll must kick a probe");

        for (var i = 0; i < polls; i++)
        {
            driver.Probed.Reset();
            driver.BuildHealthResponse();
            driver.Probed.Wait(joinMs);   // let a probe, if one started, finish before the next poll goes out
        }

        Assert.Equal(1, driver.Probes);
    }

    /// <summary>The <c>DriverBase</c> contract <c>BeckhoffDriver.TriggerAsyncProbe</c> now leans on: a probe closure
    /// that FAILS reaches <c>OnProbeFailed</c> (log + degraded) and does NOT stamp the freshness clock on the way,
    /// because the round-trip that stamps it (<c>StaDispatcher.Run</c>) is the worker's own in-process queue and never
    /// consults the XAE.
    /// <para>HONEST LABEL — this is a PIN, not the red-first proof for <c>dead-ide-marks-degraded</c>. It is GREEN
    /// against the pre-move tree: the base machinery it exercises was already right; what was wrong was the TwinCAT
    /// driver READING AND DISCARDING its liveness verdict, so this closure could never fail and the one ambient writer
    /// of <c>_lastOkTick</c> re-stamped it against a dead XAE forever. That driver is reachable from no C# suite (no
    /// test project references <c>Volt.Cli.Ide.Twincat</c>; it is net8.0-windows over live COM), so the only real
    /// check for the driver half is the e2e against a running XAE. What this test does buy: move the stamp in
    /// <c>RunOnStaThread</c> ahead of the marshalled call, or re-swallow the probe failure, and the TwinCAT fix dies
    /// silently — here it goes red.</para></summary>
    [Fact]
    public void A_probe_whose_IDE_does_not_answer_demotes_the_served_row_to_degraded_and_does_not_restamp_freshness()
    {
        var driver = new DeadIdeDriver();

        driver.TriggerAsyncProbe();
        Assert.True(SpinWait.SpinUntil(() => driver.IsDegraded, 5_000), "a failed probe must mark the session degraded");
        Assert.Equal(HealthStatus.Degraded, driver.BuildHealthResponse().Status);

        // Freshness, observed without a clock seam: clear the flag the probe just set, and the served row must STILL
        // read degraded — no IDE response was ever CONFIRMED, so the staleness branch (age = long.MaxValue) decides.
        // Had the failing round-trip stamped _lastOkTick on its way through, this would read healthy.
        driver.ClearDegraded();
        Assert.Equal(HealthStatus.Degraded, driver.BuildHealthResponse().Status);
    }

    /// <summary>A driver whose IDE does not answer, shaped like <c>BeckhoffDriver</c> after the fix: the snapshot
    /// publishes its rows (stamping the cache + throttle clock) and the probe closure THEN fails with the coded
    /// error. The throttle is parked far above the test's own duration so only the explicit
    /// <c>TriggerAsyncProbe</c> ever probes — no second probe can be in flight while the row is read.</summary>
    private sealed class DeadIdeDriver : DriverBase
    {
        protected override long ProbeThrottleMs => 600_000;

        protected override void SnapshotHealth() =>
            PublishRows(new List<ProjectEntry> { new("fake", "0", "P", HealthStatus.Healthy, false) });

        public override void TriggerAsyncProbe() =>
            RunProbeOnce(() => RunOnStaThread<int>(() =>
            {
                SnapshotHealth();
                throw new BridgeException(BridgeErrorCodes.PlcDisconnected, "the IDE did not answer the liveness probe");
            }));

        protected override T MarshalToIdeThread<T>(Func<T> fn) => fn();
        public override bool IsConnected => true;
        public override string Vendor => "fake";
        public override string? ServedProjectName => "P";
        public override string? IdeVersion => "0";
        public override void Disconnect() { }
        public override bool ShouldMarkDegraded(Exception ex) => false;
        public override void SelectProject(ConnectRequest sel) { }
        public override void FlushPendingWrites() { }
        public override bool Build() => true;
        public override IReadOnlyList<BridgeDiagnostic> GetBuildDiagnostics() => Array.Empty<BridgeDiagnostic>();
    }

    /// <summary>The minimum DriverBase subclass: it counts probes and publishes an empty row list (which is what
    /// stamps the throttle clock). Everything else is inert — no IDE, no marshalling.</summary>
    private sealed class ProbeCountingDriver : DriverBase
    {
        private int _probes;
        public int Probes => Volatile.Read(ref _probes);
        public ManualResetEventSlim Probed { get; } = new(false);

        protected override void SnapshotHealth()
        {
            Interlocked.Increment(ref _probes);
            PublishRows(new List<ProjectEntry>());
            Probed.Set();
        }

        protected override T MarshalToIdeThread<T>(Func<T> fn) => fn();
        public override bool IsConnected => true;
        public override string Vendor => "fake";
        public override string? ServedProjectName => null;
        public override string? IdeVersion => "0";
        public override void Disconnect() { }
        public override bool ShouldMarkDegraded(Exception ex) => false;
        public override void SelectProject(ConnectRequest sel) { }
        public override void FlushPendingWrites() { }
        public override bool Build() => true;
        public override IReadOnlyList<BridgeDiagnostic> GetBuildDiagnostics() => Array.Empty<BridgeDiagnostic>();
    }
}
