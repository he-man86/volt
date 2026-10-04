using System;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Volt.Relay
{
    /// <summary>The socket the tunnel talks through.
    ///
    /// <para>An interface so the tests can drive a REAL <see cref="RelayTunnel"/> — its framing, its allowlist,
    /// its concurrency, its reconnect — against an in-memory relay. Testing those through a live
    /// <see cref="ClientWebSocket"/> would mean binding a port to assert on a JSON string, and the interesting
    /// failures (a socket that dies mid-push, a relay that goes silent) are ones a real socket will not perform
    /// on request.</para>
    ///
    /// <para>Text frames only: the protocol has no binary frame.</para></summary>
    public interface IRelaySocket : IDisposable
    {
        Task ConnectAsync(Uri url, string token, CancellationToken cancellation);
        Task SendTextAsync(string text, CancellationToken cancellation);
        /// <summary>The next frame, or the relay's close WITH its status and description. The close is not a
        /// bare "gone": 1008 is how a relay turns a bridge away (`unsupported protocol N`), and a tunnel that
        /// only learns "closed" cannot tell that from a network blip.</summary>
        Task<RelayReceived> ReceiveAsync(CancellationToken cancellation);
        /// <summary>Send a Close frame and do not wait for the relay's answer — a deliberate stop's goodbye, so
        /// the relay can tell it from a drop (openspec bridge-close-frame). The caller bounds the wait.</summary>
        Task CloseOutputAsync(int status, string reason, CancellationToken cancellation);
        /// <summary>Drop it now, without a close handshake. Used when the watchdog gives up — a handshake with
        /// a peer that has stopped answering is a wait we already know the answer to.</summary>
        void Abort();
    }

    /// <summary>The real one.</summary>
    internal sealed class ClientWebSocketAdapter : IRelaySocket
    {
        // One frame's read buffer. A `refs` result on a large project is megabytes, so a frame is reassembled
        // across many reads (see ReceiveTextAsync) rather than assuming it fits.
        private const int ChunkBytes = 16 * 1024;

        private readonly ClientWebSocket _socket = new ClientWebSocket();

        public async Task ConnectAsync(Uri url, string token, CancellationToken cancellation)
        {
            // The token travels as a header, never in the URL: a path-borne credential ends up in proxy logs,
            // browser history and Referer headers, and this one authorizes writes to a live PLC project.
            _socket.Options.SetRequestHeader("Authorization", "Bearer " + token);

            // 25s is the protocol's own ping cadence. Setting it here too means the framework's keepalive and
            // ours agree rather than fighting.
            _socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(25);

            await _socket.ConnectAsync(url, cancellation).ConfigureAwait(false);
        }

        public Task SendTextAsync(string text, CancellationToken cancellation)
        {
            var bytes = Encoding.UTF8.GetBytes(text);
            return _socket.SendAsync(
                new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, cancellation);
        }

        public async Task<RelayReceived> ReceiveAsync(CancellationToken cancellation)
        {
            var buffer = new byte[ChunkBytes];
            using (var assembled = new System.IO.MemoryStream())
            {
                while (true)
                {
                    var result = await _socket
                        .ReceiveAsync(new ArraySegment<byte>(buffer), cancellation)
                        .ConfigureAwait(false);

                    if (result.MessageType == WebSocketMessageType.Close)
                        return RelayReceived.Closed(
                            result.CloseStatus.HasValue ? (int)result.CloseStatus.Value : (int?)null,
                            result.CloseStatusDescription);

                    assembled.Write(buffer, 0, result.Count);

                    // EndOfMessage is the frame boundary. Returning on the first read instead would split a
                    // large `fetch` result into fragments that are each invalid JSON — and the bug would only
                    // appear on projects big enough to exceed one chunk, which is to say on customers' projects
                    // and not on ours.
                    if (result.EndOfMessage) break;
                }

                return RelayReceived.Frame(Encoding.UTF8.GetString(assembled.ToArray()));
            }
        }

        public Task CloseOutputAsync(int status, string reason, CancellationToken cancellation) =>
            _socket.CloseOutputAsync((WebSocketCloseStatus)status, reason, cancellation);

        public void Abort()
        {
            try { _socket.Abort(); } catch { /* already gone */ }
        }

        public void Dispose()
        {
            try { _socket.Dispose(); } catch { /* already gone */ }
        }
    }
}
