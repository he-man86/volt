using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using Volt.Connector;
using Xunit;

namespace Volt.Connector.Tests;

/// <summary>
/// THE FLEET LOOP ITSELF — probe → reconcile → spawn/reap, composed.
///
/// <para><c>TwincatFleet</c>'s own summary says it was lifted out of the WinForms tray so a test project could
/// reach it, "so the fleet rules that actually ran had zero coverage while the suite asserted a spawn plan the
/// tray discarded". The lift happened; the tests did not. Its three ingredients each have their own suite
/// (<see cref="TwincatSupervisorTests"/>, <see cref="TwincatXaeProbeTests"/>, <see cref="ProbeHealthTests"/>) and
/// nothing exercised the loop that ties them together — so "a crashed worker is respawned" and "a closed XAE is
/// reaped" were properties of three parts, never of the whole.</para>
///
/// <para>Real processes, as <see cref="BridgeSupervisorTests"/> does, because the spawn is the point. The probe
/// is the one thing faked: it spawns a COM-isolated subprocess to enumerate XAE windows, which no test can
/// conjure. Windows-only, like the connector.</para>
/// </summary>
public class TwincatFleetTests : IDisposable
{
    private static bool OnWindows => RuntimeInformation.IsOSPlatform(OSPlatform.Windows);

