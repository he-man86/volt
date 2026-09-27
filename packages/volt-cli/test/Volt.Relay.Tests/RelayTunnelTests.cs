using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Volt.Contracts;
using Volt.Engine.Host;
using Volt.Relay;
using Volt.Wire;
using Xunit;

namespace Volt.Relay.Tests;

/// <summary>
/// The tunnel, driven end to end: a real <see cref="RelayTunnel"/> against a real
/// <see cref="BridgePipeHost"/> over a real named pipe, with only the SOCKET faked.
///
/// <para>That split is the point. The claim this whole design rests on is "a tunneled request is an ordinary
/// pipe call, so every guard already applies" — and a test that mocked the pipe would assert that claim
/// against itself.</para>
/// </summary>
public class RelayTunnelTests : IDisposable
{
    private readonly List<IDisposable> _disposables = new();

    private static string PipeName() => "volt.test.relay." + Guid.NewGuid().ToString("N");

    private (FakeRelay Relay, RelayTunnel Tunnel, FakeIde Ide) Start(FakeIde? ide = null) =>
        Start(out _, ide);

    private (FakeRelay Relay, RelayTunnel Tunnel, FakeIde Ide) Start(
        out string pipeName,
        FakeIde? ide = null,
        FakeDelay? delay = null,
        LogCapture? log = null)
    {
        ide ??= new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"))
        {
            Projects = new List<ProjectEntry> { new("codesys", "0", "Proj", "healthy", false) },
        };

        var pipe = PipeName();
        pipeName = pipe;
        var host = new BridgePipeHost(ide, pipe);
        host.Start();
        _disposables.Add(host);

        var relay = new FakeRelay();
        var config = RelaySidecar.Parse("{\"url\":\"wss://relay.test/bridge\",\"token\":\"t\"}", "test");
        var tunnel = new RelayTunnel(config, pipe, "codesys", "0.0.0-test", relay.NewSocket,
            delay == null ? null : delay.Delay,
            log == null ? null : log.Write);
        _disposables.Add(tunnel);
        tunnel.Start();

        Assert.True(relay.Connected.Wait(10_000), "the tunnel never dialed out");
        return (relay, tunnel, ide);
    }

    public void Dispose()
    {
        foreach (var d in _disposables) { try { d.Dispose(); } catch { } }
    }

    // ── handshake ────────────────────────────────────────────────

    [Fact]
    public async Task Announces_itself_before_anything_else()
    {
        var (relay, _, _) = Start();
        var hello = await relay.AwaitHello();

        Assert.Equal(1, hello.GetProperty("protocol").GetInt32());
        Assert.Equal("codesys", hello.GetProperty("vendor").GetString());
        Assert.False(string.IsNullOrEmpty(hello.GetProperty("pipe").GetString()));

        // FIRST, not merely present: a relay routes on `hello` and anything before it has nowhere to go.
        using var first = JsonDocument.Parse(relay.Received[0]);
        Assert.True(first.RootElement.TryGetProperty("hello", out _),
            "the first frame was not hello: " + relay.Received[0]);
    }

    // ── the allowlist ────────────────────────────────────────────

    [Theory]
    [InlineData("connect")]
    [InlineData("disconnect")]
    public async Task A_remote_party_cannot_rebind_the_served_project(string op)
    {
        var (relay, _, ide) = Start();
        await relay.AwaitHello();
        var servedBefore = ide.ServedProjectName;

        relay.SendRequest("r1", op, new { project = "SomethingElse" });
        var error = await relay.AwaitFrame("r1", "error");

        Assert.Equal(BridgeErrorCodes.BadRequest, error.GetProperty("code").GetString());
        // The refusal happens before the pipe, so the bridge is still serving what it was.
        Assert.Equal(servedBefore, ide.ServedProjectName);
    }

    [Fact]
    public async Task An_unknown_op_is_refused_without_touching_the_pipe()
    {
        var (relay, _, _) = Start();
        await relay.AwaitHello();

        relay.SendRequest("r1", "rm -rf");
        var error = await relay.AwaitFrame("r1", "error");
        Assert.Equal(BridgeErrorCodes.BadRequest, error.GetProperty("code").GetString());
    }

    // ── the happy path, and progress ─────────────────────────────

