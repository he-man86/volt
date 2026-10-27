using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
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

/// <summary>Bridge → relay chunks (openspec relay-chunked-results §2): a large terminal frame travels as acked binary
/// chunks on a connection whose relay announced them, under a window, so every other frame waits at most about
/// W / uplink. Driven end to end — a real <see cref="RelayTunnel"/> over a real pipe host, only the socket faked.</summary>
public class ChunkedResultTests : IDisposable
{
    private readonly List<IDisposable> _disposables = new();

    public void Dispose()
    {
        foreach (var d in _disposables) { try { d.Dispose(); } catch { } }
    }

    /// <summary>A project whose fetch answer is large and compresses poorly (random base64 in a comment), so its gzip
    /// spans many 8 KiB chunks — enough to fill and outgrow the 16 KiB window floor.</summary>
    private static FakeIde BigIde(int randomBytes = 90_000)
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

    private (FakeRelay Relay, RelayTunnel Tunnel) Start(
        FakeIde ide, LogCapture log, FakeDelay? delay = null, TimeSpan? pingEvery = null, TimeSpan? silenceLimit = null,
        Action<FakeRelay>? beforeStart = null)
    {
        var pipe = "volt.test.relay." + Guid.NewGuid().ToString("N");
        var host = new BridgePipeHost(ide, pipe);
        host.Start();
        _disposables.Add(host);

        var relay = new FakeRelay();
        beforeStart?.Invoke(relay);
        var config = RelaySidecar.Parse("{\"url\":\"wss://relay.test/bridge\",\"token\":\"t\"}", "test");
        var tunnel = new RelayTunnel(config, pipe, "codesys", "0.0.0-test", relay.NewSocket,
            delay == null ? null : delay.Delay, log.Write, pingEvery, silenceLimit);
        _disposables.Add(tunnel);
        tunnel.Start();
        Assert.True(relay.Connected.Wait(10_000), "the tunnel never dialed out");
        return (relay, tunnel);
    }

    /// <summary>The Info line of a connection whose relay has not announced chunks by its first frame. It states only
    /// what is true then: an announcement may still come, and turns chunking on when it does.</summary>
    private const string NoAnnouncementYet =
        "relay: no chunk announcement yet — this connection sends whole frames until the relay announces chunks";

    private static string? TextFrameOf(FakeRelay relay, string id, string key) =>
        relay.Received.FirstOrDefault(f =>
        {
            using var doc = JsonDocument.Parse(f);
            return doc.RootElement.TryGetProperty("id", out var i) && i.GetString() == id && doc.RootElement.TryGetProperty(key, out _);
        });

