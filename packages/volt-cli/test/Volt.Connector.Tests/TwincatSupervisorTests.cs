using System.Linq;
using Volt.Connector;
using Xunit;

namespace Volt.Connector.Tests;

/// <summary>The per-XAE worker supervisor's reconcile policy — spawn one worker per running XAE, reap only after a
/// SUSTAINED absence (so a transient ROT gap from a busy DTE doesn't tear down a healthy worker). Pure, no COM.</summary>
public class TwincatSupervisorTests
{
    private static int[] Pids(params int[] p) => p;

    [Fact]
    public void A_new_xae_spawns_exactly_once_while_it_stays_present()
    {
        var s = new TwincatSupervisor();
        var (spawn, reap) = s.Reconcile(Pids(100));
        Assert.Equal(new[] { 100 }, spawn);
        Assert.Empty(reap);

        // Still present next tick → NOT spawned again (its worker is running).
        (spawn, reap) = s.Reconcile(Pids(100));
        Assert.Empty(spawn);
        Assert.Empty(reap);
    }

    [Fact]
    public void Each_running_xae_gets_its_own_worker()
    {
        var s = new TwincatSupervisor();
        var (spawn, _) = s.Reconcile(Pids(100, 200, 300));
        Assert.Equal(new[] { 100, 200, 300 }, spawn.OrderBy(x => x));
    }

    [Fact]
    public void A_brief_absence_does_not_reap_the_worker()
    {
        var s = new TwincatSupervisor();
        s.Reconcile(Pids(100));
        // Absent for fewer than ReapAfterMisses ticks — a transient ROT gap, keep the worker.
        for (int i = 1; i < TwincatSupervisor.ReapAfterMisses; i++)
        {
            var (spawn, reap) = s.Reconcile(Pids());
            Assert.Empty(reap);
            Assert.Empty(spawn);
        }
    }

    [Fact]
    public void A_sustained_absence_reaps_the_worker_after_N_misses()
    {
        var s = new TwincatSupervisor();
        s.Reconcile(Pids(100));
        for (int i = 1; i < TwincatSupervisor.ReapAfterMisses; i++) Assert.Empty(s.Reconcile(Pids()).Reap);

        var (_, reap) = s.Reconcile(Pids()); // the Nth consecutive miss
        Assert.Equal(new[] { 100 }, reap);
    }

    [Fact]
    public void A_flicker_resets_the_miss_count_so_the_worker_survives()
    {
        var s = new TwincatSupervisor();
        s.Reconcile(Pids(100));
        s.Reconcile(Pids());        // miss 1
        s.Reconcile(Pids(100));     // present again → misses reset
        // Now it would take another full N absences to reap — a single subsequent miss must not.
        Assert.Empty(s.Reconcile(Pids()).Reap);
    }

    [Fact]
    public void A_reaped_xae_that_returns_spawns_a_fresh_worker()
    {
        var s = new TwincatSupervisor();
        s.Reconcile(Pids(100));
        for (int i = 0; i < TwincatSupervisor.ReapAfterMisses; i++) s.Reconcile(Pids()); // reap it

        var (spawn, _) = s.Reconcile(Pids(100));
        Assert.Equal(new[] { 100 }, spawn); // returning XAE → spawn anew
    }
}
