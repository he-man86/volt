using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Volt.Contracts;
using Volt.Engine.Host;
using Volt.Relay;
using Volt.Wire;
using Xunit;

namespace Volt.Relay.Tests;

/// <summary>The relay's cancel (openspec relay-cancel-discarded-calls): <c>{"id":"r1","cancel":"timeout"|"caller_gone"}</c>
/// for a READ the relay no longer waits for. A queued read never starts, a running one finishes on the IDE and is not
/// answered, a streaming one stops after the chunk in flight and frees its window. A cancel for a write breaks the
/// contract: named, and the write runs and is answered as ever. Driven end to end — a real tunnel over a real pipe host,
/// only the socket faked.</summary>
public class RelayCancelTests : IDisposable
{
    private readonly List<IDisposable> _disposables = new();

    public void Dispose()
    {
        foreach (var d in _disposables) { try { d.Dispose(); } catch { } }
    }

    internal static FakeIde SmallIde() =>
        new(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"))
        {
            Projects = new List<ProjectEntry> { new("codesys", "Proj", "healthy", false) },
        };

    internal static (FakeRelay Relay, RelayTunnel Tunnel) Start(
        List<IDisposable> disposables, FakeIde ide, LogCapture log, Action<FakeRelay>? beforeStart = null,
        TimeSpan? pingEvery = null, TimeSpan? silenceLimit = null)
    {
        var pipe = "volt.test.relay." + Guid.NewGuid().ToString("N");
        var host = new BridgePipeHost(ide, pipe);
        host.Start();
        disposables.Add(host);

        var relay = new FakeRelay();
        beforeStart?.Invoke(relay);
        var config = RelaySidecar.Parse("{\"url\":\"wss://relay.test/bridge\",\"token\":\"t\"}", "test");
        var tunnel = new RelayTunnel(config, pipe, "codesys", "0.0.0-test", relay.NewSocket, null, log.Write, pingEvery, silenceLimit);
        disposables.Add(tunnel);
        tunnel.Start();
        Assert.True(relay.Connected.Wait(10_000), "the tunnel never dialed out");
        return (relay, tunnel);
    }

    internal static string Cancel(string id, string reason) =>
        "{\"id\":" + JsonSerializer.Serialize(id) + ",\"cancel\":" + JsonSerializer.Serialize(reason) + "}";

    internal static async Task Eventually(Func<bool> condition, string what, int timeoutMs = 15_000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            if (condition()) return;
            await Task.Delay(25);
        }
        throw new TimeoutException(what);
    }

    internal static async Task<string> AwaitTerminalLine(LogCapture log, string id, int timeoutMs = 15_000)
    {
        await Eventually(() => log.At(VoltLogLevel.Info).Any(l => l.StartsWith("relay: -> ") && l.Contains("(" + id + ")")),
            "no terminal line for " + id + ":\n" + log, timeoutMs);
        await Task.Delay(200);
        var lines = log.At(VoltLogLevel.Info).Where(l => l.StartsWith("relay: -> ") && l.Contains("(" + id + ")")).ToList();
        Assert.True(lines.Count == 1, "expected one terminal line for " + id + ", got:\n" + log);
        return lines[0];
    }

    internal static bool HasTerminalFrame(FakeRelay relay, string id) =>
        relay.FramesOf(id, "result").Count > 0 || relay.FramesOf(id, "error").Count > 0;

    private static readonly object PushBody = new
    {
        expectedPlatform = "codesys", expectedProjectName = "FakeProject",
        ops = new object[] { new { op = "set", name = "Z.pou", sourceText = "PROGRAM Z\nVAR\nEND_VAR\n%LANGUAGE ST\n;\nEND_PROGRAM\n" } },
    };

    // ── the frame ────────────────────────────────────────────────

