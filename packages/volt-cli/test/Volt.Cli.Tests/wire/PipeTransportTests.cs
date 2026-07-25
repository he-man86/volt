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
/// yields progress frames then a result, the verbose-init progress folds into one phaseless total, and `health`
/// answers from cache (never marshalled) even while a long op holds the IDE thread.
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
    public void Health_poll_answers_from_cache_while_the_one_IDE_thread_is_busy_with_a_long_op()
    {
        // The regression guard. `health` is the ONE ambient poll — liveness + the connectable-projects list — polled
        // by the connector every ~4s and every control-plane /status. It MUST be served from a cached snapshot, NEVER
        // marshalled onto the single IDE thread. If it marshals (as the old separate `instances` op did), it queues
        // behind a long fetch/push/build on that one thread, the connector's refresh stalls, and a busy IDE reads as a
        // LOST CONNECTION. This models the real single-threaded IDE (serializeSta) and holds that thread in a live op.
        var entered = new ManualResetEventSlim(false);
        var release = new ManualResetEventSlim(false);
        var ide = new FakeIde(serializeSta: true,
            FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"))
        {
            ExtractEntered = entered,
            ExtractBlock = release,
            Projects = new List<ProjectEntry>
            {
                new ProjectEntry("codesys", "0", "Proj", "healthy", false),
            },
        };
        var pipe = Pipe();
        using var host = new BridgePipeHost(ide, pipe);
        host.Start();

        // Hold the one IDE thread inside a running op (init blocks in library-extract on the STA worker).
        var init = Task.Run(() => new PipeClient(pipe).Call("init"));
        Assert.True(entered.Wait(15_000), "init never reached the library-extract step");

        // With the IDE thread held, the health poll must still COMPLETE (release hasn't been Set) — served from
        // cache, off the held thread. The bound is a generous liveness/deadlock detector: a correct read returns in
        // ms, a WRONG one that marshalled onto the held STA thread deadlocks. NOT a latency budget (a 2s budget on a
        // <10ms read flaked under CI build-load).
        var health = Task.Run(() => new PipeClient(pipe).Call("health"));
        Assert.True(health.Wait(30_000),
            "health HUNG behind the busy IDE thread — it marshalled instead of serving the cached snapshot");
        Assert.True(health.Result.TryGetProperty("projects", out var arr) && arr.GetArrayLength() == 1,
            "health did not carry the connectable-projects list");
        Assert.NotEqual("idle", arr[0].GetProperty("status").GetString()); // serving = a non-idle row

        release.Set();
        Assert.True(init.Wait(15_000), "init did not complete after release");
    }

    [Fact]
    public void Health_polls_across_two_bridges_stay_responsive_while_one_IDE_is_busy_with_a_long_op()
    {
        // The PARALLEL-health guarantee for the multi-IDE topology (two live pipes). With ONE IDE thread HELD in a
        // long op — the >8s refs/fetch/push a large real project takes — a health poll on THAT bridge AND on a second,
        // idle bridge must both answer well under the connector's ~4s tick, concurrently, from cache; neither may
        // serialize behind the busy thread. If either did, a busy IDE would read as a lost connection across the
        // fleet. Both drivers model the real single IDE thread (serializeSta), so the block is a genuine held thread.
        var entered = new ManualResetEventSlim(false);
        var release = new ManualResetEventSlim(false);
        var busy = new FakeIde(serializeSta: true,
            FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"))
        {
            ExtractEntered = entered,
            ExtractBlock = release,
            Projects = new List<ProjectEntry> { new ProjectEntry("codesys", "0", "BigProject", "healthy", false) },
        };
        var idle = new FakeIde(serializeSta: true,
            FakeIde.Item.TextualPou("Q", "PROGRAM Q\nVAR\nEND_VAR", "y := 2;"))
        {
            Projects = new List<ProjectEntry> { new ProjectEntry("codesys", "0", "SmallProject", "healthy", false) },
        };

        var pBusy = Pipe();
        var pIdle = Pipe();
        using var hBusy = new BridgePipeHost(busy, pBusy);
        using var hIdle = new BridgePipeHost(idle, pIdle);
        hBusy.Start();
        hIdle.Start();

        // Hold the BUSY bridge's one IDE thread inside a running op.
        var op = Task.Run(() => new PipeClient(pBusy).Call("init"));
        Assert.True(entered.Wait(15_000), "the long op never reached the held step");

        // BOTH health polls must COMPLETE while the op is still held (release hasn't been Set yet) — that is the
        // proof they didn't serialize behind the busy IDE thread, and it is STRUCTURAL, not a stopwatch: a correct
        // cache-served health returns in ms; a WRONG one that marshalled onto the held STA thread would DEADLOCK
        // (that thread is inside the op, unreleasable until below). So the bound here is a generous liveness/
        // deadlock detector — NOT a latency budget (an earlier 2s budget flaked under CI build-load on a <10ms read).
        var hb = Task.Run(() => new PipeClient(pBusy).Call("health"));
        var hi = Task.Run(() => new PipeClient(pIdle).Call("health"));
        Assert.True(Task.WaitAll(new[] { hb, hi }, 30_000),
            "a health poll HUNG behind the busy IDE thread — it marshalled instead of serving the cached snapshot");

        // Each carries ITS OWN project; the busy bridge is still serving (an in-flight op is a live link, not a drop).
        Assert.Equal("BigProject", hb.Result.GetProperty("projects")[0].GetProperty("project").GetString());
        Assert.Equal("SmallProject", hi.Result.GetProperty("projects")[0].GetProperty("project").GetString());
        Assert.NotEqual("idle", hb.Result.GetProperty("projects")[0].GetProperty("status").GetString());
        Assert.NotEqual("idle", hi.Result.GetProperty("projects")[0].GetProperty("status").GetString());

        release.Set();
        Assert.True(op.Wait(15_000), "the long op did not complete after release");
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

    /// <summary>The Core `connect` post-condition, enforced ONCE in BridgePipeHost for BOTH vendors: a connect that
    /// couldn't attach the requested project (the multi-window trap — TwinCAT: not in the bound XAE; CODESYS: the
    /// pipe's project moved) leaves the driver not-connected, and the host must refuse LOUD with the shared
    /// PLC_DISCONNECTED — never "ok" into a state where the next fetch silently returns nothing. This lived per
    /// driver (TwinCAT threw its own exception, CODESYS didn't check at all); moving it here makes the wire error
    /// identical across vendors by construction. The driver just attaches; Core decides the wire outcome.</summary>
    [Fact]
    public void Connect_that_cannot_attach_the_project_is_refused_with_PLC_DISCONNECTED()
    {
        var pipe = Pipe();
        using var host = new BridgePipeHost(new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;")) { SelectConnects = false }, pipe);
        host.Start();

        var ex = Assert.Throws<PipeCallException>(() =>
            new PipeClient(pipe).Call("connect", new { project = "NotOpenHere" }));
        Assert.Equal("PLC_DISCONNECTED", ex.Code);
    }

    [Fact]
    public void Connect_that_attaches_the_project_returns_ok()
    {
        var pipe = Pipe();
        using var host = new BridgePipeHost(new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;")), pipe);
        host.Start();

        var r = new PipeClient(pipe).Call("connect", new { project = "P" });
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

    /// <summary>The tray's Disconnect, end to end over the wire. `disconnect` must REFUSE sync without tearing the
    /// host down: the CLI reaches this pipe directly, so this gate is the only thing that makes Disconnect mean
    /// anything. `health` must keep answering while disconnected — with NO serving row (so the UI shows disconnected)
    /// but STILL listing the project (so there's a row to reconnect to) — and `connect` must resume with no restart.</summary>
    [Fact]
    public void Disconnect_refuses_sync_until_the_next_connect_but_leaves_the_host_serving_health()
    {
        var pipe = Pipe();
        var ide = new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"))
        {
            HealthConnected = true,
            HealthProjectName = "Demo",
        };
        using var host = new BridgePipeHost(ide, pipe);
        host.Start();

        Assert.True(AnyServing(pipe)); // a serving row = connected
        new PipeClient(pipe).Call("refs"); // serving

        new PipeClient(pipe).Call("disconnect");

        foreach (var op in new[] { "refs", "fetch", "init", "push", "build" })
        {
            var ex = Assert.Throws<PipeCallException>(() => new PipeClient(pipe).Call(op, new { }));
            Assert.Equal("PLC_DISCONNECTED", ex.Code);
        }

        // Nothing was torn down: the host still answers, but every row is `idle` (disconnected), and health STILL
        // lists the project — otherwise there'd be no way back other than restarting the IDE.
        var health = new PipeClient(pipe).Call("health");
        Assert.All(health.GetProperty("projects").EnumerateArray(), p => Assert.Equal("idle", p.GetProperty("status").GetString()));
        Assert.True(health.GetProperty("projects").GetArrayLength() > 0); // still listed to reconnect

        new PipeClient(pipe).Call("connect", new { });
        new PipeClient(pipe).Call("refs"); // serving again, no restart
        Assert.True(AnyServing(pipe));
    }

    // Serving = a non-idle row (status folds serving in; there is no separate `serving` field on the wire).
    private static bool AnyServing(string pipe) =>
        new PipeClient(pipe).Call("health").GetProperty("projects").EnumerateArray()
            .Any(p => p.TryGetProperty("status", out var s) && s.GetString() != "idle");
}
