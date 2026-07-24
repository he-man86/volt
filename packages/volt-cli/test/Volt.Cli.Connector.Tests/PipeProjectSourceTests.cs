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
        var wire = new FakeBridgeWire().On("instances",
            """{ "instances": [ { "instanceId": "cds-1", "projects": [ { "project": "MyMachine", "dirty": true } ] } ] }""");
        var src = new PipeProjectSource("codesys", "CODESYS", wire);

        var projects = await src.EnumerateAsync();

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
        var wire = new FakeBridgeWire().On("instances",
            """
            { "instances": [ { "instanceId": "vs-1", "projects": [
                { "project": "TwinCAT Project13" }, { "project": "TwinCAT Project14" } ] } ] }
            """);
        var src = new PipeProjectSource("twincat", "TwinCAT", wire);

        var projects = await src.EnumerateAsync();

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
        Assert.Equal("select", op);
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
        var wire = new FakeBridgeWire().On("instances",
            """
            { "instances": [
                { "instanceId": "!TcXaeShell.DTE.15.0:22268", "projects": [ { "project": "TwinCAT Project13" } ] },
                { "instanceId": "!TcXaeShell.DTE.15.0:27288", "projects": [ { "project": "TwinCAT Project14" } ] } ] }
            """);
        var src = new PipeProjectSource("twincat", "TwinCAT", wire);

        var projects = (await src.EnumerateAsync()).ToList();

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
        Assert.Equal("select", op);
        Assert.Contains("\"instanceId\":\"!TcXaeShell.DTE.15.0:27288\"", body); // the second window, not the first
        Assert.Contains("\"project\":\"TwinCAT Project14\"", body);
    }

    [Fact]
    public async Task Probe_maps_the_health_wire_response()
    {
        var wire = new FakeBridgeWire().On("health",
            """{ "status": "healthy", "projectName": "MyMachine", "projectDirty": true }""");
        var src = new PipeProjectSource("codesys", "CODESYS", wire);
        var attach = new ProjectRef(null, "MyMachine");
        var selected = new DetectedProject(DetectedProject.MakeId("codesys", attach), "MyMachine", "codesys", true, attach);

        var h = await src.ProbeAsync(selected);

        Assert.Equal(BridgeStatus.Connected, h.Status);
        Assert.Equal("MyMachine", h.ProjectName);
        Assert.True(h.ProjectDirty);
    }

    /// <summary>A healthy worker with NOTHING selected is "up, waiting for a pick" — not Connected. This test
    /// used to assert the opposite, which is why the tray went green as soon as TwinCAT was open with a project,
    /// before the user had connected anything. The project details still ride along for the status text.</summary>
    [Fact]
    public async Task Probe_with_nothing_selected_is_Unavailable_not_Connected()
    {
        var wire = new FakeBridgeWire().On("health",
            """{ "status": "healthy", "projectName": "MyMachine", "projectDirty": true }""");
        var src = new PipeProjectSource("twincat", "TwinCAT", wire);

        var h = await src.ProbeAsync(null);

        Assert.Equal(BridgeStatus.Unavailable, h.Status);
        Assert.Equal("MyMachine", h.ProjectName);
        Assert.True(h.ProjectDirty);
    }

    [Fact]
    public async Task An_unreachable_bridge_enumerates_to_empty_and_probes_Unreachable()
    {
        var wire = new FakeBridgeWire();
        wire.Throw.Add("instances");
        wire.Throw.Add("health");
        var src = new PipeProjectSource("codesys", "CODESYS", wire);

        Assert.Empty(await src.EnumerateAsync());
        Assert.Equal(BridgeStatus.Unreachable, (await src.ProbeAsync(null)).Status);
    }
}

/// <summary>The CODESYS source discovers a pipe per running IDE and fans out — one wire per live pipe — so the
/// unified list shows every running CODESYS, each project carrying its serving pipe.</summary>
public class CodesysProjectSourceTests
{
    private static FakeBridgeWire OneProject(string instanceId, string name) => new FakeBridgeWire().On("instances",
        $$"""{ "instances": [ { "instanceId": "{{instanceId}}", "projects": [ { "project": "{{name}}", "dirty": false } ] } ] }""");

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

        var projects = (await src.EnumerateAsync()).OrderBy(p => p.DisplayName).ToList();

        Assert.Equal(new[] { "MachineA", "MachineB" }, projects.Select(p => p.DisplayName));
        Assert.Equal("volt.bridge.codesys.111", projects[0].Pipe);
        Assert.Equal("volt.bridge.codesys.222", projects[1].Pipe);
        // Distinct ids even if the two projects were same-named (instance = pid differs).
        Assert.NotEqual(projects[0].Id, projects[1].Id);
    }

    [Fact]
    public async Task Probe_targets_the_selected_projects_pipe()
    {
        var healthy = new FakeBridgeWire().On("health", """{ "status": "healthy", "projectName": "MachineB" }""");
        var wires = new Dictionary<string, IBridgeWire> { ["volt.bridge.codesys.222"] = healthy };
        var src = new CodesysProjectSource(() => wires.Keys.ToList(), pipe => wires[pipe]);
        var attach = new ProjectRef("222", "MachineB");
        var selected = new DetectedProject(DetectedProject.MakeId("codesys", attach), "MachineB", "codesys", false, attach, "volt.bridge.codesys.222");

        var h = await src.ProbeAsync(selected);

        Assert.Equal(BridgeStatus.Connected, h.Status);
        Assert.Equal("MachineB", h.ProjectName);
    }

    [Fact]
    public async Task No_pipes_probes_Unreachable_some_pipes_but_none_selected_is_Unavailable()
    {
        var none = new CodesysProjectSource(() => new List<string>(), _ => throw new InvalidOperationException());
        Assert.Equal(BridgeStatus.Unreachable, (await none.ProbeAsync(null)).Status);

        var some = new CodesysProjectSource(() => new List<string> { "volt.bridge.codesys.9" }, _ => new FakeBridgeWire());
        Assert.Equal(BridgeStatus.Unavailable, (await some.ProbeAsync(null)).Status);
    }
}