    [Fact]
    public async Task A_read_op_round_trips_through_the_real_pipe()
    {
        var (relay, _, _) = Start();
        await relay.AwaitHello();

        relay.SendRequest("r1", Ops.Health);
        var result = await relay.AwaitFrame("r1", "result");
        Assert.True(result.TryGetProperty("projects", out var projects));
        Assert.Equal(1, projects.GetArrayLength());
    }

    /// <summary>Progress frames arrive BEFORE the terminal frame and carry the same id. A relay demultiplexes
    /// on id alone, so a progress frame that arrived after its result would be attributed to nothing.</summary>
    [Fact]
    public async Task Progress_frames_precede_the_result_and_carry_the_id()
    {
        var (relay, _, _) = Start();
        await relay.AwaitHello();

        relay.SendRequest("r1", Ops.Fetch, new { init = true });
        await relay.AwaitFrame("r1", "result");

        int firstProgress = -1, terminal = -1;
        var frames = relay.Received;
        for (var i = 0; i < frames.Count; i++)
        {
            using var doc = JsonDocument.Parse(frames[i]);
            var root = doc.RootElement;
            if (!root.TryGetProperty("id", out var id) || id.GetString() != "r1") continue;
            if (root.TryGetProperty("progress", out _) && firstProgress < 0) firstProgress = i;
            if (root.TryGetProperty("result", out _)) terminal = i;
        }

        Assert.True(firstProgress >= 0, "a fetch sent no progress at all");
        Assert.True(firstProgress < terminal,
            "a progress frame arrived after the terminal frame — a relay would attribute it to nothing");
    }

    // ── concurrency: the property the tunnel exists for ──────────

