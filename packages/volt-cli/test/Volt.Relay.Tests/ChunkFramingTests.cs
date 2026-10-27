using System;
using System.Collections.Generic;
using System.IO.Compression;
using System.Linq;
using System.Net.WebSockets;
using System.Text;
using System.Threading.Tasks;
using Volt.Relay;
using Xunit;

namespace Volt.Relay.Tests;

/// <summary>The relay's chunks below the tunnel (openspec relay-chunked-results, review of step 3): the bridge decodes the
/// gzip member itself, so its answer is one answer on net48 (CODESYS in-proc) and net10 (the TwinCAT worker) — and the
/// real socket adapter never holds more of a binary message than the bridge announced.</summary>
public class ChunkFramingTests
{
    private static ChunkAssembly.Outcome Reassemble(string id, byte[] raw, byte[] gzip, int sliceBytes = 8000)
    {
        var assembly = new ChunkAssembly();
        var count = Math.Max(1, (gzip.Length + sliceBytes - 1) / sliceBytes);
        ChunkAssembly.Outcome? outcome = null;
        for (var seq = 0; seq < count; seq++)
        {
            var slice = gzip[Math.Min(gzip.Length, seq * sliceBytes)..Math.Min(gzip.Length, (seq + 1) * sliceBytes)];
            var header = seq == 0
                ? "{\"id\":\"" + id + "\",\"seq\":0,\"count\":" + count + ",\"bytes\":" + raw.Length + "}"
                : "{\"id\":\"" + id + "\",\"seq\":" + seq + "}";
            var message = FakeRelay.Chunk(header, slice);
            var read = ChunkAssembly.ReadHeader(message, out var malformed);
            Assert.True(read != null, malformed);
            outcome = assembly.Accept(read!, message, message.Length);
            if (seq < count - 1) Assert.Equal(ChunkAssembly.Verdict.Pending, outcome.Verdict);
        }
        return outcome!;
    }

    public static IEnumerable<object[]> Texts()
    {
        var random = new Random(11);
        const string alphabet = "abcdefghijklmnopqrstuvwxyz0123456789 :=;{}[]\"\n\tАБВГДЕЖЗИЙКЛМНОПРСТУФабвгдеёжзий€ÄÖÜäöüß";
        string Noise(int chars) => new string(Enumerable.Range(0, chars).Select(_ => alphabet[random.Next(alphabet.Length)]).ToArray());
        yield return new object[] { "one byte", "x" };
        yield return new object[] { "a small frame", "{\"id\":\"r1\",\"op\":\"health\"}" };
        yield return new object[] { "repetitive, 300 KB", string.Concat(Enumerable.Repeat("PROGRAM P\nVAR x : INT; END_VAR\nx := x + 1;\n", 7000)) };
        yield return new object[] { "noisy UTF-8 over several stored blocks, 200 K chars", Noise(200_000) };
    }

    public static IEnumerable<object[]> TextsAtEveryLevel() =>
        from text in Texts()
        from level in new[] { CompressionLevel.NoCompression, CompressionLevel.Fastest, CompressionLevel.Optimal, CompressionLevel.SmallestSize }
        select new object[] { text[0], text[1], level };

    [Theory]
    [MemberData(nameof(TextsAtEveryLevel))]
    public void Every_gzip_the_dotnet_encoder_writes_reassembles_to_the_exact_frame(string situation, string text, CompressionLevel level)
    {
        var raw = Encoding.UTF8.GetBytes(text);
        var outcome = Reassemble("r1", raw, FakeRelay.Gzip(raw, level));

        Assert.True(outcome.Verdict == ChunkAssembly.Verdict.Complete, situation + ": " + outcome.Reason);
        Assert.Equal(text, outcome.Frame);
    }

