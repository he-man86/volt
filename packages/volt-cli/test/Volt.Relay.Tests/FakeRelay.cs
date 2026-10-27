using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net.WebSockets;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Volt.Contracts;
using Volt.Relay;

namespace Volt.Relay.Tests;

/// <summary>An in-memory relay on the far end of the tunnel.
///
/// <para>It is a RELAY, not a mock of one: it holds the socket, sends requests, reads frames and demultiplexes
/// on id, exactly as a real one must. That is what lets these tests exercise the actual
/// <see cref="RelayTunnel"/> — its framing, its allowlist, its concurrency and its reconnect — rather than a
/// rehearsal of them.</para></summary>
public sealed class FakeRelay
{
    private readonly object _gate = new();
    private readonly List<string> _sentToRelay = new();
    // BINARY messages (chunks), kept apart from the text frames: a text frame is one JSON object, a binary message is
    // a header line plus gzip bytes, and a test that mixed them would parse gzip as JSON.
    private readonly List<byte[]> _binaryToRelay = new();
    // What the bridge's next receive yields. A thunk, not a string, so the queue can also carry a close with its
    // status and a connection that dies without one: the three things a real socket's receive can produce. It is handed
    // the receive's arrival callback, so an entry can report bytes that arrived before the message died (§4).
    private readonly BlockingCollection<Func<Action<int>, RelayReceived>> _toBridge = new();
    private readonly TaskCompletionSource<bool> _connected = new();

    /// <summary>Set to refuse the next connect — for the reconnect tests.</summary>
    public volatile bool RefuseConnect;

    /// <summary>Set to make a send fail, as a socket dying mid-send does, while the connection is otherwise live:
    /// a frame matching it throws instead of arriving.</summary>
    public volatile Func<string, bool>? FailSendWhen;

    /// <summary>Set to make a send STALL, as one does on a network that stops carrying a large message without
    /// resetting the flow: a frame matching it never goes out, and its send ends only when the socket is aborted
    /// (a real ClientWebSocket faults a pending send on Abort). Its token is ignored, as a stalled TCP write ignores it.</summary>
    public volatile Func<string, bool>? StallSendWhen;

    /// <summary>Set to make the bridge's Close frame never finish going out (a relay that stopped reading):
    /// the close task never completes and ignores its token, so only the tunnel's own bound ends the wait.</summary>
    public volatile bool CloseNeverCompletes;

    private readonly List<string> _socketEvents = new();

    /// <summary>What the bridge did to its sockets, in order: <c>close STATUS REASON</c> for a Close frame that
    /// went out, <c>abort</c> for a drop without a handshake.</summary>
    public IReadOnlyList<string> SocketEvents
    {
        get { lock (_gate) return _socketEvents.ToArray(); }
    }

    /// <summary>How many times a socket has been opened. The reconnect assertion.</summary>
    public int ConnectAttempts;

    public Task Connected => _connected.Task;

    /// <summary>Every frame the bridge has sent, in order.</summary>
    public IReadOnlyList<string> Received
    {
        get { lock (_gate) return _sentToRelay.ToArray(); }
    }

    /// <summary>Every BINARY message (chunk) the bridge has sent, in order.</summary>
    public IReadOnlyList<byte[]> ReceivedBinary
    {
        get { lock (_gate) return _binaryToRelay.ToArray(); }
    }

    /// <summary>Ack every chunk the moment it arrives, as a relay that keeps up does.</summary>
    public volatile bool AutoAck;

    /// <summary>Set to make a binary send fail while the connection is otherwise live.</summary>
    public volatile Func<byte[], bool>? FailBinaryWhen;

    /// <summary>The relay's announcement (relay-chunked-results): this connection may carry chunks.</summary>
    public void Announce(int maxBytes = 8192) =>
        Send("{\"volt\":\"relay\",\"chunks\":{\"maxBytes\":" + maxBytes + ",\"ack\":true}}");

    /// <summary>Ack one chunk.</summary>
    public void Ack(string id, int seq) => Send("{\"id\":" + JsonSerializer.Serialize(id) + ",\"ack\":" + seq + "}");