    [Theory]
    [InlineData("timeout")]
    [InlineData("caller_gone")]
    public void A_cancel_frame_is_its_own_kind_with_its_id_and_reason(string reason)
    {
        var frame = RelayFrames.Read(Cancel("r1", reason));
        Assert.Equal(RelayInboundKind.Cancel, frame.Kind);
        Assert.Equal("r1", frame.Id);
        Assert.Equal(reason, frame.CancelReason);
    }

    [Theory]
    [InlineData("{\"cancel\":\"timeout\"}", "a cancel has no string `id`")]
    [InlineData("{\"id\":7,\"cancel\":\"timeout\"}", "a cancel has no string `id`")]
    [InlineData("{\"id\":\"r1\",\"cancel\":\"later\"}", "a cancel's `cancel` is not \"timeout\" or \"caller_gone\": \"later\"")]
    [InlineData("{\"id\":\"r1\",\"cancel\":1}", "a cancel's `cancel` is not \"timeout\" or \"caller_gone\": 1")]
    [InlineData("{\"id\":\"r1\",\"cancel\":null}", "a cancel's `cancel` is not \"timeout\" or \"caller_gone\": null")]
    public void A_malformed_cancel_is_refused_by_name(string text, string reason)
    {
        var frame = RelayFrames.Read(text);
        Assert.Equal(RelayInboundKind.Malformed, frame.Kind);
        Assert.Equal(reason, frame.Reason);
    }

    [Fact]
    public async Task A_malformed_cancel_is_a_named_warn_and_the_read_it_names_is_answered()
    {
        var log = new LogCapture();
        var (relay, _) = Start(_disposables, SmallIde(), log);
        await relay.AwaitHello();

        relay.Send("{\"id\":\"r1\",\"cancel\":\"later\"}");
        relay.SendRequest("r1", Ops.Refs);
        await relay.AwaitFrame("r1", "result");

        Assert.Contains("relay: ignoring a malformed frame — a cancel's `cancel` is not \"timeout\" or \"caller_gone\": \"later\"",
            log.At(VoltLogLevel.Warn));
        Assert.Matches(@"^relay: -> refs \(r1\) ok \d+ms$", await AwaitTerminalLine(log, "r1"));
    }

    // ── a read, by state ─────────────────────────────────────────

    /// <summary>Queued: the tunnel has the request and has not started its pipe call. It never starts.</summary>
    [Fact]
    public async Task A_read_cancelled_while_queued_never_reaches_the_pipe()
    {
        var walks = 0;
        var ide = SmallIde();
        ide.OnWalkItems = () => Interlocked.Increment(ref walks);
        var log = new LogCapture();
        var (relay, tunnel) = Start(_disposables, ide, log);
        await relay.AwaitHello();

        var held = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var queued = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        tunnel.BeforePipeCall = id => { if (id != "r1") return Task.CompletedTask; queued.TrySetResult(true); return held.Task; };

        relay.SendRequest("r1", Ops.Refs);
        Assert.True(await Task.WhenAny(queued.Task, Task.Delay(15_000)) == queued.Task, "r1 never reached the queue");
        relay.Send(Cancel("r1", "timeout"));
        // The cancel is read before the hold is released: a frame read after it proves the receive loop got that far.
        relay.SendRequest("h", Ops.Health);
        await relay.AwaitFrame("h", "result");
        held.SetResult(true);

        Assert.Matches(@"^relay: -> refs \(r1\) cancelled \(timeout\) \d+ms$", await AwaitTerminalLine(log, "r1"));
        Assert.Equal(0, Volatile.Read(ref walks));
        Assert.False(HasTerminalFrame(relay, "r1"), "a cancelled read was answered:\n" + string.Join("\n", relay.Received));

        // The counter counts: an uncancelled refs walks.
        relay.SendRequest("r2", Ops.Refs);
        await relay.AwaitFrame("r2", "result");
        Assert.Equal(1, Volatile.Read(ref walks));
    }

