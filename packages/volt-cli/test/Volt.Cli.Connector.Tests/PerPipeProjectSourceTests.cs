using System.Threading;
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
    /// <summary>Delay each call (models a slow/hung IDE).</summary>
    public int DelayMs { get; set; }
    /// <summary>Latch to prove the pipe fan-out is CONCURRENT by ORDERING (not a wall-clock budget, which flakes on a
    /// loaded CI runner): each call signals <see cref="Entered"/> then awaits <see cref="Release"/>. A test can only
    /// observe every pipe entered if the fan-out ran them concurrently — a serialized scan blocks in the first pipe.</summary>
    public CountdownEvent? Entered { get; set; }
    public Task? Release { get; set; }

    public FakeBridgeWire On(string op, string json) { _responses[op] = json; return this; }

    public async Task<JsonElement> CallAsync(string op, object? body = null)
    {
        Calls.Add((op, body is null ? "" : JsonSerializer.Serialize(body)));
        if (Throw.Contains(op)) throw new InvalidOperationException("unreachable");
        Entered?.Signal();
        if (Release != null) await Release;
        else if (DelayMs > 0) await Task.Delay(DelayMs);
        var json = _responses.TryGetValue(op, out var j) ? j : "{}";
        return JsonSerializer.Deserialize<JsonElement>(json);
    }
}

/// <summary>The ONE per-pipe source, for both vendors: discovers a pipe per running IDE and fans out one health
/// poll each, mapping the flat <c>health.projects</c> rows into <see cref="DetectedProject"/>s that carry their
/// serving pipe. (TwinCAT now discovers per-XAE pipes exactly as CODESYS does per-IDE.)</summary>
public class PerPipeProjectSourceTests
{
    private const string Pipe = "volt.bridge.twincat.1";

    // A source over a single scripted pipe (the smallest fan-out) — models one running IDE.
    private static PerPipeProjectSource One(string vendor, string display, IBridgeWire wire, string pipe = Pipe)
        => new(vendor, display, () => new[] { pipe }, _ => wire);

    [Fact]
    public async Task Enumerate_maps_a_project_with_no_subprojects_to_one_entry()
    {
        var wire = new FakeBridgeWire().On("health",
            """{ "projects": [ { "project": "MyMachine", "dirty": true } ] }""");
        var src = One("codesys", "CODESYS", wire, "volt.bridge.codesys.1");

        var projects = (await src.ScanAsync()).Projects;

        var p = Assert.Single(projects);
        Assert.Equal("MyMachine", p.DisplayName);
        Assert.Equal("codesys", p.Vendor);
        Assert.True(p.Dirty);
        Assert.Equal(new ProjectRef("MyMachine"), p.Attach);
        Assert.Equal("volt.bridge.codesys.1", p.Pipe); // the serving pipe is stamped onto the row
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
        var src = One("twincat", "TwinCAT", wire);

        var projects = (await src.ScanAsync()).Projects;

        Assert.Equal(new[] { "TwinCAT Project13", "TwinCAT Project14" }, projects.Select(p => p.DisplayName));
        Assert.Equal(new ProjectRef("TwinCAT Project13"), projects[0].Attach);
        Assert.Equal(new ProjectRef("TwinCAT Project14"), projects[1].Attach);
    }

    [Fact]
    public async Task Bind_sends_select_with_the_projects_name_targeting_its_own_pipe()
    {
        var wire = new FakeBridgeWire().On("health", """{ "projects": [ { "project": "TwinCAT Project1" } ] }""");
        var src = One("twincat", "TwinCAT", wire);

        var proj = (await src.ScanAsync()).Projects.Single(); // carries Pipe = the serving pipe
        wire.Calls.Clear();
        await src.BindAsync(proj);

        var (op, body) = Assert.Single(wire.Calls);
        Assert.Equal("connect", op);
        Assert.Contains("\"project\":\"TwinCAT Project1\"", body);
    }

    // ── two open windows (the multi-instance case) ──────────────────────────────────────────────────────
    // TwinCAT is now per-XAE: two windows arrive as two DISCOVERED pipes → two rows. Distinguished by project NAME;
    // two windows on an IDENTICALLY-named project is the accepted name-identity limit (they collapse to one row —
    // see the ConnectionManager dedup test).

