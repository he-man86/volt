using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Text.Json;
using Volt.Wire;

namespace Volt.Relay
{
    /// <summary>Reassembling the relay's chunks of a large REQUEST (openspec relay-chunked-results, the mirror image).
    /// One per connection, never carried to the next: a request whose last chunk did not arrive on THIS connection is
    /// never served, so a request whose last chunk the relay never sent cannot have run.
    ///
    /// <para>A chunk is one binary message: a JSON header line, <c>\n</c>, then a slice of gzip(the request's UTF-8).
    /// Seq 0 states <c>count</c> and <c>bytes</c>. The slices, in seq order and inflated, are the exact request frame.</para>
    ///
    /// <para>Driven from the receive loop only, so it holds no lock.</para></summary>
    internal sealed class ChunkAssembly
    {
        /// <summary>The largest chunk message this bridge takes — what its <c>hello</c> states.</summary>
        public const int MaxBytes = 8192;

        /// <summary>The largest request a chunked set may state: the pipe's own frame cap, which the request crosses next.</summary>
        public const int MaxRequestBytes = PipeServer.MaxFrameBytes;

        /// <summary>The most gzip this bridge holds for ONE set stating <paramref name="bytes"/>: twice the bytes plus 1 KiB.
        /// It is the bridge's own limit, not a property of gzip — a valid member has no length bound (header fields, empty
        /// blocks). A standard writer stays far inside it: one that keeps a block stored when coding would not shrink it
        /// (zlib, miniz, .NET) writes at most bytes + 5 per 64 KiB stored block + 18. It refuses a huge stated
        /// <c>count</c> of 8 KiB slices for a small request before the bridge buffers them.</summary>
        private static long MaxGzipBytes(long bytes) => 2 * bytes + 1024;

        /// <summary>The most gzip ALL of a connection's unfinished sets hold together: one frame cap. The per-set bound
        /// alone lets a relay spread a large hold over many ids, and the tunnel acks every chunk at once, so the relay's
        /// window bounds only what is in flight, never what the bridge holds — in the IDE's own process (32-bit CODESYS
        /// among them).</summary>
        public const long MaxHeldBytes = PipeServer.MaxFrameBytes;

        /// <summary>How many finished ids (reassembled or refused) a connection remembers, oldest forgotten first, to name a
        /// chunk that arrives after its set. Bounded so a connection that lives for days does not grow with every request it
        /// serves; a chunk of an id further back is judged on its own.</summary>
        public const int FinishedRemembered = 256;

        /// <summary>One chunk's header line, read before anything else so its ack can go out at once.</summary>
        public sealed class Header
        {
            public Header(string id, int? seq, int? count, long? bytes, int sliceAt)
            { Id = id; Seq = seq; Count = count; Bytes = bytes; SliceAt = sliceAt; }
            public string Id { get; }
            /// <summary>Null when the header states no non-negative integer <c>seq</c>: the chunk cannot be acked.</summary>
            public int? Seq { get; }
            /// <summary>A positive <c>count</c>, or null when the header states none.</summary>
            public int? Count { get; }
            /// <summary>The integer <c>bytes</c> stated, or null when the header states none.</summary>
            public long? Bytes { get; }
            /// <summary>Where the gzip slice starts in the message: after the header's <c>\n</c>.</summary>
            public int SliceAt { get; }
        }

        public enum Verdict
        {
            /// <summary>Taken; the request is not complete yet.</summary>
            Pending,
            /// <summary>The last chunk: <see cref="Outcome.Frame"/> is the whole request frame.</summary>
            Complete,
            /// <summary>The set is broken: the id is answered BAD_REQUEST, by <see cref="Outcome.Reason"/>, and never served.</summary>
            Refused,
            /// <summary>A chunk past the end of a set this connection has already refused (no reason: the relay sends what was
            /// on its way) or already reassembled (<see cref="Outcome.Reason"/> says so). Dropped, never answered a second
            /// time. A chunk 0 is never ignored: it starts a new request under the id, as a whole frame reusing it would.</summary>
            Ignored,
        }

