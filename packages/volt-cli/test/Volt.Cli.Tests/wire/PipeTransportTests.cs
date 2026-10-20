using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Volt.Wire;
using Xunit;
using Volt.Contracts;
using Volt.Engine.Library;
using Volt.Engine.Host;

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

    /// <summary>`grep` over the pipe answers the matching LINES with the matched item's refs version (openspec
    /// <c>grep-item-sources</c>), and a pattern that does not compile is a coded BAD_REQUEST, not INTERNAL_ERROR.</summary>
    [Fact]
    public void Grep_answers_lines_and_versions_over_the_pipe()
    {
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "fbMotor();\nx := fbMotor.bRunning;", "POUs"),
            FakeIde.Item.TextualPou("P2", "PROGRAM P2\nVAR\nEND_VAR", "y := 1;", "POUs"));
        var pipe = Pipe();
        using var host = new BridgePipeHost(ide, pipe);
        host.Start();
        var client = new PipeClient(pipe);
        var version = client.Call("refs").GetProperty("items").GetProperty("POUs/PLC_PRG.pou").GetString();

        var result = client.Call("grep", new { pattern = "bRunning" });

        var match = Assert.Single(result.GetProperty("matches").EnumerateArray().ToList());
        Assert.Equal("POUs/PLC_PRG.pou", match.GetProperty("path").GetString());
        Assert.Equal("x := fbMotor.bRunning;", match.GetProperty("text").GetString());
        Assert.Equal(version, result.GetProperty("items").GetProperty("POUs/PLC_PRG.pou").GetString());
        Assert.Equal(2, result.GetProperty("searched").GetInt32());

        var ex = Assert.Throws<PipeCallException>(() => client.Call("grep", new { pattern = "fbMotor(" }));
        Assert.Equal("BAD_REQUEST", ex.Code);
    }

    /// <summary>`health.ops` IS THE DISPATCH TABLE (openspec <c>grep-item-sources</c>): every op it names is answered by
    /// an arm of the host's switch, and every other name — each <see cref="Ops"/> constant it leaves out, and a name no
    /// op has — is refused as an unknown op. A client reads it to know what it can ask; a list that drifted from the
    /// switch would promise an op the bridge refuses, or hide one it serves.</summary>
    [Fact]
    public void Health_ops_is_exactly_the_set_of_ops_the_host_dispatches()
    {
        var constants = typeof(Ops).GetFields()
            .Where(f => f.IsLiteral && f.FieldType == typeof(string)).Select(f => (string)f.GetRawConstantValue()!).ToList();
        foreach (var op in constants.Append("no-such-op"))
        {
            var pipe = Pipe();
            using var host = new BridgePipeHost(new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;")), pipe);
            host.Start();
            string? unknown = null;
            try { new PipeClient(pipe).Call(op, new { }); }
            catch (PipeCallException e) when (e.Message.Contains($"unknown op '{op}'")) { unknown = e.Message; }
            catch (PipeCallException) { }   // refused for its body or state: the op IS dispatched
            Assert.True((unknown is null) == BridgePipeHost.Served.Contains(op),
                $"`{op}`: {(unknown is null ? "dispatched" : "unknown")}, and health.ops {(BridgePipeHost.Served.Contains(op) ? "names" : "omits")} it");
        }

        var health = Pipe();
        using var h = new BridgePipeHost(new FakeIde(), health);
        h.Start();
        var ops = new PipeClient(health).Call("health").GetProperty("ops").EnumerateArray().Select(o => o.GetString()).ToList();
        Assert.Equal(BridgePipeHost.Served, ops);
        Assert.Contains(Ops.Grep, ops);
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
        new PipeClient(pipe).Call("fetch", new { init = true }, onProgress: f => progress.Add(f.Clone()));

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
        var init = Task.Run(() => new PipeClient(pipe).Call("fetch", new { init = true }));
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
        var op = Task.Run(() => new PipeClient(pBusy).Call("fetch", new { init = true }));
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

    /// <summary>A bridge whose pipe cannot be BOUND must fail <c>Start()</c>, not report ready. The first pipe
    /// instance is created SYNCHRONOUSLY in <c>PipeServer.Start</c>, so the reason reaches the caller — CODESYS's
    /// <c>PipeHost.Start</c> turns it into "Volt bridge FAILED to start: …" through its existing catch arm, and the
    /// TwinCAT worker exits non-zero. Armed on the accept thread instead (as it was), a name collision or an ACL
    /// denial killed the loop unobserved while the caller returned "Volt bridge started on pipe …" and the log said
    /// "ready": a success message, an invisible dead bridge, and nothing anywhere to read.
    /// <para>"anonymous" is the BCL's reserved anonymous-pipe name: the ONE bind failure forcible offline on any
    /// machine (<c>MaxAllowedServerInstances</c> is 255, so a same-name second listener does not fail). It faults the
    /// same <c>NamedPipeServerStream</c> construction a collision or a denial does, which is what this pins.</para></summary>
    [Fact]
    public void A_bridge_whose_pipe_cannot_be_bound_fails_Start_instead_of_reporting_ready()
    {
        using var host = new BridgePipeHost(
            new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;")), "anonymous");

        Assert.ThrowsAny<ArgumentException>(() => host.Start());
    }

    [Fact]
    public void A_coded_bridge_error_reaches_the_client_as_its_real_code_not_INTERNAL_ERROR()
    {
        var pipe = Pipe();
        using var host = new BridgePipeHost(new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;")), pipe);
        host.Start();

        // /fetch with no knownItems and not init → the service throws BridgeException(BAD_REQUEST). The wire must
        // carry that code through to PipeCallException.Code (it used to flatten every error to INTERNAL_ERROR).
        var ex = Assert.Throws<PipeCallException>(() => new PipeClient(pipe).Call("fetch", new { }));
        Assert.Equal("BAD_REQUEST", ex.Code);
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

        // The asked-for name is the PROJECT the fake serves (`HealthProjectName`, default "FakeProject") — this
        // used to pass "P", which is the POU ITEM's name, and only passed because nothing compared the two.
        var r = new PipeClient(pipe).Call("connect", new { project = "FakeProject" });
        Assert.True(r.GetProperty("ok").GetBoolean());
    }

    /// <summary>The other half of that same post-condition, and the parity point: a connect for a project the bridge
    /// is NOT serving must be refused, on BOTH vendors. Reading `IsConnected` alone let CODESYS answer ok for a name
    /// it does not serve (its select is a no-op refresh of its one primary project) while TwinCAT refused — a
    /// per-vendor difference a pipe client can observe, and the reason the live suite vendor-branched around it. The
    /// connector then marked a green row for a project the first push refuses WRONG_PROJECT against.</summary>
    [Fact]
    public void Connect_to_a_project_the_bridge_does_not_serve_is_refused()
    {
        var pipe = Pipe();
        // The select ATTACHES fine (SelectConnects stays true) — the bridge is connected and serving "Demo". The
        // only thing wrong is that the caller asked for something else, which is exactly the gap: nothing about
        // `IsConnected` can see it.
        var ide = new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;")) { HealthProjectName = "Demo" };
        using var host = new BridgePipeHost(ide, pipe);
        host.Start();

        var ex = Assert.Throws<PipeCallException>(() =>
            new PipeClient(pipe).Call("connect", new { project = "SomeOtherProject" }));
        Assert.Equal("PLC_DISCONNECTED", ex.Code);
    }

    /// <summary>What `_paused` is after a REFUSED connect, stated as a test rather than left to be discovered: the
    /// bridge stays RESUMED. `connect` un-pauses BEFORE the IDE work on purpose (a `disconnect` that lands mid-select
    /// must win), so a refusal does not restore the gate — the caller sees PLC_DISCONNECTED, and the bridge is
    /// serving again. The way back is another `connect`, which is unaffected: the empty/absent-project select still
    /// resumes (Disconnect_refuses_sync_until_the_next_connect_but_leaves_the_host_serving_health covers that).</summary>
    [Fact]
    public void A_refused_connect_still_resumes_the_bridge_the_pause_gate_is_not_restored()
    {
        var pipe = Pipe();
        var ide = new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;")) { HealthProjectName = "Demo" };
        using var host = new BridgePipeHost(ide, pipe);
        host.Start();

        new PipeClient(pipe).Call("disconnect");
        Assert.Equal("PLC_DISCONNECTED",
            Assert.Throws<PipeCallException>(() => new PipeClient(pipe).Call("refs")).Code);

        Assert.Equal("PLC_DISCONNECTED",
            Assert.Throws<PipeCallException>(() =>
                new PipeClient(pipe).Call("connect", new { project = "SomeOtherProject" })).Code);

        new PipeClient(pipe).Call("refs");   // un-paused by the refused connect — the gate was not restored
        Assert.True(AnyServing(pipe));
    }

    /// <summary>Every project-touching op on a bridge with nothing bound is refused with the SHARED PLC_DISCONNECTED,
    /// enforced once in Core — not each driver faulting its own way (CODESYS "no Application", TwinCAT a COM error)
    /// into a generic INTERNAL_ERROR. Same guarantee on both vendors because the check is above the seam.</summary>
    [Theory]
    [InlineData("refs")]
    [InlineData("fetch")]
    [InlineData("push")]
    [InlineData("build")]
    public void A_project_op_on_a_not_connected_bridge_is_refused_with_PLC_DISCONNECTED(string op)
    {
        var pipe = Pipe();
        using var host = new BridgePipeHost(
            new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;")) { HealthConnected = false }, pipe);
        host.Start();

        // Each op's own body: `knownItems` is a member of `refs` and `fetch` only, and a body is read strictly.
        object body = op is "refs" or "fetch" ? new { knownItems = new Dictionary<string, string>() } : new { };
        var ex = Assert.Throws<PipeCallException>(() => new PipeClient(pipe).Call(op, body));
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

    /// <summary>A FRAME THE CALLER MIS-SPELLED IS THE CALLER'S FAULT, and the bridge says so.
    ///
    /// <para>`PipeServer` stamps any exception that is not an <c>ICodedError</c> as INTERNAL_ERROR, and a
    /// <c>JsonException</c> from the envelope parse is not one — so a client that sent a truncated line, or a
    /// body of the wrong shape, was told the BRIDGE had failed and went looking at the IDE. The five codes that
    /// exist to describe a bad request described none of it.</para>
    ///
    /// <para>Both halves are here because they are refused in two different files: the envelope by
    /// <c>PipeServer</c> (which cannot see the Engine, hence <c>Volt.Contracts.CodedException</c>) and the body
    /// by <c>BridgePipeHost.Body&lt;T&gt;</c>.</para></summary>
    [Fact]
    public void A_malformed_frame_or_body_is_a_coded_BAD_REQUEST()
    {
        var pipe = Pipe();
        using var host = new BridgePipeHost(new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;")), pipe);
        host.Start();

        Assert.Equal("BAD_REQUEST", RawErrorCode(pipe, @"{""op"":""refs"",""body"":"));
        Assert.Equal("BAD_REQUEST", RawErrorCode(pipe, @"{""op"":""push"",""body"":{""ops"":4}}"));
    }

    /// <summary>A PUSH OP IN A RETIRED SPELLING IS REFUSED BY NAME (openspec <c>multi-application-tree</c>, gate review of
    /// step 3a, finding 1). The path wire has one destination field, <c>to</c>; a client still sending <c>toFolder</c> or
    /// <c>toName</c> was answered as if the field were absent — the bare name read as an item at the tree root, so the
    /// create landed in the CODESYS POU pool (or was refused on TwinCAT) and nothing named the stale field.</summary>
    [Theory]
    [InlineData("toFolder")]
    [InlineData("toName")]
    public void A_set_op_carrying_a_field_the_wire_does_not_have_is_a_BAD_REQUEST_naming_it(string field)
    {
        var pipe = Pipe();
        using var host = new BridgePipeHost(new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;")), pipe);
        host.Start();

        var op = new Dictionary<string, object?> { ["op"] = "set", ["name"] = "X.pou", [field] = "POUs", ["sourceText"] = "x", ["ifVersion"] = null };
        var ex = Assert.Throws<PipeCallException>(() => new PipeClient(pipe).Call("push", new { ops = new[] { op } }));
        Assert.Equal("BAD_REQUEST", ex.Code);
        Assert.Contains(field, ex.Message);
    }

    /// <summary>EVERY REQUEST BODY REFUSES A MEMBER ITS OP DOES NOT HAVE (openspec <c>refuse-unknown-request-members</c>).
    /// A folder-wire client's <c>knownFolders</c> was dropped in silence, and its root-keyed <c>knownItems</c> then read
    /// every item outside the root as removed; a recorder's deleted <c>buildType</c> reached nothing. One strict read
    /// answers each with BAD_REQUEST naming the op and the member, before the walk, the apply or the build.</summary>
    [Theory]
    [InlineData("fetch", @"{""knownItems"":{},""knownFolders"":{}}", "knownFolders")]
    [InlineData("refs", @"{""knownItems"":{},""knownFolders"":{}}", "knownFolders")]
    [InlineData("build", @"{""buildType"":""full""}", "buildType")]
    [InlineData("grep", @"{""pattern"":""x"",""regex"":true}", "regex")]
    [InlineData("connect", @"{""x"":1}", "x")]
    [InlineData("push", @"{""ops"":[],""x"":1}", "x")]
    [InlineData("fetch", @"{""KnownItems"":{}}", "KnownItems")]
    [InlineData("push", @"{""ops"":[{""name"":""P.pou""}]}", "push")]
    [InlineData("push", @"{""ops"":[{""name"":""P.pou"",""x"":1,""op"":""set""}]}", "x")]
    [InlineData("push", @"{""ops"":[{""name"":""P.pou"",""Op"":""set""}]}", "push")]
    public void A_request_body_member_the_op_does_not_have_is_a_BAD_REQUEST_naming_the_op_and_the_member(
        string op, string body, string member)
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"));
        var pipe = Pipe();
        using var host = new BridgePipeHost(ide, pipe);
        host.Start();

        var error = RawError(pipe, $@"{{""op"":""{op}"",""body"":{body}}}");

        Assert.Equal("BAD_REQUEST", error.Code);
        Assert.Contains($"`{op}`", error.Message);
        Assert.Contains(member, error.Message);
        Assert.Equal(0, ide.WalkCalls);
        Assert.Empty(ide.BuildSequence);
        Assert.Null(ide.Selected);
    }

    /// <summary>A BUILD NAMES ITS APPLICATIONS ON THE WIRE (openspec <c>build-selects-application</c> 2.1-2.2): a root
    /// <c>refs</c> published reaches the driver as the one application to build, and a root the project does not hold is a
    /// BAD_REQUEST frame naming it, with nothing built.</summary>
    [Fact]
    public void A_build_names_its_applications_over_the_pipe_and_an_unknown_root_is_a_BAD_REQUEST_naming_it()
    {
        const string app = "Device/Plc Logic/Application";
        var ide = new FakeIde(FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;", app))
        { HealthPlatform = "codesys", HealthProjectName = "Demo" };
        ide.ContainerKinds["Device"] = Volt.Engine.Item.ItemKind.Device;
        ide.ContainerKinds["Device/Plc Logic"] = Volt.Engine.Item.ItemKind.PlcLogic;
        ide.ContainerKinds[app] = Volt.Engine.Item.ItemKind.Application;
        var pipe = Pipe();
        using var host = new BridgePipeHost(ide, pipe);
        host.Start();
        const string bound = @"""expectedPlatform"":""codesys"",""expectedProjectName"":""Demo""";

        var error = RawError(pipe, $@"{{""op"":""build"",""body"":{{{bound},""applications"":[""Device_1/Plc Logic/Application""]}}}}");
        Assert.Equal("BAD_REQUEST", error.Code);
        Assert.Contains("'Device_1/Plc Logic/Application'", error.Message);
        Assert.Empty(ide.BuildSequence);

        var built = RawTerminal(pipe, $@"{{""op"":""build"",""body"":{{{bound},""applications"":[""{app}""]}}}}");
        Assert.True(built.GetProperty("result").GetProperty("success").GetBoolean());
        Assert.Equal(new[] { app }, Assert.Single(ide.BuiltApplications));
    }

    /// <summary>The envelope and the responses read their members by their exact name, as request bodies do: a
    /// PascalCase spelling has no sender, and accepting it gave every member two spellings.</summary>
    [Fact]
    public void A_miscased_member_of_the_envelope_or_a_response_is_not_read()
    {
        var pipe = Pipe();
        using var host = new BridgePipeHost(new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;")), pipe);
        host.Start();

        var error = RawError(pipe, @"{""Op"":""health""}");
        Assert.Equal("BAD_REQUEST", error.Code);

        var health = JsonSerializer.Deserialize<HealthResponse>(@"{""BridgeVersion"":""9.9.9""}", WireJson.Read)!;
        Assert.Null(health.BridgeVersion);
    }

    /// <summary>A REQUEST FRAME HAS A SIZE CAP (<see cref="PipeServer.MaxFrameBytes"/>). The frame is read into memory
    /// before it is parsed, and on CODESYS that memory is the IDE's own process: a client that streams bytes with no
    /// newline used to grow the buffer without bound. Past the cap the server answers BAD_REQUEST naming the cap,
    /// closes the connection, and keeps serving.</summary>
    [Fact]
    public async Task A_request_frame_over_the_size_cap_is_a_BAD_REQUEST_and_the_bridge_keeps_serving()
    {
        var pipe = Pipe();
        using var host = new BridgePipeHost(new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;")), pipe);
        host.Start();

        using (var client = new System.IO.Pipes.NamedPipeClientStream(".", pipe, System.IO.Pipes.PipeDirection.InOut,
                   System.IO.Pipes.PipeOptions.Asynchronous))
        {
            client.Connect(5000);
            // Writes past the cap with no newline, until the server closes the connection under it.
            var flood = Task.Run(async () =>
            {
                var chunk = new byte[1 << 20];
                Array.Fill(chunk, (byte)'x');
                try
                {
                    for (long sent = 0; sent <= PipeServer.MaxFrameBytes + chunk.Length; sent += chunk.Length)
                        await client.WriteAsync(chunk, 0, chunk.Length);
                }
                catch (System.IO.IOException) { /* the server closed the connection: expected */ }
                catch (ObjectDisposedException) { }
            });

            var buf = new byte[64 * 1024];
            var answer = new System.IO.MemoryStream();
            var read = Task.Run(async () =>
            {
                int n;
                while ((n = await client.ReadAsync(buf, 0, buf.Length)) > 0)
                {
                    answer.Write(buf, 0, n);
                    if (Array.IndexOf(buf, (byte)'\n', 0, n) >= 0) break;
                }
            });
            await read.WaitAsync(TimeSpan.FromSeconds(30));   // TimeoutException: the bridge never answered
            var raw = System.Text.Encoding.UTF8.GetString(answer.ToArray()).Trim();
            using var doc = JsonDocument.Parse(raw);
            var err = doc.RootElement.GetProperty("error");
            Assert.Equal("BAD_REQUEST", err.GetProperty("code").GetString());
            Assert.Contains(PipeServer.MaxFrameBytes.ToString(System.Globalization.CultureInfo.InvariantCulture),
                err.GetProperty("message").GetString());
            await flood.WaitAsync(TimeSpan.FromSeconds(30));  // TimeoutException: the connection was not closed
        }

        // The process did not fall over and the server still answers.
        Assert.True(new PipeClient(pipe).Call("health").TryGetProperty("projects", out _));
    }

    /// <summary>A PUSH OP'S <c>op</c> MAY STAND ANYWHERE IN ITS OBJECT (volt-cli-rework 1.0, finding (e)). JSON members
    /// are unordered, and the serializer's polymorphism default read the discriminator only as the FIRST member, so a
    /// client that wrote <c>op</c> last was refused BAD_REQUEST by a rule no document stated. Strictness otherwise holds:
    /// an unknown member and a miscased one are still refused (the theories above).</summary>
    [Fact]
    public void A_push_op_whose_discriminator_comes_last_is_accepted_and_applied()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"));
        var pipe = Pipe();
        using var host = new BridgePipeHost(ide, pipe);
        host.Start();

        var frame = RawTerminal(pipe,
            @"{""op"":""push"",""body"":{""ops"":[{""name"":""Q.pou"",""ifVersion"":null," +
            @"""sourceText"":""PROGRAM Q\nVAR\nEND_VAR\nIMPLEMENTATION ST\nx := 1;\nEND_PROGRAM\n"",""op"":""set""}]}}");

        Assert.True(frame.TryGetProperty("result", out var result), "expected a result frame, got: " + frame);
        Assert.True(result.GetProperty("accepted").GetBoolean(), "the push was not accepted: " + result);
        Assert.Contains(ide.CreatedItems, i => i.Contains('Q'));
    }

    /// <summary>Send ONE line exactly as given and answer the terminal frame (<c>result</c> or <c>error</c>).</summary>
    private static JsonElement RawTerminal(string pipe, string line)
    {
        using var client = new System.IO.Pipes.NamedPipeClientStream(".", pipe, System.IO.Pipes.PipeDirection.InOut);
        client.Connect(5000);
        var bytes = System.Text.Encoding.UTF8.GetBytes(line + "\n");
        client.Write(bytes, 0, bytes.Length);
        client.Flush();
        using var reader = new System.IO.StreamReader(client, System.Text.Encoding.UTF8);
        while (reader.ReadLine() is { } raw)
        {
            using var doc = JsonDocument.Parse(raw);
            if (!doc.RootElement.TryGetProperty("progress", out _)) return doc.RootElement.Clone();
        }
        throw new Xunit.Sdk.XunitException("the bridge answered no terminal frame to: " + line);
    }

    private static (string Code, string Message) RawError(string pipe, string line)
    {
        using var client = new System.IO.Pipes.NamedPipeClientStream(".", pipe, System.IO.Pipes.PipeDirection.InOut);
        client.Connect(5000);
        var bytes = System.Text.Encoding.UTF8.GetBytes(line + "\n");
        client.Write(bytes, 0, bytes.Length);
        client.Flush();
        using var reader = new System.IO.StreamReader(client, System.Text.Encoding.UTF8);
        var raw = reader.ReadLine() ?? throw new Xunit.Sdk.XunitException("the bridge answered nothing to: " + line);
        using var doc = JsonDocument.Parse(raw);
        if (!doc.RootElement.TryGetProperty("error", out var err))
            throw new Xunit.Sdk.XunitException("expected an error frame, got: " + raw);
        return (err.GetProperty("code").GetString()!, err.GetProperty("message").GetString()!);
    }

    /// <summary>Send ONE line exactly as given — no serializer between the test and the server, which is the
    /// whole point of a malformed-input test — and read the error code out of the frame that comes back. Reads
    /// the raw JSON rather than <c>PipeFrame</c>, which is internal to the wire and stays that way.</summary>
    private static string RawErrorCode(string pipe, string line) => RawError(pipe, line).Code;

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

        foreach (var op in new[] { "refs", "fetch", "push", "build" })
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

    /// <summary>
    /// ONE SERVER PER PIPE NAME. Windows does not enforce this: a second <c>NamedPipeServerStream</c> on a live
    /// name is another INSTANCE of the same pipe (the accept loop needs several, so the count cannot be capped at
    /// one), and the OS then hands each client connection to whichever instance is waiting. Two bridges answer
    /// the same name and a single client is split across both at random.
    ///
    /// Measured 2026-09-20 on TwinCAT, where `ide.ps1` and the connector tray each launched a worker on
    /// `volt.bridge.twincat.46264` from DIFFERENT builds: `connect` answered ok from one and the next `refs`
    /// answered PLC_DISCONNECTED from the other. Both comments that should have caught it asserted a name
    /// collision would fault at the bind — it never did, which is why nothing guarded it.
    /// </summary>
    [Fact]
    public void A_second_server_on_a_live_pipe_name_is_refused()
    {
        var pipe = "volt.test." + Guid.NewGuid().ToString("N");
        using var first = new BridgePipeHost(new FakeIde(Array.Empty<FakeIde.Item>()), pipe);
        first.Start();

        using var second = new BridgePipeHost(new FakeIde(Array.Empty<FakeIde.Item>()), pipe);
        var ex = Assert.ThrowsAny<Exception>(() => second.Start());
        Assert.Contains("already served", ex.Message);

        // and the name comes BACK, so a restart after a clean stop is not blocked by our own guard
        first.Stop();
        using var third = new BridgePipeHost(new FakeIde(Array.Empty<FakeIde.Item>()), pipe);
        third.Start();
    }
}
