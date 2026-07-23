using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Volt.Cli.Connector;
using Xunit;

namespace Volt.Cli.Connector.Tests;

/// <summary>A fake source so the ConnectionManager can be exercised with no pipe/IDE: it returns a scripted
/// project list + health, records binds, and can be told to throw on enumerate (an unreachable bridge).</summary>
internal sealed class FakeProjectSource : IProjectSource
{
    public string Vendor { get; }
    public string DisplayName { get; }
    public List<DetectedProject> Projects { get; } = new();
    public BridgeHealth Health { get; set; } = new() { Status = BridgeStatus.Unknown };
    public bool ThrowOnEnumerate { get; set; }
    public List<DetectedProject> Bound { get; } = new();
    public List<DetectedProject> Unbound { get; } = new();

    public FakeProjectSource(string vendor, string display) { Vendor = vendor; DisplayName = display; }

    public DetectedProject Add(string name, bool dirty = false)
    {
        var attach = new ProjectRef(null, name);
        var p = new DetectedProject(DetectedProject.MakeId(Vendor, attach), name, Vendor, dirty, attach);
        Projects.Add(p);
        return p;
    }

    public Task<IReadOnlyList<DetectedProject>> EnumerateAsync() =>
        ThrowOnEnumerate ? throw new InvalidOperationException("unreachable")
                         : Task.FromResult<IReadOnlyList<DetectedProject>>(Projects.ToList());