        public sealed class Outcome
        {
            private Outcome(Verdict verdict, string? frame, string? reason) { Verdict = verdict; Frame = frame; Reason = reason; }
            public Verdict Verdict { get; }
            public string? Frame { get; }
            public string? Reason { get; }
            internal static readonly Outcome Pending = new Outcome(Verdict.Pending, null, null);
            internal static Outcome Complete(string frame) => new Outcome(Verdict.Complete, frame, null);
            internal static Outcome Refused(string reason) => new Outcome(Verdict.Refused, null, reason);
            internal static Outcome Ignored(string? reason) => new Outcome(Verdict.Ignored, null, reason);
        }

        private sealed class Partial
        {
            public Partial(int count, int bytes) { Count = count; Bytes = bytes; }
            public int Count { get; }
            public int Bytes { get; }
            public int Next = 1;
            /// <summary>The slices as they arrived, each copied at its own length: no doubling buffer.</summary>
            public readonly List<byte[]> Slices = new List<byte[]>();
            public long Held;
        }

        private readonly Dictionary<string, Partial> _partial = new Dictionary<string, Partial>(StringComparer.Ordinal);
        /// <summary>Finished ids: true when refused, false when reassembled. <see cref="_finishedOrder"/> keeps their order,
        /// so the oldest is forgotten past <see cref="FinishedRemembered"/>.</summary>
        private readonly Dictionary<string, bool> _finished = new Dictionary<string, bool>(StringComparer.Ordinal);
        private readonly LinkedList<string> _finishedOrder = new LinkedList<string>();
        private long _held;

        /// <summary>The gzip all unfinished sets on this connection hold.</summary>
        public long HeldBytes => _held;

        /// <summary>How many finished ids this connection remembers (at most <see cref="FinishedRemembered"/>).</summary>
        public int FinishedCount => _finished.Count;

        private static string N(long value) => value.ToString(CultureInfo.InvariantCulture);

        private void Finish(string id, bool refused)
        {
            Forget(id);
            _finished[id] = refused;
            _finishedOrder.AddLast(id);
            if (_finishedOrder.Count > FinishedRemembered)
            {
                _finished.Remove(_finishedOrder.First!.Value);
                _finishedOrder.RemoveFirst();
            }
        }

        private void Forget(string id)
        {
            if (_finished.Remove(id)) _finishedOrder.Remove(id);
        }

        /// <summary>Drops an unfinished set and takes its gzip off the connection's total.</summary>
        private void Release(string id)
        {
            if (_partial.TryGetValue(id, out var partial))
            {
                _held -= partial.Held;
                _partial.Remove(id);
            }
        }

        /// <summary>The header of <paramref name="message"/>, or null with <paramref name="malformed"/> when it names no id
        /// — then there is no one to answer, and the chunk is a WARN and nothing else.</summary>
        public static Header? ReadHeader(byte[] message, out string? malformed)
        {
            malformed = null;
            var newline = Array.IndexOf(message, (byte)'\n');
            if (newline < 0) { malformed = "a binary message with no header line"; return null; }

            JsonDocument doc;
            try { doc = JsonDocument.Parse(new ReadOnlyMemory<byte>(message, 0, newline)); }
            catch (JsonException ex) { malformed = "a chunk header that is not JSON: " + ex.Message; return null; }
            using (doc)
            {
                var root = doc.RootElement;
                if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("id", out var id) || id.ValueKind != JsonValueKind.String)
                {
                    malformed = "a chunk header with no string `id`";
                    return null;
                }
                int? seq = root.TryGetProperty("seq", out var s) && s.ValueKind == JsonValueKind.Number && s.TryGetInt32(out var sv) && sv >= 0
                    ? sv : (int?)null;
                int? count = root.TryGetProperty("count", out var c) && c.ValueKind == JsonValueKind.Number && c.TryGetInt32(out var cv) && cv > 0
                    ? cv : (int?)null;
                long? bytes = root.TryGetProperty("bytes", out var b) && b.ValueKind == JsonValueKind.Number && b.TryGetInt64(out var bv)
                    ? bv : (long?)null;
                return new Header(id.GetString()!, seq, count, bytes, newline + 1);
            }
        }

