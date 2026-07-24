using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Volt.Engine.Wire;
using Volt.Cli.Transport;
using Volt.Cli.Tests; // the shared FakeIde
using Xunit;

namespace Volt.Cli.Connector.Tests;

/// <summary>
/// The connect/disconnect lifecycle, end to end over REAL named pipes, from BOTH sides at once: the connector
/// drives (<see cref="ConnectionManager"/> — what the tray, the VS Code extension and the desktop all call) while
/// a separate <see cref="PipeClient"/> plays the CLI (`volt push`), which reaches the bridge DIRECTLY and never
/// consults the connector. That split is the whole reason Disconnect needed a bridge-side gate — a connector-side
/// selection flag is invisible to the CLI, so "disconnected" in the tray still pushed and pulled. These tests
/// exist to make that regression impossible.
///
/// No CODESYS required, deliberately: the parity boundary is the pipe wire, so a real BridgePipeHost over a real
/// pipe with a faked IDE exercises every state transition, in CI, in milliseconds. A headless CODESYS could only
/// add confidence in the vendor glue BELOW the wire (the driver), which is `test/e2e`'s job.
/// </summary>
public class DisconnectLifecycleTests
{
    private readonly string _prefix = "volt.test.disc." + Guid.NewGuid().ToString("N") + ".";

