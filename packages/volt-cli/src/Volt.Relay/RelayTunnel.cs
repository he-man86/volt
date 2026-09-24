using System;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Volt.Contracts;
using Volt.Wire;

namespace Volt.Relay
{
    /// <summary>The bridge half of the relay protocol: dial out, serve pipe ops that arrive, reconnect forever.
    ///
    /// <para>Protocol: <c>packages/volt-cli/docs/relay-protocol.md</c>.</para>
    ///
    /// <para><b>It is a pipe client.</b> Every request becomes an ordinary <see cref="PipeClient"/> call against
    /// this machine's own bridge pipe — the same call the CLI makes. That costs a local hop and buys the
    /// property that matters: there is ONE entry point to the engine and every guard is on it. A tunnel that
    /// called the dispatcher directly would be a second entry point, and the first guard added to only one of
    /// them is a remote write that skips it.</para>
    ///
    /// <para><b>It adds no vocabulary.</b> Ops come from <see cref="Ops"/>, errors from
    /// <see cref="BridgeErrorCodes"/>, and progress/result frames are forwarded verbatim.</para></summary>
    public sealed class RelayTunnel : IDisposable
    {
        // 25s ping / 60s silence, per the protocol. The watchdog is deliberately far longer than the ping: it is
        // there to notice a socket that is open but dead (a NAT or proxy that dropped the flow without an RST —
        // the common failure for a long-lived outbound connection through corporate kit), not to police latency.
        private static readonly TimeSpan PingEvery = TimeSpan.FromSeconds(25);
        private static readonly TimeSpan SilenceLimit = TimeSpan.FromSeconds(60);

        private static readonly TimeSpan BackoffFloor = TimeSpan.FromSeconds(1);
        private static readonly TimeSpan BackoffCeiling = TimeSpan.FromSeconds(30);

        private readonly RelaySidecar _config;
        private readonly string _pipeName;
        private readonly string _vendor;
        private readonly string _voltVersion;
        private readonly Func<IRelaySocket> _socketFactory;

        private readonly CancellationTokenSource _stopping = new CancellationTokenSource();
        // ClientWebSocket permits ONE send at a time. Requests are served concurrently on purpose (`health` must
        // answer while `push` holds the IDE thread), so their frames race to this socket — every write goes
        // through here.
        private readonly SemaphoreSlim _sendLock = new SemaphoreSlim(1, 1);

        private IRelaySocket? _socket;
        private DateTime _lastInboundUtc;
        private Task? _loop;

        public RelayTunnel(
            RelaySidecar config,
            string pipeName,
            string vendor,
            string voltVersion,
            Func<IRelaySocket>? socketFactory = null)
        {
            _config = config ?? throw new ArgumentNullException(nameof(config));
            _pipeName = pipeName;
            _vendor = vendor;
            _voltVersion = voltVersion;
            // Injected so the tests drive a real tunnel against an in-memory relay. The default is the real
            // ClientWebSocket; nothing about the logic below knows which it has.
            _socketFactory = socketFactory ?? (() => new ClientWebSocketAdapter());
        }

        /// <summary>Start dialing. Returns immediately; the tunnel runs until <see cref="Dispose"/>.</summary>
        public void Start()
        {
            if (_loop != null) throw new InvalidOperationException("tunnel already started");
            VoltLog.Info("relay: tunnel starting -> " + _config.SafeDescription);
            _loop = Task.Run(() => RunForeverAsync(_stopping.Token));
        }

        /// <summary>Connect, serve, reconnect. The only way out is <see cref="Dispose"/>.</summary>
        private async Task RunForeverAsync(CancellationToken stopping)
        {
            var backoff = BackoffFloor;
            var random = new Random();

            while (!stopping.IsCancellationRequested)
            {
                try
                {
                    await RunOneConnectionAsync(stopping).ConfigureAwait(false);
                    // A clean end means the relay closed us. That is still a disconnect, so back off — an
                    // immediate redial against a relay that is refusing (a revoked token, say) is a hot loop
                    // against someone else's server.
                }
                catch (OperationCanceledException) when (stopping.IsCancellationRequested)
                {
                    return;
                }
                catch (Exception ex)
                {
                    // The host is NOT the place to surface this: a relay that is down must not stop a bridge
                    // serving its local CLI. The log is the record.
                    VoltLog.Warn("relay: connection ended (" + ex.GetType().Name + "): " + ex.Message);
                }

                if (stopping.IsCancellationRequested) return;

                // Jittered, because every bridge pointed at one relay would otherwise redial in lockstep after
                // that relay restarts and arrive as a thundering herd.
                var jitter = TimeSpan.FromMilliseconds(random.Next(0, 1000));
                var wait = backoff + jitter;
                VoltLog.Debug("relay: reconnecting in " + (int)wait.TotalSeconds + "s");
                try { await Task.Delay(wait, stopping).ConfigureAwait(false); }
                catch (OperationCanceledException) { return; }

                var doubled = TimeSpan.FromTicks(backoff.Ticks * 2);
                backoff = doubled > BackoffCeiling ? BackoffCeiling : doubled;
            }
        }

