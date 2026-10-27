using System;
using System.Collections.Generic;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Volt.Contracts;
using Volt.Engine.Host;
using Volt.Relay;
using Volt.Wire;
using Xunit;

namespace Volt.Relay.Tests;

/// <summary>Relay → bridge chunks (openspec relay-chunked-results §3, the mirror image): the bridge's <c>hello</c> says it
/// takes chunks; a relay may then send a large REQUEST as binary chunks, which the bridge acks one by one, reassembles
/// per id and serves as if it had arrived whole. A broken set is refused by name and never served; a partial set never
/// outlives its connection. Driven end to end — a real <see cref="RelayTunnel"/> over a real pipe host, only the socket
/// faked; the chunks are cut by the test's own gzip, not by the bridge's splitter.</summary>
public class ChunkedRequestTests : IDisposable
{
    private readonly List<IDisposable> _disposables = new();

    public void Dispose()
    {
        foreach (var d in _disposables) { try { d.Dispose(); } catch { } }
    }

    private static FakeIde Ide() =>
        new(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"))
        {
            Projects = new List<ProjectEntry> { new("codesys", "Proj", "healthy", false) },
        };

    private (FakeRelay Relay, FakeIde Ide) Start(LogCapture log, FakeDelay? delay = null)
    {
        var ide = Ide();
        var pipe = "volt.test.relay." + Guid.NewGuid().ToString("N");
        var host = new BridgePipeHost(ide, pipe);
        host.Start();
        _disposables.Add(host);

        var relay = new FakeRelay();
        var config = RelaySidecar.Parse("{\"url\":\"wss://relay.test/bridge\",\"token\":\"t\"}", "test");
        var tunnel = new RelayTunnel(config, pipe, "codesys", "0.0.0-test", relay.NewSocket, delay == null ? null : delay.Delay, log.Write);
        _disposables.Add(tunnel);
        tunnel.Start();
        Assert.True(relay.Connected.Wait(10_000), "the tunnel never dialed out");
        return (relay, ide);
    }

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

    private static string Header0(string id, int count, long bytes) =>
        "{\"id\":" + JsonSerializer.Serialize(id) + ",\"seq\":0,\"count\":" + count + ",\"bytes\":" + bytes + "}";

    private static string HeaderN(string id, int seq) => "{\"id\":" + JsonSerializer.Serialize(id) + ",\"seq\":" + seq + "}";

    private static int FindAscii(byte[] haystack, string needle)
    {
        var n = Encoding.ASCII.GetBytes(needle);
        for (var i = 0; i + n.Length <= haystack.Length; i++)
            if (haystack.AsSpan(i, n.Length).SequenceEqual(n)) return i;
        throw new InvalidOperationException(needle + " is not in the stored gzip");
    }

    private static string Fetch(string id) => FakeRelay.RequestFrame(id, Ops.Fetch, new { init = true });

    // ── 3.1: hello says the bridge takes chunks ─────────────────────────────

    [Fact]
    public async Task Hello_states_that_the_bridge_takes_chunks_of_at_most_8192_bytes_with_acks()
    {
        var (relay, _) = Start(new LogCapture());
        var hello = await relay.AwaitHello();

        var chunks = hello.GetProperty("chunks");
        Assert.Equal(new[] { "maxBytes", "ack" }, chunks.EnumerateObject().Select(p => p.Name).ToArray());
        Assert.Equal(8192, chunks.GetProperty("maxBytes").GetInt32());
        Assert.Equal(JsonValueKind.True, chunks.GetProperty("ack").ValueKind);
    }

    // ── 3.2: receive, ack, reassemble, serve ────────────────────────────────

    [Fact]
    public async Task A_chunked_request_is_acked_chunk_by_chunk_and_served_exactly_as_the_whole_one()
    {
        var log = new LogCapture();
        var (relay, _) = Start(log);
        await relay.AwaitHello();

        // The same request whole first: the answer the chunked one must get.
        relay.Send(Fetch("whole"));
        var whole = await relay.AwaitFrame("whole", "result");

        var chunks = FakeRelay.ChunksFor("r1", Fetch("r1"), 16);
        Assert.True(chunks.Count >= 3, "the request should span several chunks, got " + chunks.Count);
        foreach (var chunk in chunks) relay.SendBinary(chunk);
        var result = await relay.AwaitFrame("r1", "result");

        Assert.Equal(whole.GetRawText(), result.GetRawText());
        Assert.Equal(Enumerable.Range(0, chunks.Count), relay.AcksFrom("r1"));
        Assert.Single(relay.FramesOf("r1", "result"));
        Assert.Empty(log.At(VoltLogLevel.Warn));
        Assert.Contains(log.At(VoltLogLevel.Info), l => l == "relay: <- fetch (r1)");
    }

    [Fact]
    public async Task Each_chunk_is_acked_at_once_and_nothing_runs_before_the_last_one()
    {
        var log = new LogCapture();
        var (relay, ide) = Start(log);
        await relay.AwaitHello();
        var chunks = FakeRelay.ChunksFor("r1", Fetch("r1"), 16);

        relay.SendBinary(chunks[0]);
        relay.SendBinary(chunks[1]);
        await Eventually(() => relay.AcksFrom("r1").Count == 2, "chunks 0 and 1 were not acked:\n" + log);
        await Task.Delay(200);
        Assert.Equal(0, ide.WalkCalls);
        Assert.Empty(relay.FramesOf("r1", "result"));
        Assert.Empty(relay.FramesOf("r1", "error"));

        foreach (var chunk in chunks.Skip(2)) relay.SendBinary(chunk);
        await relay.AwaitFrame("r1", "result");
        Assert.True(ide.WalkCalls > 0, "the probe does not see a fetch run");
    }

    [Fact]
    public async Task Two_ids_reassemble_apart_when_their_chunks_interleave()
    {
        var (relay, _) = Start(new LogCapture());
        await relay.AwaitHello();
        var a = FakeRelay.ChunksFor("a", Fetch("a"), 16);
        var b = FakeRelay.ChunksFor("b", FakeRelay.RequestFrame("b", Ops.Health), 16);

        for (var i = 0; i < Math.Max(a.Count, b.Count); i++)
        {
            if (i < a.Count) relay.SendBinary(a[i]);
            if (i < b.Count) relay.SendBinary(b[i]);
        }
        await relay.AwaitFrame("a", "result");
        await relay.AwaitFrame("b", "result");
        Assert.Equal(Enumerable.Range(0, a.Count), relay.AcksFrom("a"));
        Assert.Equal(Enumerable.Range(0, b.Count), relay.AcksFrom("b"));
    }

    // ── 3.3: refusal by name ────────────────────────────────────────────────

    /// <summary>Each broken set: the chunks a relay sends, the reason the bridge names, and the acks it sends (every
    /// chunk whose id and seq it can read is acked, refused or not — an unacked chunk would hold the relay's window).</summary>
    public static IEnumerable<object[]> Broken()
    {
        var frame = Fetch("r1");
        var raw = Encoding.UTF8.GetBytes(frame);
        var gzip = FakeRelay.Gzip(raw);
        var half = gzip.Length / 2;
        var first = gzip[..half];
        var second = gzip[half..];

        yield return new object[] { "seq 1 without seq 0",
            new[] { FakeRelay.Chunk(HeaderN("r1", 1), second) },
            "chunk 1 of r1 arrived without chunk 0", new[] { 1 } };
        yield return new object[] { "a gap",
            new[] { FakeRelay.Chunk(Header0("r1", 3, raw.Length), first), FakeRelay.Chunk(HeaderN("r1", 2), second) },
            "chunk 2 of r1 arrived after chunk 0: chunk 1 is missing", new[] { 0, 2 } };
        yield return new object[] { "a duplicate",
            new[] { FakeRelay.Chunk(Header0("r1", 2, raw.Length), first), FakeRelay.Chunk(HeaderN("r1", 0), first) },
            "chunk 0 of r1 arrived twice", new[] { 0, 0 } };
        yield return new object[] { "a duplicate seq 0",
            new[] { FakeRelay.Chunk(Header0("r1", 2, raw.Length), first), FakeRelay.Chunk(Header0("r1", 2, raw.Length), first) },
            "chunk 0 of r1 arrived twice", new[] { 0, 0 } };
        yield return new object[] { "more than count",
            new[] { FakeRelay.Chunk(Header0("r1", 2, raw.Length), first),
                    FakeRelay.Chunk(HeaderN("r1", 2), second) },
            "chunk 2 of r1 is past the 2 chunks chunk 0 states", new[] { 0, 2 } };
        yield return new object[] { "an inflate error",
            new[] { FakeRelay.Chunk(Header0("r1", 1, raw.Length), Encoding.ASCII.GetBytes("this is not gzip at all")) },
            "the chunks of r1 do not inflate", new[] { 0 } };
        yield return new object[] { "a length under bytes",
            new[] { FakeRelay.Chunk(Header0("r1", 1, raw.Length + 1), gzip) },
            "the chunks of r1 inflate to " + raw.Length + " B, not the " + (raw.Length + 1) + " B chunk 0 states", new[] { 0 } };
        yield return new object[] { "a length over bytes",
            new[] { FakeRelay.Chunk(Header0("r1", 1, raw.Length - 1), gzip) },
            "the chunks of r1 inflate past the " + (raw.Length - 1) + " B chunk 0 states", new[] { 0 } };
        yield return new object[] { "bytes over the frame cap",
            new[] { FakeRelay.Chunk(Header0("r1", 1, 64L * 1024 * 1024 + 1), gzip) },
            "chunk 0 of r1 states 67108865 B, over the 67108864 B frame cap", new[] { 0 } };
        yield return new object[] { "a chunk over the announced maxBytes",
            new[] { FakeRelay.Chunk(Header0("r1", 1, raw.Length), new byte[8192]) },
            "chunk 0 of r1 is " + (Encoding.UTF8.GetByteCount(Header0("r1", 1, raw.Length) + "\n") + 8192) +
            " B, over the 8192 B this bridge announced", new[] { 0 } };
        yield return new object[] { "no count",
            new[] { FakeRelay.Chunk("{\"id\":\"r1\",\"seq\":0,\"bytes\":" + raw.Length + "}", gzip) },
            "chunk 0 of r1 has no positive integer `count`", new[] { 0 } };
        yield return new object[] { "count 0",
            new[] { FakeRelay.Chunk(Header0("r1", 0, raw.Length), gzip) },
            "chunk 0 of r1 has no positive integer `count`", new[] { 0 } };
        yield return new object[] { "no bytes",
            new[] { FakeRelay.Chunk("{\"id\":\"r1\",\"seq\":0,\"count\":1}", gzip) },
            "chunk 0 of r1 has no positive integer `bytes`", new[] { 0 } };
        yield return new object[] { "no seq",
            new[] { FakeRelay.Chunk("{\"id\":\"r1\",\"count\":1,\"bytes\":" + raw.Length + "}", gzip) },
            "a chunk of r1 has no chunk number (`seq`, a non-negative integer)", Array.Empty<int>() };
        yield return new object[] { "not UTF-8",
            new[] { FakeRelay.Chunk(Header0("r1", 1, 2), FakeRelay.Gzip(new byte[] { 0xC3, 0x28 })) },
            "the chunks of r1 inflate to bytes that are not UTF-8", new[] { 0 } };
        // The gzip member is held to its own framing (review of step 3): the 8-byte trailer is required and checked, and
        // nothing may follow it. One answer on both vendor hosts, whatever a runtime's GZipStream would let through.
        var stored = FakeRelay.Gzip(raw, CompressionLevel.NoCompression);
        var tampered = (byte[])stored.Clone();
        var flip = FindAscii(tampered, "true");
        tampered[flip] = (byte)'T';
        yield return new object[] { "a corrupted payload with no trailer",
            new[] { FakeRelay.Chunk(Header0("r1", 1, raw.Length), tampered[..^8]) },
            "the chunks of r1 end without the whole 8-byte gzip trailer (CRC32 and ISIZE): 0 B of it arrived", new[] { 0 } };
        yield return new object[] { "no trailer",
            new[] { FakeRelay.Chunk(Header0("r1", 1, raw.Length), gzip[..^8]) },
            "the chunks of r1 end without the whole 8-byte gzip trailer (CRC32 and ISIZE): 0 B of it arrived", new[] { 0 } };
        yield return new object[] { "a cut trailer",
            new[] { FakeRelay.Chunk(Header0("r1", 1, raw.Length), gzip[..^3]) },
            "the chunks of r1 end without the whole 8-byte gzip trailer (CRC32 and ISIZE): 5 B of it arrived", new[] { 0 } };
        var badCrc = (byte[])gzip.Clone();
        badCrc[^8] ^= 0x01;
        yield return new object[] { "a flipped CRC",
            new[] { FakeRelay.Chunk(Header0("r1", 1, raw.Length), badCrc) },
            "the chunks of r1 fail the gzip CRC32 check", new[] { 0 } };
        yield return new object[] { "a corrupted payload with its trailer",
            new[] { FakeRelay.Chunk(Header0("r1", 1, raw.Length), tampered) },
            "the chunks of r1 fail the gzip CRC32 check", new[] { 0 } };
        var badSize = (byte[])gzip.Clone();
        badSize[^4] ^= 0x01;
        yield return new object[] { "a wrong ISIZE",
            new[] { FakeRelay.Chunk(Header0("r1", 1, raw.Length), badSize) },
            "the chunks of r1 end with ISIZE " + (raw.Length ^ 1) + " in the gzip trailer, not the " + raw.Length + " B they inflate to",
            new[] { 0 } };
        yield return new object[] { "bytes after the gzip member",
            new[] { FakeRelay.Chunk(Header0("r1", 1, raw.Length), gzip.Concat(new byte[] { 1, 0, 0, 0, 0 }).ToArray()) },
            "the chunks of r1 carry 5 B after the gzip member", new[] { 0 } };
        yield return new object[] { "two gzip members",
            new[] { FakeRelay.Chunk(Header0("r1", 1, raw.Length), gzip.Concat(gzip).ToArray()) },
            "the chunks of r1 carry " + gzip.Length + " B after the gzip member", new[] { 0 } };
        // A set may not hold more gzip than the bridge holds for its `bytes` (2 x bytes + 1 KiB, the bridge's own limit —
        // not a property of gzip, review of gate step 3): the bridge never buffers a huge `count` x 8 KiB.
        var noise = new byte[8000];
        new Random(7).NextBytes(noise);
        yield return new object[] { "more gzip than the bridge holds for bytes, at chunk 0",
            new[] { FakeRelay.Chunk(Header0("r1", int.MaxValue, 100), noise) },
            "chunk 0 of r1 brings the set to 8000 B of gzip, over the 1224 B this bridge holds for a request of 100 B (2 x bytes + 1 KiB)", new[] { 0 } };
        yield return new object[] { "more gzip than the bridge holds for bytes, across chunks",
            new[] { FakeRelay.Chunk(Header0("r1", int.MaxValue, 100), noise[..600]), FakeRelay.Chunk(HeaderN("r1", 1), noise[..700]) },
            "chunk 1 of r1 brings the set to 1300 B of gzip, over the 1224 B this bridge holds for a request of 100 B (2 x bytes + 1 KiB)", new[] { 0, 1 } };
        yield return new object[] { "a frame that is not a request",
            FakeRelay.ChunksFor("r1", "{\"id\":\"r1\",\"ack\":3}", 1 << 20).ToArray(),
            "the reassembled frame of r1 is not a request", new[] { 0 } };
        yield return new object[] { "a request naming another id",
            FakeRelay.ChunksFor("r1", Fetch("other"), 1 << 20).ToArray(),
            "the reassembled request of r1 names the id \"other\"", new[] { 0 } };
    }

    [Theory]
    [MemberData(nameof(Broken))]
    public async Task A_broken_chunked_request_is_refused_by_name_and_never_served(
        string situation, byte[][] chunks, string reason, int[] acks)
    {
        var log = new LogCapture();
        var (relay, ide) = Start(log);
        await relay.AwaitHello();

        foreach (var chunk in chunks) relay.SendBinary(chunk);
        var error = await relay.AwaitFrame("r1", "error");

        Assert.Equal(BridgeErrorCodes.BadRequest, error.GetProperty("code").GetString());
        var message = error.GetProperty("message").GetString()!;
        Assert.StartsWith("chunked request refused: " + reason, message);
        Assert.EndsWith("; it was not run", message);
        Assert.Single(log.At(VoltLogLevel.Warn), l =>
            l.StartsWith("relay: refusing chunked request r1 — " + reason, StringComparison.Ordinal) &&
            l.EndsWith("; answered BAD_REQUEST, nothing was run", StringComparison.Ordinal));
        // The ack for each chunk the bridge could name goes out first; the refusal is the id's ONE terminal frame.
        await Eventually(() => relay.AcksFrom("r1").Count == acks.Length, situation + ": acks " + string.Join(",", relay.AcksFrom("r1")));
        await Task.Delay(200);
        Assert.Equal(acks, relay.AcksFrom("r1"));
        Assert.Single(relay.FramesOf("r1", "error"));
        Assert.Empty(relay.FramesOf("r1", "result"));
        Assert.Empty(relay.FramesOf("other", "result"));
        Assert.Equal(0, ide.WalkCalls);

        // The connection stays: one broken request is not every request in flight.
        relay.SendRequest("h", Ops.Health);
        await relay.AwaitFrame("h", "result");
    }

    [Fact]
    public async Task The_chunks_still_in_flight_after_a_refusal_are_acked_and_get_no_second_answer()
    {
        var log = new LogCapture();
        var (relay, ide) = Start(log);
        await relay.AwaitHello();
        var chunks = FakeRelay.ChunksFor("r1", Fetch("r1"), 16);

        relay.SendBinary(chunks[0]);
        relay.SendBinary(chunks[2]);   // the gap: refused
        relay.SendBinary(chunks[3]);   // already on its way when the relay learns of the refusal
        await relay.AwaitFrame("r1", "error");
        await Eventually(() => relay.AcksFrom("r1").Count == 3, "the late chunk was not acked:\n" + log);
        await Task.Delay(200);

        Assert.Equal(new[] { 0, 2, 3 }, relay.AcksFrom("r1"));
        Assert.Single(relay.FramesOf("r1", "error"));
        Assert.Single(log.At(VoltLogLevel.Warn));
        Assert.Equal(0, ide.WalkCalls);
    }

    [Fact]
    public async Task A_set_sent_again_under_an_id_already_served_is_a_new_request_served_again_as_a_whole_frame_would_be()
    {
        // Ids are the relay's and opaque (relay-protocol.md): a whole frame reusing an id is served again, so a chunked
        // set reusing one is too. Before review of step 3 it was acked and dropped, and the relay waited for nothing.
        var log = new LogCapture();
        var (relay, _) = Start(log);
        await relay.AwaitHello();
        var chunks = FakeRelay.ChunksFor("r1", Fetch("r1"), 16);

        foreach (var chunk in chunks) relay.SendBinary(chunk);
        await relay.AwaitFrame("r1", "result");
        foreach (var chunk in chunks) relay.SendBinary(chunk);
        await Eventually(() => relay.FramesOf("r1", "result").Count == 2, "the reused id was not served again:\n" + log);

        Assert.Empty(relay.FramesOf("r1", "error"));
        Assert.Empty(log.At(VoltLogLevel.Warn));
        await Eventually(() => relay.AcksFrom("r1").Count == 2 * chunks.Count, "not every chunk was acked:\n" + log);
    }

    [Fact]
    public async Task A_set_sent_again_under_an_id_already_refused_is_a_new_request()
    {
        var log = new LogCapture();
        var (relay, _) = Start(log);
        await relay.AwaitHello();
        var chunks = FakeRelay.ChunksFor("r1", Fetch("r1"), 16);

        relay.SendBinary(chunks[0]);
        relay.SendBinary(chunks[2]);   // the gap: refused
        await relay.AwaitFrame("r1", "error");
        foreach (var chunk in chunks) relay.SendBinary(chunk);
        await relay.AwaitFrame("r1", "result");

        Assert.Single(relay.FramesOf("r1", "error"));
        Assert.Single(relay.FramesOf("r1", "result"));
    }

    [Fact]
    public async Task A_chunk_past_the_last_of_a_reassembled_set_is_acked_and_named_and_the_id_is_not_answered_twice()
    {
        var log = new LogCapture();
        var (relay, _) = Start(log);
        await relay.AwaitHello();
        var chunks = FakeRelay.ChunksFor("r1", Fetch("r1"), 16);
        var last = chunks.Count - 1;

        foreach (var chunk in chunks) relay.SendBinary(chunk);
        await relay.AwaitFrame("r1", "result");
        relay.SendBinary(chunks[last]);
        await Eventually(() => relay.AcksFrom("r1").Count == chunks.Count + 1, "the repeat was not acked:\n" + log);
        await Eventually(() => log.At(VoltLogLevel.Warn).Any(), "no WARN for the repeat:\n" + log);

        Assert.Single(log.At(VoltLogLevel.Warn), l =>
            l == "relay: ignoring chunk " + last + " of r1 — it arrived after r1 was reassembled on this connection");
        Assert.Single(relay.FramesOf("r1", "result"));
        Assert.Empty(relay.FramesOf("r1", "error"));
    }

    [Fact]
    public async Task A_binary_message_over_the_limit_is_refused_by_its_length_on_the_wire()
    {
        // The real adapter keeps only the first bytes of a message over the limit and hands up its true length.
        var log = new LogCapture();
        var (relay, ide) = Start(log);
        await relay.AwaitHello();
        var prefix = FakeRelay.Chunk(Header0("r1", 1, 100), new byte[ChunkAssembly.MaxBytes])[..ChunkAssembly.MaxBytes];

        relay.SendOversizedBinary(prefix, 500_000_000);
        var error = await relay.AwaitFrame("r1", "error");

        Assert.Equal("chunked request refused: chunk 0 of r1 is 500000000 B, over the 8192 B this bridge announced; it was not run",
            error.GetProperty("message").GetString());
        await Eventually(() => relay.AcksFrom("r1").Count == 1, "the chunk was not acked:\n" + log);
        Assert.Equal(0, ide.WalkCalls);
    }

    [Theory]
    [InlineData(new byte[] { 1, 2, 3 }, "a binary message with no header line")]
    [InlineData(new byte[] { (byte)'x', (byte)'\n', 1 }, "a chunk header that is not JSON")]
    [InlineData(new byte[] { (byte)'{', (byte)'}', (byte)'\n', 1 }, "a chunk header with no string `id`")]
    public async Task A_binary_message_with_no_id_to_answer_is_a_named_warn_and_nothing_else(byte[] message, string reason)
    {
        var log = new LogCapture();
        var (relay, ide) = Start(log);
        await relay.AwaitHello();

        relay.SendBinary(message);
        relay.SendRequest("h", Ops.Health);
        await relay.AwaitFrame("h", "result");

        Assert.Single(log.At(VoltLogLevel.Warn), l => l.StartsWith("relay: ignoring a malformed chunk — " + reason, StringComparison.Ordinal));
        Assert.All(relay.Received.Skip(1), f => Assert.Contains("\"h\"", f));
        Assert.Equal(0, ide.WalkCalls);
    }

    [Fact]
    public async Task A_partial_request_is_discarded_with_its_connection_and_never_served()
    {
        // The relay sent chunk 0 of a fetch, then the connection died. The rest arriving on the NEXT connection must not
        // complete it: a request whose last chunk the relay never sent cannot have run, which is what makes a push safe
        // to retry.
        var log = new LogCapture();
        var delay = new FakeDelay();
        var (relay, ide) = Start(log, delay);
        await relay.AwaitHello();
        var chunks = FakeRelay.ChunksFor("r1", Fetch("r1"), 16);

        relay.SendBinary(chunks[0]);
        await Eventually(() => relay.AcksFrom("r1").Count == 1, "chunk 0 was not acked:\n" + log);
        relay.DieWithoutClose();
        await delay.NextWait();
        delay.Release();
        await Eventually(() => relay.Received.Count(f => f.Contains("\"hello\"")) == 2, "the tunnel did not redial:\n" + log);

        foreach (var chunk in chunks.Skip(1)) relay.SendBinary(chunk);
        var error = await relay.AwaitFrame("r1", "error");

        Assert.Equal(BridgeErrorCodes.BadRequest, error.GetProperty("code").GetString());
        Assert.Equal("chunked request refused: chunk 1 of r1 arrived without chunk 0; it was not run", error.GetProperty("message").GetString());
        await Task.Delay(200);
        Assert.Empty(relay.FramesOf("r1", "result"));
        Assert.Single(relay.FramesOf("r1", "error"));
        Assert.Equal(0, ide.WalkCalls);
        Assert.DoesNotContain(log.At(VoltLogLevel.Info), l => l.StartsWith("relay: <- "));
    }
}