    private static FakeIde Ide(string project) => new(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"))
    {
        HealthConnected = true,
        HealthProjectName = project,
        Projects = new List<ProjectEntry>
        {
            new ProjectEntry("codesys", project, "3.5", project, "healthy", true, false),
        },
    };

    private static BridgePipeHost StartHost(string pipe, string project)
    {
        var h = new BridgePipeHost(Ide(project), pipe);
        h.Start();
        for (int i = 0; i < 150 && !File.Exists(@"\\.\pipe\" + pipe); i++) Thread.Sleep(20);
        return h;
    }

    private CodesysProjectSource Source() => new(() => PipeDiscovery.List(_prefix), pipe => new PipeBridgeWire(pipe));

    // ── the CLI's side of the wire — exactly what `volt push` / `volt status` do ──
    private static bool CliCanSync(string pipe)
    {
        try { new PipeClient(pipe).Call("refs"); return true; }
        catch (PipeCallException e) when (e.Code == "PLC_DISCONNECTED") { return false; }
    }

    private static bool CliSeesConnected(string pipe) =>
        new PipeClient(pipe).Call("health").GetProperty("projects").EnumerateArray()
            .Any(p => p.TryGetProperty("serving", out var s) && s.ValueKind == System.Text.Json.JsonValueKind.True);

    /// <summary>The core round trip, asserted from BOTH sides after every transition. This is the test that would
    /// have caught the original bug: before the bridge-side gate, `CliCanSync` stayed true after Disconnect.</summary>
    [Fact]
    public async Task Connect_disconnect_reconnect_agree_on_both_sides_and_tear_nothing_down()
    {
        var pipe = _prefix + "1";
        var host = StartHost(pipe, "MachineA");
        var mgr = new ConnectionManager(new IProjectSource[] { Source() });
        try
        {
            await mgr.RefreshAsync();
            var proj = mgr.Projects.Single();

            await mgr.ConnectAsync(proj);
            Assert.Equal(proj.Id, mgr.ActiveConnection?.Id);
            Assert.True(CliCanSync(pipe));      // the CLI can push/pull
            Assert.True(CliSeesConnected(pipe));

            await mgr.DisconnectAsync();
            Assert.Null(mgr.ActiveConnection);   // connector side: nothing selected
            Assert.False(CliCanSync(pipe));      // CLI side: REFUSED — the point of the whole feature
            Assert.False(CliSeesConnected(pipe));// so every UI renders "not connected" within one poll

            // Nothing was torn down: the host still serves discovery, so the project stays listed and offerable.
            await mgr.RefreshAsync();
            Assert.Equal("MachineA", mgr.Projects.Single().DisplayName);

            await mgr.ConnectAsync(mgr.Projects.Single());
            Assert.True(CliCanSync(pipe));       // resumed with no restart of anything
            Assert.True(CliSeesConnected(pipe));

            // The connector's own view must track the bridge at every step — this is the signal both frontends
            // render from, and it disagreeing with the CLI is the whole class of bug this feature kept hitting.
            await mgr.RefreshAsync();
            Assert.True(mgr.IsServingProject(proj.Id));
            Assert.Equal(BridgeStatus.Connected, mgr.Aggregate());
        }
        finally { host.Dispose(); }
    }

    /// <summary>The connector's report and the CLI's reality must agree after EVERY transition. They are read
    /// over different connections by different code paths, so a split here is invisible until a user hits it:
    /// the UI says connected while `volt push` is refused, or vice versa. Asserted as one pair, per step.</summary>
    [Fact]
    public async Task The_connector_view_and_the_CLI_never_disagree_across_the_whole_cycle()
    {
        var pipe = _prefix + "1";
        var host = StartHost(pipe, "MachineA");
        var mgr = new ConnectionManager(new IProjectSource[] { Source() });
        try
        {
            await mgr.RefreshAsync();
            var id = mgr.Projects.Single().Id;

            // Detected but never connected: listed, NOT serving, tray not green. ("Detected" is not "connected" —
            // the assumption that they were the same is what this refactor removed.)
            Assert.True(mgr.Projects.Count == 1);
            Assert.Equal(mgr.IsServingProject(id), CliCanSync(pipe));
            Assert.NotEqual(BridgeStatus.Connected, mgr.Aggregate());

            await mgr.ConnectAsync(mgr.Projects.Single());
            await mgr.RefreshAsync();
            Assert.True(mgr.IsServingProject(id));
            Assert.Equal(mgr.IsServingProject(id), CliCanSync(pipe));
            Assert.Equal(BridgeStatus.Connected, mgr.Aggregate());

            await mgr.DisconnectAsync();
            await mgr.RefreshAsync();
            Assert.False(mgr.IsServingProject(id));                    // the gated bridge is still LISTED...
            Assert.True(mgr.Projects.Count == 1);                      // ...which is how you reconnect to it
            Assert.Equal(mgr.IsServingProject(id), CliCanSync(pipe));  // and both sides say the same thing
            Assert.NotEqual(BridgeStatus.Connected, mgr.Aggregate());  // tray is not green

            await mgr.ConnectAsync(mgr.Projects.Single());
            await mgr.RefreshAsync();
            Assert.Equal(mgr.IsServingProject(id), CliCanSync(pipe));
            Assert.Equal(BridgeStatus.Connected, mgr.Aggregate());
        }
        finally { host.Dispose(); }
    }

    /// <summary>The tray goes GREEN only when something is actually connected — never merely because an IDE is
    /// running with a project open. The single-worker source used to ignore the selection and report the worker's
    /// raw health, so TwinCAT painted the tray green the moment XAE was up, before the user connected anything.
    /// (CODESYS never had it: its per-instance probe already keys off the selection.)</summary>
    [Fact]
    public async Task A_detected_but_unconnected_project_does_not_paint_the_tray_connected()
    {
        var pipe = _prefix + "1";
        var host = StartHost(pipe, "MachineA");
        // A single-worker (TwinCAT-shaped) source over this live host: healthy, project open, nothing selected.
        var src = new PipeProjectSource("twincat", "TwinCAT", new PipeBridgeWire(pipe), pipe);
        var mgr = new ConnectionManager(new IProjectSource[] { src });
        try
        {
            await mgr.RefreshAsync();
            Assert.NotEmpty(mgr.Projects);                            // detected...
            Assert.Null(mgr.ActiveConnection);                        // ...but not connected
            Assert.NotEqual(BridgeStatus.Connected, mgr.Aggregate()); // so: not green

            await mgr.ConnectAsync(mgr.Projects[0]);
            await mgr.RefreshAsync();
            Assert.Equal(BridgeStatus.Connected, mgr.Aggregate());    // green only once connected
        }
        finally { host.Dispose(); }
    }

    /// <summary>Disconnecting ONE project must not disconnect another. Two CODESYS IDEs = two pipes = two
    /// independent gates, so a second workspace bound to the other project keeps syncing. (Per-workspace health,
    /// not the connector's single "active connection", is what the UI reads — there is no stealing.)</summary>
    [Fact]
    public async Task Disconnecting_one_host_leaves_every_other_host_serving()
    {
        var pa = _prefix + "a";
        var pb = _prefix + "b";
        var a = StartHost(pa, "MachineA");
        var b = StartHost(pb, "MachineB");
        var mgr = new ConnectionManager(new IProjectSource[] { Source() });
        try
        {
            await mgr.RefreshAsync();
            await mgr.ConnectAsync(mgr.Projects.Single(p => p.DisplayName == "MachineA"));
            await mgr.DisconnectAsync();

            Assert.False(CliCanSync(pa)); // the one we disconnected
            Assert.True(CliCanSync(pb));  // its neighbour is untouched
        }
        finally { a.Dispose(); b.Dispose(); }
    }

    /// <summary>Switching projects is NOT a disconnect. Connecting B clears A's selection (one active connection),
    /// but never deselects A's bridge — a workspace bound to A must keep syncing while you look at B. This pins
    /// the asymmetry: only an explicit Disconnect gates a bridge.</summary>
    [Fact]
    public async Task Switching_the_active_connection_does_not_disconnect_the_previous_bridge()
    {
        var pa = _prefix + "a";
        var pb = _prefix + "b";
        var a = StartHost(pa, "MachineA");
        var b = StartHost(pb, "MachineB");
        var mgr = new ConnectionManager(new IProjectSource[] { Source() });
        try
        {
            await mgr.RefreshAsync();
            await mgr.ConnectAsync(mgr.Projects.Single(p => p.DisplayName == "MachineA"));
            await mgr.ConnectAsync(mgr.Projects.Single(p => p.DisplayName == "MachineB"));

            Assert.Equal("MachineB", mgr.ActiveConnection?.DisplayName);
            Assert.True(CliCanSync(pa)); // A was only deselected in the UI, not gated
            Assert.True(CliCanSync(pb));
        }
        finally { a.Dispose(); b.Dispose(); }
    }

    /// <summary>A disconnected bridge whose IDE then closes: the refresh must drop it like any other dead host —
    /// the pause flag lives in that process, so it dies with it. No stuck state, no throw.</summary>
    [Fact]
    public async Task A_disconnected_host_that_then_closes_is_dropped_like_any_other()
    {
        var pipe = _prefix + "1";
        var host = StartHost(pipe, "MachineA");
        var mgr = new ConnectionManager(new IProjectSource[] { Source() });
        try
        {
            await mgr.RefreshAsync();
            await mgr.ConnectAsync(mgr.Projects.Single());
            await mgr.DisconnectAsync();

            host.Stop();
            for (int i = 0; i < 150 && File.Exists(@"\\.\pipe\" + pipe); i++) Thread.Sleep(20);
            await mgr.RefreshAsync();

            Assert.Empty(mgr.Projects);
            Assert.Null(mgr.ActiveConnection);
        }
        finally { host.Dispose(); }
    }

    /// <summary>Disconnecting a bridge that is already gone must not throw — the user clicking Disconnect on a
    /// project whose IDE just closed is a normal race, and it is already disconnected in every sense that matters.</summary>
    [Fact]
    public async Task Disconnecting_an_unreachable_bridge_is_silent_not_an_error()
    {
        var pipe = _prefix + "1";
        var host = StartHost(pipe, "MachineA");
        var mgr = new ConnectionManager(new IProjectSource[] { Source() });
        try
        {
            await mgr.RefreshAsync();
            await mgr.ConnectAsync(mgr.Projects.Single());

            host.Stop(); // the IDE closes between the click and the deselect
            for (int i = 0; i < 150 && File.Exists(@"\\.\pipe\" + pipe); i++) Thread.Sleep(20);

            Assert.Equal(UnbindResult.Unreachable, await mgr.DisconnectAsync()); // reported as GONE, not "out of date"
            Assert.Null(mgr.ActiveConnection);
        }
        finally { host.Dispose(); }
    }

    /// <summary>A second Disconnect on an already-disconnected connector is a no-op, and a `select` from ANY
    /// client resumes the bridge — the connector is not the only thing that can un-pause it (init sets VOLT_PIPE
    /// and the shells connect through the connector, but the wire must not depend on who calls).</summary>
    [Fact]
    public async Task Disconnect_is_idempotent_and_any_select_resumes_the_bridge()
    {
        var pipe = _prefix + "1";
        var host = StartHost(pipe, "MachineA");
        var mgr = new ConnectionManager(new IProjectSource[] { Source() });
        try
        {
            await mgr.RefreshAsync();
            await mgr.ConnectAsync(mgr.Projects.Single());
            await mgr.DisconnectAsync();
            await mgr.DisconnectAsync(); // no active connection now — must be a harmless no-op
            Assert.False(CliCanSync(pipe));

            new PipeClient(pipe).Call("connect", new { }); // a direct connect, bypassing the connector
            Assert.True(CliCanSync(pipe));
        }
        finally { host.Dispose(); }
    }
}
