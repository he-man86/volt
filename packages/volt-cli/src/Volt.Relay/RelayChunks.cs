using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Text;
using Volt.Contracts;

namespace Volt.Relay
{
    /// <summary>Splitting a large terminal frame into the relay's binary chunks (openspec relay-chunked-results).
    ///
    /// <para>A chunk is ONE binary message: a JSON header line, <c>\n</c>, then a slice of gzip(the frame's UTF-8).
    /// <c>count</c> and <c>bytes</c> (the frame's UTF-8 length) are on seq 0 only. The slices concatenated and inflated
    /// are byte for byte the frame the bridge would have sent whole, so the relay hands its caller exactly that.</para></summary>
    internal static class RelayChunks
    {
        /// <summary>A terminal frame whose UTF-8 is over this many bytes is chunked on a connection that announced chunks.
        /// Everything else (ping, progress, a small answer) stays one whole text frame.</summary>
        public const int Over = 8192;

        /// <summary>The largest message this bridge sends: the relay's <c>maxBytes</c>, or the window's floor when that is
        /// smaller. A chunk larger than the floor could never fit an empty window; a smaller one is within the contract
        /// ("at most maxBytes").</summary>
        public static int MessageBytes(int maxBytes) => Math.Min(maxBytes, ChunkWindow.Floor);

        /// <summary>Whether an answer to <paramref name="id"/> can be chunked under <paramref name="maxBytes"/>, whatever
        /// the answer turns out to be: seq 0's header with the largest <c>count</c> and <c>bytes</c> an int can state
        /// still leaves a byte for data. Known when the request ARRIVES, so a request that fails it is refused by name
        /// before its op runs — never after a push ran and its answer could not be sent.</summary>
        public static bool IdFits(string id, int maxBytes) =>
            maxBytes - Encoding.UTF8.GetByteCount(Header(RelayFrames.JsonEncode(id), 0, int.MaxValue, int.MaxValue) + "\n") >= 1;

        /// <summary>One chunk on its way: the id and seq its ack will name, and the whole message.</summary>
        public sealed class Outgoing
        {
            public Outgoing(string id, int seq, byte[] message) { Id = id; Seq = seq; Message = message; }
            public string Id { get; }
            public int Seq { get; }
            public byte[] Message { get; }
        }

        /// <summary>The chunk messages of <paramref name="frame"/>, each at most <paramref name="maxBytes"/>, every one
        /// but the last full.</summary>
        /// <exception cref="VoltInvariantException">The id does not fit (<see cref="IdFits"/>): the tunnel refuses such a
        /// request at intake, so reaching here is a broken invariant.</exception>
        public static List<byte[]> Split(string id, string frame, int maxBytes)
        {
            var raw = Encoding.UTF8.GetBytes(frame);
            byte[] gzip;
            using (var buffer = new MemoryStream())
            {
                using (var deflate = new GZipStream(buffer, CompressionLevel.Optimal, leaveOpen: true))
                    deflate.Write(raw, 0, raw.Length);
                gzip = buffer.ToArray();
            }

            var idJson = RelayFrames.JsonEncode(id);
            // `count` is in seq 0's header, and its digits change how much that header leaves for data, so the split
            // is found by fixpoint: split assuming a count, and again with the count that produced. A longer count
            // only ever needs more chunks, so it settles in a step or two.
            var count = 1;
            while (true)
            {
                var messages = new List<byte[]>();
                var offset = 0;
                for (var seq = 0; offset < gzip.Length; seq++)
                {
                    var header = Encoding.UTF8.GetBytes(Header(idJson, seq, count, raw.Length) + "\n");
                    var room = maxBytes - header.Length;
                    if (room < 1)
                        throw new VoltInvariantException(
                            "cannot chunk the answer to an id of " + id.Length.ToString(CultureInfo.InvariantCulture) +
                            " characters under maxBytes " + maxBytes.ToString(CultureInfo.InvariantCulture) +
                            ": such a request is refused at intake (RelayChunks.IdFits), so it should never be answered");
                    var take = Math.Min(room, gzip.Length - offset);
                    var message = new byte[header.Length + take];
                    Buffer.BlockCopy(header, 0, message, 0, header.Length);
                    Buffer.BlockCopy(gzip, offset, message, header.Length, take);
                    messages.Add(message);
                    offset += take;
                }
                if (messages.Count == count) return messages;
                count = messages.Count;
            }
        }

        private static string Header(string idJson, int seq, int count, int bytes) =>
            seq == 0
                ? "{\"id\":" + idJson + ",\"seq\":0,\"count\":" + count.ToString(CultureInfo.InvariantCulture) +
                  ",\"bytes\":" + bytes.ToString(CultureInfo.InvariantCulture) + "}"
                : "{\"id\":" + idJson + ",\"seq\":" + seq.ToString(CultureInfo.InvariantCulture) + "}";
    }
}
