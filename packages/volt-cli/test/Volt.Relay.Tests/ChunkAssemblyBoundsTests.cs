using System;
using System.Linq;
using System.Text;
using Volt.Relay;
using Xunit;

namespace Volt.Relay.Tests;

/// <summary>What one connection's <see cref="ChunkAssembly"/> may hold (review of gate step 3): the gzip of all its
/// unfinished sets together, what it holds per set and how it names that limit, and how many finished ids it remembers.
/// Driven on the assembly itself: the bounds are about what the bridge holds, which a full tunnel only hides.</summary>
public class ChunkAssemblyBoundsTests
{
    private static ChunkAssembly.Outcome Send(ChunkAssembly assembly, string header, byte[] slice)
    {
        var message = FakeRelay.Chunk(header, slice);
        var read = ChunkAssembly.ReadHeader(message, out var malformed);
        Assert.True(read != null, malformed);
        return assembly.Accept(read!, message, message.Length);
    }

    private static string Header0(string id, int count, long bytes) =>
        "{\"id\":\"" + id + "\",\"seq\":0,\"count\":" + count + ",\"bytes\":" + bytes + "}";

    private static string HeaderN(string id, int seq) => "{\"id\":\"" + id + "\",\"seq\":" + seq + "}";

    [Fact]
    public void The_gzip_of_all_unfinished_sets_on_a_connection_is_bounded_by_one_frame_cap_and_refused_by_name()
    {
        // The reviewer's repro: twenty ids, each stating a huge count and the largest `bytes`, fed round-robin and never
        // finished. Each stays under its own per-set bound; together they would hold ~2.6 GiB in the IDE's process.
        var assembly = new ChunkAssembly();
        var slice = new byte[8000];
        new Random(3).NextBytes(slice);
        const int ids = 20;
        var cap = (long)ChunkAssembly.MaxRequestBytes;
        long held = 0;
        ChunkAssembly.Outcome? refused = null;
        string? refusedId = null;
        int refusedSeq = -1;

        for (var seq = 0; refused == null && seq < 100_000; seq++)
            for (var i = 0; i < ids && refused == null; i++)
            {
                var id = "a" + i;
                var outcome = Send(assembly, seq == 0 ? Header0(id, int.MaxValue, ChunkAssembly.MaxRequestBytes) : HeaderN(id, seq), slice);
                if (outcome.Verdict == ChunkAssembly.Verdict.Refused) { refused = outcome; refusedId = id; refusedSeq = seq; }
                else { Assert.Equal(ChunkAssembly.Verdict.Pending, outcome.Verdict); held += slice.Length; }
            }

        Assert.NotNull(refused);
        Assert.True(held <= cap, held + " B held, over the " + cap + " B cap");
        Assert.True(held + slice.Length > cap, "refused at " + held + " B, before the cap");
        Assert.Equal("chunk " + refusedSeq + " of " + refusedId + " brings this connection's unfinished chunked requests to " +
            (held + slice.Length) + " B of gzip, over the " + cap + " B (one frame cap) the bridge holds at once", refused!.Reason);
        // The refused set's gzip is released: what is held is exactly the other sets'.
        Assert.Equal(held - (long)refusedSeq * slice.Length, assembly.HeldBytes);
    }

    [Fact]
    public void A_set_that_finishes_or_is_refused_releases_its_gzip_from_the_connection_total()
    {
        var assembly = new ChunkAssembly();
        var frame = Encoding.UTF8.GetBytes("{\"id\":\"r1\",\"op\":\"health\",\"protocol\":1}");
        var gzip = FakeRelay.Gzip(frame);
        var half = gzip.Length / 2;

        Assert.Equal(ChunkAssembly.Verdict.Pending, Send(assembly, Header0("r1", 2, frame.Length), gzip[..half]).Verdict);
        Assert.Equal(half, assembly.HeldBytes);
        Assert.Equal(ChunkAssembly.Verdict.Complete, Send(assembly, HeaderN("r1", 1), gzip[half..]).Verdict);
        Assert.Equal(0, assembly.HeldBytes);

        Assert.Equal(ChunkAssembly.Verdict.Pending, Send(assembly, Header0("r2", 3, frame.Length), gzip[..half]).Verdict);
        Assert.Equal(ChunkAssembly.Verdict.Refused, Send(assembly, HeaderN("r2", 2), gzip[half..]).Verdict);
        Assert.Equal(0, assembly.HeldBytes);
    }

    [Fact]
    public void The_per_set_bound_is_named_as_the_bridge_limit_it_is_not_as_what_a_gzip_can_be()
    {
        // A valid single-member gzip of a 10 B frame with a 2000 B FEXTRA field: GzipMember reads past it, so the per-set
        // bound is not "what a gzip of 10 B can take" (valid gzip has no length bound at all: header fields, empty blocks).
        // It is the bridge's own limit, and the refusal says so.
        var raw = Encoding.UTF8.GetBytes("0123456789");
        var plain = FakeRelay.Gzip(raw);
        var extra = new byte[2000];
        var withExtra = new byte[10 + 2 + extra.Length + plain.Length - 10];
        Array.Copy(plain, withExtra, 10);
        withExtra[3] = 0x04;                     // FLG.FEXTRA
        withExtra[10] = (byte)(extra.Length & 0xFF);
        withExtra[11] = (byte)(extra.Length >> 8);
        Array.Copy(plain, 10, withExtra, 12 + extra.Length, plain.Length - 10);
        Assert.Equal(raw, GzipMember.Inflate(withExtra, withExtra.Length, raw.Length));

        var outcome = Send(new ChunkAssembly(), Header0("r1", 1, raw.Length), withExtra);

        Assert.Equal(ChunkAssembly.Verdict.Refused, outcome.Verdict);
        Assert.Equal("chunk 0 of r1 brings the set to " + withExtra.Length + " B of gzip, over the 1044 B this bridge holds " +
            "for a request of 10 B (2 x bytes + 1 KiB)", outcome.Reason);
    }

    [Fact]
    public void A_connection_remembers_a_bounded_number_of_finished_ids()
    {
        // Finished ids are kept only to name a chunk that arrives after its set; a long-lived connection serving fresh ids
        // must not grow without end.
        var assembly = new ChunkAssembly();
        var served = ChunkAssembly.FinishedRemembered + 50;
        for (var n = 0; n < served; n++)
        {
            var id = "r" + n;
            var frame = Encoding.UTF8.GetBytes("{\"id\":\"" + id + "\",\"op\":\"health\",\"protocol\":1}");
            var outcome = Send(assembly, Header0(id, 1, frame.Length), FakeRelay.Gzip(frame));
            Assert.Equal(ChunkAssembly.Verdict.Complete, outcome.Verdict);
        }

        Assert.Equal(ChunkAssembly.FinishedRemembered, assembly.FinishedCount);
        // The most recent finished set still names its straggler.
        var last = "r" + (served - 1);
        var straggler = Send(assembly, HeaderN(last, 1), new byte[] { 0 });
        Assert.Equal(ChunkAssembly.Verdict.Ignored, straggler.Verdict);
        Assert.Equal("it arrived after " + last + " was reassembled on this connection", straggler.Reason);
    }
}