    private readonly string _dir = Directory.CreateDirectory(
        Path.Combine(Path.GetTempPath(), "volt-fleet-" + Guid.NewGuid().ToString("N"))).FullName;

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); } catch { /* a leaked child still holds a file */ }
    }

    /// <summary>A worker script that stays alive. `TwincatFleet` uses the probe exe AS the worker exe, so this is
    /// what every spawned "worker" runs.</summary>
    private string WorkerExe()
    {
        var path = Path.Combine(_dir, "worker.cmd");
        File.WriteAllText(path, "@echo off\r\nping -n 60 127.0.0.1 >nul\r\n");
        return path;
    }

    private static bool WaitUntil(Func<bool> condition, int timeoutMs = 20000)
    {
        var sw = Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < timeoutMs)
        {
            if (condition()) return true;
            Thread.Sleep(50);
        }
        return condition();
    }

    /// <summary>A probe whose answer the test controls: a pid list, or null for "the probe FAILED" (which is not
    /// the same as "no XAE is open", and the fleet must treat it differently).</summary>
    private sealed class FakeProbe
    {
        public IReadOnlyList<int>? Answer = Array.Empty<int>();
        public int Calls;
        public IReadOnlyList<int>? ListPids(string? exe, TimeSpan timeout) { Calls++; return Answer; }
    }

    private static string WorkerIdFor(int pid) => $"twincat.{pid}";

    [Fact]
    public async Task One_worker_per_live_XAE_is_spawned_and_a_second_tick_does_not_double_it()
    {
        if (!OnWindows) return;
        var probe = new FakeProbe { Answer = new[] { 4242, 4243 } };
        using var fleet = new TwincatFleet(probe.ListPids);
        var exe = WorkerExe();

        await fleet.Tick(exe, TimeSpan.FromSeconds(5));
        Assert.True(WaitUntil(() => fleet.IsWorkerRunning(WorkerIdFor(4242)) && fleet.IsWorkerRunning(WorkerIdFor(4243))),
            "one worker per live XAE pid was expected");

        // Idempotent: the tray ticks on a timer, so the common case is "nothing changed".
        await fleet.Tick(exe, TimeSpan.FromSeconds(5));
        Assert.True(fleet.IsWorkerRunning(WorkerIdFor(4242)));
        Assert.True(fleet.IsWorkerRunning(WorkerIdFor(4243)));
    }

    [Fact]
    public async Task A_closed_XAE_reaps_its_worker_only_after_the_debounce()
    {
        if (!OnWindows) return;
        var probe = new FakeProbe { Answer = new[] { 5150 } };
        using var fleet = new TwincatFleet(probe.ListPids);
        var exe = WorkerExe();

        await fleet.Tick(exe, TimeSpan.FromSeconds(5));
        Assert.True(WaitUntil(() => fleet.IsWorkerRunning(WorkerIdFor(5150))), "the worker never started");

        // The XAE goes away. A transient ROT gap must NOT tear down a healthy worker, so the first misses are
        // absorbed — that debounce is the policy's whole purpose, and this is the first test that proves the
        // fleet actually honours it rather than the policy merely computing it.
        probe.Answer = Array.Empty<int>();
        for (var i = 1; i < TwincatSupervisor.ReapAfterMisses; i++)
        {
            await fleet.Tick(exe, TimeSpan.FromSeconds(5));
            Assert.True(fleet.IsWorkerRunning(WorkerIdFor(5150)), $"reaped after only {i} miss(es) — the debounce was skipped");
        }

        await fleet.Tick(exe, TimeSpan.FromSeconds(5)); // the miss that crosses the threshold
        Assert.True(WaitUntil(() => !fleet.IsWorkerRunning(WorkerIdFor(5150))), "a sustained absence must reap the worker");
    }

    [Fact]
    public async Task A_FAILING_probe_leaves_the_fleet_alone_it_is_not_no_XAE()
    {
        if (!OnWindows) return;
        var probe = new FakeProbe { Answer = new[] { 6001 } };
        using var fleet = new TwincatFleet(probe.ListPids);
        var exe = WorkerExe();

        await fleet.Tick(exe, TimeSpan.FromSeconds(5));
        Assert.True(WaitUntil(() => fleet.IsWorkerRunning(WorkerIdFor(6001))), "the worker never started");

        // null means the probe could not answer — NOT that the XAE is gone. Reaping here would kill a healthy
        // worker every time a busy DTE declined to enumerate, which is the everyday case on a machine mid-push.
        probe.Answer = null;
        for (var i = 0; i < TwincatSupervisor.ReapAfterMisses + 2; i++) await fleet.Tick(exe, TimeSpan.FromSeconds(5));
        Assert.True(fleet.IsWorkerRunning(WorkerIdFor(6001)), "a failing probe must never reap a healthy worker");

        // ...and supervision resumes once the probe recovers.
        probe.Answer = new[] { 6001, 6002 };
        await fleet.Tick(exe, TimeSpan.FromSeconds(5));
        Assert.True(WaitUntil(() => fleet.IsWorkerRunning(WorkerIdFor(6002))), "spawning did not resume after the probe recovered");
    }

    [Fact]
    public async Task A_crashed_worker_is_respawned_while_its_XAE_lives()
    {
        if (!OnWindows) return;
        var probe = new FakeProbe { Answer = new[] { 7007 } };
        using var fleet = new TwincatFleet(probe.ListPids);
        var exe = WorkerExe();

        await fleet.Tick(exe, TimeSpan.FromSeconds(5));
        Assert.True(WaitUntil(() => fleet.IsWorkerRunning(WorkerIdFor(7007))), "the worker never started");

        fleet.StopWorker(WorkerIdFor(7007)); // stands in for a crash: the process is gone, the XAE is not
        Assert.False(fleet.IsWorkerRunning(WorkerIdFor(7007)));

        await fleet.Tick(exe, TimeSpan.FromSeconds(5));
        Assert.True(WaitUntil(() => fleet.IsWorkerRunning(WorkerIdFor(7007))),
            "a worker that died while its XAE lived must come back on the next tick");
    }

    [Fact]
    public async Task No_worker_binary_means_no_probe_and_no_spawn()
    {
        var probe = new FakeProbe { Answer = new[] { 8008 } };
        using var fleet = new TwincatFleet(probe.ListPids);

        await fleet.Tick(null, TimeSpan.FromSeconds(5));
        await fleet.Tick("", TimeSpan.FromSeconds(5));

        // A dev checkout without a build must not spawn the probe subprocess on every tick forever.
        Assert.Equal(0, probe.Calls);
        Assert.False(fleet.IsWorkerRunning(WorkerIdFor(8008)));
    }

    /// <summary>An XAE run "as administrator" never reaches the (unelevated) ROT probe, so it gets no worker; the fleet
    /// names it once — not every tick, not one the probe sees, not an unelevated one still starting up
    /// (environment-dependency-audit 2.2).</summary>
    [Fact]
    public async Task An_elevated_XAE_the_probe_cannot_see_is_named_once()
    {
        var probe = new FakeProbe { Answer = new[] { 100 } };
        var shells = new (int, bool?)[] { (100, true), (200, true), (300, false), (400, null) };
        using var fleet = new TwincatFleet(probe.ListPids, () => shells);
        var exe = WorkerExe();

        await fleet.Tick(exe, TimeSpan.FromSeconds(5));
        await fleet.Tick(exe, TimeSpan.FromSeconds(5));

        Assert.Equal(new[] { 200 }, fleet.ElevatedOutOfSight);
        Assert.False(fleet.IsWorkerRunning(WorkerIdFor(200)));
    }
}
