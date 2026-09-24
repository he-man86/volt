using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Volt.Contracts;
using Volt.Engine.Host;
using Volt.Relay;
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

    private (FakeRelay Relay, RelayTunnel Tunnel, FakeIde Ide) Start(FakeIde? ide = null)
    {
        ide ??= new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"))
        {
            Projects = new List<ProjectEntry> { new("codesys", "0", "Proj", "healthy", false) },
        };

        var pipe = PipeName();
        var host = new BridgePipeHost(ide, pipe);
        host.Start();
        _disposables.Add(host);

        var relay = new FakeRelay();
        var config = RelaySidecar.Parse("{\"url\":\"wss://relay.test/bridge\",\"token\":\"t\"}", "test");
        var tunnel = new RelayTunnel(config, pipe, "codesys", "0.0.0-test", relay.NewSocket);
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
