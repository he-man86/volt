using System;
using System.Globalization;
using System.Net.WebSockets;
using System.Text;
using System.Threading.Tasks;

namespace Volt.Relay
{
    /// <summary>One receive from an <see cref="IRelaySocket"/>: a text frame, a binary message (a chunk of a request,
    /// openspec relay-chunked-results), or the relay's close. Exactly one of <see cref="Text"/>, <see cref="Bytes"/> and
    /// <see cref="Close"/> is set.
    ///
    /// <para>Part of the socket contract, so it lives beside neither implementation: the real adapter and the
    /// tests' in-memory relay both build it.</para></summary>
    public sealed class RelayReceived
    {
        private RelayReceived(string? text, byte[]? bytes, long length, RelayClose? close)
        { Text = text; Bytes = bytes; Length = length; Close = close; }

        public string? Text { get; }
        /// <summary>A binary message: whole, or — when it was longer than the bridge takes — only its first bytes, so the
        /// adapter never holds a message past the limit the bridge announced.</summary>
        public byte[]? Bytes { get; }
        /// <summary>The binary message's length on the wire; over <see cref="Bytes"/>' length only when it was cut.</summary>
        public long Length { get; }
        public RelayClose? Close { get; }

        public static RelayReceived Frame(string text) =>
            new RelayReceived(text ?? throw new ArgumentNullException(nameof(text)), null, 0, null);

        public static RelayReceived Binary(byte[] message) =>
            new RelayReceived(null, message ?? throw new ArgumentNullException(nameof(message)), message.Length, null);

        /// <summary>A binary message of <paramref name="length"/> bytes of which only <paramref name="prefix"/> was kept.</summary>
        public static RelayReceived Binary(byte[] prefix, long length)
        {
            if (prefix == null) throw new ArgumentNullException(nameof(prefix));
            if (length < prefix.Length) throw new ArgumentOutOfRangeException(nameof(length), "a message is never shorter than its kept bytes");
            return new RelayReceived(null, prefix, length, null);
        }

        public static RelayReceived Closed(int? status, string? description) =>
            new RelayReceived(null, null, 0, new RelayClose(status, description));

        /// <summary>One whole message from <paramref name="receive"/> (one socket read per call), reassembled across reads.
        /// Apart from the socket (the real adapter passes its own reads) so its buffering is testable without one.
        ///
        /// <para>A binary message is a chunk, which the bridge's <c>hello</c> caps at <see cref="ChunkAssembly.MaxBytes"/>:
        /// past that only its first bytes are kept (its header names the id to refuse) and the rest is read and counted, not
        /// held, so a relay cannot make the IDE's process hold a message of any size before it is refused.</para></summary>
        internal static async Task<RelayReceived> ReadAsync(Func<ArraySegment<byte>, Task<WebSocketReceiveResult>> receive, int readBytes)
        {
            var buffer = new byte[readBytes];
            long length = 0;
            using (var assembled = new System.IO.MemoryStream())
            {
                while (true)
                {
                    var result = await receive(new ArraySegment<byte>(buffer)).ConfigureAwait(false);

                    if (result.MessageType == WebSocketMessageType.Close)
                        return Closed(
                            result.CloseStatus.HasValue ? (int)result.CloseStatus.Value : (int?)null,
                            result.CloseStatusDescription);

                    length += result.Count;
                    var keep = result.MessageType == WebSocketMessageType.Binary
                        ? (int)Math.Min(result.Count, Math.Max(0, ChunkAssembly.MaxBytes - assembled.Length))
                        : result.Count;
                    assembled.Write(buffer, 0, keep);

                    // EndOfMessage is the frame boundary. Returning on the first read instead would split a
                    // large `fetch` result into fragments that are each invalid JSON — and the bug would only
                    // appear on projects big enough to exceed one chunk, which is to say on customers' projects
                    // and not on ours.
                    if (result.EndOfMessage)
                    {
                        // A binary message is a chunk of a request: its bytes go up as they are, header line and gzip.
                        if (result.MessageType == WebSocketMessageType.Binary) return Binary(assembled.ToArray(), length);
                        break;
                    }
                }

                return Frame(Encoding.UTF8.GetString(assembled.ToArray()));
            }
        }
    }

    /// <summary>The close handshake the relay sent.</summary>
    public sealed class RelayClose
    {
        /// <summary>WebSocket 1008 (policy violation): the relay will not serve this bridge.</summary>
        public const int PolicyViolation = 1008;

        public RelayClose(int? status, string? description)
        {
            Status = status;
            // A close handshake may carry a status and no reason text, and ClientWebSocket reports that as null.
            // An absent reason and an empty one say the same thing, so they are one value here.
            Description = description ?? "";
        }

        /// <summary>Null only when the close frame carried no status, which the WebSocket API can report; the log
        /// then says so in words rather than inventing a number.</summary>
        public int? Status { get; }
        public string Description { get; }

        public bool IsPolicyRefusal => Status == PolicyViolation;

        public override string ToString() =>
            (Status.HasValue ? Status.Value.ToString(CultureInfo.InvariantCulture) : "no status")
            + " \"" + Description + "\"";
    }
}