        /// <summary>Take one chunk whose header <see cref="ReadHeader"/> read: <paramref name="message"/> is the chunk (only
        /// its first bytes when it was over the limit) and <paramref name="length"/> its length on the wire. The ack has gone
        /// out already: it is sent for every chunk with an id and a seq, refused or not, so a broken set never holds the
        /// relay's window.</summary>
        public Outcome Accept(Header header, byte[] message, long length)
        {
            var id = header.Id;
            if (header.Seq == 0)
            {
                // Ids are the relay's and opaque (relay-protocol.md): a whole frame reusing one is served again, so a chunk
                // 0 starts a new request under it, whatever this connection did with the id before.
                Forget(id);
            }
            else if (_finished.TryGetValue(id, out var wasRefused))
                return wasRefused ? Outcome.Ignored(null) : Outcome.Ignored("it arrived after " + id + " was reassembled on this connection");

            var verdict = Take(header, message, length);
            if (verdict.Verdict == Verdict.Refused) { Release(id); Finish(id, refused: true); }
            else if (verdict.Verdict == Verdict.Complete) Finish(id, refused: false);
            return verdict;
        }

        private Outcome Take(Header header, byte[] message, long length)
        {
            var id = header.Id;
            if (header.Seq == null) return Outcome.Refused("a chunk of " + id + " has no chunk number (`seq`, a non-negative integer)");
            var seq = header.Seq.Value;
            var name = "chunk " + N(seq) + " of " + id;
            if (length > MaxBytes)
                return Outcome.Refused(name + " is " + N(length) + " B, over the " + N(MaxBytes) + " B this bridge announced");

            Partial? partial;
            _partial.TryGetValue(id, out partial);
            if (seq == 0)
            {
                if (partial != null) return Outcome.Refused(name + " arrived twice");
                if (header.Count == null) return Outcome.Refused(name + " has no positive integer `count`");
                if (header.Bytes == null || header.Bytes.Value < 1) return Outcome.Refused(name + " has no positive integer `bytes`");
                if (header.Bytes.Value > MaxRequestBytes)
                    return Outcome.Refused(name + " states " + N(header.Bytes.Value) + " B, over the " + N(MaxRequestBytes) + " B frame cap");
                partial = new Partial(header.Count.Value, (int)header.Bytes.Value);
                _partial[id] = partial;
            }
            else
            {
                if (partial == null) return Outcome.Refused(name + " arrived without chunk 0");
                if (seq >= partial.Count) return Outcome.Refused(name + " is past the " + N(partial.Count) + " chunks chunk 0 states");
                if (seq < partial.Next) return Outcome.Refused(name + " arrived twice");
                if (seq > partial.Next)
                    return Outcome.Refused(name + " arrived after chunk " + N(partial.Next - 1) + ": chunk " + N(partial.Next) + " is missing");
                partial.Next++;
            }

            var slice = message.Length - header.SliceAt;
            var held = partial.Held + slice;
            if (held > MaxGzipBytes(partial.Bytes))
                return Outcome.Refused(name + " brings the set to " + N(held) + " B of gzip, over the " +
                    N(MaxGzipBytes(partial.Bytes)) + " B this bridge holds for a request of " + N(partial.Bytes) + " B (2 x bytes + 1 KiB)");
            if (_held + slice > MaxHeldBytes)
                return Outcome.Refused(name + " brings this connection's unfinished chunked requests to " + N(_held + slice) +
                    " B of gzip, over the " + N(MaxHeldBytes) + " B (one frame cap) the bridge holds at once");
            var copy = new byte[slice];
            Array.Copy(message, header.SliceAt, copy, 0, slice);
            partial.Slices.Add(copy);
            partial.Held += slice;
            _held += slice;
            if (partial.Next < partial.Count) return Outcome.Pending;

            Release(id);
            return Inflate(id, partial);
        }

        /// <summary>The whole request: the slices decoded as ONE gzip member (<see cref="GzipMember"/>: stopped as soon as it
        /// passes <c>bytes</c>, its trailer required and verified, nothing after it), then decoded as strict UTF-8.</summary>
        private static Outcome Inflate(string id, Partial partial)
        {
            var gzip = new byte[partial.Held];
            var at = 0;
            foreach (var slice in partial.Slices) { Array.Copy(slice, 0, gzip, at, slice.Length); at += slice.Length; }
            byte[] raw;
            try { raw = GzipMember.Inflate(gzip, gzip.Length, partial.Bytes); }
            catch (GzipMember.BrokenException ex) { return Outcome.Refused("the chunks of " + id + " " + ex.Message); }

            try { return Outcome.Complete(new UTF8Encoding(false, throwOnInvalidBytes: true).GetString(raw)); }
            catch (DecoderFallbackException) { return Outcome.Refused("the chunks of " + id + " inflate to bytes that are not UTF-8"); }
        }
    }
}
