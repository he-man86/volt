using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Volt.Connector;
using Volt.Wire;
using Xunit;
using Volt.Contracts;

namespace Volt.Connector.Tests;

/// <summary>A fake source so the ConnectionManager can be exercised with no pipe/IDE: it returns a scripted
/// project list, reports reachability, records binds/unbinds, and can be told to throw on scan (an unreachable
/// bridge). Shared by <see cref="ConnectionManagerTests"/> (detection) and <see cref="ConnectionManagerSessionTests"/>
/// (the session/reconcile loop).</summary>
internal sealed class FakeProjectSource : IProjectSource
{
    public string Vendor { get; }
    public string DisplayName { get; }
    public List<DetectedProject> Projects { get; } = new();
    /// <summary>Whether the bridge answered this tick — the one bit the rows can't express (up-but-empty vs down).</summary>
    public bool Reachable { get; set; } = true;
    public bool ThrowOnEnumerate { get; set; }
    /// <summary>Delay this source's scan (models a slow/hung bridge).</summary>
    public int ScanDelayMs { get; set; }
    /// <summary>Latch to prove CONCURRENT scanning by ORDERING (not a wall-clock budget, which flakes when a loaded CI
    /// runner slows even the concurrent path): the scan signals <see cref="ScanEntered"/> then awaits <see cref="ScanRelease"/>.</summary>
    public CountdownEvent? ScanEntered { get; set; }
    public Task? ScanRelease { get; set; }
    public List<DetectedProject> Bound { get; } = new();
    public List<DetectedProject> Unbound { get; } = new();

    public FakeProjectSource(string vendor, string display) { Vendor = vendor; DisplayName = display; }

    public DetectedProject Add(string name, bool dirty = false, bool serving = false, string status = HealthStatus.Healthy)
    {
        var attach = new ProjectRef(name);
        // serving folds into status: a not-serving row is "idle"; a serving one carries its channel status.
        var p = new DetectedProject(DetectedProject.MakeId(Vendor, attach), name, Vendor, dirty, attach, Status: serving ? status : HealthStatus.Idle);
        Projects.Add(p);
        return p;
    }

    public async Task<SourceScan> ScanAsync()
    {
        if (ThrowOnEnumerate) throw new InvalidOperationException("unreachable");
        ScanEntered?.Signal();
        if (ScanRelease != null) await ScanRelease;
        else if (ScanDelayMs > 0) await Task.Delay(ScanDelayMs);
        return new SourceScan(Projects.ToList(), Reachable);
    }

    public Task BindAsync(DetectedProject project) { Bound.Add(project); return Task.CompletedTask; }
    public Task UnbindAsync(DetectedProject project) { Unbound.Add(project); return Task.CompletedTask; }
}

/// <summary>The detection + aggregate + concurrency core of the ConnectionManager — no sessions, no pipes. The
/// session/reconcile behaviour lives in <see cref="ConnectionManagerSessionTests"/>; the pure planner in
/// <see cref="ReconcilerTests"/>.</summary>
public class ConnectionManagerTests
{
    private static ConnectionManager Mgr(params IProjectSource[] sources) => new(sources);

    [Fact]
    public async Task Merges_projects_from_all_sources_into_one_list()
    {
        var cds = new FakeProjectSource("codesys", "CODESYS");
        var tc = new FakeProjectSource("twincat", "TwinCAT");
        cds.Add("MachineA");
        tc.Add("MachineB");
        var mgr = Mgr(cds, tc);

        await mgr.RefreshAsync();

        Assert.Equal(new[] { "MachineA", "MachineB" }, mgr.Projects.Select(p => p.DisplayName).OrderBy(x => x));
        Assert.Equal("codesys", mgr.Projects.Single(p => p.DisplayName == "MachineA").Vendor);
        Assert.Equal("twincat", mgr.Projects.Single(p => p.DisplayName == "MachineB").Vendor);
    }

    [Fact]
    public void DisplayName_lookup_backs_the_platform_prefix_and_notification()
    {
        var mgr = Mgr(new FakeProjectSource("codesys", "CODESYS"), new FakeProjectSource("twincat", "TwinCAT"));
        Assert.Equal("CODESYS", mgr.DisplayNameOf("codesys"));
        Assert.Equal("TwinCAT", mgr.DisplayNameOf("twincat"));
    }