    /// <summary>`health` answers while a long op holds the IDE thread. This is the whole reason a tunneled
    /// request gets its own pipe connection; serialize them and a hosted client cannot tell a busy bridge from
    /// a lost one.</summary>
    [Fact]
    public async Task Health_answers_while_a_long_op_holds_the_IDE_thread()
    {
        var entered = new ManualResetEventSlim(false);
        var release = new ManualResetEventSlim(false);
        var ide = new FakeIde(serializeSta: true,
            FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"))
        {
            ExtractEntered = entered,
            ExtractBlock = release,
            Projects = new List<ProjectEntry> { new("codesys", "0", "Proj", "healthy", false) },
        };

        var (relay, _, _) = Start(ide);
        await relay.AwaitHello();

        relay.SendRequest("slow", Ops.Fetch, new { init = true });
        Assert.True(entered.Wait(15_000), "the fetch never reached the blocking step");

        relay.SendRequest("fast", Ops.Health);
        var health = await relay.AwaitFrame("fast", "result");
        Assert.True(health.TryGetProperty("projects", out _));

        release.Set();
        await relay.AwaitFrame("slow", "result");
    }

    // ── errors ───────────────────────────────────────────────────

    /// <summary>A coded bridge error crosses as its own code. The tunnel adds no vocabulary: a client matches
    /// the same strings it would over a local pipe.</summary>
    [Fact]
    public async Task A_bridge_error_crosses_with_its_code_intact()
    {
        var ide = new FakeIde { HealthConnected = false };
        var (relay, _, _) = Start(ide);
        await relay.AwaitHello();

        relay.SendRequest("r1", Ops.Refs);
        var error = await relay.AwaitFrame("r1", "error");
        Assert.Equal(BridgeErrorCodes.PlcDisconnected, error.GetProperty("code").GetString());
        Assert.False(string.IsNullOrEmpty(error.GetProperty("message").GetString()));
    }

    /// <summary>Every accepted id gets exactly ONE terminal frame. A second would settle a request the relay
    /// has already answered its caller about.</summary>
    [Fact]
    public async Task Exactly_one_terminal_frame_per_request()
    {
        var (relay, _, _) = Start();
        await relay.AwaitHello();

        relay.SendRequest("r1", Ops.Health);
        await relay.AwaitFrame("r1", "result");
        await Task.Delay(500);

        var terminals = 0;
        foreach (var raw in relay.Received)
        {
            using var doc = JsonDocument.Parse(raw);
            var root = doc.RootElement;
            if (!root.TryGetProperty("id", out var id) || id.GetString() != "r1") continue;
            if (root.TryGetProperty("result", out _) || root.TryGetProperty("error", out _)) terminals++;
        }
        Assert.Equal(1, terminals);
    }

    /// <summary>A frame the bridge cannot parse is logged and dropped, NOT fatal. Closing the socket over one
    /// bad frame would abandon every request in flight.</summary>
    [Fact]
    public async Task A_malformed_frame_does_not_take_the_connection_down()
    {
        var (relay, _, _) = Start();
        await relay.AwaitHello();

        relay.Send("{not json at all");
        relay.Send("{\"op\":\"health\"}");          // a request with no id: nowhere to answer
        relay.SendRequest("r1", Ops.Health);       // ...and the tunnel still serves this

        var result = await relay.AwaitFrame("r1", "result");
        Assert.True(result.TryGetProperty("projects", out _));
    }

    // ── liveness ─────────────────────────────────────────────────

    [Fact]
    public async Task Reconnects_after_the_socket_drops()
    {
        var (relay, _, _) = Start();
        await relay.AwaitHello();
        Assert.Equal(1, relay.ConnectAttempts);

        relay.DropSocket!();

        var deadline = DateTime.UtcNow.AddSeconds(20);
        while (relay.ConnectAttempts < 2 && DateTime.UtcNow < deadline) await Task.Delay(100);
        Assert.True(relay.ConnectAttempts >= 2,
            "the tunnel did not redial after the socket dropped");
    }

    // ── the relay's close, and what it does to redialing ─────────
    //
    // A relay turns a bridge away with close status 1008 and a reason (`unsupported protocol N` for a bridge
    // from another protocol version). Until this was pinned the tunnel dropped both and redialed every 30 s for
    // ever, so "download the new bridge" looked, on the engineer's machine, exactly like a network blip.

    private static readonly TimeSpan Floor = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan Ceiling = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan RefusedCeiling = TimeSpan.FromHours(1);
    // Every wait carries up to 1 s of jitter, so a wait is asserted as a range starting at its base.
    private static readonly TimeSpan Jitter = TimeSpan.FromSeconds(1);

    private static void AssertWait(TimeSpan expectedBase, TimeSpan actual, string what) =>
        Assert.True(actual >= expectedBase && actual < expectedBase + Jitter,
            $"{what}: expected a wait of {expectedBase} (+ < 1 s jitter), the tunnel asked for {actual}");

    [Fact]
    public async Task A_protocol_refusal_is_one_error_line_with_the_reason_and_the_update_hint()
    {
        var delay = new FakeDelay();
        var log = new LogCapture();
        var (relay, _, _) = Start(out _, delay: delay, log: log);
        await relay.AwaitHello();

        relay.Close(1008, "unsupported protocol 1");
        var wait = await delay.NextWait();

        var errors = log.At(VoltLogLevel.Error);
        Assert.True(errors.Count == 1, "expected exactly one error line, got:\n" + log);
        Assert.Contains("unsupported protocol 1", errors[0]);
        Assert.Contains("download the latest bridge", errors[0]);

        // The long ceiling, not 30 s: a stale bridge re-asking every half minute is a hot loop against someone
        // else's server that can only ever get the same answer.
        AssertWait(RefusedCeiling, wait, "after a 1008");
        // And no dial in the meantime: the wait IS the gap between attempts.
        Assert.Equal(1, relay.ConnectAttempts);
    }

    [Fact]
    public async Task A_policy_refusal_for_another_reason_names_it_without_an_update_hint()
    {
        var delay = new FakeDelay();
        var log = new LogCapture();
        var (relay, _, _) = Start(out _, delay: delay, log: log);
        await relay.AwaitHello();

        relay.Close(1008, "bridge disabled by its owner");
        var wait = await delay.NextWait();

        var errors = log.At(VoltLogLevel.Error);
        Assert.True(errors.Count == 1, "expected exactly one error line, got:\n" + log);
        Assert.Contains("bridge disabled by its owner", errors[0]);
        // A newer bridge would be refused just the same; telling the engineer to download one sends them the
        // wrong way.
        Assert.DoesNotContain("download", errors[0]);
        AssertWait(RefusedCeiling, wait, "after a 1008");
    }

    /// <summary>A relay restart (1001 going away, or 1006: the connection dies with no close at all) is NOT a
    /// refusal. Today's jittered backoff, 1 s doubling to a 30 s ceiling, pinned by value.</summary>
    [Theory]
    [InlineData(1001)]
    [InlineData(1006)]
    public async Task A_relay_restart_backs_off_to_at_most_30s_as_before(int status)
    {
        var delay = new FakeDelay();
        var (relay, _, _) = Start(out _, delay: delay, log: new LogCapture());
        await relay.AwaitHello();

        var expected = new[] { 1, 2, 4, 8, 16, 30, 30, 30 };
        for (var i = 0; i < expected.Length; i++)
        {
            if (status == 1006) relay.DieWithoutClose();
            else relay.Close(status, "going away");

            AssertWait(TimeSpan.FromSeconds(expected[i]), await delay.NextWait(), $"end #{i + 1} ({status})");
            delay.Release();
        }
    }

    [Fact]
    public async Task A_lifted_refusal_puts_the_backoff_back_at_its_floor()
    {
        var delay = new FakeDelay();
        var (relay, _, _) = Start(out _, delay: delay, log: new LogCapture());
        await relay.AwaitHello();

        // Three ends the relay never accepted climb the backoff to 8 s, so a floor afterwards is the RESET and
        // not a coincidence of it never having climbed.
        for (var i = 0; i < 3; i++)
        {
            relay.Close(1001, "going away");
            await delay.NextWait();
            delay.Release();
        }

        relay.Close(1008, "unsupported protocol 1");
        AssertWait(RefusedCeiling, await delay.NextWait(), "after a 1008");
        delay.Release();

        // Accepted this time: the relay talks to the bridge (any frame proves it is being served) before the
        // connection later ends in an ordinary way.
        relay.Send(RelayFrames.Pong);
        relay.Close(1001, "going away");
        AssertWait(Floor, await delay.NextWait(), "the first end after an accepted connection");
    }

    [Theory]
    [InlineData(1000, "replaced by a live bridge")]
    [InlineData(1001, "going away")]
    [InlineData(1011, "internal error")]
    [InlineData(1008, "unsupported protocol 1")]
    public async Task Every_relay_close_is_logged_with_its_status_and_description(int status, string description)
    {
        var delay = new FakeDelay();
        var log = new LogCapture();
        var (relay, _, _) = Start(out _, delay: delay, log: log);
        await relay.AwaitHello();

        relay.Close(status, description);
        await delay.NextWait();

        Assert.True(
            log.Lines.Any(l => l.Message.Contains(status.ToString()) && l.Message.Contains(description)),
            $"no log line names both {status} and \"{description}\":\n" + log);
    }

    [Fact]
    public async Task The_local_pipe_keeps_answering_while_the_tunnel_is_refused()
    {
        var delay = new FakeDelay();
        var (relay, _, _) = Start(out var pipe, delay: delay, log: new LogCapture());
        await relay.AwaitHello();

        relay.Close(1008, "unsupported protocol 1");
        await delay.NextWait();

        // The tunnel is sitting out its refusal. The engineer's own CLI talks to the same pipe and must not notice.
        var health = await Task.Run(() => new PipeClient(pipe).Call(Ops.Health));
        Assert.True(health.TryGetProperty("projects", out var projects));
        Assert.Equal(1, projects.GetArrayLength());
    }
}

/// <summary>The heartbeat's exact bytes.
///
/// <para>These are a CROSS-REPO contract, which is why they are pinned by value rather than by round-trip.
/// The hosted relay registers this exact payload as a WebSocket auto-response, so its edge answers the
/// heartbeat without waking the object that owns the connection. Change the string on either side and the
/// two stop matching silently: the bridge keeps pinging, the relay keeps waking, and the only symptom is a
/// bill and a Durable Object that never hibernates.</para>
///
/// <para>The counter form this replaced — <c>{"ping":1}</c>, <c>{"ping":2}</c> — matched nothing, for ever.
/// It also bought nothing: no pong is correlated to its ping, because the watchdog measures SILENCE.</para></summary>
public sealed class RelayHeartbeatTests
{
    [Fact]
    public void Ping_is_the_exact_constant_the_relay_auto_responds_to()
    {
        Assert.Equal("{\"volt\":\"ping\"}", RelayFrames.Ping);
    }

    [Fact]
    public void Pong_is_the_exact_constant_the_relay_answers_with()
    {
        Assert.Equal("{\"volt\":\"pong\"}", RelayFrames.Pong);
    }

    [Fact]
    public void Ping_carries_no_varying_part()
    {
        // The property, not just the value: two pings a thousand apart must be
        // byte-identical or the edge cannot match them.
        Assert.Same(RelayFrames.Ping, RelayFrames.Ping);
        Assert.DoesNotContain("0", RelayFrames.Ping);
        Assert.DoesNotContain("1", RelayFrames.Ping);
    }
}
