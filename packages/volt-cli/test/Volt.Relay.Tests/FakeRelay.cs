using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Net.WebSockets;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
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
    // What the bridge's next receive yields. A thunk, not a string, so the queue can also carry a close with its
    // status and a connection that dies without one: the three things a real socket's receive can produce.
    private readonly BlockingCollection<Func<RelayReceived>> _toBridge = new();
    private readonly TaskCompletionSource<bool> _connected = new();

    /// <summary>Set to refuse the next connect — for the reconnect tests.</summary>
    public volatile bool RefuseConnect;

    /// <summary>Set to make a send fail, as a socket dying mid-send does, while the connection is otherwise live:
    /// a frame matching it throws instead of arriving.</summary>
    public volatile Func<string, bool>? FailSendWhen;

    /// <summary>How many times a socket has been opened. The reconnect assertion.</summary>
    public int ConnectAttempts;

    public Task Connected => _connected.Task;

    /// <summary>Every frame the bridge has sent, in order.</summary>
    public IReadOnlyList<string> Received
    {
        get { lock (_gate) return _sentToRelay.ToArray(); }
    }

    public IRelaySocket NewSocket() => new Socket(this);

    public void Send(string frame) => _toBridge.Add(() => RelayReceived.Frame(frame));

    /// <summary>Close the tunnel from the relay's side with a status and reason, as a relay's close handshake
    /// does. The next receive sees it: on this connection, or on the next one if none is reading.</summary>
    public void Close(int status, string description) =>
        _toBridge.Add(() => RelayReceived.Closed(status, description));

    /// <summary>The connection dies with no close handshake (1006: a relay restart, a dropped flow). A real
    /// ClientWebSocket reports that by THROWING from receive, not with a close frame, so this does too.</summary>
    public void DieWithoutClose() =>
        _toBridge.Add(() => throw new WebSocketException(WebSocketError.ConnectionClosedPrematurely));

    public void SendRequest(string id, string op, object? body = null)
    {
        var json = body == null ? "{}" : JsonSerializer.Serialize(body);
        Send("{\"id\":\"" + id + "\",\"op\":\"" + op + "\",\"body\":" + json + "}");
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
            lock (_relay._gate) _relay._sentToRelay.Add(text);
            return Task.CompletedTask;
        }

        public Task<RelayReceived> ReceiveAsync(CancellationToken cancellation)
        {
            return Task.Run(() =>
            {
                using var linked = CancellationTokenSource.CreateLinkedTokenSource(
                    cancellation, _aborted.Token);
                Func<RelayReceived> next;
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
                return next();
            });
        }

        public void Abort() { try { _aborted.Cancel(); } catch { } }
        public void Dispose() { try { _aborted.Cancel(); } catch { } _aborted.Dispose(); }
    }
}