    [Fact]
    public void A_gzip_header_with_every_optional_field_is_read_past_and_its_header_crc_checked()
    {
        var raw = Encoding.UTF8.GetBytes("{\"id\":\"r1\",\"op\":\"health\"}");
        var plain = FakeRelay.Gzip(raw);
        var header = new List<byte>(plain[..10]);
        header[3] = 0x02 | 0x04 | 0x08 | 0x10;               // FHCRC | FEXTRA | FNAME | FCOMMENT
        header.AddRange(new byte[] { 3, 0, 9, 9, 9 });       // XLEN 3, then 3 bytes
        header.AddRange(Encoding.ASCII.GetBytes("request.json\0"));
        header.AddRange(Encoding.ASCII.GetBytes("a comment\0"));
        var crc = Crc32(header.ToArray());
        header.Add((byte)crc);
        header.Add((byte)(crc >> 8));
        var gzip = header.Concat(plain[10..]).ToArray();

        var outcome = Reassemble("r1", raw, gzip);
        Assert.True(outcome.Verdict == ChunkAssembly.Verdict.Complete, outcome.Reason);

        gzip[header.Count - 1] ^= 0x01;
        var broken = Reassemble("r1", raw, gzip);
        Assert.Equal(ChunkAssembly.Verdict.Refused, broken.Verdict);
        Assert.Equal("the chunks of r1 do not inflate (the gzip header CRC does not match)", broken.Reason);
    }

    // An independent CRC32 (bit by bit, no table), so the test does not grade the bridge's table against itself.
    private static uint Crc32(byte[] data)
    {
        var crc = 0xFFFFFFFFu;
        foreach (var b in data)
        {
            crc ^= b;
            for (var k = 0; k < 8; k++) crc = (crc & 1) != 0 ? (crc >> 1) ^ 0xEDB88320u : crc >> 1;
        }
        return ~crc;
    }

    // ── the real adapter never buffers past the limit ─────────────────────

    private static Func<ArraySegment<byte>, Task<WebSocketReceiveResult>> Script(params (byte[] Bytes, WebSocketMessageType Type, bool End)[] reads)
    {
        var queue = new Queue<(byte[] Bytes, WebSocketMessageType Type, bool End)>(reads);
        return buffer =>
        {
            var (bytes, type, end) = queue.Dequeue();
            Assert.True(bytes.Length <= buffer.Count, "a scripted read larger than the adapter's buffer");
            Buffer.BlockCopy(bytes, 0, buffer.Array!, buffer.Offset, bytes.Length);
            return Task.FromResult(new WebSocketReceiveResult(bytes.Length, type, end));
        };
    }

    private static byte[] Filled(int length, byte value) => Enumerable.Repeat(value, length).ToArray();

    [Fact]
    public async Task A_binary_message_over_the_limit_keeps_only_its_first_bytes_and_hands_up_its_length_on_the_wire()
    {
        var head = FakeRelay.Chunk("{\"id\":\"r1\",\"seq\":0,\"count\":1,\"bytes\":9}", Filled(16 * 1024 - 40, 1));
        var reads = new List<(byte[], WebSocketMessageType, bool)> { (head[..(16 * 1024)], WebSocketMessageType.Binary, false) };
        for (var i = 0; i < 1000; i++) reads.Add((Filled(16 * 1024, 2), WebSocketMessageType.Binary, false));
        reads.Add((Filled(100, 3), WebSocketMessageType.Binary, true));

        var received = await RelayReceived.ReadAsync(Script(reads.ToArray()), 16 * 1024);

        Assert.Equal(ChunkAssembly.MaxBytes, received.Bytes!.Length);
        Assert.Equal(head[..ChunkAssembly.MaxBytes], received.Bytes);
        Assert.Equal(16L * 1024 * 1001 + 100, received.Length);
    }

    [Fact]
    public async Task A_binary_message_at_the_limit_and_a_text_frame_arrive_whole()
    {
        var chunk = Filled(ChunkAssembly.MaxBytes, 7);
        var binary = await RelayReceived.ReadAsync(Script(
            (chunk[..5000], WebSocketMessageType.Binary, false), (chunk[5000..], WebSocketMessageType.Binary, true)), 16 * 1024);
        Assert.Equal(chunk, binary.Bytes);
        Assert.Equal(chunk.Length, binary.Length);

        var text = string.Concat(Enumerable.Repeat("x", 40_000));
        var bytes = Encoding.UTF8.GetBytes(text);
        var frame = await RelayReceived.ReadAsync(Script(
            (bytes[..16384], WebSocketMessageType.Text, false), (bytes[16384..32768], WebSocketMessageType.Text, false),
            (bytes[32768..], WebSocketMessageType.Text, true)), 16 * 1024);
        Assert.Equal(text, frame.Text);
    }
}
