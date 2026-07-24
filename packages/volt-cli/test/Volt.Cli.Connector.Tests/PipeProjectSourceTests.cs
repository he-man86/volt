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
            """{ "projects": [ { "instanceId": "cds-1", "project": "MyMachine", "dirty": true } ] }""");
        var src = new PipeProjectSource("codesys", "CODESYS", wire);

        var projects = (await src.ScanAsync()).Projects;

        var p = Assert.Single(projects);
        Assert.Equal("MyMachine", p.DisplayName);
        Assert.Equal("codesys", p.Vendor);
        Assert.True(p.Dirty);
        Assert.Equal(new ProjectRef("cds-1", "MyMachine"), p.Attach);
    }

    [Fact]
    public async Task Enumerate_yields_one_entry_per_project_identity_only()
    {
        // Detection is identity-only: one entry per open project, never a breakdown of the PLC applications inside
        // it — connecting doesn't reach into content.
        var wire = new FakeBridgeWire().On("health",
            """
            { "projects": [
                { "instanceId": "vs-1", "project": "TwinCAT Project13" },
                { "instanceId": "vs-1", "project": "TwinCAT Project14" } ] }
            """);
        var src = new PipeProjectSource("twincat", "TwinCAT", wire);

        var projects = (await src.ScanAsync()).Projects;

        Assert.Equal(new[] { "TwinCAT Project13", "TwinCAT Project14" }, projects.Select(p => p.DisplayName));
        Assert.Equal(new ProjectRef("vs-1", "TwinCAT Project13"), projects[0].Attach);
        Assert.Equal(new ProjectRef("vs-1", "TwinCAT Project14"), projects[1].Attach);
    }

    [Fact]
    public async Task Bind_sends_select_with_the_projects_attach_coordinates()
    {
        var wire = new FakeBridgeWire();
        var src = new PipeProjectSource("twincat", "TwinCAT", wire);
        var attach = new ProjectRef("vs-1", "TwinCAT Project1");
        var proj = new DetectedProject(DetectedProject.MakeId("twincat", attach), "PLC_A", "twincat", false, attach);

        await src.BindAsync(proj);

        var (op, body) = Assert.Single(wire.Calls);
        Assert.Equal("connect", op);
        Assert.Contains("\"instanceId\":\"vs-1\"", body);
        Assert.Contains("\"project\":\"TwinCAT Project1\"", body);
    }

    // ── two open TcXaeShell windows (the multi-XAE case that shipped broken) ──────────────────────────────
    // Unlike CODESYS (a pipe per instance), TwinCAT is ONE worker: two windows arrive as two instances in a SINGLE
    // `instances` response, and the connector must keep them distinct so a select can target the right one. This
    // whole path had no coverage, which is why selecting the second window's project slipped through untested.

    [Fact]
    public async Task Enumerate_two_twincat_windows_yields_two_projects_with_distinct_instance_ids()
    {
        var wire = new FakeBridgeWire().On("health",
            """
            { "projects": [
                { "instanceId": "!TcXaeShell.DTE.15.0:22268", "project": "TwinCAT Project13" },
                { "instanceId": "!TcXaeShell.DTE.15.0:27288", "project": "TwinCAT Project14" } ] }
            """);
        var src = new PipeProjectSource("twincat", "TwinCAT", wire);

        var projects = (await src.ScanAsync()).Projects.ToList();

        Assert.Equal(new[] { "TwinCAT Project13", "TwinCAT Project14" }, projects.Select(p => p.DisplayName));
        // Each carries its OWN instance moniker — this is what lets `select` reach the right window.
        Assert.Equal("!TcXaeShell.DTE.15.0:22268", projects[0].Attach.Instance);
        Assert.Equal("!TcXaeShell.DTE.15.0:27288", projects[1].Attach.Instance);
        Assert.NotEqual(projects[0].Id, projects[1].Id);
    }

    [Fact]
    public async Task Bind_the_second_window_sends_the_second_instances_moniker_not_the_first()
    {
        var wire = new FakeBridgeWire();
        var src = new PipeProjectSource("twincat", "TwinCAT", wire);
        // The SECOND window's project — the one whose select was returning zero items.
        var attach = new ProjectRef("!TcXaeShell.DTE.15.0:27288", "TwinCAT Project14");
        var proj = new DetectedProject(DetectedProject.MakeId("twincat", attach), "TwinCAT Project14", "twincat", false, attach);

        await src.BindAsync(proj);

        var (op, body) = Assert.Single(wire.Calls);
        Assert.Equal("connect", op);
        Assert.Contains("\"instanceId\":\"!TcXaeShell.DTE.15.0:27288\"", body); // the second window, not the first
        Assert.Contains("\"project\":\"TwinCAT Project14\"", body);
    }

    /// <summary>The connection state is a per-row fact now — serving/status/dirty ride straight through onto each
    /// <see cref="DetectedProject"/>. No second probe: the scan reads them off the wire row. (The "up but nothing
    /// selected is not green" rule moved to <c>ConnectionManager.Aggregate</c>, which owns selection.)</summary>
    [Fact]
    public async Task Scan_carries_serving_status_and_dirty_off_the_wire_row()
    {
        var wire = new FakeBridgeWire().On("health",
            """{ "projects": [ { "instanceId": "i", "project": "MyMachine", "status": "healthy", "serving": true, "dirty": true } ] }""");
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
    private static FakeBridgeWire OneProject(string instanceId, string name) => new FakeBridgeWire().On("health",
        $$"""{ "projects": [ { "instanceId": "{{instanceId}}", "project": "{{name}}", "dirty": false } ] }""");

    [Fact]
    public async Task Fans_out_over_every_discovered_pipe_stamping_each_projects_pipe()
    {
        var wires = new Dictionary<string, IBridgeWire>
        {
            ["volt.bridge.codesys.111"] = OneProject("111", "MachineA"),
            ["volt.bridge.codesys.222"] = OneProject("222", "MachineB"),
        };
        var src = new CodesysProjectSource(
            () => wires.Keys.ToList(),
            pipe => wires[pipe]);

        var projects = (await src.ScanAsync()).Projects.OrderBy(p => p.DisplayName).ToList();

        Assert.Equal(new[] { "MachineA", "MachineB" }, projects.Select(p => p.DisplayName));
        Assert.Equal("volt.bridge.codesys.111", projects[0].Pipe);
        Assert.Equal("volt.bridge.codesys.222", projects[1].Pipe);
        // Distinct ids even if the two projects were same-named (instance = pid differs).
        Assert.NotEqual(projects[0].Id, projects[1].Id);
    }

    [Fact]
    public async Task Scan_carries_the_serving_row_off_the_selected_projects_pipe()
    {
        var healthy = new FakeBridgeWire().On("health", """{ "projects": [ { "instanceId": "222", "project": "MachineB", "status": "healthy", "serving": true } ] }""");
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
