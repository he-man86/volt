using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Volt.Cli.Connector;
using Xunit;

namespace Volt.Cli.Connector.Tests;

/// <summary>A scripted <see cref="IBridgeWire"/>: returns canned JSON per op and records the calls, so the
/// pipe-backed source can be tested against the wire contract with no pipe/IDE.</summary>
internal sealed class FakeBridgeWire : IBridgeWire
{
    private readonly Dictionary<string, string> _responses = new();
    public List<(string Op, string Body)> Calls { get; } = new();
    public HashSet<string> Throw { get; } = new();

    public FakeBridgeWire On(string op, string json) { _responses[op] = json; return this; }

    public Task<JsonElement> CallAsync(string op, object? body = null)
    {
        Calls.Add((op, body is null ? "" : JsonSerializer.Serialize(body)));
        if (Throw.Contains(op)) throw new InvalidOperationException("unreachable");
        var json = _responses.TryGetValue(op, out var j) ? j : "{}";
        return Task.FromResult(JsonSerializer.Deserialize<JsonElement>(json));
    }
}

public class PipeProjectSourceTests
{
    [Fact]
    public async Task Enumerate_maps_a_codesys_project_with_no_subprojects_to_one_entry()
    {
        var wire = new FakeBridgeWire().On("health",
            """{ "projects": [ { "project": "MyMachine", "dirty": true } ] }""");
        var src = new PipeProjectSource("codesys", "CODESYS", wire);

        var projects = (await src.ScanAsync()).Projects;

        var p = Assert.Single(projects);
        Assert.Equal("MyMachine", p.DisplayName);
        Assert.Equal("codesys", p.Vendor);
        Assert.True(p.Dirty);
        Assert.Equal(new ProjectRef("MyMachine"), p.Attach);
    }

    [Fact]
    public async Task Enumerate_yields_one_entry_per_project_identity_only()
    {
        // Detection is identity-only: one entry per open project, never a breakdown of the PLC applications inside
        // it — connecting doesn't reach into content.
        var wire = new FakeBridgeWire().On("health",
            """
            { "projects": [
                { "project": "TwinCAT Project13" },
                { "project": "TwinCAT Project14" } ] }
            """);
        var src = new PipeProjectSource("twincat", "TwinCAT", wire);

        var projects = (await src.ScanAsync()).Projects;

        Assert.Equal(new[] { "TwinCAT Project13", "TwinCAT Project14" }, projects.Select(p => p.DisplayName));
        Assert.Equal(new ProjectRef("TwinCAT Project13"), projects[0].Attach);
        Assert.Equal(new ProjectRef("TwinCAT Project14"), projects[1].Attach);
    }

    [Fact]
    public async Task Bind_sends_select_with_the_projects_attach_coordinates()
    {
        var wire = new FakeBridgeWire();
        var src = new PipeProjectSource("twincat", "TwinCAT", wire);
        var attach = new ProjectRef("TwinCAT Project1");
        var proj = new DetectedProject(DetectedProject.MakeId("twincat", attach), "PLC_A", "twincat", false, attach);

        await src.BindAsync(proj);

        var (op, body) = Assert.Single(wire.Calls);
        Assert.Equal("connect", op);
        Assert.Contains("\"project\":\"TwinCAT Project1\"", body);
    }

    // ── two open TcXaeShell windows (the multi-XAE case that shipped broken) ──────────────────────────────
    // TwinCAT is ONE worker: two windows arrive as two rows in a SINGLE health response. Distinguished by project
    // NAME — two DIFFERENT-named projects stay distinct rows; the driver's `select` resolves whichever window holds
    // the named project (BindByProject). Two windows on an IDENTICALLY-named project is the accepted name-identity
    // limit — they collapse to one row (see the ConnectionManager dedup test).

    [Fact]
    public async Task Enumerate_two_twincat_windows_yields_two_distinct_projects_by_name()
    {
        var wire = new FakeBridgeWire().On("health",
            """
            { "projects": [
                { "project": "TwinCAT Project13" },
                { "project": "TwinCAT Project14" } ] }
            """);
        var src = new PipeProjectSource("twincat", "TwinCAT", wire);

        var projects = (await src.ScanAsync()).Projects.ToList();

        Assert.Equal(new[] { "TwinCAT Project13", "TwinCAT Project14" }, projects.Select(p => p.DisplayName));
        Assert.NotEqual(projects[0].Id, projects[1].Id); // distinct identities — by name
    }