    public Task BindAsync(DetectedProject project) { Bound.Add(project); return Task.CompletedTask; }
    /// <summary>What the fake bridge does on unbind — Unsupported plays an OUT-OF-DATE bridge (keeps serving the
    /// CLI), Unreachable plays one whose IDE has closed.</summary>
    public UnbindResult UnbindOutcome { get; set; } = UnbindResult.Gated;
    public Task<UnbindResult> UnbindAsync(DetectedProject project) { Unbound.Add(project); return Task.FromResult(UnbindOutcome); }
    public Task<BridgeHealth> ProbeAsync(DetectedProject? selected) => Task.FromResult(Health);
}

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
        // Vendor is carried on each entry (for the prefix/logo + routing), not a separate list.
        Assert.Equal("codesys", mgr.Projects.Single(p => p.DisplayName == "MachineA").Vendor);
        Assert.Equal("twincat", mgr.Projects.Single(p => p.DisplayName == "MachineB").Vendor);
    }

    [Fact]
    public async Task Connect_routes_to_the_projects_own_vendor_source_and_fires_Connected()
    {
        var cds = new FakeProjectSource("codesys", "CODESYS");
        var tc = new FakeProjectSource("twincat", "TwinCAT");
        var pA = cds.Add("MachineA");
        tc.Add("MachineB");
        var mgr = Mgr(cds, tc);
        await mgr.RefreshAsync();

        DetectedProject? connected = null;
        mgr.Connected += p => connected = p;

        await mgr.ConnectAsync(pA);

        Assert.Single(cds.Bound);                 // routed to CODESYS
        Assert.Empty(tc.Bound);                   // NOT the other vendor
        Assert.Equal(pA, cds.Bound[0]);
        Assert.Equal(pA, connected);              // Connected fired with the project (for the platform toast)
        Assert.Equal(pA, mgr.SelectedOf("codesys"));
        Assert.Null(mgr.SelectedOf("twincat"));
    }

    [Fact]
    public void DisplayName_lookup_backs_the_platform_prefix_and_notification()
    {
        var mgr = Mgr(new FakeProjectSource("codesys", "CODESYS"), new FakeProjectSource("twincat", "TwinCAT"));
        Assert.Equal("CODESYS", mgr.DisplayNameOf("codesys"));
        Assert.Equal("TwinCAT", mgr.DisplayNameOf("twincat"));
    }

    [Theory]
    // With NOTHING connected, the tray never goes green — a live channel only means "up, waiting for a pick"
    // (that is why the first row expects Unavailable, not Connected: a healthy bridge with no active connection
    // used to paint the tray green merely because an IDE was open). Below that: Degraded, then Unavailable, then
    // Unknown. Green requires an active connection that is actually being served — see the Aggregate tests in
    // DisconnectLifecycleTests, which drive a real bridge.
    [InlineData(BridgeStatus.Connected, BridgeStatus.Unreachable, BridgeStatus.Unavailable)]
    [InlineData(BridgeStatus.Degraded, BridgeStatus.Unavailable, BridgeStatus.Degraded)]
    [InlineData(BridgeStatus.Unavailable, BridgeStatus.Unreachable, BridgeStatus.Unavailable)]
    [InlineData(BridgeStatus.Unreachable, BridgeStatus.Unknown, BridgeStatus.Unknown)]
    public async Task Aggregate_status_follows_the_informative_alive_precedence(
        BridgeStatus a, BridgeStatus b, BridgeStatus expected)
    {
        var s1 = new FakeProjectSource("codesys", "CODESYS") { Health = new BridgeHealth { Status = a } };
        var s2 = new FakeProjectSource("twincat", "TwinCAT") { Health = new BridgeHealth { Status = b } };
        var mgr = Mgr(s1, s2);
        await mgr.RefreshAsync();
        Assert.Equal(expected, mgr.Aggregate());
    }

    [Fact]
    public async Task An_unreachable_source_contributes_nothing_and_does_not_break_refresh()
    {
        var ok = new FakeProjectSource("codesys", "CODESYS");
        ok.Add("MachineA");
        var down = new FakeProjectSource("twincat", "TwinCAT") { ThrowOnEnumerate = true };
        var mgr = Mgr(ok, down);

        await mgr.RefreshAsync();   // must not throw

        Assert.Equal(new[] { "MachineA" }, mgr.Projects.Select(p => p.DisplayName));
    }

    [Fact]
    public async Task A_selection_whose_project_vanished_is_dropped_on_refresh()
    {
        var cds = new FakeProjectSource("codesys", "CODESYS");
        var pA = cds.Add("MachineA");
        var mgr = Mgr(cds);
        await mgr.RefreshAsync();
        await mgr.ConnectAsync(pA);
        Assert.Equal(pA, mgr.SelectedOf("codesys"));

        cds.Projects.Clear();       // the IDE closed the project
        await mgr.RefreshAsync();

        Assert.Null(mgr.SelectedOf("codesys"));
    }

    [Fact]
    public async Task Connecting_one_project_clears_any_other_active_connection()
    {
        // One active connection across all vendors: connecting a TwinCAT project deselects a connected CODESYS one.
        var cds = new FakeProjectSource("codesys", "CODESYS");
        var tc = new FakeProjectSource("twincat", "TwinCAT");
        var pA = cds.Add("MachineA");
        var pB = tc.Add("MachineB");
        var mgr = Mgr(cds, tc);
        await mgr.RefreshAsync();

        await mgr.ConnectAsync(pA);
        Assert.Equal(pA, mgr.ActiveConnection);

        await mgr.ConnectAsync(pB);                 // switch platforms
        Assert.Equal(pB, mgr.ActiveConnection);
        Assert.Null(mgr.SelectedOf("codesys"));     // the CODESYS one was cleared
        Assert.Equal(pB, mgr.SelectedOf("twincat"));
    }

    [Fact]
    public async Task Disconnect_unbinds_the_bridge_and_clears_the_selection_but_leaves_projects_listed()
    {
        var cds = new FakeProjectSource("codesys", "CODESYS");
        var pA = cds.Add("MachineA");
        var mgr = Mgr(cds);
        await mgr.RefreshAsync();
        await mgr.ConnectAsync(pA);
        Assert.Equal(pA, mgr.ActiveConnection);

        Assert.Equal(UnbindResult.Gated, await mgr.DisconnectAsync()); // the bridge accepted the deselect

        // The bridge is told to stop serving — clearing the selection alone would leave the CLI (which reaches
        // the pipe directly, never the connector) still pushing and pulling.
        Assert.Equal(new[] { pA }, cds.Unbound);
        Assert.Null(mgr.ActiveConnection);
        Assert.Null(mgr.SelectedOf("codesys"));
        await mgr.RefreshAsync();
        Assert.Equal(new[] { "MachineA" }, mgr.Projects.Select(p => p.DisplayName)); // host stays live/listed
    }

    /// <summary>The mixed-install case: an OUT-OF-DATE bridge has no `deselect` op and keeps serving the CLI. The
    /// selection still clears (the UI has to stop claiming a connection), but DisconnectAsync must report false so
    /// the shells can warn — otherwise the user sees "Disconnected" while `volt push` still works, which is the
    /// exact bug the gate exists to kill.</summary>
    /// <summary>GET /status must read LIVE state, so RefreshIfStaleAsync re-probes when the snapshot is old and
    /// skips when it is fresh. Without the skip, a burst of polling clients would re-probe every pipe on every
    /// request; without the re-probe, a change made outside Volt (an IDE closing) lags the tray tick PLUS the
    /// client's own poll interval.</summary>
    /// <summary>THE per-project fix. A VS Code window shows the connection for the project ITS workspace is bound
    /// to, which is often not the tray's active one — so a global disconnect from that window gated a DIFFERENT
    /// project: the clicked row stayed connected while another workspace silently stopped syncing.</summary>
    [Fact]
    public async Task Disconnect_targets_the_named_project_not_the_active_one()
    {
        var cds = new FakeProjectSource("codesys", "CODESYS");
        var pA = cds.Add("MachineA");
        var pB = cds.Add("MachineB");
        var mgr = Mgr(cds);
        await mgr.RefreshAsync();
        await mgr.ConnectAsync(pA); // A is the ACTIVE connection

        Assert.Equal(UnbindResult.Gated, await mgr.DisconnectAsync(pB.Id)); // ...but B is what we disconnect

        Assert.Equal(new[] { pB }, cds.Unbound);        // B's bridge was gated
        Assert.Equal(pA, mgr.ActiveConnection);         // A's highlight is untouched
    }

    [Fact]
    public async Task RefreshIfStale_reprobes_when_old_and_skips_when_fresh()
    {
        var cds = new FakeProjectSource("codesys", "CODESYS");
        cds.Add("MachineA");
        var mgr = Mgr(cds);

        await mgr.RefreshIfStaleAsync(TimeSpan.FromSeconds(1)); // never refreshed → must run
        Assert.Single(mgr.Projects);

        // Fresh: a second call inside the window must NOT re-enumerate. Prove it by making the source throw —
        // a skipped refresh can't observe that, and the previous generation stays intact.
        cds.ThrowOnEnumerate = true;
        await mgr.RefreshIfStaleAsync(TimeSpan.FromSeconds(30));
        Assert.Single(mgr.Projects);

        // Stale (a zero window is always stale): it runs, the throwing source contributes nothing, list empties.
        await mgr.RefreshIfStaleAsync(TimeSpan.Zero);
        Assert.Empty(mgr.Projects);
    }

    /// <summary>Concurrent refreshes must serialize — the tray timer and the control plane both trigger them, and
    /// the published state is replaced per generation rather than mutated, so a reader never sees a half-built one.</summary>
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

    [Fact]
    public async Task Disconnect_reports_false_when_the_bridge_is_too_old_to_be_gated()
    {
        var cds = new FakeProjectSource("codesys", "CODESYS") { UnbindOutcome = UnbindResult.Unsupported };
        var pA = cds.Add("MachineA");
        var mgr = Mgr(cds);
        await mgr.RefreshAsync();
        await mgr.ConnectAsync(pA);

        Assert.Equal(UnbindResult.Unsupported, await mgr.DisconnectAsync());
        Assert.Null(mgr.ActiveConnection); // the selection clears either way
    }

    /// <summary>Disconnecting with nothing connected is a no-op that reports success — there is no un-gated bridge
    /// to warn about, so it must not raise the out-of-date warning.</summary>
    [Fact]
    public async Task Disconnect_with_no_active_connection_is_a_silent_no_op()
    {
        var cds = new FakeProjectSource("codesys", "CODESYS") { UnbindOutcome = UnbindResult.Unsupported };
        cds.Add("MachineA");
        var mgr = Mgr(cds);
        await mgr.RefreshAsync();

        Assert.Equal(UnbindResult.Gated, await mgr.DisconnectAsync()); // nothing to disconnect is a no-op
        Assert.Empty(cds.Unbound);
    }
}
