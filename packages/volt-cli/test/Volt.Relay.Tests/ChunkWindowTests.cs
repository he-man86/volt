using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Volt.Relay;
using Xunit;

namespace Volt.Relay.Tests;

/// <summary>The chunk splitter and the per-connection window, as logic (openspec relay-chunked-results §2.3, §2.4).
/// The tunnel tests (<see cref="ChunkedResultTests"/>) drive the same code through a real tunnel; these pin the
/// arithmetic a tunnel test cannot reach in a second — a 5 s rate window and a 256 KiB cap.</summary>
public class ChunkWindowTests
{
    private static string RandomFrame(int randomBytes, int seed = 7)
    {
        var noise = new byte[randomBytes];
        new Random(seed).NextBytes(noise);
        return "{\"id\":\"r1\",\"result\":{\"text\":\"" + Convert.ToBase64String(noise) + "\"}}";
    }

    private static byte[] Inflate(IEnumerable<byte[]> messages)
    {
        using var gz = new MemoryStream();
        foreach (var m in messages) gz.Write(FakeRelay.ParseChunk(m).Slice);
        gz.Position = 0;
        using var inflate = new GZipStream(gz, CompressionMode.Decompress);
        using var frame = new MemoryStream();
        inflate.CopyTo(frame);
        return frame.ToArray();
    }

    // ── splitting ───────────────────────────────────────────────

    [Theory]
    [InlineData(20_000, 8192)]
    [InlineData(200_000, 8192)]
    // 1024 B messages over ~270 KB of gzip: over 100 chunks, so `count` gains digits while the split is found.
    [InlineData(200_000, 1024)]
    public void A_split_frame_reassembles_byte_for_byte_and_every_message_fits(int randomBytes, int maxBytes)
    {
        var frame = RandomFrame(randomBytes);
        var messages = RelayChunks.Split("r1", frame, maxBytes);

        Assert.Equal(Encoding.UTF8.GetBytes(frame), Inflate(messages));
        Assert.All(messages, m => Assert.True(m.Length <= maxBytes, "a message of " + m.Length + " B"));
        // Every message but the last is FULL: no chunk is wasted.
        Assert.All(messages.Take(messages.Count - 1), m => Assert.Equal(maxBytes, m.Length));
        var first = FakeRelay.ParseChunk(messages[0]).Header;
        Assert.Equal(messages.Count, first.GetProperty("count").GetInt32());
        Assert.Equal(Encoding.UTF8.GetByteCount(frame), first.GetProperty("bytes").GetInt32());
        for (var seq = 1; seq < messages.Count; seq++)
            Assert.Equal("{\"id\":\"r1\",\"seq\":" + seq + "}", JsonSerializer.Serialize(FakeRelay.ParseChunk(messages[seq]).Header));
    }

    [Fact]
    public void The_header_line_is_exactly_the_contract_s_shape()
    {
        var frame = RandomFrame(20_000);
        var messages = RelayChunks.Split("r1", frame, 8192);
        var headerLine = Encoding.UTF8.GetString(messages[0], 0, Array.IndexOf(messages[0], (byte)'\n'));
        Assert.Equal("{\"id\":\"r1\",\"seq\":0,\"count\":" + messages.Count + ",\"bytes\":" + Encoding.UTF8.GetByteCount(frame) + "}", headerLine);
    }

    [Fact]
    public void Whether_an_id_fits_is_known_before_the_answer_exists()
    {
        // The tunnel asks this at intake, before the op runs, and refuses the request by name when it is false.
        Assert.True(RelayChunks.IdFits("r1", 1024));
        Assert.False(RelayChunks.IdFits(new string('x', 1000), 1024));
        Assert.False(RelayChunks.IdFits("r1", 40));
    }

    [Fact]
    public void An_id_that_fits_splits_whatever_the_answer_s_count_and_bytes()
    {
        // The longest id that fits leaves ONE byte of data per chunk under the worst-case header (10-digit count and
        // bytes): every real split of it, whose count and bytes have fewer digits, has room.
        const int maxBytes = 1024;
        var id = "x";
        while (RelayChunks.IdFits(id + "x", maxBytes)) id += "x";
        var frame = RandomFrame(2_000);
        var messages = RelayChunks.Split(id, frame, maxBytes);
        Assert.Equal(Encoding.UTF8.GetBytes(frame), Inflate(messages));
        Assert.All(messages, m => Assert.True(m.Length <= maxBytes));
    }

    [Fact]
    public void Splitting_for_an_id_that_does_not_fit_is_a_broken_invariant_not_a_quiet_drop()
    {
        var ex = Assert.Throws<Volt.Contracts.VoltInvariantException>(() => RelayChunks.Split(new string('x', 2000), RandomFrame(20_000), 1024));
        Assert.Contains("refused at intake", ex.Message);
    }

    // ── the window ──────────────────────────────────────────────

    private sealed class Clock
    {
        public TimeSpan Now = TimeSpan.FromSeconds(100);
        public TimeSpan Read() => Now;
    }

