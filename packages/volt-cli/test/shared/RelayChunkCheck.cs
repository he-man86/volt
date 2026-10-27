using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Text.Json;
using Xunit;

namespace Volt.Tests.Shared;

/// <summary>The chunk contract as a RELAY checks it (openspec relay-chunked-results design.md, Relay obligations),
/// restated from the contract and not taken from the bridge, so the real-socket tests grade the bridge's chunks by what
/// PLC Assist's relay refuses as <c>chunk_invalid</c>: the header's exact members (<c>id</c>, <c>seq</c>, and
/// <c>count</c> + <c>bytes</c> on seq 0 only), every message within <c>maxBytes</c>, seq 0 first, no gap, no duplicate,
/// no more than <c>count</c>, the <c>count</c> and <c>bytes</c> guards, and the gzip member: its header, the set's last
/// 8 bytes as its trailer (CRC32 of the output, ISIZE = <c>bytes</c>), inflated by <see cref="DeflateStream"/> to
/// exactly <c>bytes</c>. Not GZipStream: it accepts a missing trailer (design.md).</summary>
public sealed class RelayChunkCheck
{
    public sealed class Invalid : Exception
    {
        public Invalid(string message) : base(message) { }
    }

    private const long CountGuard = 32L * 1024 * 1024;
    private const long BytesGuard = 64L * 1024 * 1024;

    private sealed class Set
    {
        public int Count;
        public long Bytes;
        public int Next;
        public readonly MemoryStream Gzip = new MemoryStream();
    }

    private readonly int _maxBytes;
    private readonly Dictionary<string, Set> _open = new Dictionary<string, Set>();
    private readonly HashSet<string> _done = new HashSet<string>();

    public RelayChunkCheck(int maxBytes) => _maxBytes = maxBytes;