    [Fact]
    public async Task Bind_a_project_sends_its_name_and_the_driver_resolves_the_window()
    {
        var wire = new FakeBridgeWire();
        var src = new PipeProjectSource("twincat", "TwinCAT", wire);
        var attach = new ProjectRef("TwinCAT Project14");
        var proj = new DetectedProject(DetectedProject.MakeId("twincat", attach), "TwinCAT Project14", "twincat", false, attach);

        await src.BindAsync(proj);

        var (op, body) = Assert.Single(wire.Calls);
        Assert.Equal("connect", op);
        Assert.Contains("\"project\":\"TwinCAT Project14\"", body); // the driver's BindByProject finds the window holding it
    }

    /// <summary>The connection state is a per-row fact now — serving/status/dirty ride straight through onto each
    /// <see cref="DetectedProject"/>. No second probe: the scan reads them off the wire row. (The "up but nothing
    /// selected is not green" rule moved to <c>ConnectionManager.Aggregate</c>, which owns selection.)</summary>
    [Fact]
    public async Task Scan_carries_serving_status_and_dirty_off_the_wire_row()
    {
        var wire = new FakeBridgeWire().On("health",
            """{ "projects": [ { "project": "MyMachine", "status": "healthy", "dirty": true } ] }""");
        var src = new PipeProjectSource("codesys", "CODESYS", wire);

        var scan = await src.ScanAsync();

        Assert.True(scan.Reachable);
        var p = Assert.Single(scan.Projects);
        Assert.True(p.Serving);
        Assert.Equal("healthy", p.Status);
        Assert.True(p.Dirty);
    }

    [Fact]
    public async Task An_unreachable_bridge_scans_to_empty_and_not_reachable()
    {
        var wire = new FakeBridgeWire();
        wire.Throw.Add("health"); // discovery rides on health
        var src = new PipeProjectSource("codesys", "CODESYS", wire);

        var scan = await src.ScanAsync();
        Assert.Empty(scan.Projects);
        Assert.False(scan.Reachable);
    }
}

/// <summary>The CODESYS source discovers a pipe per running IDE and fans out — one wire per live pipe — so the
/// unified list shows every running CODESYS, each project carrying its serving pipe.</summary>
public class CodesysProjectSourceTests
{
    private static FakeBridgeWire OneProject(string name) => new FakeBridgeWire().On("health",
        $$"""{ "projects": [ { "project": "{{name}}", "dirty": false } ] }""");

    [Fact]
    public async Task Fans_out_over_every_discovered_pipe_stamping_each_projects_pipe()
    {
        var wires = new Dictionary<string, IBridgeWire>
        {
            ["volt.bridge.codesys.111"] = OneProject("MachineA"),
            ["volt.bridge.codesys.222"] = OneProject("MachineB"),
        };
        var src = new CodesysProjectSource(
            () => wires.Keys.ToList(),
            pipe => wires[pipe]);

        var projects = (await src.ScanAsync()).Projects.OrderBy(p => p.DisplayName).ToList();

        Assert.Equal(new[] { "MachineA", "MachineB" }, projects.Select(p => p.DisplayName));
        Assert.Equal("volt.bridge.codesys.111", projects[0].Pipe);
        Assert.Equal("volt.bridge.codesys.222", projects[1].Pipe);
        Assert.NotEqual(projects[0].Id, projects[1].Id); // distinct identities — by name
    }

    [Fact]
    public async Task Scan_carries_the_serving_row_off_the_selected_projects_pipe()
    {
        var healthy = new FakeBridgeWire().On("health", """{ "projects": [ { "project": "MachineB", "status": "healthy" } ] }""");
        var wires = new Dictionary<string, IBridgeWire> { ["volt.bridge.codesys.222"] = healthy };
        var src = new CodesysProjectSource(() => wires.Keys.ToList(), pipe => wires[pipe]);

        var scan = await src.ScanAsync();

        Assert.True(scan.Reachable);
        var p = Assert.Single(scan.Projects);
        Assert.Equal("MachineB", p.DisplayName);
        Assert.True(p.Serving);
    }

    [Fact]
    public async Task No_pipes_is_not_reachable_but_a_live_pipe_is()
    {
        var none = new CodesysProjectSource(() => new List<string>(), _ => throw new InvalidOperationException());
        Assert.False((await none.ScanAsync()).Reachable);

        // A live pipe existing IS the reachability bit, even if that host answers with no project rows.
        var some = new CodesysProjectSource(() => new List<string> { "volt.bridge.codesys.9" }, _ => new FakeBridgeWire());
        Assert.True((await some.ScanAsync()).Reachable);
    }
}