    private static IReadOnlyList<byte[]> Messages(string id, int count, int size = 8192) =>
        Enumerable.Range(0, count).Select(seq =>
        {
            var head = Encoding.UTF8.GetBytes("{\"id\":\"" + id + "\",\"seq\":" + seq + "}\n");
            var m = new byte[size];
            head.CopyTo(m, 0);
            return m;
        }).ToList();

    private static List<RelayChunks.Outgoing> TakeAll(ChunkWindow window)
    {
        var taken = new List<RelayChunks.Outgoing>();
        while (window.TryTake(out var c)) taken.Add(c);
        return taken;
    }

    [Fact]
    public void The_window_starts_at_16_KiB()
    {
        var window = new ChunkWindow(new Clock().Read);
        _ = window.Enqueue("a", Messages("a", 10));
        Assert.Equal(16 * 1024, window.Window);
        Assert.Equal(2, TakeAll(window).Count);
    }

    [Fact]
    public void The_window_is_the_bytes_acked_over_the_last_5_s_clamped_to_16_and_256_KiB()
    {
        var clock = new Clock();
        var window = new ChunkWindow(clock.Read);
        _ = window.Enqueue("a", Messages("a", 100));

        void AckNext(int n)
        {
            for (var i = 0; i < n; i++)
            {
                Assert.True(window.TryTake(out var c));
                Assert.True(window.Ack("a", c.Seq));
            }
        }

        // 5 chunks (40 KiB) acked within 5 s: W = 40 KiB.
        AckNext(5);
        Assert.Equal(40 * 1024, window.Window);
        // 40 more (320 KiB in the span): capped at 256 KiB.
        clock.Now += TimeSpan.FromSeconds(1);
        AckNext(40);
        Assert.Equal(256 * 1024, window.Window);
        // Over 5 s later, nothing was acked in the span: back to the floor.
        clock.Now += TimeSpan.FromSeconds(5.5);
        Assert.Equal(16 * 1024, window.Window);
    }

    [Fact]
    public void From_a_cold_start_the_window_at_most_doubles_per_round()
    {
        // design.md's ramp: the acked sum grows by at most the window it allowed, so W doubles per round after the
        // first and reaches the 256 KiB cap in 5 rounds (at 300 ms RTT about 1.5 s).
        var window = new ChunkWindow(new Clock().Read);
        _ = window.Enqueue("a", Messages("a", 200));
        var seen = new List<int>();
        for (var round = 0; round < 6; round++)
        {
            seen.Add(window.Window);
            foreach (var c in TakeAll(window)) Assert.True(window.Ack(c.Id, c.Seq));
        }
        Assert.Equal(new[] { 16384, 16384, 32768, 65536, 131072, 262144 }, seen);
    }

    [Fact]
    public void Unacked_bytes_never_exceed_the_window_and_whole_ids_go_out_first_in_first_out()
    {
        var clock = new Clock();
        var window = new ChunkWindow(clock.Read);
        _ = window.Enqueue("a", Messages("a", 3));
        _ = window.Enqueue("b", Messages("b", 2));

        var order = new List<string>();
        for (var round = 0; round < 10 && order.Count < 5; round++)
        {
            var taken = TakeAll(window);
            Assert.True(taken.Sum(c => c.Message.Length) <= window.Window);
            foreach (var c in taken) { order.Add(c.Id + c.Seq); }
            foreach (var c in taken) Assert.True(window.Ack(c.Id, c.Seq));
        }
        Assert.Equal(new[] { "a0", "a1", "a2", "b0", "b1" }, order);
    }

    [Fact]
    public async Task A_delivery_completes_at_the_last_ack_and_an_ack_for_nothing_is_refused()
    {
        var window = new ChunkWindow(new Clock().Read);
        var delivered = window.Enqueue("a", Messages("a", 2));
        var taken = TakeAll(window);
        Assert.Equal(2, taken.Count);

        Assert.True(window.Ack("a", 1));
        Assert.False(delivered.IsCompleted);
        Assert.False(window.Ack("a", 1), "a second ack for the same chunk acks nothing");
        Assert.False(window.Ack("zzz", 0));
        Assert.True(window.Ack("a", 0));
        await delivered;
    }

    [Fact]
    public async Task Closing_the_window_abandons_every_pending_delivery()
    {
        var window = new ChunkWindow(new Clock().Read);
        var a = window.Enqueue("a", Messages("a", 4));
        TakeAll(window);
        window.Close();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => a);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => window.Enqueue("b", Messages("b", 1)));
    }

    [Fact]
    public void The_oldest_unacked_chunk_is_stalled_only_past_the_limit()
    {
        var clock = new Clock();
        var window = new ChunkWindow(clock.Read);
        _ = window.Enqueue("a", Messages("a", 2));
        TakeAll(window);
        clock.Now += TimeSpan.FromSeconds(60);
        Assert.Null(window.Stalled(TimeSpan.FromSeconds(60)));
        clock.Now += TimeSpan.FromMilliseconds(1);
        var stalled = window.Stalled(TimeSpan.FromSeconds(60));
        Assert.NotNull(stalled);
        Assert.Equal(("a", 0), (stalled!.Id, stalled.Seq));
    }
}
