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
        LogCapture? log = null,
        TimeSpan? pingEvery = null,
        TimeSpan? silenceLimit = null)
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
            log == null ? null : log.Write, pingEvery, silenceLimit);
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

    /// <summary>openspec relay-request-deadline: a request field the bridge does not know — a caller's budget
    /// is the one a relay asked for — is ignored, and the op is served exactly as without it. There is no
    /// deadline below the relay (IDE_BUSY is what keeps a write from waiting behind a write), so even a budget
    /// that expired long ago refuses nothing: the push still applies.</summary>
    [Fact]
    public async Task A_request_with_a_budget_is_served_as_if_it_had_none()
    {
        var (relay, _, _) = Start();
        await relay.AwaitHello();

        relay.Send("{\"id\":\"plain\",\"op\":\"push\",\"body\":{\"ops\":[]}}");
        var plain = await relay.AwaitFrame("plain", "result");
        relay.Send("{\"id\":\"budget\",\"op\":\"push\",\"body\":{\"ops\":[]},\"budgetMs\":0}");
        var budget = await relay.AwaitFrame("budget", "result");

        Assert.Equal(plain.GetRawText(), budget.GetRawText());
        Assert.DoesNotContain(relay.Received, f => f.StartsWith("{\"id\":\"budget\",\"error\""));
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

    // ── the log: one terminal line per request, one line per connection end ──
    //
    // openspec relay-request-logging. The bridge log is the only record of what a relayed request did and why a
    // connection ended; before this a coded refusal and a BAD_REQUEST left only their `<-` line, and an end was
    // three lines (one at Debug) with no age, no pipe and no in-flight ids.

    private static IReadOnlyList<string> TerminalLines(LogCapture log, string id) =>
        log.At(VoltLogLevel.Info).Where(l => l.StartsWith("relay: -> ") && l.Contains("(" + id + ")")).ToList();

    private static IReadOnlyList<(VoltLogLevel Level, string Message)> EndLines(LogCapture log) =>
        log.Lines.Where(l => l.Message.StartsWith("relay: connection on ")).ToList();

    private static async Task<string> AwaitTerminalLine(LogCapture log, string id, int timeoutMs = 15_000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            var lines = TerminalLines(log, id);
            if (lines.Count > 0)
            {
                // Settle, then assert ONE: a second terminal line would arrive right behind the first.
                await Task.Delay(200);
                lines = TerminalLines(log, id);
                Assert.True(lines.Count == 1, $"expected one terminal line for {id}, got:\n" + log);
                return lines[0];
            }
            await Task.Delay(25);
        }
        throw new TimeoutException($"no terminal line for {id} within {timeoutMs}ms:\n" + log);
    }

    [Fact]
    public async Task A_coded_error_is_one_terminal_line_naming_its_code()
    {
        var log = new LogCapture();
        var (relay, _, _) = Start(out _, new FakeIde { HealthConnected = false }, log: log);
        await relay.AwaitHello();

        relay.SendRequest("r1", Ops.Refs);
        await relay.AwaitFrame("r1", "error");

        var line = await AwaitTerminalLine(log, "r1");
        Assert.StartsWith("relay: -> refs (r1) error " + BridgeErrorCodes.PlcDisconnected + " ", line);
        Assert.DoesNotContain("delivered=no", line);
    }

    [Fact]
    public async Task A_non_relayable_op_is_one_terminal_line_saying_refused()
    {
        var log = new LogCapture();
        var (relay, _, _) = Start(out _, log: log);
        await relay.AwaitHello();

        relay.SendRequest("r1", "connect", new { project = "Other" });
        await relay.AwaitFrame("r1", "error");

        var line = await AwaitTerminalLine(log, "r1");
        Assert.StartsWith("relay: -> connect (r1) refused " + BridgeErrorCodes.BadRequest + " ", line);
        Assert.DoesNotContain("delivered=no", line);
    }

    [Fact]
    public async Task A_served_op_is_one_terminal_line_with_its_duration()
    {
        var log = new LogCapture();
        var (relay, _, _) = Start(out _, log: log);
        await relay.AwaitHello();

        relay.SendRequest("r1", Ops.Health);
        await relay.AwaitFrame("r1", "result");

        var line = await AwaitTerminalLine(log, "r1");
        Assert.Matches(@"^relay: -> health \(r1\) ok \d+ms$", line);
    }

    /// <summary>The narrow case PLCAssist read right: the push LANDED, then the socket failed while its result
    /// was sent on a connection still live. It used to be logged "'push' failed on pipe" at Error and answered a
    /// second time with INTERNAL_ERROR.</summary>
    [Fact]
    public async Task A_push_whose_result_could_not_be_sent_is_ok_and_not_delivered()
    {
        var log = new LogCapture();
        var (relay, _, _) = Start(out _, log: log);
        await relay.AwaitHello();

        relay.FailSendWhen = frame => frame.StartsWith("{\"id\":\"r1\",\"result\"");
        relay.SendRequest("r1", Ops.Push, new { ops = Array.Empty<object>() });

        var line = await AwaitTerminalLine(log, "r1");
        Assert.Matches(@"^relay: -> push \(r1\) ok accepted newProjectVersion=\S+ \d+ms delivered=no \(WebSocketException: .+\)$", line);
        Assert.Empty(log.At(VoltLogLevel.Error));
        // And no second terminal frame: the op succeeded, there is nothing to answer as an error.
        Assert.DoesNotContain(relay.Received, f => f.StartsWith("{\"id\":\"r1\",\"error\""));
    }

    /// <summary>The connection goes while the op holds the IDE thread; the op completes afterwards. One line
    /// says it was abandoned AND what it did, and the id is not answered on the next connection.</summary>
    [Fact]
    public async Task An_abandoned_request_is_one_terminal_line_with_its_own_outcome()
    {
        var entered = new ManualResetEventSlim(false);
        var release = new ManualResetEventSlim(false);
        var ide = new FakeIde(serializeSta: true, FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"))
        {
            ExtractEntered = entered,
            ExtractBlock = release,
            Projects = new List<ProjectEntry> { new("codesys", "0", "Proj", "healthy", false) },
        };
        var log = new LogCapture();
        var delay = new FakeDelay();
        var (relay, _, _) = Start(out _, ide, delay, log);
        await relay.AwaitHello();

        relay.SendRequest("slow", Ops.Fetch, new { init = true });
        Assert.True(entered.Wait(15_000), "the fetch never reached the blocking step");
        relay.DieWithoutClose();
        await delay.NextWait();

        release.Set();
        var line = await AwaitTerminalLine(log, "slow");
        Assert.Matches(@"^relay: -> fetch \(slow\) abandoned ok \d+ms delivered=no$", line);
        Assert.DoesNotContain(relay.Received, f => f.StartsWith("{\"id\":\"slow\",\"result\""));
    }

    /// <summary>The case PLCAssist asked about (openspec relay-outcome-ledger 1.2): the socket drops while a push
    /// holds the IDE, the push is accepted afterwards, and the bridge redials. The one terminal line pairs the id
    /// with the verdict and the new project version, and the redialled connection carries nothing for the id —
    /// no report frame, no late result.</summary>
    [Fact]
    public async Task A_push_completed_after_the_connection_went_logs_its_verdict_and_is_never_answered()
    {
        var entered = new ManualResetEventSlim(false);
        var release = new ManualResetEventSlim(false);
        var ide = new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"))
        {
            FlushEntered = entered,
            FlushBlock = release,
        };
        var log = new LogCapture();
        var delay = new FakeDelay();
        var (relay, _, _) = Start(out _, ide, delay, log);
        await relay.AwaitHello();

        relay.SendRequest("r5", Ops.Push, new { ops = Array.Empty<object>() });
        Assert.True(entered.Wait(15_000), "the push never reached the blocking step");
        relay.DieWithoutClose();
        await delay.NextWait();
        delay.Release();
        var deadline = DateTime.UtcNow.AddSeconds(15);
        while (relay.Received.Count(f => f.Contains("\"hello\"")) < 2 && DateTime.UtcNow < deadline) await Task.Delay(25);
        Assert.True(relay.Received.Count(f => f.Contains("\"hello\"")) == 2, "the tunnel did not redial:\n" + log);

        release.Set();
        var line = await AwaitTerminalLine(log, "r5");
        Assert.Matches(@"^relay: -> push \(r5\) abandoned ok accepted newProjectVersion=\S+ \d+ms delivered=no$", line);
        Assert.DoesNotContain(relay.Received, f => f.Contains("\"r5\""));
    }

    [Fact]
    public async Task A_relay_close_is_one_info_end_line_with_age_cause_in_flight_and_next_dial()
    {
        var log = new LogCapture();
        var delay = new FakeDelay();
        var (relay, _, _) = Start(out var pipe, delay: delay, log: log);
        await relay.AwaitHello();

        relay.Close(1001, "going away");
        var wait = await delay.NextWait();

        var ends = EndLines(log);
        Assert.True(ends.Count == 1, "expected one end line, got:\n" + log);
        Assert.Equal(VoltLogLevel.Info, ends[0].Level);
        Assert.Matches(@"^relay: connection on " + pipe + @" ended after \d+s — the relay closed the connection: 1001 ""going away"" \| in flight: none \| next dial in " +
                       (int)wait.TotalSeconds + "s$", ends[0].Message);
        // Nothing was in flight, so no request's terminal line is written.
        Assert.DoesNotContain(log.At(VoltLogLevel.Info), l => l.StartsWith("relay: -> "));
    }

    [Fact]
    public async Task A_drop_without_close_is_one_warn_end_line()
    {
        var log = new LogCapture();
        var delay = new FakeDelay();
        var (relay, _, _) = Start(out var pipe, delay: delay, log: log);
        await relay.AwaitHello();

        relay.DieWithoutClose();
        var wait = await delay.NextWait();

        var ends = EndLines(log);
        Assert.True(ends.Count == 1, "expected one end line, got:\n" + log);
        Assert.Equal(VoltLogLevel.Warn, ends[0].Level);
        Assert.Matches(@"^relay: connection on " + pipe + @" ended after \d+s — dropped without a close \(WebSocketException\): .+ \| in flight: none \| next dial in " +
                       (int)wait.TotalSeconds + "s$", ends[0].Message);
    }

    [Fact]
    public async Task The_watchdog_drop_is_one_end_line_naming_the_watchdog_and_both_ids_in_flight()
    {
        var entered = new ManualResetEventSlim(false);
        var release = new ManualResetEventSlim(false);
        var ide = new FakeIde(serializeSta: true, FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"))
        {
            ExtractEntered = entered,
            ExtractBlock = release,
            Projects = new List<ProjectEntry> { new("codesys", "0", "Proj", "healthy", false) },
        };
        var log = new LogCapture();
        var delay = new FakeDelay();
        var (relay, _, _) = Start(out var pipe, ide, delay, log,
            pingEvery: TimeSpan.FromMilliseconds(100), silenceLimit: TimeSpan.FromMilliseconds(600));
        await relay.AwaitHello();

        relay.SendRequest("a", Ops.Fetch, new { init = true });
        relay.SendRequest("b", Ops.Fetch, new { init = true });
        Assert.True(entered.Wait(15_000), "the fetch never reached the blocking step");
        // Nothing more from the relay: the watchdog drops the socket.
        var wait = await delay.NextWait();
        release.Set();

        var ends = EndLines(log);
        Assert.True(ends.Count == 1, "expected one end line, got:\n" + log);
        Assert.Matches(@"^relay: connection on " + pipe + @" ended after \d+s — the watchdog dropped it \(no frame for \d+s\) \| in flight: a b \| next dial in " +
                       (int)wait.TotalSeconds + "s$", ends[0].Message);
        await AwaitTerminalLine(log, "a");
        await AwaitTerminalLine(log, "b");
    }

    [Fact]
    public async Task A_refused_upgrade_is_one_end_line_saying_it_never_connected()
    {
        var log = new LogCapture();
        var delay = new FakeDelay();
        var (relay, _, _) = Start(out var pipe, delay: delay, log: log);
        await relay.AwaitHello();

        relay.RefuseConnect = true;
        relay.DieWithoutClose();
        await delay.NextWait();
        delay.Release();
        var wait = await delay.NextWait();

        var ends = EndLines(log);
        Assert.True(ends.Count == 2, "expected two end lines (the drop, then the refused dial), got:\n" + log);
        Assert.Matches(@"^relay: connection on " + pipe + @" ended before it connected — could not connect \(InvalidOperationException\): relay refused \(test\) \| in flight: none \| next dial in " +
                       (int)wait.TotalSeconds + "s$", ends[1].Message);
    }

    // ── a deliberate stop closes (openspec bridge-close-frame) ────

    [Fact]
    public async Task A_deliberate_stop_sends_close_1001_bridge_stopping_then_drops()
    {
        var (relay, tunnel, _) = Start();
        await relay.AwaitHello();

        tunnel.Dispose();

        // A relay cannot tell a drop (1006) from a stop unless the stop says so, and it says so FIRST.
        var events = relay.SocketEvents;
        Assert.True(events.Count >= 2, "expected a close then the drop, got: " + string.Join(" | ", events));
        Assert.Equal("close 1001 bridge stopping", events[0]);
        Assert.Contains("abort", events.Skip(1));
    }

    [Fact]
    public async Task A_close_the_relay_never_takes_is_dropped_within_the_bound()
    {
        var (relay, tunnel, _) = Start();
        await relay.AwaitHello();
        relay.CloseNeverCompletes = true;

        var clock = System.Diagnostics.Stopwatch.StartNew();
        tunnel.Dispose();
        clock.Stop();

        // About one second for the close, then the drop: a stop must never hold up an IDE that is closing.
        Assert.True(clock.Elapsed < TimeSpan.FromSeconds(2.5), "the stop took " + clock.Elapsed);
        Assert.Contains("abort", relay.SocketEvents);
    }

    [Fact]
    public async Task The_watchdog_still_aborts_without_a_close()
    {
        var delay = new FakeDelay();
        var (relay, _, _) = Start(out _, delay: delay,
            pingEvery: TimeSpan.FromMilliseconds(100), silenceLimit: TimeSpan.FromMilliseconds(600));
        await relay.AwaitHello();

        // Nothing from the relay: the watchdog drops the socket, and the reconnect asks for its wait.
        await delay.NextWait();

        var events = relay.SocketEvents;
        Assert.Contains("abort", events);
        Assert.DoesNotContain(events, e => e.StartsWith("close", StringComparison.Ordinal));
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