    /// <summary>The id and seq a chunk's header names: what the relay acks before anything else.</summary>
    public static (string Id, int Seq) IdAndSeq(byte[] message)
    {
        using var header = ParseHeader(message, out _);
        var root = header.RootElement;
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("id", out var id) || id.ValueKind != JsonValueKind.String)
            throw new Invalid("the header names no id");
        if (!root.TryGetProperty("seq", out var seq) || seq.ValueKind != JsonValueKind.Number || !seq.TryGetInt32(out var s) || s < 0)
            throw new Invalid("the header names no seq");
        return (id.GetString()!, s);
    }

    private static JsonDocument ParseHeader(byte[] message, out int newline)
    {
        newline = Array.IndexOf(message, (byte)'\n');
        if (newline < 0) throw new Invalid("no header line");
        try { return JsonDocument.Parse(Encoding.UTF8.GetString(message, 0, newline)); }
        catch (JsonException) { throw new Invalid("the header line is not JSON"); }
    }

    /// <summary>Takes one binary message: the whole frame once its set is complete, null before; <see cref="Invalid"/>
    /// for anything the contract refuses (the set is then dropped).</summary>
    public byte[]? Add(byte[] message)
    {
        var (id, seq) = IdAndSeq(message);
        try { return AddChecked(message, id, seq); }
        catch (Invalid) { _open.Remove(id); throw; }
    }

    private byte[]? AddChecked(byte[] message, string id, int seq)
    {
        if (message.Length > _maxBytes) throw new Invalid("a message of " + message.Length + " B, over maxBytes " + _maxBytes);
        if (_done.Contains(id)) throw new Invalid("seq " + seq + " after the set was whole");
        using var header = ParseHeader(message, out var newline);
        var members = header.RootElement.EnumerateObject().Select(p => p.Name).ToList();
        var expected = seq == 0 ? new[] { "id", "seq", "count", "bytes" } : new[] { "id", "seq" };
        if (!members.SequenceEqual(expected))
            throw new Invalid("seq " + seq + "'s header has {" + string.Join(",", members) + "}, not {" + string.Join(",", expected) + "}");

        if (seq == 0)
        {
            if (_open.ContainsKey(id)) throw new Invalid("a duplicate seq 0");
            var root = header.RootElement;
            var c = root.GetProperty("count");
            if (c.ValueKind != JsonValueKind.Number || !c.TryGetInt32(out var count) || count < 1) throw new Invalid("count is not a positive integer");
            var b = root.GetProperty("bytes");
            if (b.ValueKind != JsonValueKind.Number || !b.TryGetInt64(out var bytes) || bytes < 0) throw new Invalid("bytes is not a non-negative integer");
            if ((long)count * _maxBytes > CountGuard) throw new Invalid("count " + count + " × maxBytes is over 32 MiB");
            if (bytes > BytesGuard) throw new Invalid("bytes " + bytes + " is over 64 MiB");
            _open[id] = new Set { Count = count, Bytes = bytes };
        }
        if (!_open.TryGetValue(id, out var set)) throw new Invalid("seq " + seq + " without seq 0");
        if (seq < set.Next) throw new Invalid("a duplicate seq " + seq);
        if (seq > set.Next) throw new Invalid("a gap: seq " + seq + " where " + set.Next + " was due");
        if (seq >= set.Count) throw new Invalid("seq " + seq + ", more than count " + set.Count);
        set.Gzip.Write(message, newline + 1, message.Length - newline - 1);
        set.Next++;
        if (set.Next < set.Count) return null;

        _open.Remove(id);
        _done.Add(id);
        return Inflate(set.Gzip.ToArray(), set.Bytes);
    }

    private static byte[] Inflate(byte[] gzip, long bytes)
    {
        if (gzip.Length < 18 || gzip[0] != 0x1f || gzip[1] != 0x8b || gzip[2] != 8) throw new Invalid("not a deflate gzip member");
        int flags = gzip[3], at = 10;
        if ((flags & 0xE0) != 0) throw new Invalid("reserved gzip FLG bits set");
        if ((flags & 0x04) != 0) at += 2 + (gzip[at] | gzip[at + 1] << 8);
        if ((flags & 0x08) != 0 && at < gzip.Length) at = Array.IndexOf(gzip, (byte)0, at) + 1;
        if ((flags & 0x10) != 0 && at > 0 && at < gzip.Length) at = Array.IndexOf(gzip, (byte)0, at) + 1;
        if ((flags & 0x02) != 0) at += 2;
        var trailer = gzip.Length - 8;
        if (at <= 0 || at > trailer) throw new Invalid("the gzip header runs into the trailer");

        var output = new MemoryStream();
        try
        {
            using var deflate = new DeflateStream(new MemoryStream(gzip, at, trailer - at), CompressionMode.Decompress);
            var buffer = new byte[16 * 1024];
            int n;
            while ((n = deflate.Read(buffer, 0, buffer.Length)) > 0)
            {
                output.Write(buffer, 0, n);
                if (output.Length > bytes) throw new Invalid("inflates past the " + bytes + " B seq 0 states");
            }
        }
        catch (InvalidDataException) { throw new Invalid("an inflate error"); }
        var whole = output.ToArray();
        if (whole.Length != bytes) throw new Invalid("inflates to " + whole.Length + " B, not the " + bytes + " B seq 0 states");
        if (ReadUInt32(gzip, trailer) != Crc32(whole)) throw new Invalid("the gzip trailer's CRC32 does not match");
        if (ReadUInt32(gzip, trailer + 4) != (uint)bytes) throw new Invalid("the gzip trailer's ISIZE is not bytes");
        return whole;
    }

    private static uint ReadUInt32(byte[] b, int at) => (uint)(b[at] | b[at + 1] << 8 | b[at + 2] << 16 | b[at + 3] << 24);

    private static uint Crc32(byte[] data)
    {
        var crc = 0xFFFFFFFFu;
        foreach (var d in data)
        {
            crc ^= d;
            for (var k = 0; k < 8; k++) crc = (crc & 1) != 0 ? (crc >> 1) ^ 0xEDB88320u : crc >> 1;
        }
        return ~crc;
    }
}

/// <summary>The test relay's chunk check refuses what a real relay refuses (review of step 5): in the net48 suite it is
/// the only chunk-contract check there is, so a bridge that states a wrong <c>bytes</c>, drops the trailer or repeats a
/// chunk must turn the real-socket test red. The sets are built here with the runtime's GZipStream, not the bridge's
/// splitter.</summary>
public class RelayChunkCheckTests
{
    private const int MaxBytes = 256;
    private const int Room = 160;

    private static readonly byte[] Frame = Encoding.UTF8.GetBytes("{\"id\":\"r1\",\"result\":\"" + RealSocketScale.Noise().Substring(0, 900) + "\"}");

    private static byte[] Gzip(byte[] raw)
    {
        using var buffer = new MemoryStream();
        using (var gz = new GZipStream(buffer, CompressionLevel.Optimal, leaveOpen: true)) gz.Write(raw, 0, raw.Length);
        return buffer.ToArray();
    }

