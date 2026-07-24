using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Volt.Engine.Library;
using Volt.Engine.Wire;
using Volt.Cli.Transport;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>
/// The bridge wire tests, reformatted for the NAMED-PIPE transport (was HTTP + HttpClient in the bridge's
/// ProgressStreamTests). Same Core services, same FakeIde, same guarantees — proven over a pipe: a streamed op
/// yields progress frames then a result, the verbose-init progress folds into one phaseless total, and /health
/// advertises the activeOp of a concurrent in-flight mutation.
/// </summary>
public class PipeTransportTests
{
    private static string Pipe() => "volt.test." + Guid.NewGuid().ToString("N");

    [Fact]
    public void Fetch_streams_progress_then_a_result_over_the_pipe()
    {
        var items = Enumerable.Range(0, 60)
            .Select(i => FakeIde.Item.TextualPou($"P{i}", $"PROGRAM P{i}\nVAR\nEND_VAR", "x := 1;"))
            .ToArray();
        var pipe = Pipe();
        using var host = new BridgePipeHost(new FakeIde(items), pipe);
        host.Start();

        var progress = new List<JsonElement>();
        var result = new PipeClient(pipe).Call("fetch",
            new { knownItems = new Dictionary<string, string>() },
            onProgress: f => progress.Add(f.Clone()));

        Assert.NotEmpty(progress);                            // ≥1 progress frame
        Assert.True(result.TryGetProperty("changed", out _)); // the result IS a FetchResponse
    }

    [Fact]
    public void Verbose_init_folds_library_signatures_into_one_phaseless_total_over_the_pipe()
    {
        var items = Enumerable.Range(0, 30)
            .Select(i => FakeIde.Item.TextualPou($"P{i}", $"PROGRAM P{i}\nVAR\nEND_VAR", "x := 1;"))
            .ToArray();
        var libs = Enumerable.Range(0, 40)
            .Select(i => new LibSignature($"F{i}", "MyLib, 1.0.0.0 (v)", "Function",
                Array.Empty<LibVar>(), Array.Empty<LibVar>(), Array.Empty<LibVar>(), Array.Empty<LibVar>(), null, "INT"))
            .ToList();
        var pipe = Pipe();
        using var host = new BridgePipeHost(new FakeIde(items) { LibSignatures = libs }, pipe);
        host.Start();

        var progress = new List<JsonElement>();
        new PipeClient(pipe).Call("init", onProgress: f => progress.Add(f.Clone()));

        Assert.NotEmpty(progress);
        Assert.All(progress, p => Assert.False(p.TryGetProperty("phase", out _))); // no separate phase
        var last = progress[^1];
        Assert.Equal(items.Length + libs.Count, last.GetProperty("total").GetInt32());
        Assert.Equal(items.Length + libs.Count, last.GetProperty("done").GetInt32());
    }

    [Fact]
    public void Health_reports_the_active_op_while_a_mutation_is_in_flight_then_clears()
    {
        var entered = new ManualResetEventSlim(false);
        var release = new ManualResetEventSlim(false);
        var ide = new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"))
        {
            ExtractEntered = entered,
            ExtractBlock = release,
        };
        var pipe = Pipe();
        using var host = new BridgePipeHost(ide, pipe);
        host.Start();

        Assert.Null(ActiveOp(pipe)); // idle → no activeOp

        var init = Task.Run(() => new PipeClient(pipe).Call("init"));
        Assert.True(entered.Wait(5000), "init never reached the library-extract step");

        Assert.Equal("init", ActiveOp(pipe)); // concurrent /health sees the in-flight op

        release.Set();
        Assert.True(init.Wait(5000), "init did not complete after release");

        string? op = "init";
        for (var i = 0; i < 100 && op != null; i++) { op = ActiveOp(pipe); if (op != null) Thread.Sleep(20); }
        Assert.Null(op); // cleared once the op completes
    }