    [Fact]
    public async Task Fans_out_over_every_discovered_pipe_stamping_each_projects_pipe()
    {
        var wires = new Dictionary<string, IBridgeWire>
        {
            ["volt.bridge.codesys.111"] = new FakeBridgeWire().On("health", """{ "projects": [ { "project": "MachineA" } ] }"""),
            ["volt.bridge.codesys.222"] = new FakeBridgeWire().On("health", """{ "projects": [ { "project": "MachineB" } ] }"""),
        };
        var src = new PerPipeProjectSource("codesys", "CODESYS", () => wires.Keys.ToList(), pipe => wires[pipe]);

        var projects = (await src.ScanAsync()).Projects.OrderBy(p => p.DisplayName).ToList();

        Assert.Equal(new[] { "MachineA", "MachineB" }, projects.Select(p => p.DisplayName));
        Assert.Equal("volt.bridge.codesys.111", projects[0].Pipe);
        Assert.Equal("volt.bridge.codesys.222", projects[1].Pipe);
        Assert.NotEqual(projects[0].Id, projects[1].Id); // distinct identities — by name
    }

    [Fact]
    public async Task Scan_carries_serving_status_and_dirty_off_the_wire_row()
    {
        var wire = new FakeBridgeWire().On("health",
            """{ "projects": [ { "project": "MyMachine", "status": "healthy", "dirty": true } ] }""");
        var src = One("codesys", "CODESYS", wire, "volt.bridge.codesys.1");

        var scan = await src.ScanAsync();

        Assert.True(scan.Reachable);
        var p = Assert.Single(scan.Projects);
        Assert.True(p.Serving);
        Assert.Equal("healthy", p.Status);
        Assert.True(p.Dirty);
    }

    [Fact]
    public async Task Fans_out_over_pipes_concurrently_so_a_slow_ide_does_not_serialize_the_others()
    {
        // Five running IDEs. One slow/hung IDE must not stall discovery of the others. Proven by ORDERING, not a
        // stopwatch: each pipe's health call signals on entry and awaits release — all five can only be observed
        // entered if the fan-out ran them concurrently (a serialized scan blocks in the first pipe). The 30s wait is a
        // deadlock detector, not a latency budget (a tight wall-clock budget flaked when a loaded CI runner slowed
        // even the concurrent path).
        const int n = 5;
        var entered = new CountdownEvent(n);
        var release = new TaskCompletionSource();
        var wires = new Dictionary<string, IBridgeWire>();
        for (int i = 1; i <= n; i++)
            wires[$"volt.bridge.codesys.{i}"] = new FakeBridgeWire { Entered = entered, Release = release.Task }
                .On("health", $$"""{ "projects": [ { "project": "M{{i}}" } ] }""");
        var src = new PerPipeProjectSource("codesys", "CODESYS", () => wires.Keys.ToList(), pipe => wires[pipe]);

        var scanTask = src.ScanAsync();
        Assert.True(entered.Wait(30_000), "pipe fan-out was serialized — one pipe blocked the others");
        release.SetResult();
        var scan = await scanTask;

        Assert.Equal(n, scan.Projects.Count);
    }

    [Fact]
    public async Task No_pipes_is_not_reachable_but_a_live_pipe_is()
    {
        var none = new PerPipeProjectSource("codesys", "CODESYS", () => new List<string>(), _ => throw new InvalidOperationException());
        Assert.False((await none.ScanAsync()).Reachable);

        // A live pipe existing IS the reachability bit, even if that host answers with no project rows.
        var some = new PerPipeProjectSource("codesys", "CODESYS", () => new List<string> { "volt.bridge.codesys.9" }, _ => new FakeBridgeWire());
        Assert.True((await some.ScanAsync()).Reachable);
    }

    [Fact]
    public async Task An_unreachable_bridge_scans_to_empty_for_that_pipe()
    {
        var wire = new FakeBridgeWire();
        wire.Throw.Add("health"); // discovery rides on health
        var src = One("codesys", "CODESYS", wire, "volt.bridge.codesys.1");

        var scan = await src.ScanAsync();
        Assert.Empty(scan.Projects);            // that host went away mid-scan — no rows
        Assert.True(scan.Reachable);            // ...but the pipe was discovered, so the source itself is reachable
    }
}