        private async Task RunOneConnectionAsync(CancellationToken stopping)
        {
            using (var socket = _socketFactory())
            {
                _socket = socket;
                await socket.ConnectAsync(new Uri(_config.Url), _config.Token, stopping).ConfigureAwait(false);
                VoltLog.Info("relay: connected to " + _config.SafeDescription);

                _lastInboundUtc = DateTime.UtcNow;
                await SendAsync(RelayFrames.Hello(_voltVersion, _vendor, _pipeName), stopping).ConfigureAwait(false);

                using (var connectionDead = CancellationTokenSource.CreateLinkedTokenSource(stopping))
                {
                    var pinger = PingLoopAsync(connectionDead.Token);
                    try
                    {
                        await ReceiveLoopAsync(socket, connectionDead.Token).ConfigureAwait(false);
                    }
                    finally
                    {
                        connectionDead.Cancel();
                        // The ping loop owns no state worth waiting on, but leaving it running would have two
                        // pingers on the next connection.
                        try { await pinger.ConfigureAwait(false); } catch { /* cancelled */ }
                        _socket = null;
                        // In-flight requests are abandoned by contract — the relay fails them to its caller, and
                        // `ifVersion` makes the retry safe. Nothing to clean up here; the point is that we do
                        // NOT try to answer them on the next connection, which would answer an id the relay has
                        // already given up on.
                    }
                }
            }
        }

        private async Task ReceiveLoopAsync(IRelaySocket socket, CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                var text = await socket.ReceiveTextAsync(token).ConfigureAwait(false);
                if (text == null)
                {
                    VoltLog.Info("relay: socket closed by the relay");
                    return;
                }

                _lastInboundUtc = DateTime.UtcNow;
                var frame = RelayFrames.Read(text);

                switch (frame.Kind)
                {
                    case RelayInboundKind.Ignorable:
                        break;

                    case RelayInboundKind.Malformed:
                        // Logged and dropped. Closing the socket would abandon every request in flight over one
                        // bad frame, and there is no id to answer on anyway.
                        VoltLog.Warn("relay: ignoring a malformed frame — " + frame.Reason);
                        break;

                    case RelayInboundKind.Request:
                        // Fire and forget, deliberately. Awaiting here would serialize the tunnel onto one
                        // request at a time and destroy the property the whole design exists for: `health` and
                        // `logs` answering while a `push` holds the IDE thread.
                        var _ = ServeAsync(frame, token);
                        break;
                }
            }
        }