    [Fact]
    public void A_coded_bridge_error_reaches_the_client_as_its_real_code_not_INTERNAL_ERROR()
    {
        var pipe = Pipe();
        using var host = new BridgePipeHost(new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;")), pipe);
        host.Start();

        // /fetch with no knownItems and not init → the service throws BridgeException(NO_SIDECAR). The wire must
        // carry that code through to PipeCallException.Code (it used to flatten every error to INTERNAL_ERROR).
        var ex = Assert.Throws<PipeCallException>(() => new PipeClient(pipe).Call("fetch", new { }));
        Assert.Equal("NO_SIDECAR", ex.Code);
    }

    /// <summary>The Core `select` post-condition, enforced ONCE in BridgePipeHost for BOTH vendors: a select that
    /// couldn't attach the requested project (the multi-window trap — TwinCAT: not in the bound XAE; CODESYS: the
    /// pipe's project moved) leaves the driver not-connected, and the host must refuse LOUD with the shared
    /// PLC_DISCONNECTED — never "ok" into a state where the next fetch silently returns nothing. This lived per
    /// driver (TwinCAT threw its own exception, CODESYS didn't check at all); moving it here makes the wire error
    /// identical across vendors by construction. The driver just attaches; Core decides the wire outcome.</summary>
    [Fact]
    public void Select_that_cannot_attach_the_project_is_refused_with_PLC_DISCONNECTED()
    {
        var pipe = Pipe();
        using var host = new BridgePipeHost(new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;")) { SelectConnects = false }, pipe);
        host.Start();

        var ex = Assert.Throws<PipeCallException>(() =>
            new PipeClient(pipe).Call("select", new { instanceId = "xae-2", project = "NotOpenHere", plcProject = (string?)null }));
        Assert.Equal("PLC_DISCONNECTED", ex.Code);
    }

    [Fact]
    public void Select_that_attaches_the_project_returns_ok()
    {
        var pipe = Pipe();
        using var host = new BridgePipeHost(new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;")), pipe);
        host.Start();

        var r = new PipeClient(pipe).Call("select", new { instanceId = "xae-1", project = "P", plcProject = (string?)null });
        Assert.True(r.GetProperty("ok").GetBoolean());
    }

    /// <summary>Every project-touching op on a bridge with nothing bound is refused with the SHARED PLC_DISCONNECTED,
    /// enforced once in Core — not each driver faulting its own way (CODESYS "no Application", TwinCAT a COM error)
    /// into a generic INTERNAL_ERROR. Same guarantee on both vendors because the check is above the seam.</summary>
    [Theory]
    [InlineData("refs")]
    [InlineData("fetch")]
    [InlineData("init")]
    [InlineData("push")]
    [InlineData("build")]
    public void A_project_op_on_a_not_connected_bridge_is_refused_with_PLC_DISCONNECTED(string op)
    {
        var pipe = Pipe();
        using var host = new BridgePipeHost(
            new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;")) { HealthConnected = false }, pipe);
        host.Start();

        var ex = Assert.Throws<PipeCallException>(() =>
            new PipeClient(pipe).Call(op, new { knownItems = new Dictionary<string, string>() }));
        Assert.Equal("PLC_DISCONNECTED", ex.Code);
    }

    [Fact]
    public void An_unknown_op_is_a_coded_BAD_REQUEST_not_a_bare_internal_error()
    {
        var pipe = Pipe();
        using var host = new BridgePipeHost(new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;")), pipe);
        host.Start();

        var ex = Assert.Throws<PipeCallException>(() => new PipeClient(pipe).Call("bogus", new { }));
        Assert.Equal("BAD_REQUEST", ex.Code);
    }

    /// <summary>The tray's Disconnect, end to end over the wire. `deselect` must REFUSE sync without tearing the
    /// host down: the CLI reaches this pipe directly, so this gate is the only thing that makes Disconnect mean
    /// anything. `health` + `instances` must keep answering while disconnected — they are how the UI shows the
    /// state and lists the project to reconnect to — and `select` must resume service with no restart.</summary>
    [Fact]
    public void Deselect_refuses_sync_until_the_next_select_but_leaves_the_host_serving_health_and_instances()
    {
        var pipe = Pipe();
        var ide = new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"))
        {
            HealthConnected = true,
            HealthProjectName = "Demo",
        };
        using var host = new BridgePipeHost(ide, pipe);
        host.Start();

        Assert.True(new PipeClient(pipe).Call("health").GetProperty("connected").GetBoolean());
        new PipeClient(pipe).Call("refs"); // serving

        new PipeClient(pipe).Call("deselect");

        foreach (var op in new[] { "refs", "fetch", "init", "push", "build" })
        {
            var ex = Assert.Throws<PipeCallException>(() => new PipeClient(pipe).Call(op, new { }));
            Assert.Equal("PLC_DISCONNECTED", ex.Code);
        }

        // Nothing was torn down: the host still answers, but reports itself disconnected, and still lists the
        // project — otherwise there'd be no way back other than restarting the IDE.
        var health = new PipeClient(pipe).Call("health");
        Assert.False(health.GetProperty("connected").GetBoolean());
        Assert.Equal("unavailable", health.GetProperty("status").GetString());
        Assert.True(new PipeClient(pipe).Call("instances").TryGetProperty("instances", out _));

        new PipeClient(pipe).Call("select", new { });
        new PipeClient(pipe).Call("refs"); // serving again, no restart
        Assert.True(new PipeClient(pipe).Call("health").GetProperty("connected").GetBoolean());
    }

    private static string? ActiveOp(string pipe)
    {
        var h = new PipeClient(pipe).Call("health");
        return h.TryGetProperty("activeOp", out var op) && op.ValueKind == JsonValueKind.String ? op.GetString() : null;
    }
}