    /// <summary>Running: the IDE call is never interrupted. It finishes, and nothing is sent for the id.</summary>
    [Fact]
    public async Task A_read_cancelled_while_running_finishes_on_the_IDE_and_is_not_answered()
    {
        var entered = new ManualResetEventSlim(false);
        var release = new ManualResetEventSlim(false);
        var walked = 0;
        var ide = SmallIde();
        var log = new LogCapture();
        var (relay, _) = Start(_disposables, ide, log);
        await relay.AwaitHello();
        ide.OnWalkItems = () => { entered.Set(); release.Wait(TimeSpan.FromSeconds(30)); Interlocked.Increment(ref walked); };

        relay.SendRequest("r1", Ops.Refs);
        Assert.True(entered.Wait(15_000), "the refs never reached its walk");
        relay.Send(Cancel("r1", "caller_gone"));
        relay.SendRequest("h", Ops.Health);
        await relay.AwaitFrame("h", "result");
        Assert.DoesNotContain(log.At(VoltLogLevel.Info), l => l.StartsWith("relay: -> refs (r1)"));

        release.Set();
        Assert.Matches(@"^relay: -> refs \(r1\) cancelled \(caller_gone\) \d+ms$", await AwaitTerminalLine(log, "r1"));
        Assert.Equal(1, Volatile.Read(ref walked));
        Assert.False(HasTerminalFrame(relay, "r1"), "a cancelled read was answered:\n" + string.Join("\n", relay.Received));
        Assert.Empty(log.At(VoltLogLevel.Warn));
    }

    [Fact]
    public async Task A_cancel_for_an_unknown_id_is_a_debug_line_and_nothing_else()
    {
        var log = new LogCapture();
        var (relay, _) = Start(_disposables, SmallIde(), log);
        await relay.AwaitHello();

        relay.Send(Cancel("nobody", "timeout"));
        relay.SendRequest("h", Ops.Health);
        await relay.AwaitFrame("h", "result");
        await AwaitTerminalLine(log, "h");

        Assert.Contains("relay: ignoring a cancel for nobody — no request of that id is in flight on this connection",
            log.At(VoltLogLevel.Debug));
        Assert.Empty(log.At(VoltLogLevel.Warn));
    }

    [Fact]
    public async Task A_cancel_for_a_finished_read_is_a_debug_line_and_nothing_else()
    {
        var log = new LogCapture();
        var (relay, _) = Start(_disposables, SmallIde(), log);
        await relay.AwaitHello();

        relay.SendRequest("r1", Ops.Refs);
        await relay.AwaitFrame("r1", "result");
        Assert.Matches(@"^relay: -> refs \(r1\) ok \d+ms$", await AwaitTerminalLine(log, "r1"));

        relay.Send(Cancel("r1", "timeout"));
        await Eventually(() => log.At(VoltLogLevel.Debug).Contains(
            "relay: ignoring a cancel for r1 — no request of that id is in flight on this connection"), "no debug line:\n" + log);
        Assert.Single(log.At(VoltLogLevel.Info), l => l.StartsWith("relay: -> refs (r1)"));
        Assert.Empty(log.At(VoltLogLevel.Warn));
    }

    // ── a write is never cancelled ───────────────────────────────