        /// <summary>Serve one request: forward it to the local pipe and stream the frames back, tagged.</summary>
        private async Task ServeAsync(RelayInbound request, CancellationToken token)
        {
            // Both non-null by construction: ReceiveLoopAsync only routes a frame here when RelayFrames.Read
            // classified it as a Request, and that arm sets them. Asserted once, so the four frame builders
            // below are not each guarding a case that cannot happen.
            var id = request.Id!;
            var op = request.Op!;

            VoltLog.Info("relay: <- " + op + " (" + id + ")");

            try
            {
                if (!RelayFrames.Allowed.Contains(op))
                {
                    // Refused WITHOUT touching the pipe. `connect`/`disconnect` land here: a remote party does
                    // not get to rebind which project an engineer's IDE serves.
                    await SendAsync(RelayFrames.Error(id, BridgeErrorCodes.BadRequest,
                        "op '" + op + "' is not relayable"), token).ConfigureAwait(false);
                    return;
                }

                // One pipe connection per request id — the pipe's own concurrency, which is what lets `health`
                // answer off the IDE thread while `push` holds it.
                var client = new PipeClient(_pipeName);
                var result = await Task.Run(() => client.Call(
                    op,
                    request.Body,
                    progress =>
                    {
                        // Progress is best-effort: a failed progress send must not fail the REQUEST, whose
                        // terminal frame is the thing the caller is waiting for.
                        try { SendAsync(RelayFrames.Progress(id, progress), token).GetAwaiter().GetResult(); }
                        catch (Exception ex) { VoltLog.Debug("relay: dropped a progress frame: " + ex.Message); }
                    }), token).ConfigureAwait(false);

                await SendAsync(RelayFrames.Result(id, result), token).ConfigureAwait(false);
                VoltLog.Info("relay: -> " + op + " (" + id + ") ok");
            }
            catch (PipeCallException ex)
            {
                // A coded bridge error crosses as its code, unchanged. This is the ordinary path for
                // PLC_DISCONNECTED, WRONG_PROJECT and friends.
                await TrySendAsync(RelayFrames.Error(id, ex.Code, ex.Message), token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                // The socket went while this was running. The relay has already failed it to its caller;
                // answering now would answer an id nobody is waiting on.
                VoltLog.Debug("relay: abandoned '" + op + "' — the connection went");
            }
            catch (Exception ex)
            {
                // Errors are coded or they are bugs. A request is NEVER dropped: every id the bridge accepts
                // gets exactly one terminal frame, or the socket closes.
                VoltLog.Warn("relay: '" + op + "' failed: " + ex.Message);
                await TrySendAsync(RelayFrames.Error(id, BridgeErrorCodes.InternalError,
                    ex.Message), token).ConfigureAwait(false);
            }
        }

        private async Task PingLoopAsync(CancellationToken token)
        {
            // Wrapped whole. This task is awaited only in a `finally` that does not run until the receive
            // loop returns, so an exception here is INVISIBLE: the pinger dies, the watchdog stops, and the
            // tunnel waits for ever on a socket nobody is checking. That is not a hypothetical — it is the
            // shape of the first wedge this hit against a live IDE.
            try { await PingLoopCoreAsync(token).ConfigureAwait(false); }
            catch (OperationCanceledException) { /* connection going */ }
            catch (Exception ex)
            {
                VoltLog.Error("relay: the heartbeat died — " + ex);
                // Take the socket with it. A connection with no heartbeat is not a connection; dropping it
                // forces the reconnect that gets us a working one.
                var socket = _socket;
                if (socket != null) { try { socket.Abort(); } catch { /* going anyway */ } }
            }
        }

        private async Task PingLoopCoreAsync(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                try { await Task.Delay(PingEvery, token).ConfigureAwait(false); }
                catch (OperationCanceledException) { return; }

                // Silence means the flow is dead even though the socket says otherwise. Dropping it here is
                // what makes the reconnect happen; without this the tunnel sits "connected" forever against a
                // relay that stopped listening.
                if (DateTime.UtcNow - _lastInboundUtc > SilenceLimit)
                {
                    VoltLog.Warn("relay: no frame for " + (int)SilenceLimit.TotalSeconds + "s — dropping the socket");
                    var socket = _socket;
                    if (socket != null) { try { socket.Abort(); } catch { /* going anyway */ } }
                    return;
                }

                // Logged at Info deliberately. A tunnel that goes quiet is the failure this whole
                // design is about, and "when did the heartbeat stop" is the first question — it cannot
                // be answered from a log that only records problems.
                VoltLog.Info("relay: ping (silent for " +
                    (int)(DateTime.UtcNow - _lastInboundUtc).TotalSeconds + "s)");
                await TrySendAsync(RelayFrames.Ping, token).ConfigureAwait(false);
            }
        }

        private async Task SendAsync(string frame, CancellationToken token)
        {
            await _sendLock.WaitAsync(token).ConfigureAwait(false);
            try
            {
                var socket = _socket;
                if (socket == null) throw new InvalidOperationException("no socket");
                await socket.SendTextAsync(frame, token).ConfigureAwait(false);
            }
            finally
            {
                _sendLock.Release();
            }
        }

        /// <summary>Send, swallowing failure. For frames whose loss is not worth failing anything over — a ping,
        /// or an error frame on a socket that is already going.</summary>
        private async Task TrySendAsync(string frame, CancellationToken token)
        {
            try { await SendAsync(frame, token).ConfigureAwait(false); }
            catch (Exception ex) { VoltLog.Debug("relay: send failed: " + ex.Message); }
        }

        public void Dispose()
        {
            try { _stopping.Cancel(); } catch { /* already */ }
            var socket = _socket;
            if (socket != null) { try { socket.Abort(); } catch { /* going anyway */ } }
            try { _loop?.Wait(TimeSpan.FromSeconds(5)); } catch { /* best effort */ }
            _stopping.Dispose();
            _sendLock.Dispose();
        }
    }
}