    [Theory]
    // With NOTHING wanted, the tray never goes green: a reachable channel only means "up, waiting for a pick"
    // (Unavailable/amber); if no channel is reachable there is nothing there (Unknown). Green requires a project that
    // is both SERVING and WANTED — see the session tests.
    [InlineData(true, false, BridgeStatus.Unavailable)]
    [InlineData(true, true, BridgeStatus.Unavailable)]
    [InlineData(false, false, BridgeStatus.Unknown)]
    public async Task Aggregate_with_nothing_wanted_is_Unavailable_iff_any_channel_is_reachable(
        bool aReachable, bool bReachable, BridgeStatus expected)
    {
        var s1 = new FakeProjectSource("codesys", "CODESYS") { Reachable = aReachable };
        var s2 = new FakeProjectSource("twincat", "TwinCAT") { Reachable = bReachable };
        var mgr = Mgr(s1, s2);
        await mgr.RefreshAsync();
        Assert.Equal(expected, mgr.Aggregate());
    }

    [Fact]
    public async Task IsServingProject_is_independent_per_row_across_all_IDEs()
    {
        // Four IDEs, two serving: each row's serving is its OWN bridge's fact, so one connected IDE never flips
        // another's connection state.
        var cds = new FakeProjectSource("codesys", "CODESYS");
        cds.Add("A", serving: true); cds.Add("B", serving: false);
        var tc = new FakeProjectSource("twincat", "TwinCAT");
        tc.Add("C", serving: true); tc.Add("D", serving: false);
        var mgr = Mgr(cds, tc);
        await mgr.RefreshAsync();

        string Id(string v, string n) => $"{v}:{n}";
        Assert.True(mgr.IsServingProject(Id("codesys", "A")));
        Assert.False(mgr.IsServingProject(Id("codesys", "B")));
        Assert.True(mgr.IsServingProject(Id("twincat", "C")));
        Assert.False(mgr.IsServingProject(Id("twincat", "D")));
    }

    [Fact]
    public async Task Same_name_across_different_vendors_stays_distinct()
    {
        // vendor+name is the identity, so "Shared" on CODESYS and "Shared" on TwinCAT are TWO rows.
        var cds = new FakeProjectSource("codesys", "CODESYS");
        cds.Add("Shared");
        var tc = new FakeProjectSource("twincat", "TwinCAT");
        tc.Add("Shared");
        var mgr = Mgr(cds, tc);
        await mgr.RefreshAsync();

        Assert.Equal(2, mgr.Projects.Count);
        Assert.Equal(2, mgr.Projects.Select(p => p.Id).Distinct().Count());
    }

    [Fact]
    public async Task Same_name_same_vendor_collapse_keeps_the_SERVING_instance()
    {
        // Two CODESYS on an identically-named project collapse to one row (vendor+name identity). If the enumeration
        // lists the IDLE one first, the SERVING instance must still win.
        var cds = new FakeProjectSource("codesys", "CODESYS");
        cds.Add("MachineA", serving: false);
        cds.Add("MachineA", serving: true);
        var mgr = Mgr(cds);

        await mgr.RefreshAsync();

        var row = Assert.Single(mgr.Projects);
        Assert.True(mgr.IsServingProject(row.Id));
    }

    [Fact]
    public async Task Two_projects_with_the_same_name_collapse_to_one_row()
    {
        var cds = new FakeProjectSource("codesys", "CODESYS");
        cds.Add("MachineA");
        cds.Add("MachineA");
        var mgr = Mgr(cds);

        await mgr.RefreshAsync();

        Assert.Single(mgr.Projects);
        Assert.Equal("MachineA", mgr.Projects[0].DisplayName);
    }

