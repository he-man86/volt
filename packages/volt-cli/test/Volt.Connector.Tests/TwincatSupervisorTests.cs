using Volt.Connector;
using Xunit;

namespace Volt.Connector.Tests;

/// <summary>The per-XAE worker supervisor's REAP policy — stop a worker only after a SUSTAINED absence, so a
/// transient ROT gap from a busy DTE does not tear down a healthy one. Pure, no COM.
///
/// <para><b>Four of these used to assert spawns.</b> `Reconcile` returned `(Spawn, Reap)` and the only caller
/// discards the first half — `TwincatFleet.Tick` does `var (_, reap) = …` and then calls `EnsureWorker` for
/// every live pid, level-triggered, which is the right shape because a worker that died between ticks must come
/// back without a fresh "newly seen" edge. So the spawn list was computed, returned, thrown away, and pinned
/// here by tests that could not fail for any reason a user would notice.</para></summary>
public class TwincatSupervisorTests
{
    private static int[] Pids(params int[] p) => p;

    [Fact]
    public void A_present_xae_is_never_reaped()
    {
        var s = new TwincatSupervisor();
        Assert.Empty(s.Reap(Pids(100)));
        Assert.Empty(s.Reap(Pids(100)));
    }

    [Fact]
    public void A_brief_absence_does_not_reap_the_worker()
    {
        var s = new TwincatSupervisor();
        s.Reap(Pids(100));
        // Absent for fewer than ReapAfterMisses ticks — a transient ROT gap, keep the worker.
        for (var i = 1; i < TwincatSupervisor.ReapAfterMisses; i++) Assert.Empty(s.Reap(Pids()));
    }

    [Fact]
    public void A_sustained_absence_reaps_the_worker_after_N_misses()
    {
        var s = new TwincatSupervisor();
        s.Reap(Pids(100));
        for (var i = 1; i < TwincatSupervisor.ReapAfterMisses; i++) Assert.Empty(s.Reap(Pids()));

        Assert.Equal(new[] { 100 }, s.Reap(Pids()));   // the Nth consecutive miss
    }

    [Fact]
    public void A_flicker_resets_the_miss_count_so_the_worker_survives()
    {
        var s = new TwincatSupervisor();
        s.Reap(Pids(100));
        s.Reap(Pids());        // miss 1
        s.Reap(Pids(100));     // present again → misses reset
        // Now it would take another full N absences to reap — a single subsequent miss must not.
        Assert.Empty(s.Reap(Pids()));
    }

    /// <summary>Each XAE is counted on its own: one going away must not reap a sibling that is still there.</summary>
    [Fact]
    public void Absence_is_tracked_per_xae()
    {
        var s = new TwincatSupervisor();
        s.Reap(Pids(100, 200));
        for (var i = 1; i < TwincatSupervisor.ReapAfterMisses; i++) Assert.Empty(s.Reap(Pids(200)));

        Assert.Equal(new[] { 100 }, s.Reap(Pids(200)));
    }

    /// <summary>A reaped pid that returns starts its absence count from scratch — it must not carry the misses
    /// that got it reaped and vanish again on the next gap.</summary>
    [Fact]
    public void A_reaped_xae_that_returns_starts_counting_again()
    {
        var s = new TwincatSupervisor();
        s.Reap(Pids(100));
        for (var i = 0; i < TwincatSupervisor.ReapAfterMisses; i++) s.Reap(Pids());   // reap it

        s.Reap(Pids(100));                                   // back
        Assert.Empty(s.Reap(Pids()));                        // one miss is not enough again
    }
}