    [Fact]
    public async Task A_cancel_for_a_push_is_a_named_warn_and_the_push_runs_to_its_end_and_is_answered()
    {
        var entered = new ManualResetEventSlim(false);
        var release = new ManualResetEventSlim(false);
        var ide = SmallIde();
        var log = new LogCapture();
        var (relay, _) = Start(_disposables, ide, log);
        await relay.AwaitHello();
        ide.OnWalkItems = () => { entered.Set(); release.Wait(TimeSpan.FromSeconds(30)); };

        relay.SendRequest("p1", Ops.Push, PushBody);
        Assert.True(entered.Wait(15_000), "the push never reached its walk");
        relay.Send(Cancel("p1", "timeout"));
        await Eventually(() => log.At(VoltLogLevel.Warn).Any(l => l.Contains("(p1)")), "no warn for the push's cancel:\n" + log);
        release.Set();

        var result = await relay.AwaitFrame("p1", "result");
        Assert.True(result.TryGetProperty("newProjectVersion", out _), "the push did not land: " + result.GetRawText());
        Assert.Matches(@"^relay: -> push \(p1\) ok landed newProjectVersion=\S+ \d+ms$", await AwaitTerminalLine(log, "p1"));
        Assert.Equal(new[]
        {
            "relay: a cancel for push (p1) breaks the contract — the relay cancels reads only; the push runs to its end and is answered",
        }, log.At(VoltLogLevel.Warn));
    }

    [Fact]
    public async Task A_cancel_for_a_build_is_a_named_warn_and_the_build_runs_to_its_end_and_is_answered()
    {
        var entered = new ManualResetEventSlim(false);
        var release = new ManualResetEventSlim(false);
        var ide = new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"))
        {
            Projects = new List<ProjectEntry> { new("codesys", "Proj", "healthy", false) },
            BuildEntered = entered,
            BuildBlock = release,
        };
        var log = new LogCapture();
        var (relay, _) = Start(_disposables, ide, log);
        await relay.AwaitHello();

        relay.SendRequest("b1", Ops.Build, new { expectedPlatform = "codesys", expectedProjectName = "FakeProject" });
        Assert.True(entered.Wait(15_000), "the build never started");
        relay.Send(Cancel("b1", "caller_gone"));
        await Eventually(() => log.At(VoltLogLevel.Warn).Any(l => l.Contains("(b1)")), "no warn for the build's cancel:\n" + log);
        release.Set();

        await relay.AwaitFrame("b1", "result");
        Assert.Matches(@"^relay: -> build \(b1\) ok \d+ms$", await AwaitTerminalLine(log, "b1"));
        Assert.Equal(new[] { "build" }, ide.BuildSequence);
        Assert.Equal(new[]
        {
            "relay: a cancel for build (b1) breaks the contract — the relay cancels reads only; the build runs to its end and is answered",
        }, log.At(VoltLogLevel.Warn));
    }

    // ── a relay that never cancels ──────────────────────────────

    [Fact]
    public async Task A_relay_that_never_cancels_is_served_as_before()
    {
        var log = new LogCapture();
        var (relay, _) = Start(_disposables, ChunkedCancelTests.BigIde(), log, r => { r.AutoAck = true; r.Announce(); });
        await relay.AwaitHello();

        relay.SendRequest("r1", Ops.Refs);
        relay.SendRequest("f1", Ops.Fetch, new { init = true });
        relay.SendRequest("p1", Ops.Push, PushBody);
        await relay.AwaitFrame("r1", "result");
        await relay.AwaitReassembled("f1");
        await relay.AwaitFrame("p1", "result");

        Assert.Matches(@"^relay: -> refs \(r1\) ok \d+ms$", await AwaitTerminalLine(log, "r1"));
        Assert.Matches(@"^relay: -> fetch \(f1\) ok \d+ms, \d+ B as \d+ chunks$", await AwaitTerminalLine(log, "f1"));
        Assert.Matches(@"^relay: -> push \(p1\) ok landed newProjectVersion=\S+ \d+ms$", await AwaitTerminalLine(log, "p1"));
        Assert.DoesNotContain(log.Lines, l => l.Message.Contains("cancel"));
        Assert.Empty(log.At(VoltLogLevel.Warn));
    }
}

/// <summary>A cancel while a read's answer streams as chunks. It times the tunnel's ack watchdog (a short silence limit),
/// so it runs alone (see <see cref="TunnelClockCollection"/>).</summary>
[Collection(TunnelClockCollection.Name)]
public sealed class ChunkedCancelTests : IDisposable
{
    private readonly List<IDisposable> _disposables = new();