    /// <summary><paramref name="gzip"/> split into messages of at most <see cref="MaxBytes"/>, each headed by what
    /// <paramref name="header"/> writes for (seq, count).</summary>
    private static List<byte[]> Split(byte[] gzip, Func<int, int, string> header)
    {
        var count = (gzip.Length + Room - 1) / Room;
        var messages = new List<byte[]>();
        for (var seq = 0; seq < count; seq++)
        {
            var h = Encoding.UTF8.GetBytes(header(seq, count) + "\n");
            var take = Math.Min(Room, gzip.Length - seq * Room);
            var m = new byte[h.Length + take];
            Buffer.BlockCopy(h, 0, m, 0, h.Length);
            Buffer.BlockCopy(gzip, seq * Room, m, h.Length, take);
            messages.Add(m);
        }
        return messages;
    }

    private static Func<int, int, string> Headers(long bytes) => (seq, count) => seq == 0
        ? "{\"id\":\"r1\",\"seq\":0,\"count\":" + count + ",\"bytes\":" + bytes + "}"
        : "{\"id\":\"r1\",\"seq\":" + seq + "}";

    private static List<byte[]> Good() => Split(Gzip(Frame), Headers(Frame.Length));

    private static byte[]? Feed(IEnumerable<byte[]> messages)
    {
        var check = new RelayChunkCheck(MaxBytes);
        byte[]? whole = null;
        foreach (var m in messages) whole = check.Add(m) ?? whole;
        return whole;
    }

    private static string Refusal(IEnumerable<byte[]> messages) => Assert.Throws<RelayChunkCheck.Invalid>(() => Feed(messages)).Message;

    [Fact]
    public void A_whole_set_reassembles_to_the_frame()
    {
        var messages = Good();
        Assert.True(messages.Count > 2, messages.Count + " messages");
        Assert.Equal(Frame, Feed(messages));
    }

    [Fact]
    public void A_wrong_bytes_is_refused() =>
        Assert.Contains("not the " + (Frame.Length + 1) + " B", Refusal(Split(Gzip(Frame), Headers(Frame.Length + 1))));

    [Fact]
    public void A_set_without_its_trailer_is_refused()
    {
        var gzip = Gzip(Frame);
        Refusal(Split(gzip.Take(gzip.Length - 8).ToArray(), Headers(Frame.Length)));
    }

    [Fact]
    public void A_bad_crc_is_refused()
    {
        var gzip = Gzip(Frame);
        gzip[gzip.Length - 8] ^= 0xff;
        Assert.Contains("CRC32", Refusal(Split(gzip, Headers(Frame.Length))));
    }

    [Fact]
    public void A_bad_isize_is_refused()
    {
        var gzip = Gzip(Frame);
        gzip[gzip.Length - 4] ^= 0x01;
        Assert.Contains("ISIZE", Refusal(Split(gzip, Headers(Frame.Length))));
    }

    [Fact]
    public void A_duplicate_chunk_is_refused()
    {
        var messages = Good();
        messages.Insert(2, messages[1]);
        Assert.Contains("duplicate", Refusal(messages));
    }

    [Fact]
    public void A_gap_is_refused()
    {
        var messages = Good();
        messages.RemoveAt(1);
        Assert.Contains("gap", Refusal(messages));
    }

    [Fact]
    public void A_seq_without_seq_0_is_refused() => Assert.Contains("without seq 0", Refusal(Good().Skip(1)));

    [Fact]
    public void A_chunk_after_the_set_was_whole_is_refused()
    {
        var messages = Good();
        messages.Add(messages[messages.Count - 1]);
        Assert.Contains("after the set was whole", Refusal(messages));
    }

    [Fact]
    public void Count_on_a_later_seq_is_refused() =>
        Assert.Contains("header has", Refusal(Split(Gzip(Frame), (seq, count) =>
            "{\"id\":\"r1\",\"seq\":" + seq + ",\"count\":" + count + (seq == 0 ? ",\"bytes\":" + Frame.Length : "") + "}")));

    [Fact]
    public void A_message_over_maxBytes_is_refused()
    {
        var messages = Good();
        var big = new byte[MaxBytes + 1];
        Buffer.BlockCopy(messages[0], 0, big, 0, messages[0].Length);
        messages[0] = big;
        Assert.Contains("over maxBytes", Refusal(messages));
    }
}