    /// <summary>A chunk message split at its first newline: the JSON header line, and the gzip slice after it.</summary>
    public static (JsonElement Header, byte[] Slice) ParseChunk(byte[] message)
    {
        var newline = Array.IndexOf(message, (byte)'\n');
        if (newline < 0) throw new InvalidOperationException("a chunk with no header line");
        using var doc = JsonDocument.Parse(new ReadOnlyMemory<byte>(message, 0, newline));
        return (doc.RootElement.Clone(), message[(newline + 1)..]);
    }

    /// <summary>The chunks of <paramref name="id"/> received so far, in arrival order.</summary>
    public IReadOnlyList<(JsonElement Header, byte[] Slice)> ChunksOf(string id)
    {
        var chunks = new List<(JsonElement, byte[])>();
        foreach (var message in ReceivedBinary)
        {
            var chunk = ParseChunk(message);
            if (chunk.Header.GetProperty("id").GetString() == id) chunks.Add(chunk);
        }
        return chunks;
    }

    /// <summary>Wait for every chunk of <paramref name="id"/> (seq 0 states <c>count</c>), then reassemble them as a
    /// relay must: concatenate the slices in seq order and inflate. Returns the frame's exact UTF-8 bytes.</summary>
    public async Task<byte[]> AwaitReassembled(string id, int timeoutMs = 15_000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            var chunks = ChunksOf(id);
            if (chunks.Count > 0 && chunks[0].Header.TryGetProperty("count", out var count) && chunks.Count == count.GetInt32())
            {
                using var gz = new System.IO.MemoryStream();
                for (var seq = 0; seq < chunks.Count; seq++)
                {
                    if (chunks[seq].Header.GetProperty("seq").GetInt32() != seq)
                        throw new InvalidOperationException("chunk " + seq + " of " + id + " arrived out of order");
                    gz.Write(chunks[seq].Slice);
                }
                gz.Position = 0;
                using var inflate = new System.IO.Compression.GZipStream(gz, System.IO.Compression.CompressionMode.Decompress);
                using var frame = new System.IO.MemoryStream();
                inflate.CopyTo(frame);
                return frame.ToArray();
            }
            await Task.Delay(25);
        }
        throw new TimeoutException("the chunks of '" + id + "' never completed within " + timeoutMs + "ms; got " + ChunksOf(id).Count);
    }

    /// <summary>One BINARY message to the bridge: a chunk of a request (relay-chunked-results §3).</summary>
    public void SendBinary(byte[] message) => _toBridge.Add(_ => RelayReceived.Binary(message));

    /// <summary>A binary message over the bridge's limit as the real adapter hands it up: only its first bytes kept,
    /// and the length it had on the wire (relay-chunked-results; the adapter never buffers past the limit).</summary>
    public void SendOversizedBinary(byte[] prefix, long length) => _toBridge.Add(_ => RelayReceived.Binary(prefix, length));

    /// <summary>A request frame as a relay writes it (the shape <see cref="SendRequest"/> sends whole).</summary>
    public static string RequestFrame(string id, string op, object? body = null) =>
        "{\"id\":" + JsonSerializer.Serialize(id) + ",\"op\":\"" + op + "\",\"protocol\":" + WireProtocol.Version +
        ",\"body\":" + (body == null ? "{}" : JsonSerializer.Serialize(body)) + "}";

    /// <summary>gzip of <paramref name="raw"/>, written here and not by the bridge's own splitter, so a test of the
    /// bridge's reassembly does not grade the bridge against itself.</summary>
    public static byte[] Gzip(byte[] raw, System.IO.Compression.CompressionLevel level = System.IO.Compression.CompressionLevel.Optimal)
    {
        using var buffer = new System.IO.MemoryStream();
        using (var gz = new System.IO.Compression.GZipStream(buffer, level, leaveOpen: true))
            gz.Write(raw);
        return buffer.ToArray();
    }

    /// <summary>One chunk message: <paramref name="header"/> (a JSON object), <c>\n</c>, then <paramref name="slice"/>.</summary>
    public static byte[] Chunk(string header, byte[] slice)
    {
        var head = System.Text.Encoding.UTF8.GetBytes(header + "\n");
        var message = new byte[head.Length + slice.Length];
        Buffer.BlockCopy(head, 0, message, 0, head.Length);
        Buffer.BlockCopy(slice, 0, message, head.Length, slice.Length);
        return message;
    }

    /// <summary>The chunks a relay sends for <paramref name="frame"/>: gzip(its UTF-8) cut into slices of
    /// <paramref name="sliceBytes"/>, <c>count</c> and <c>bytes</c> on seq 0 only.</summary>
    public static List<byte[]> ChunksFor(string id, string frame, int sliceBytes)
    {
        var raw = System.Text.Encoding.UTF8.GetBytes(frame);
        var gzip = Gzip(raw);
        var count = (gzip.Length + sliceBytes - 1) / sliceBytes;
        var chunks = new List<byte[]>();
        for (var seq = 0; seq < count; seq++)
        {
            var slice = gzip[(seq * sliceBytes)..Math.Min(gzip.Length, (seq + 1) * sliceBytes)];
            var header = seq == 0
                ? "{\"id\":" + JsonSerializer.Serialize(id) + ",\"seq\":0,\"count\":" + count + ",\"bytes\":" + raw.Length + "}"
                : "{\"id\":" + JsonSerializer.Serialize(id) + ",\"seq\":" + seq + "}";
            chunks.Add(Chunk(header, slice));
        }
        return chunks;
    }

    /// <summary>The seqs the bridge acked for <paramref name="id"/>, in the order it acked them.</summary>
    public IReadOnlyList<int> AcksFrom(string id) =>
        FramesOf(id, "ack").Select(a => a.GetInt32()).ToList();

    /// <summary>The bridge's text frames for <paramref name="id"/> that carry <paramref name="key"/>, in order.</summary>
    public IReadOnlyList<JsonElement> FramesOf(string id, string key)
    {
        var frames = new List<JsonElement>();
        foreach (var raw in Received)
        {
            using var doc = JsonDocument.Parse(raw);
            var root = doc.RootElement;
            if (root.TryGetProperty("id", out var gotId) && gotId.GetString() == id && root.TryGetProperty(key, out var payload))
                frames.Add(payload.Clone());
        }
        return frames;
    }

    public IRelaySocket NewSocket() => new Socket(this);

    public void Send(string frame) => _toBridge.Add(_ => RelayReceived.Frame(frame));

    /// <summary>Close the tunnel from the relay's side with a status and reason, as a relay's close handshake
    /// does. The next receive sees it: on this connection, or on the next one if none is reading.</summary>
    public void Close(int status, string description) =>
        _toBridge.Add(_ => RelayReceived.Closed(status, description));

    /// <summary>The connection dies with no close handshake (1006: a relay restart, a dropped flow). A real
    /// ClientWebSocket reports that by THROWING from receive, not with a close frame, so this does too.</summary>
    public void DieWithoutClose() =>
        _toBridge.Add(_ => throw new WebSocketException(WebSocketError.ConnectionClosedPrematurely));

    /// <summary>A message starts — <paramref name="arrivedBytes"/> of it come over the wire — and the connection dies
    /// before its end, with no close: a downstream cut partway through a frame (relay-chunked-results §4).</summary>
    public void DieMidMessage(int arrivedBytes) =>
        _toBridge.Add(arrived =>
        {
            arrived(arrivedBytes);
            throw new WebSocketException(WebSocketError.ConnectionClosedPrematurely);
        });

    public void SendRequest(string id, string op, object? body = null)
    {
        var json = body == null ? "{}" : JsonSerializer.Serialize(body);
        Send("{\"id\":\"" + id + "\",\"op\":\"" + op + "\",\"protocol\":" + WireProtocol.Version + ",\"body\":" + json + "}");
    }

    /// <summary>Wait for a frame carrying <paramref name="id"/> with the given key, and return it parsed.</summary>
    public async Task<JsonElement> AwaitFrame(string id, string key, int timeoutMs = 15_000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            foreach (var raw in Received)
            {
                using var doc = JsonDocument.Parse(raw);
                var root = doc.RootElement;
                if (!root.TryGetProperty("id", out var gotId) || gotId.GetString() != id) continue;
                if (root.TryGetProperty(key, out var payload)) return payload.Clone();
            }
            await Task.Delay(25);
        }
        throw new TimeoutException(
            $"no '{key}' frame for id '{id}' within {timeoutMs}ms. Frames seen: " +
            string.Join(" | ", Received));
    }

    public async Task<JsonElement> AwaitHello(int timeoutMs = 15_000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            foreach (var raw in Received)
            {
                using var doc = JsonDocument.Parse(raw);
                if (doc.RootElement.TryGetProperty("hello", out var hello)) return hello.Clone();
            }
            await Task.Delay(25);
        }
        throw new TimeoutException("no hello frame within " + timeoutMs + "ms");
    }

    /// <summary>Kill the live socket, as a dropped connection would.</summary>
    public Action? DropSocket { get; set; }

    private sealed class Socket : IRelaySocket
    {
        private readonly FakeRelay _relay;
        private readonly CancellationTokenSource _aborted = new();

        public Socket(FakeRelay relay) => _relay = relay;

        public Task ConnectAsync(Uri url, string token, CancellationToken cancellation)
        {
            Interlocked.Increment(ref _relay.ConnectAttempts);
            if (_relay.RefuseConnect) throw new InvalidOperationException("relay refused (test)");
            _relay.DropSocket = () => { try { _aborted.Cancel(); } catch { } };
            _relay._connected.TrySetResult(true);
            return Task.CompletedTask;
        }

        public Task SendTextAsync(string text, CancellationToken cancellation)
        {
            if (_aborted.IsCancellationRequested) throw new OperationCanceledException();
            if (_relay.FailSendWhen?.Invoke(text) == true)
                throw new WebSocketException(WebSocketError.ConnectionClosedPrematurely);
            if (_relay.StallSendWhen?.Invoke(text) == true)
            {
                var stalled = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
                _aborted.Token.Register(() => stalled.TrySetException(new WebSocketException(WebSocketError.ConnectionClosedPrematurely)));
                return stalled.Task;
            }
            lock (_relay._gate) _relay._sentToRelay.Add(text);
            return Task.CompletedTask;
        }

        public Task SendBinaryAsync(byte[] message, CancellationToken cancellation)
        {
            if (_aborted.IsCancellationRequested) throw new OperationCanceledException();
            if (_relay.FailBinaryWhen?.Invoke(message) == true)
                throw new WebSocketException(WebSocketError.ConnectionClosedPrematurely);
            lock (_relay._gate) _relay._binaryToRelay.Add(message);
            if (_relay.AutoAck)
            {
                var header = ParseChunk(message).Header;
                _relay.Ack(header.GetProperty("id").GetString()!, header.GetProperty("seq").GetInt32());
            }
            return Task.CompletedTask;
        }

        public Task<RelayReceived> ReceiveAsync(Action<int> arrived, CancellationToken cancellation)
        {
            return Task.Run(() =>
            {
                using var linked = CancellationTokenSource.CreateLinkedTokenSource(
                    cancellation, _aborted.Token);
                Func<Action<int>, RelayReceived> next;
                try
                {
                    next = _relay._toBridge.Take(linked.Token);
                }
                catch (OperationCanceledException) when (!cancellation.IsCancellationRequested)
                {
                    // Aborted (the watchdog, or DropSocket): a real socket throws from a receive it can no
                    // longer complete. It does not hand back a close, because nobody sent one.
                    throw new WebSocketException(WebSocketError.ConnectionClosedPrematurely);
                }
                var received = next(arrived);
                // A whole message arrives in one read here: its bytes are reported as the real adapter's reads report them.
                if (received.Close == null) arrived(checked((int)received.Length));
                return received;
            });
        }

        public Task CloseOutputAsync(int status, string reason, CancellationToken cancellation)
        {
            if (_relay.CloseNeverCompletes) return new TaskCompletionSource<bool>().Task;
            lock (_relay._gate) _relay._socketEvents.Add("close " + status + " " + reason);
            return Task.CompletedTask;
        }

        public void Abort()
        {
            lock (_relay._gate) _relay._socketEvents.Add("abort");
            try { _aborted.Cancel(); } catch { }
        }
        public void Dispose() { try { _aborted.Cancel(); } catch { } _aborted.Dispose(); }
    }
}