    [Fact]
    public async Task Merges_four_projects_across_multiple_sources_into_one_list()
    {
        var cds = new FakeProjectSource("codesys", "CODESYS");
        cds.Add("MachineA"); cds.Add("MachineB");
        var tc = new FakeProjectSource("twincat", "TwinCAT");
        tc.Add("Line1"); tc.Add("Line2");
        var mgr = Mgr(cds, tc);

        await mgr.RefreshAsync();

        Assert.Equal(new[] { "Line1", "Line2", "MachineA", "MachineB" }, mgr.Projects.Select(p => p.DisplayName).OrderBy(x => x));
        Assert.Equal(4, mgr.Projects.Select(p => p.Id).Distinct().Count());
        Assert.Equal(2, mgr.Projects.Count(p => p.Vendor == "codesys"));
        Assert.Equal(2, mgr.Projects.Count(p => p.Vendor == "twincat"));
    }

    [Fact]
    public async Task Sources_are_scanned_concurrently_so_a_slow_vendor_does_not_stall_the_other()
    {
        var entered = new CountdownEvent(2);
        var release = new TaskCompletionSource();
        var cds = new FakeProjectSource("codesys", "CODESYS") { ScanEntered = entered, ScanRelease = release.Task };
        cds.Add("MachineA");
        var tc = new FakeProjectSource("twincat", "TwinCAT") { ScanEntered = entered, ScanRelease = release.Task };
        tc.Add("Line1");
        var mgr = Mgr(cds, tc);

        var refresh = mgr.RefreshAsync();
        Assert.True(entered.Wait(30_000), "the two vendors' scans were serialized — one blocked the other");
        release.SetResult();
        await refresh;

        Assert.Equal(2, mgr.Projects.Count);
    }

    [Fact]
    public async Task An_unreachable_source_contributes_nothing_and_does_not_break_refresh()
    {
        var ok = new FakeProjectSource("codesys", "CODESYS");
        ok.Add("MachineA");
        var down = new FakeProjectSource("twincat", "TwinCAT") { ThrowOnEnumerate = true };
        var mgr = Mgr(ok, down);

        await mgr.RefreshAsync();

        Assert.Equal(new[] { "MachineA" }, mgr.Projects.Select(p => p.DisplayName));
    }

    [Fact]
    public async Task RefreshIfStale_reprobes_when_old_and_skips_when_fresh()
    {
        var cds = new FakeProjectSource("codesys", "CODESYS");
        cds.Add("MachineA");
        var mgr = Mgr(cds);

        await mgr.RefreshIfStaleAsync(TimeSpan.FromSeconds(1)); // never refreshed → must run
        Assert.Single(mgr.Projects);

        cds.ThrowOnEnumerate = true;
        await mgr.RefreshIfStaleAsync(TimeSpan.FromSeconds(30)); // fresh → skip; a skipped refresh can't observe the throw
        Assert.Single(mgr.Projects);

        await mgr.RefreshIfStaleAsync(TimeSpan.Zero); // stale → runs; the throwing source contributes nothing
        Assert.Empty(mgr.Projects);
    }

    [Fact]
    public async Task Readers_never_see_a_torn_or_mixed_generation_while_refreshes_churn()
    {
        var cds = new FakeProjectSource("codesys", "CODESYS");
        cds.Add("MachineA");
        cds.Add("MachineB");
        var mgr = Mgr(cds);
        await mgr.RefreshAsync();

        using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        var writer = Task.Run(async () => { while (!stop.IsCancellationRequested) await mgr.RefreshAsync(); });
        var reader = Task.Run(() =>
        {
            while (!stop.IsCancellationRequested)
            {
                mgr.Aggregate();
                _ = mgr.Projects.Count;
                foreach (var p in mgr.Projects) mgr.IsServingProject(p.Id);
            }
        });

        await Task.WhenAll(writer, reader); // an exception on either side fails the test
        Assert.Equal(2, mgr.Projects.Count);
    }

    [Fact]
    public async Task Concurrent_refreshes_do_not_corrupt_the_published_state()
    {
        var cds = new FakeProjectSource("codesys", "CODESYS");
        cds.Add("MachineA");
        cds.Add("MachineB");
        var mgr = Mgr(cds);

        await Task.WhenAll(Enumerable.Range(0, 12).Select(_ => mgr.RefreshAsync()));

        Assert.Equal(2, mgr.Projects.Count);
        Assert.Equal(new[] { "MachineA", "MachineB" }, mgr.Projects.Select(p => p.DisplayName).OrderBy(n => n));
    }
}
