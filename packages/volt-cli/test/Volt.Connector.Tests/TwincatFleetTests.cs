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

    /// <summary>A worker script that stays alive — both builds at once, for the tests that are not about bitness.</summary>
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

    private static TwincatWorkers Both(string exe) => new(X86: exe, X64: exe);

    /// <summary>A fleet over the fake probe; every XAE 32-bit (TcXaeShell 15) unless the test says otherwise.</summary>
    private static TwincatFleet Fleet(FakeProbe probe, Func<IReadOnlyList<(int Pid, bool? Elevated)>>? shells = null,
        Func<int, bool?>? xaeIs32Bit = null) =>
        new(probe.ListPids, shells ?? (() => Array.Empty<(int, bool?)>()), xaeIs32Bit ?? (_ => true));

    /// <summary>A worker build that marks which build it is and the XAE pid it was given (<c>--xae-pid &lt;pid&gt;</c>):
    /// the file <c>&lt;build&gt;.&lt;pid&gt;</c> beside it.</summary>
    private string MarkingWorker(string build)
    {
        var path = Path.Combine(_dir, build + ".cmd");
        File.WriteAllText(path, $"@echo off\r\necho.>\"{Path.Combine(_dir, build)}.%2\"\r\nping -n 60 127.0.0.1 >nul\r\n");
        return path;
    }

    private bool Spawned(string build, int pid) => File.Exists(Path.Combine(_dir, $"{build}.{pid}"));

    /// <summary>THE WORKER HAS THE XAE's BITNESS (DIALECT C2t): the Solution Explorer hierarchy crosses into the worker
    /// through the XAE's own msenvp proxy, which is of the XAE's bitness — so a 32-bit TcXaeShell gets the x86 build and
    /// a 64-bit TcXaeShell64 the x64 one, each reading the hierarchy in-process. Every cell, because no machine here
    /// runs a 64-bit XAE.</summary>
    [Theory]
    [InlineData(true, "x86", "x64")]    // TcXaeShell 15 (4024)
    [InlineData(false, "x64", "x86")]   // TcXaeShell64 (4026)
    public async Task The_worker_has_the_XAE_bitness(bool xaeIs32Bit, string expected, string other)
    {
        if (!OnWindows) return;
        var probe = new FakeProbe { Answer = new[] { 9100 } };
        using var fleet = Fleet(probe, xaeIs32Bit: _ => xaeIs32Bit);
        var workers = new TwincatWorkers(X86: MarkingWorker("x86"), X64: MarkingWorker("x64"));

        await fleet.Tick(workers, TimeSpan.FromSeconds(5));

        Assert.True(WaitUntil(() => Spawned(expected, 9100)), $"the {expected} worker was not spawned for this XAE");
        Assert.False(Spawned(other, 9100), $"the {other} worker was spawned for an XAE of the other bitness");
    }

    [Fact]
    public async Task Two_XAEs_of_different_bitness_each_get_their_own_build()
    {
        if (!OnWindows) return;
        var probe = new FakeProbe { Answer = new[] { 9201, 9264 } };
        using var fleet = Fleet(probe, xaeIs32Bit: pid => pid == 9201);
        var workers = new TwincatWorkers(X86: MarkingWorker("x86"), X64: MarkingWorker("x64"));

        await fleet.Tick(workers, TimeSpan.FromSeconds(5));

        Assert.True(WaitUntil(() => Spawned("x86", 9201) && Spawned("x64", 9264)), "each XAE must get the worker of its own bitness");
        Assert.False(Spawned("x64", 9201));
        Assert.False(Spawned("x86", 9264));
    }

    /// <summary>No build of the XAE's bitness: no worker at all — the other build cannot read that XAE's hierarchy —
    /// and the XAE is named, once.</summary>
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task A_missing_build_of_the_XAE_bitness_spawns_nothing_and_is_named(bool xaeIs32Bit)
    {
        if (!OnWindows) return;
        var probe = new FakeProbe { Answer = new[] { 9300 } };
        using var fleet = Fleet(probe, xaeIs32Bit: _ => xaeIs32Bit);
        var present = MarkingWorker(xaeIs32Bit ? "x64" : "x86");
        var workers = xaeIs32Bit ? new TwincatWorkers(X86: null, X64: present) : new TwincatWorkers(X86: present, X64: null);

        await fleet.Tick(workers, TimeSpan.FromSeconds(5));
        await fleet.Tick(workers, TimeSpan.FromSeconds(5));

        Assert.False(fleet.IsWorkerRunning(WorkerIdFor(9300)));
        Assert.False(Spawned(xaeIs32Bit ? "x64" : "x86", 9300), "the other bitness's worker was spawned");
        Assert.Equal(new[] { 9300 }, fleet.Unservable);
    }

    /// <summary>An XAE whose bitness cannot be read (it exited between the probe and the read) gets no worker this pass:
    /// a worker is never started on a guessed bitness.</summary>
    [Fact]
    public async Task An_XAE_of_unreadable_bitness_gets_no_worker()
    {
        if (!OnWindows) return;
        var probe = new FakeProbe { Answer = new[] { 9400 } };
        using var fleet = Fleet(probe, xaeIs32Bit: _ => null);
        var workers = new TwincatWorkers(X86: MarkingWorker("x86"), X64: MarkingWorker("x64"));

        await fleet.Tick(workers, TimeSpan.FromSeconds(5));

        Assert.False(fleet.IsWorkerRunning(WorkerIdFor(9400)));
        Assert.False(Spawned("x86", 9400) || Spawned("x64", 9400));
    }

    [Fact]
    public async Task One_worker_per_live_XAE_is_spawned_and_a_second_tick_does_not_double_it()
    {
        if (!OnWindows) return;
        var probe = new FakeProbe { Answer = new[] { 4242, 4243 } };
        using var fleet = Fleet(probe);
        var exe = WorkerExe();

        await fleet.Tick(Both(exe), TimeSpan.FromSeconds(5));
        Assert.True(WaitUntil(() => fleet.IsWorkerRunning(WorkerIdFor(4242)) && fleet.IsWorkerRunning(WorkerIdFor(4243))),
            "one worker per live XAE pid was expected");

        // Idempotent: the tray ticks on a timer, so the common case is "nothing changed".
        await fleet.Tick(Both(exe), TimeSpan.FromSeconds(5));
        Assert.True(fleet.IsWorkerRunning(WorkerIdFor(4242)));
        Assert.True(fleet.IsWorkerRunning(WorkerIdFor(4243)));
    }

    [Fact]
    public async Task A_closed_XAE_reaps_its_worker_only_after_the_debounce()
    {
        if (!OnWindows) return;
        var probe = new FakeProbe { Answer = new[] { 5150 } };
        using var fleet = Fleet(probe);
        var exe = WorkerExe();

        await fleet.Tick(Both(exe), TimeSpan.FromSeconds(5));
        Assert.True(WaitUntil(() => fleet.IsWorkerRunning(WorkerIdFor(5150))), "the worker never started");

        // The XAE goes away. A transient ROT gap must NOT tear down a healthy worker, so the first misses are
        // absorbed — that debounce is the policy's whole purpose, and this is the first test that proves the
        // fleet actually honours it rather than the policy merely computing it.
        probe.Answer = Array.Empty<int>();
        for (var i = 1; i < TwincatSupervisor.ReapAfterMisses; i++)
        {
            await fleet.Tick(Both(exe), TimeSpan.FromSeconds(5));
            Assert.True(fleet.IsWorkerRunning(WorkerIdFor(5150)), $"reaped after only {i} miss(es) — the debounce was skipped");
        }

        await fleet.Tick(Both(exe), TimeSpan.FromSeconds(5)); // the miss that crosses the threshold
        Assert.True(WaitUntil(() => !fleet.IsWorkerRunning(WorkerIdFor(5150))), "a sustained absence must reap the worker");
    }

    /// <summary>THE PROJECT OPENED AGAIN (one worker per XAE): an XAE closed and its project opened again is a NEW XAE
    /// under a new pid, and the connector gives it its own worker — <c>--xae-pid &lt;new pid&gt;</c> — on the very tick it
    /// first sees it, while the closed XAE's worker is reaped after the debounce. A worker never re-attaches to another
    /// window, so this spawn is the only way a reopened project is served again; the live half is
    /// <c>test/e2e/connection/ide-restart.test.ts</c>, whose worker <c>ide.ps1</c> spawns with these same arguments.</summary>
    [Fact]
    public async Task A_project_opened_again_in_a_new_XAE_gets_a_new_worker_and_the_closed_one_is_reaped()
    {
        if (!OnWindows) return;
        var probe = new FakeProbe { Answer = new[] { 9500 } };
        using var fleet = Fleet(probe);
        var exe = MarkingWorker("x86");
        var workers = new TwincatWorkers(X86: exe, X64: null);

        await fleet.Tick(workers, TimeSpan.FromSeconds(5));
        Assert.True(WaitUntil(() => Spawned("x86", 9500) && fleet.IsWorkerRunning(WorkerIdFor(9500))), "the first XAE got no worker");

        probe.Answer = new[] { 9501 };   // closed, and opened again: a new XAE
        await fleet.Tick(workers, TimeSpan.FromSeconds(5));
        Assert.True(WaitUntil(() => Spawned("x86", 9501) && fleet.IsWorkerRunning(WorkerIdFor(9501))),
            "the XAE the project was opened again in got no worker of its own");

        for (var i = 1; i < TwincatSupervisor.ReapAfterMisses; i++) await fleet.Tick(workers, TimeSpan.FromSeconds(5));
        Assert.True(WaitUntil(() => !fleet.IsWorkerRunning(WorkerIdFor(9500))), "the closed XAE's worker outlived it");
        Assert.True(fleet.IsWorkerRunning(WorkerIdFor(9501)));
    }

    [Fact]
    public async Task A_FAILING_probe_leaves_the_fleet_alone_it_is_not_no_XAE()
    {
        if (!OnWindows) return;
        var probe = new FakeProbe { Answer = new[] { 6001 } };
        using var fleet = Fleet(probe);
        var exe = WorkerExe();

        await fleet.Tick(Both(exe), TimeSpan.FromSeconds(5));
        Assert.True(WaitUntil(() => fleet.IsWorkerRunning(WorkerIdFor(6001))), "the worker never started");

        // null means the probe could not answer — NOT that the XAE is gone. Reaping here would kill a healthy
        // worker every time a busy DTE declined to enumerate, which is the everyday case on a machine mid-push.
        probe.Answer = null;
        for (var i = 0; i < TwincatSupervisor.ReapAfterMisses + 2; i++) await fleet.Tick(Both(exe), TimeSpan.FromSeconds(5));
        Assert.True(fleet.IsWorkerRunning(WorkerIdFor(6001)), "a failing probe must never reap a healthy worker");

        // ...and supervision resumes once the probe recovers.
        probe.Answer = new[] { 6001, 6002 };
        await fleet.Tick(Both(exe), TimeSpan.FromSeconds(5));
        Assert.True(WaitUntil(() => fleet.IsWorkerRunning(WorkerIdFor(6002))), "spawning did not resume after the probe recovered");
    }

    [Fact]
    public async Task A_crashed_worker_is_respawned_while_its_XAE_lives()
    {
        if (!OnWindows) return;
        var probe = new FakeProbe { Answer = new[] { 7007 } };
        using var fleet = Fleet(probe);
        var exe = WorkerExe();

        await fleet.Tick(Both(exe), TimeSpan.FromSeconds(5));
        Assert.True(WaitUntil(() => fleet.IsWorkerRunning(WorkerIdFor(7007))), "the worker never started");

        fleet.StopWorker(WorkerIdFor(7007)); // stands in for a crash: the process is gone, the XAE is not
        Assert.False(fleet.IsWorkerRunning(WorkerIdFor(7007)));

        await fleet.Tick(Both(exe), TimeSpan.FromSeconds(5));
        Assert.True(WaitUntil(() => fleet.IsWorkerRunning(WorkerIdFor(7007))),
            "a worker that died while its XAE lived must come back on the next tick");
    }

    [Fact]
    public async Task No_worker_binary_means_no_probe_and_no_spawn()
    {
        var probe = new FakeProbe { Answer = new[] { 8008 } };
        using var fleet = Fleet(probe);

        await fleet.Tick(new TwincatWorkers(null, null), TimeSpan.FromSeconds(5));
        await fleet.Tick(new TwincatWorkers("", ""), TimeSpan.FromSeconds(5));

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
        using var fleet = Fleet(probe, shells: () => shells);
        var exe = WorkerExe();

        await fleet.Tick(Both(exe), TimeSpan.FromSeconds(5));
        await fleet.Tick(Both(exe), TimeSpan.FromSeconds(5));

        Assert.Equal(new[] { 200 }, fleet.ElevatedOutOfSight);
        Assert.False(fleet.IsWorkerRunning(WorkerIdFor(200)));
    }
}