    public void Dispose()
    {
        foreach (var d in _disposables) { try { d.Dispose(); } catch { } }
    }

    /// <summary>A project whose fetch answer spans many 8 KiB chunks (random base64 compresses poorly).</summary>
    internal static FakeIde BigIde(int randomBytes = 90_000)
    {
        var noise = new byte[randomBytes];
        new Random(42).NextBytes(noise);
        return new FakeIde(
            FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"),
            FakeIde.Item.TextualPou("Big", "PROGRAM Big\nVAR\nEND_VAR", "(* " + Convert.ToBase64String(noise) + " *)\nx := 1;"))
        {
            Projects = new List<ProjectEntry> { new("codesys", "Proj", "healthy", false) },
        };
    }

    /// <summary>The 2 KB/s gate's case: the relay gave up on a large fetch while it streamed. The bridge stops after the
    /// chunk in flight, frees the window for other ids, and the chunks it sent and the relay never acks do not trip the
    /// ack watchdog — the relay owes nothing for an answer it cancelled.</summary>
    [Fact]
    public async Task A_read_cancelled_while_streaming_stops_frees_the_window_and_is_not_held_against_the_connection()
    {
        var log = new LogCapture();
        var (relay, _) = RelayCancelTests.Start(_disposables, BigIde(), log, r => r.Announce(),
            pingEvery: TimeSpan.FromMilliseconds(100), silenceLimit: TimeSpan.FromMilliseconds(800));
        await relay.AwaitHello();
        // The relay keeps talking, so only an ack the bridge waits for could end the connection.
        using var talking = new CancellationTokenSource();
        var pongs = Task.Run(async () =>
        {
            while (!talking.IsCancellationRequested) { relay.Send(RelayFrames.Pong); await Task.Delay(50); }
        });

        relay.SendRequest("f1", Ops.Fetch, new { init = true });
        // No acks: the window floor (16 KiB) holds two 8 KiB chunks.
        await RelayCancelTests.Eventually(() => relay.ChunksOf("f1").Count == 2, "the floor's two chunks never arrived:\n" + log);
        var count = relay.ChunksOf("f1")[0].Header.GetProperty("count").GetInt32();
        Assert.True(count > 2, "the answer fits the floor; the test needs one that does not");

        relay.Send(RelayCancelTests.Cancel("f1", "timeout"));
        var line = await RelayCancelTests.AwaitTerminalLine(log, "f1");
        Assert.Matches(@"^relay: -> fetch \(f1\) cancelled \(timeout\) after 2 of " + count + @" chunks \d+ms$", line);

        // Another id's chunked answer gets the whole window, though f1's two chunks are never acked.
        relay.AutoAck = true;
        relay.SendRequest("f2", Ops.Fetch, new { init = true });
        await relay.AwaitReassembled("f2");
        Assert.Matches(@"^relay: -> fetch \(f2\) ok \d+ms, \d+ B as \d+ chunks$", await RelayCancelTests.AwaitTerminalLine(log, "f2"));

        // Past the ack limit (800 ms, checked every 100 ms): f1's unacked chunks did not drop the connection.
        await Task.Delay(1500);
        Assert.Equal(2, relay.ChunksOf("f1").Count);
        Assert.DoesNotContain("abort", relay.SocketEvents);
        Assert.DoesNotContain(log.Lines, l => l.Message.StartsWith("relay: connection on "));

        // The relay's late acks of the two chunks it got are expected, not "an ack for nothing".
        relay.Ack("f1", 0);
        relay.Ack("f1", 1);
        relay.SendRequest("h", Ops.Health);
        await relay.AwaitFrame("h", "result");
        talking.Cancel();
        await pongs;

        Assert.False(RelayCancelTests.HasTerminalFrame(relay, "f1"), "a cancelled read was answered");
        Assert.Empty(log.At(VoltLogLevel.Warn));
    }
}
