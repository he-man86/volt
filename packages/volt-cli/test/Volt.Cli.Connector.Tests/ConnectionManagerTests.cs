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
    public Task UnbindAsync(DetectedProject project) { Unbound.Add(project); return Task.CompletedTask; }
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
    // Connected wins over everything; then Degraded; then Unavailable (up, no project); else Unknown.
    [InlineData(BridgeStatus.Connected, BridgeStatus.Unreachable, BridgeStatus.Connected)]
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

        await mgr.DisconnectAsync();

        // The bridge is told to stop serving — clearing the selection alone would leave the CLI (which reaches
        // the pipe directly, never the connector) still pushing and pulling.
        Assert.Equal(new[] { pA }, cds.Unbound);
        Assert.Null(mgr.ActiveConnection);
        Assert.Null(mgr.SelectedOf("codesys"));
        await mgr.RefreshAsync();
        Assert.Equal(new[] { "MachineA" }, mgr.Projects.Select(p => p.DisplayName)); // host stays live/listed
    }
}