    private static async Task Eventually(Func<bool> condition, string what, int timeoutMs = 15_000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            if (condition()) return;
            await Task.Delay(25);
        }
        throw new TimeoutException(what);
    }

    private static async Task<string> AwaitTerminalLine(LogCapture log, string id, int timeoutMs = 15_000)
    {
        await Eventually(() => log.At(VoltLogLevel.Info).Any(l => l.StartsWith("relay: -> ") && l.Contains("(" + id + ")")),
            "no terminal line for " + id + ":\n" + log, timeoutMs);
        await Task.Delay(200);
        var lines = log.At(VoltLogLevel.Info).Where(l => l.StartsWith("relay: -> ") && l.Contains("(" + id + ")")).ToList();
        Assert.True(lines.Count == 1, "expected one terminal line for " + id + ", got:\n" + log);
        return lines[0];
    }

    // ── 2.1 / 2.3: an announced connection chunks a large answer ─────────────

    [Fact]
    public async Task A_large_answer_on_an_announced_connection_is_binary_chunks_that_reassemble_to_the_whole_frame()
    {
        var ide = BigIde();
        // The same project through a connection that announced nothing: the frame the bridge sends whole.
        var plain = Start(ide, new LogCapture());
        await plain.Relay.AwaitHello();
        plain.Relay.SendRequest("r1", Ops.Fetch, new { init = true });
        await plain.Relay.AwaitFrame("r1", "result");
        var whole = TextFrameOf(plain.Relay, "r1", "result")!;
        Assert.True(Encoding.UTF8.GetByteCount(whole) > 8192, "the fixture's answer is not large: " + whole.Length);
        Assert.Empty(plain.Relay.ReceivedBinary);

        var log = new LogCapture();
        var (relay, _) = Start(ide, log, beforeStart: r => { r.AutoAck = true; r.Announce(); });
        await relay.AwaitHello();
        relay.SendRequest("r1", Ops.Fetch, new { init = true });
        var reassembled = await relay.AwaitReassembled("r1");

        // Byte for byte the frame a connection without chunks carries whole.
        Assert.Equal(Encoding.UTF8.GetBytes(whole), reassembled);
        // And not ALSO as text: one terminal frame per id.
        Assert.Null(TextFrameOf(relay, "r1", "result"));

        var chunks = relay.ChunksOf("r1");
        Assert.True(chunks.Count > 2, "expected several chunks, got " + chunks.Count);
        Assert.All(relay.ReceivedBinary, m => Assert.True(m.Length <= 8192, "a message of " + m.Length + " B"));
        for (var seq = 0; seq < chunks.Count; seq++)
        {
            var header = chunks[seq].Header;
            var names = header.EnumerateObject().Select(p => p.Name).ToArray();
            Assert.Equal(seq == 0 ? new[] { "id", "seq", "count", "bytes" } : new[] { "id", "seq" }, names);
            Assert.Equal(seq, header.GetProperty("seq").GetInt32());
        }
        Assert.Equal(chunks.Count, chunks[0].Header.GetProperty("count").GetInt32());
        Assert.Equal(reassembled.Length, chunks[0].Header.GetProperty("bytes").GetInt32());
    }

    [Fact]
    public async Task A_small_answer_on_an_announced_connection_stays_a_text_frame()
    {
        var log = new LogCapture();
        var (relay, _) = Start(BigIde(), log, beforeStart: r => { r.AutoAck = true; r.Announce(); });
        await relay.AwaitHello();

        relay.SendRequest("h", Ops.Health);
        await relay.AwaitFrame("h", "result");
        Assert.Empty(relay.ReceivedBinary);
    }

    [Fact]
    public async Task A_connection_without_an_announcement_sends_a_large_answer_whole_and_says_so()
    {
        var log = new LogCapture();
        var (relay, _) = Start(BigIde(), log);
        await relay.AwaitHello();
        relay.SendRequest("r1", Ops.Fetch, new { init = true });
        await relay.AwaitFrame("r1", "result");

        Assert.Empty(relay.ReceivedBinary);
        Assert.Single(log.At(VoltLogLevel.Info), l => l == NoAnnouncementYet);
        Assert.DoesNotContain(log.At(VoltLogLevel.Info), l => l.StartsWith("relay: this connection chunks"));
    }

    [Fact]
    public async Task An_announced_connection_says_once_that_it_chunks()
    {
        var log = new LogCapture();
        var (relay, _) = Start(BigIde(), log, beforeStart: r => { r.AutoAck = true; r.Announce(4096); });
        await relay.AwaitHello();
        relay.SendRequest("r1", Ops.Fetch, new { init = true });
        await relay.AwaitReassembled("r1");

        Assert.Single(log.At(VoltLogLevel.Info), l => l == "relay: this connection chunks terminal frames over 8192 B, at most 4096 B per message");
        Assert.DoesNotContain(log.At(VoltLogLevel.Info), l => l.StartsWith("relay: this connection sends whole"));
        // maxBytes is the relay's: every message honours the announced 4096.
        Assert.All(relay.ReceivedBinary, m => Assert.True(m.Length <= 4096, "a message of " + m.Length + " B"));
    }

    [Theory]
    [InlineData("{\"volt\":\"relay\"}", "has no `chunks` object")]
    [InlineData("{\"volt\":\"relay\",\"chunks\":{\"ack\":true}}", "has no integer `chunks.maxBytes`")]
    [InlineData("{\"volt\":\"relay\",\"chunks\":{\"maxBytes\":\"8192\",\"ack\":true}}", "has no integer `chunks.maxBytes`")]
    [InlineData("{\"volt\":\"relay\",\"chunks\":{\"maxBytes\":0,\"ack\":true}}", "`chunks.maxBytes` 0 is not a positive integer")]
    [InlineData("{\"volt\":\"relay\",\"chunks\":{\"maxBytes\":-8192,\"ack\":true}}", "`chunks.maxBytes` -8192 is not a positive integer")]
    [InlineData("{\"volt\":\"relay\",\"chunks\":{\"maxBytes\":8192}}", "does not state `chunks.ack: true`")]
    [InlineData("{\"volt\":\"relay\",\"chunks\":{\"maxBytes\":8192,\"ack\":false}}", "does not state `chunks.ack: true`")]
    public async Task A_malformed_announcement_is_a_named_warn_and_the_connection_stays_whole_frame(string announcement, string reason)
    {
        var log = new LogCapture();
        var (relay, _) = Start(BigIde(), log, beforeStart: r => { r.AutoAck = true; r.Send(announcement); });
        await relay.AwaitHello();
        relay.SendRequest("r1", Ops.Fetch, new { init = true });
        await relay.AwaitFrame("r1", "result");

        Assert.Empty(relay.ReceivedBinary);
        Assert.Single(log.At(VoltLogLevel.Warn), l => l.StartsWith("relay: ignoring a malformed frame — the relay's announcement ") && l.Contains(reason));
        Assert.Single(log.At(VoltLogLevel.Info), l => l == NoAnnouncementYet);
    }

    [Fact]
    public async Task An_announcement_after_another_frame_still_turns_chunking_on()
    {
        // The contract says "a bridge chunks only on a connection that received it" — not "as its first frame". A relay
        // that sends anything before its announcement must not lose chunking: that is the 55 s close this change ends.
        var log = new LogCapture();
        var (relay, _) = Start(BigIde(), log, beforeStart: r => { r.Send(RelayFrames.Pong); r.AutoAck = true; r.Announce(); });
        await relay.AwaitHello();
        await Eventually(() => log.At(VoltLogLevel.Info).Any(l => l.StartsWith("relay: this connection chunks")),
            "the late announcement was not taken:\n" + log);
        relay.SendRequest("r1", Ops.Fetch, new { init = true });
        await relay.AwaitReassembled("r1");

        Assert.Null(TextFrameOf(relay, "r1", "result"));
        Assert.Empty(log.At(VoltLogLevel.Warn));
        // Both Info lines are true when they are written: whole frames until the announcement, chunks after it.
        var info = log.At(VoltLogLevel.Info).ToList();
        var whole = info.IndexOf(NoAnnouncementYet);
        Assert.True(whole >= 0 && whole < info.FindIndex(l => l.StartsWith("relay: this connection chunks")), string.Join("\n", info));
    }

    [Fact]
    public async Task A_second_announcement_is_a_named_warn_and_the_first_one_stands()
    {
        var log = new LogCapture();
        var (relay, _) = Start(BigIde(), log, beforeStart: r => { r.AutoAck = true; r.Announce(4096); r.Announce(8192); });
        await relay.AwaitHello();
        await Eventually(() => log.At(VoltLogLevel.Warn).Any(), "no WARN for the second announcement:\n" + log);
        relay.SendRequest("r1", Ops.Fetch, new { init = true });
        await relay.AwaitReassembled("r1");

        Assert.Single(log.At(VoltLogLevel.Warn), l =>
            l == "relay: ignoring a second chunk announcement — the connection keeps chunking at most 4096 B per message");
        Assert.All(relay.ReceivedBinary, m => Assert.True(m.Length <= 4096, "a message of " + m.Length + " B"));
    }

    [Theory]
    // A maxBytes over the window's floor is honoured with SMALLER messages: a chunk larger than the floor could never
    // fit an empty window. Under the relay's limit is within the contract ("at most maxBytes").
    [InlineData(32768)]
    [InlineData(1 << 30)]
    public async Task A_maxBytes_over_the_window_floor_chunks_at_the_floor(int maxBytes)
    {
        var log = new LogCapture();
        var (relay, _) = Start(BigIde(), log, beforeStart: r => { r.AutoAck = true; r.Announce(maxBytes); });
        await relay.AwaitHello();
        relay.SendRequest("r1", Ops.Fetch, new { init = true });
        await relay.AwaitReassembled("r1");

        Assert.Empty(log.At(VoltLogLevel.Warn));
        Assert.Single(log.At(VoltLogLevel.Info), l => l == "relay: this connection chunks terminal frames over 8192 B, at most 16384 B per message");
        Assert.All(relay.ReceivedBinary, m => Assert.True(m.Length <= 16384, "a message of " + m.Length + " B"));
    }

    [Fact]
    public async Task A_request_whose_id_cannot_fit_a_chunk_header_is_refused_by_name_before_it_runs()
    {
        // The id and maxBytes are both known when the request arrives, so it is refused THEN — never after a push ran
        // and its answer could not be sent.
        var ide = BigIde();
        var log = new LogCapture();
        var (relay, _) = Start(ide, log, beforeStart: r => { r.AutoAck = true; r.Announce(1024); });
        await relay.AwaitHello();
        var id = new string('x', 1000);
        relay.SendRequest(id, Ops.Fetch, new { init = true });
        await relay.AwaitFrame(id, "error");

        var error = JsonDocument.Parse(TextFrameOf(relay, id, "error")!).RootElement.GetProperty("error");
        Assert.Equal(BridgeErrorCodes.BadRequest, error.GetProperty("code").GetString());
        Assert.Equal("the request id (1000 characters) cannot fit a chunk header in the 1024 B chunks this connection sends, " +
            "so a large answer could not be delivered; it was not run", error.GetProperty("message").GetString());
        Assert.Matches(RelayProtocolDoc.IdRefusal(), error.GetProperty("message").GetString());
        Assert.Equal(0, ide.WalkCalls);
        Assert.Empty(relay.ReceivedBinary);
        var line = await AwaitTerminalLine(log, id);
        Assert.Matches(@"^relay: -> fetch \(x+\) refused BAD_REQUEST \d+ms$", line);

        // The same project answers a request whose id fits: the refusal is the id's, not the fetch's.
        relay.SendRequest("r1", Ops.Fetch, new { init = true });
        await relay.AwaitReassembled("r1");
        Assert.True(ide.WalkCalls > 0, "the probe does not see a fetch run");
    }

    [Fact]
    public async Task The_id_refusal_names_the_chunk_size_this_connection_sends_not_the_relays_larger_maxBytes()
    {
        // Review of gate step 6: a relay announcing 100000 gets 16384 B chunks (the window's floor), so an id is judged
        // against 16384, and the refusal names that number, never the relay's 100000 as if it were the limit.
        var ide = BigIde();
        var log = new LogCapture();
        var (relay, _) = Start(ide, log, beforeStart: r => { r.AutoAck = true; r.Announce(100000); });
        await relay.AwaitHello();
        var id = new string('x', 16400);
        relay.SendRequest(id, Ops.Fetch, new { init = true });
        await relay.AwaitFrame(id, "error");

        var message = JsonDocument.Parse(TextFrameOf(relay, id, "error")!).RootElement.GetProperty("error").GetProperty("message").GetString();
        Assert.Equal("the request id (16400 characters) cannot fit a chunk header in the 16384 B chunks this connection sends, " +
            "so a large answer could not be delivered; it was not run", message);
        Assert.Equal(0, ide.WalkCalls);
    }

    [Fact]
    public async Task A_malformed_announcement_after_a_valid_one_is_a_named_warn_and_the_connection_keeps_chunking()
    {
        // The doc's claim (review of gate step 6): a malformed announcement changes nothing, so after a valid one the
        // connection keeps chunking at the size that one set.
        var log = new LogCapture();
        var (relay, _) = Start(BigIde(), log, beforeStart: r => { r.AutoAck = true; r.Announce(4096); r.Send("{\"volt\":\"relay\",\"chunks\":{}}"); });
        await relay.AwaitHello();
        await Eventually(() => log.At(VoltLogLevel.Warn).Any(), "no WARN for the malformed announcement:\n" + log);
        relay.SendRequest("r1", Ops.Fetch, new { init = true });
        await relay.AwaitReassembled("r1");

        Assert.Single(log.At(VoltLogLevel.Warn), l =>
            l == "relay: ignoring a malformed frame — the relay's announcement has no integer `chunks.maxBytes`");
        Assert.NotEmpty(relay.ReceivedBinary);
        Assert.All(relay.ReceivedBinary, m => Assert.True(m.Length <= 4096, "a message of " + m.Length + " B"));
    }

    [Fact]
    public async Task The_announcement_is_per_connection_and_never_carried_across_a_reconnect()
    {
        var log = new LogCapture();
        var delay = new FakeDelay();
        var (relay, _) = Start(BigIde(), log, delay, beforeStart: r => { r.AutoAck = true; r.Announce(); });
        await relay.AwaitHello();
        relay.SendRequest("r1", Ops.Fetch, new { init = true });
        await relay.AwaitReassembled("r1");

        relay.DieWithoutClose();
        await delay.NextWait();
        delay.Release();
        await Eventually(() => relay.Received.Count(f => f.Contains("\"hello\"")) == 2, "the tunnel did not redial:\n" + log);
        var binaryBefore = relay.ReceivedBinary.Count;

        relay.SendRequest("r2", Ops.Fetch, new { init = true });
        await relay.AwaitFrame("r2", "result");
        Assert.Equal(binaryBefore, relay.ReceivedBinary.Count);
        Assert.Single(log.At(VoltLogLevel.Info), l => l == NoAnnouncementYet);
    }

    // ── 2.2: acks ───────────────────────────────────────────────

    [Theory]
    [InlineData("{\"id\":\"r9\",\"ack\":-1}", "an ack's `ack` is not a chunk number")]
    [InlineData("{\"id\":\"r9\",\"ack\":\"1\"}", "an ack's `ack` is not a chunk number")]
    [InlineData("{\"id\":\"r9\",\"ack\":1.5}", "an ack's `ack` is not a chunk number")]
    [InlineData("{\"ack\":1}", "an ack has no string `id`")]
    [InlineData("{\"id\":7,\"ack\":1}", "an ack has no string `id`")]
    public async Task A_malformed_ack_is_a_named_warn(string ack, string reason)
    {
        var log = new LogCapture();
        var (relay, _) = Start(BigIde(), log, beforeStart: r => r.Announce());
        await relay.AwaitHello();
        relay.Send(ack);
        relay.SendRequest("h", Ops.Health);
        await relay.AwaitFrame("h", "result");

        Assert.Single(log.At(VoltLogLevel.Warn), l => l.StartsWith("relay: ignoring a malformed frame — " + reason));
    }

    [Fact]
    public async Task An_ack_for_nothing_is_a_named_warn()
    {
        var log = new LogCapture();
        var (relay, _) = Start(BigIde(), log, beforeStart: r => r.Announce());
        await relay.AwaitHello();
        relay.Ack("nobody", 3);
        relay.SendRequest("h", Ops.Health);
        await relay.AwaitFrame("h", "result");

        Assert.Single(log.At(VoltLogLevel.Warn), l => l == "relay: an ack for nothing — chunk 3 of nobody is not awaiting an ack");
    }

    // ── 2.4: the window ─────────────────────────────────────────

    [Fact]
    public async Task Without_acks_at_most_the_window_floor_is_sent_and_a_health_answers_in_between()
    {
        var log = new LogCapture();
        var (relay, _) = Start(BigIde(), log, beforeStart: r => r.Announce());
        await relay.AwaitHello();
        relay.SendRequest("r1", Ops.Fetch, new { init = true });
        await Eventually(() => relay.ChunksOf("r1").Count > 0, "no chunk arrived:\n" + log);
        await Task.Delay(300);

        var sent = relay.ReceivedBinary.Sum(m => m.Length);
        Assert.True(sent <= 16 * 1024, "sent " + sent + " B unacked, over the 16 KiB floor");
        var count = relay.ChunksOf("r1")[0].Header.GetProperty("count").GetInt32();
        Assert.True(relay.ReceivedBinary.Count < count, "the whole answer went out without an ack");

        // A whole frame is not held behind the window.
        relay.SendRequest("h", Ops.Health);
        await relay.AwaitFrame("h", "result");
        Assert.Equal(sent, relay.ReceivedBinary.Sum(m => m.Length));
    }

    [Fact]
    public async Task Acks_grow_the_window()
    {
        var log = new LogCapture();
        var (relay, _) = Start(BigIde(), log, beforeStart: r => r.Announce());
        await relay.AwaitHello();
        relay.SendRequest("r1", Ops.Fetch, new { init = true });
        // The floor: two 8 KiB chunks.
        await Eventually(() => relay.ChunksOf("r1").Count == 2, "the floor's two chunks never arrived:\n" + log);
        await Task.Delay(200);
        Assert.Equal(2, relay.ChunksOf("r1").Count);

        // 16 KiB acked over the last 5 s: W is still 16 KiB, so two more.
        relay.Ack("r1", 0); relay.Ack("r1", 1);
        await Eventually(() => relay.ChunksOf("r1").Count == 4, "acks released nothing:\n" + log);
        await Task.Delay(200);
        Assert.Equal(4, relay.ChunksOf("r1").Count);

        // 32 KiB acked: W is 32 KiB, so FOUR go out unacked.
        relay.Ack("r1", 2); relay.Ack("r1", 3);
        await Eventually(() => relay.ChunksOf("r1").Count == 8, "the window did not grow to 32 KiB:\n" + log);
        await Task.Delay(200);
        Assert.Equal(8, relay.ChunksOf("r1").Count);
    }

    // ── 2.5: delivery and stall ─────────────────────────────────

    [Fact]
    public async Task A_delivered_chunked_answer_is_one_terminal_line_with_its_bytes_chunks_and_time_to_the_last_ack()
    {
        var log = new LogCapture();
        var (relay, _) = Start(BigIde(), log, beforeStart: r => r.Announce());
        await relay.AwaitHello();
        relay.SendRequest("r1", Ops.Fetch, new { init = true });

        // Ack by hand, the last one late: the line's duration runs to the LAST ack, not to the last send.
        var count = -1;
        var acked = 0;
        var deadline = DateTime.UtcNow.AddSeconds(15);
        while (DateTime.UtcNow < deadline && (count < 0 || acked < count))
        {
            var chunks = relay.ChunksOf("r1");
            if (chunks.Count > 0) count = chunks[0].Header.GetProperty("count").GetInt32();
            while (acked < chunks.Count && acked < count - 1) relay.Ack("r1", acked++);
            if (count > 0 && chunks.Count == count && acked == count - 1)
            {
                await Task.Delay(700);
                relay.Ack("r1", acked++);
                break;
            }
            await Task.Delay(20);
        }
        var bytes = (await relay.AwaitReassembled("r1")).Length;

        var line = await AwaitTerminalLine(log, "r1");
        var match = Regex.Match(line, @"^relay: -> fetch \(r1\) ok (\d+)ms, (\d+) B as (\d+) chunks$");
        Assert.True(match.Success, line);
        Assert.True(int.Parse(match.Groups[1].Value) >= 700, "the duration stopped before the last ack: " + line);
        Assert.Equal(bytes, int.Parse(match.Groups[2].Value));
        Assert.Equal(count, int.Parse(match.Groups[3].Value));
    }

    [Fact]
    public async Task A_chunk_not_acked_within_the_silence_limit_is_named_and_drops_the_connection_and_the_answer_is_abandoned()
    {
        var log = new LogCapture();
        var delay = new FakeDelay();
        var (relay, _) = Start(BigIde(), log, delay, pingEvery: TimeSpan.FromMilliseconds(100),
            silenceLimit: TimeSpan.FromMilliseconds(800), beforeStart: r => r.Announce());
        await relay.AwaitHello();
        // The relay keeps talking, so the inbound-silence watchdog is not what ends it: only the missing ack is.
        using var talking = new CancellationTokenSource();
        var pongs = Task.Run(async () =>
        {
            while (!talking.IsCancellationRequested) { relay.Send(RelayFrames.Pong); await Task.Delay(50); }
        });

        relay.SendRequest("r1", Ops.Fetch, new { init = true });
        var wait = await delay.NextWait();
        talking.Cancel();
        await pongs;

        Assert.Single(log.At(VoltLogLevel.Warn), l =>
            Regex.IsMatch(l, @"^relay: chunk 0 of r1 was not acked within \d+s — the relay stopped acking; dropping the socket$"));
        var end = log.Lines.Single(l => l.Message.StartsWith("relay: connection on "));
        Assert.Equal(VoltLogLevel.Warn, end.Level);
        Assert.Matches(@" ended after \d+s — a chunk was not acked \(chunk 0 of r1 within \d+s\) \| in flight: r1 \| sent \d+ B \(largest \d+\), received \d+ B \(largest \d+\) \| next dial in " +
                       (int)wait.TotalSeconds + "s$", end.Message);
        var line = await AwaitTerminalLine(log, "r1");
        Assert.Matches(@"^relay: -> fetch \(r1\) abandoned ok \d+ms, \d+ B as \d+ chunks delivered=no$", line);
    }

    /// <summary>§4: the end line's byte accounting counts the chunks too — binary messages at their length, beside the
    /// text frames — so a connection that carried a chunked answer states what really went over it.</summary>
    [Fact]
    public async Task The_end_line_counts_binary_chunks_with_the_text_frames_each_way()
    {
        var log = new LogCapture();
        var delay = new FakeDelay();
        var (relay, _) = Start(BigIde(), log, delay, beforeStart: r => { r.AutoAck = true; r.Announce(); });
        await relay.AwaitHello();
        var request = FakeRelay.RequestFrame("r1", Ops.Fetch, new { init = true });
        relay.Send(request);
        var line = await AwaitTerminalLine(log, "r1");
        Assert.Matches(@"^relay: -> fetch \(r1\) ok \d+ms, \d+ B as \d+ chunks$", line);

        relay.Close(1001, "going away");
        var wait = await delay.NextWait();

        var binary = relay.ReceivedBinary;
        Assert.True(binary.Count > 1, "the answer was not chunked");
        var sent = relay.Received.Select(f => (long)Encoding.UTF8.GetByteCount(f)).Concat(binary.Select(m => (long)m.Length)).ToList();
        // What the relay sent: its announcement, the request, and one ack per chunk.
        var received = new[] { "{\"volt\":\"relay\",\"chunks\":{\"maxBytes\":8192,\"ack\":true}}", request }
            .Concat(binary.Select(m =>
            {
                var header = FakeRelay.ParseChunk(m).Header;
                return "{\"id\":\"r1\",\"ack\":" + header.GetProperty("seq").GetInt32() + "}";
            }))
            .Select(f => (long)Encoding.UTF8.GetByteCount(f)).ToList();
        var end = log.Lines.Single(l => l.Message.StartsWith("relay: connection on ")).Message;
        Assert.EndsWith(" | in flight: none | sent " + sent.Sum() + " B (largest " + sent.Max() + "), received " + received.Sum() +
                        " B (largest " + received.Max() + ") | next dial in " + (int)wait.TotalSeconds + "s", end);
    }

    [Fact]
    public async Task A_chunk_whose_send_fails_on_a_live_connection_is_not_delivered_and_named()
    {
        var log = new LogCapture();
        var (relay, _) = Start(BigIde(), log, beforeStart: r => { r.AutoAck = true; r.Announce(); });
        await relay.AwaitHello();
        relay.FailBinaryWhen = _ => true;
        relay.SendRequest("r1", Ops.Fetch, new { init = true });

        var line = await AwaitTerminalLine(log, "r1");
        Assert.Matches(@"^relay: -> fetch \(r1\) ok \d+ms, \d+ B as \d+ chunks delivered=no \(WebSocketException: .+\)$", line);
    }

    [Fact]
    public async Task A_chunk_send_that_fails_after_earlier_chunks_went_drops_the_socket_so_the_relay_drops_the_partial_answer()
    {
        // Chunk 0 is at the relay; chunk 1 fails. The relay has no frame that says "this id will not complete": its
        // socket ending is how it learns, and it then discards the partial reassembly. Kept open, the relay would hold
        // chunk 0 until its idle timeout, its caller would wait for an answer that cannot come, and chunk 0's ack would
        // read as "an ack for nothing".
        var log = new LogCapture();
        var delay = new FakeDelay();
        var (relay, _) = Start(BigIde(), log, delay, beforeStart: r => r.Announce());
        await relay.AwaitHello();
        var binary = 0;
        relay.FailBinaryWhen = _ => Interlocked.Increment(ref binary) == 2;
        relay.SendRequest("r1", Ops.Fetch, new { init = true });

        var wait = await delay.NextWait();
        Assert.Single(log.At(VoltLogLevel.Warn), l =>
            Regex.IsMatch(l, @"^relay: chunk 1 of r1 could not be sent \(WebSocketException: .+\) — the relay cannot complete r1; dropping the socket$"));
        Assert.DoesNotContain(log.Lines, l => l.Message.StartsWith("relay: an ack for nothing"));
        var end = log.Lines.Single(l => l.Message.StartsWith("relay: connection on "));
        Assert.Equal(VoltLogLevel.Warn, end.Level);
        // r1 may have finished (its terminal line written, delivered=no) before the receive loop ends.
        Assert.Matches(@" ended after \d+s — a chunk could not be sent \(chunk 1 of r1: WebSocketException\) \| in flight: (r1|none) \| sent \d+ B \(largest \d+\), received \d+ B \(largest \d+\) \| next dial in " +
                       (int)wait.TotalSeconds + "s$", end.Message);
        // §4 review: the chunk whose send failed carried nothing the relay can have counted — `sent` is exactly the text
        // frames and the one chunk that reached it (the fake keeps a failed message out of what it received).
        var sent = relay.Received.Select(f => (long)Encoding.UTF8.GetByteCount(f)).Concat(relay.ReceivedBinary.Select(m => (long)m.Length)).ToList();
        Assert.Single(relay.ReceivedBinary);
        Assert.Contains(" | sent " + sent.Sum() + " B (largest " + sent.Max() + "), received ", end.Message);
        var line = await AwaitTerminalLine(log, "r1");
        Assert.Matches(@"^relay: -> fetch \(r1\) ok \d+ms, \d+ B as \d+ chunks delivered=no \(WebSocketException: .+\)$", line);
    }
}
