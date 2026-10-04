using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Linq;
using System.Net.WebSockets;
using System.Text.Json;
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
        private static readonly TimeSpan DefaultPingEvery = TimeSpan.FromSeconds(25);
        private static readonly TimeSpan DefaultSilenceLimit = TimeSpan.FromSeconds(60);
        private readonly TimeSpan _pingEvery;
        private readonly TimeSpan _silenceLimit;

        private static readonly TimeSpan BackoffFloor = TimeSpan.FromSeconds(1);
        private static readonly TimeSpan BackoffCeiling = TimeSpan.FromSeconds(30);
        // After a 1008 (the relay will not serve this bridge). Long, because the answer will not change on
        // retry; finite, because a mistaken refusal from one relay deploy must heal without every engineer
        // restarting their IDE. See RunForeverAsync.
        private static readonly TimeSpan RefusedCeiling = TimeSpan.FromHours(1);

        private readonly RelaySidecar _config;
        private readonly string _pipeName;
        private readonly string _vendor;
        private readonly string? _voltVersion;
        private readonly Func<IRelaySocket> _socketFactory;
        private readonly Func<TimeSpan, CancellationToken, Task> _delay;
        private readonly Action<VoltLogLevel, string> _log;

        private readonly CancellationTokenSource _stopping = new CancellationTokenSource();
        // ClientWebSocket permits ONE send at a time. Requests are served concurrently on purpose (`health` must
        // answer while `push` holds the IDE thread), so their frames race to this socket — every write goes
        // through here.
        private readonly SemaphoreSlim _sendLock = new SemaphoreSlim(1, 1);

        private IRelaySocket? _socket;
        private DateTime _lastInboundUtc;
        // Whether the relay sent this connection any frame at all. A field rather than a return value because it
        // must survive the connection ending in an exception (a 1006 after a week of service still earns the
        // backoff reset). Written and read only on the reconnect loop's own async flow.
        private bool _accepted;
        // The connection being served (or dialed): what its end line reports. Replaced per dial on the reconnect
        // loop's own flow; the heartbeat writes only its DropCause.
        private Connection? _connection;
        private Task? _loop;

        /// <summary>One dial's facts, for its end line (openspec relay-request-logging).</summary>
        private sealed class Connection
        {
            public DateTime? ConnectedUtc;
            // id -> op of every request read on THIS connection that has not yet logged its terminal line.
            public readonly ConcurrentDictionary<string, string> InFlight = new ConcurrentDictionary<string, string>();
            // InFlight at the moment the connection ended, before its abandoned requests drain.
            public string[] InFlightAtEnd = new string[0];
            // Set by the heartbeat when IT drops the socket, so the end line names the watchdog or the dead
            // heartbeat rather than the receive exception the drop causes.
            public volatile string? DropCause;
        }

        public RelayTunnel(
            RelaySidecar config,
            string pipeName,
            string vendor,
            string? voltVersion,
            Func<IRelaySocket>? socketFactory = null,
            Func<TimeSpan, CancellationToken, Task>? reconnectDelay = null,
            Action<VoltLogLevel, string>? log = null,
            TimeSpan? pingEvery = null,
            TimeSpan? silenceLimit = null)
        {
            _config = config ?? throw new ArgumentNullException(nameof(config));
            _pipeName = pipeName;
            _vendor = vendor;
            _voltVersion = voltVersion;
            // Injected so the tests drive a real tunnel against an in-memory relay. The default is the real
            // ClientWebSocket; nothing about the logic below knows which it has.
            _socketFactory = socketFactory ?? (() => new ClientWebSocketAdapter());
            // The reconnect wait is injected because the backoff IS the behaviour under test: a refused bridge
            // waits an hour, and a test that slept it (or a scaled-down copy of the policy) would prove nothing
            // about the real numbers. A test records the wait the tunnel asked for, then releases it.
            _delay = reconnectDelay ?? ((wait, token) => Task.Delay(wait, token));
            // Injected because VoltLog is one process-wide file shared by every test running in parallel, and the
            // log line is the tunnel's only surface to the engineer: a test must be able to read exactly its own.
            _log = log ?? LogToVoltLog;
            // Injected only so a test can watch the watchdog fire without waiting 60-85 s. The protocol's
            // numbers are what every real tunnel runs.
            _pingEvery = pingEvery ?? DefaultPingEvery;
            _silenceLimit = silenceLimit ?? DefaultSilenceLimit;
        }

        private static void LogToVoltLog(VoltLogLevel level, string message)
        {
            switch (level)
            {
                case VoltLogLevel.Debug: VoltLog.Debug(message); break;
                case VoltLogLevel.Info: VoltLog.Info(message); break;
                case VoltLogLevel.Warn: VoltLog.Warn(message); break;
                case VoltLogLevel.Error: VoltLog.Error(message); break;
                default: throw new ArgumentOutOfRangeException(nameof(level), level, "not a VoltLog level");
            }
        }

        private void Log(VoltLogLevel level, string message) => _log(level, message);

        /// <summary>Start dialing. Returns immediately; the tunnel runs until <see cref="Dispose"/>.</summary>
        public void Start()
        {
            if (_loop != null) throw new InvalidOperationException("tunnel already started");
            Log(VoltLogLevel.Info, "relay: tunnel starting -> " + _config.SafeDescription);
            _loop = Task.Run(() => RunForeverAsync(_stopping.Token));
        }

        /// <summary>Connect, serve, reconnect. The only way out is <see cref="Dispose"/>.</summary>
        private async Task RunForeverAsync(CancellationToken stopping)
        {
            var backoff = BackoffFloor;
            var random = new Random();

            while (!stopping.IsCancellationRequested)
            {
                RelayClose? close = null;
                Exception? ended = null;
                try
                {
                    close = await RunOneConnectionAsync(stopping).ConfigureAwait(false);
                    // A close is still a disconnect, so back off: an immediate redial against a relay that is
                    // refusing is a hot loop against someone else's server.
                }
                catch (OperationCanceledException) when (stopping.IsCancellationRequested)
                {
                    return;
                }
                catch (Exception ex)
                {
                    // The host is NOT the place to surface this: a relay that is down must not stop a bridge
                    // serving its local CLI. The log (the end line below) is the record.
                    ended = ex;
                }

                if (stopping.IsCancellationRequested) return;

                // A connection the relay SERVED proves it takes this bridge, so whatever ended it, the climb
                // starts again from the floor. Without the reset a bridge whose backoff had once climbed to 30 s
                // waited 30 s after every later relay deploy, for the rest of the process's life.
                if (_accepted) backoff = BackoffFloor;

                TimeSpan baseWait;
                VoltLogLevel level;
                string cause;
                var conn = _connection;
                if (close != null && close.IsPolicyRefusal)
                {
                    // The relay will not serve this bridge, and redialing cannot change its mind — only a new
                    // bridge (or the relay's operator) can. So: slow down, but NEVER stop. The CODESYS bridge
                    // runs in-proc, where "restart the bridge" means restarting the engineer's IDE, and one
                    // mistaken 1008 from a relay deploy must not strand every bridge until each user does that.
                    baseWait = RefusedCeiling;
                    level = VoltLogLevel.Error;
                    cause = RefusalLine(close);
                }
                else
                {
                    baseWait = backoff;
                    var doubled = TimeSpan.FromTicks(backoff.Ticks * 2);
                    backoff = doubled > BackoffCeiling ? BackoffCeiling : doubled;
                    level = VoltLogLevel.Warn;
                    if (close != null) { level = VoltLogLevel.Info; cause = "the relay closed the connection: " + close; }
                    else if (conn?.DropCause != null) cause = conn.DropCause;
                    else if (ended == null) cause = "the receive loop ended with no close";
                    else if (conn?.ConnectedUtc == null)
                        // A refused upgrade (401/403) lands here; the platform's message names the HTTP status
                        // where it reports one.
                        cause = "could not connect (" + ended.GetType().Name + "): " + ended.Message;
                    else cause = "dropped without a close (" + ended.GetType().Name + "): " + ended.Message;
                }

                // Jittered, because every bridge pointed at one relay would otherwise redial in lockstep after
                // that relay restarts and arrive as a thundering herd.
                var jitter = TimeSpan.FromMilliseconds(random.Next(0, 1000));
                var wait = baseWait + jitter;
                Log(level, EndLine(conn, cause, wait));
                try { await _delay(wait, stopping).ConfigureAwait(false); }
                catch (OperationCanceledException) { return; }
            }
        }

        /// <summary>The one line an engineer reads when the relay turns their bridge away. It names the relay's
        /// reason verbatim, and says what to do only when the reason is the protocol: a bridge refused for any
        /// other cause would be refused just the same after an update, so the hint would send them the wrong way.</summary>
        private static string RefusalLine(RelayClose close)
        {
            var line = "relay: the relay refused this bridge (" + close + ").";
            if (close.Description.IndexOf("protocol", StringComparison.OrdinalIgnoreCase) >= 0)
                line += " This bridge speaks relay protocol " + RelayFrames.Protocol +
                        ", which the relay does not serve: download the latest bridge.";
            return line + " Trying again in " + (int)RefusedCeiling.TotalMinutes + " minutes.";
        }

        /// <summary>The ONE line a connection end gets: the pipe it served (the name embeds the pid, and one log
        /// file holds every process of a vendor), its age, its cause, the ids it abandoned and the next dial.</summary>
        private string EndLine(Connection? conn, string cause, TimeSpan nextDial)
        {
            var connected = conn?.ConnectedUtc;
            var age = connected == null
                ? "before it connected"
                : "after " + (int)(DateTime.UtcNow - connected.Value).TotalSeconds + "s";
            var inFlight = conn == null || conn.InFlightAtEnd.Length == 0 ? "none" : string.Join(" ", conn.InFlightAtEnd);
            return "relay: connection on " + _pipeName + " ended " + age + " — " + cause +
                   " | in flight: " + inFlight + " | next dial in " + (int)nextDial.TotalSeconds + "s";
        }

        /// <summary>Serve one connection. Returns the relay's close, or null when it ended any other way.</summary>
        private async Task<RelayClose?> RunOneConnectionAsync(CancellationToken stopping)
        {
            _accepted = false;
            var conn = new Connection();
            _connection = conn;
            using (var socket = _socketFactory())
            {
                _socket = socket;
                await socket.ConnectAsync(new Uri(_config.Url), _config.Token, stopping).ConfigureAwait(false);
                conn.ConnectedUtc = DateTime.UtcNow;
                Log(VoltLogLevel.Info, "relay: connected to " + _config.SafeDescription);

                _lastInboundUtc = DateTime.UtcNow;
                await SendAsync(RelayFrames.Hello(_voltVersion, _vendor, _pipeName), stopping).ConfigureAwait(false);

                using (var connectionDead = CancellationTokenSource.CreateLinkedTokenSource(stopping))
                {
                    var pinger = PingLoopAsync(connectionDead.Token);
                    try
                    {
                        return await ReceiveLoopAsync(socket, conn, connectionDead.Token).ConfigureAwait(false);
                    }
                    finally
                    {
                        conn.InFlightAtEnd = conn.InFlight.Keys.OrderBy(k => k, StringComparer.Ordinal).ToArray();
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

        /// <summary>Returns the relay's close; null when the token ended the loop instead.</summary>
        private async Task<RelayClose?> ReceiveLoopAsync(IRelaySocket socket, Connection conn, CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                var received = await socket.ReceiveAsync(token).ConfigureAwait(false);
                // Handed up, not logged here: what the close MEANS (an ordinary end, or a refusal that sets the
                // next dial an hour out) is the reconnect policy's call, and it logs the close with that verdict.
                if (received.Close != null) return received.Close;
                var text = received.Text!;

                _lastInboundUtc = DateTime.UtcNow;
                _accepted = true;
                var frame = RelayFrames.Read(text);

                switch (frame.Kind)
                {
                    case RelayInboundKind.Ignorable:
                        break;

                    case RelayInboundKind.Malformed:
                        // Logged and dropped. Closing the socket would abandon every request in flight over one
                        // bad frame, and there is no id to answer on anyway.
                        Log(VoltLogLevel.Warn, "relay: ignoring a malformed frame — " + frame.Reason);
                        break;

                    case RelayInboundKind.Request:
                        // Fire and forget, deliberately. Awaiting here would serialize the tunnel onto one
                        // request at a time and destroy the property the whole design exists for: `health`
                        // answering while a `push` holds the IDE thread.
                        // Registered here, synchronously, so the end line lists it even when the connection
                        // ends before the request's own task has run.
                        conn.InFlight[frame.Id!] = frame.Op!;
                        var _ = ServeAsync(frame, conn, token);
                        break;
                }
            }
            return null;
        }

        /// <summary>Serve one request: forward it to the local pipe and stream the frames back, tagged.
        ///
        /// <para>Ends in ONE terminal Info line, whatever ended it (openspec relay-request-logging):
        /// <c>relay: -&gt; op (id) outcome Nms [delivered=no]</c>. The op's outcome and the delivery of its frame
        /// are judged apart, so a push that landed and could not be answered reads <c>ok … delivered=no</c>, never
        /// as a failure of the op.</para></summary>
        private async Task ServeAsync(RelayInbound request, Connection conn, CancellationToken token)
        {
            // Both non-null by construction: ReceiveLoopAsync only routes a frame here when RelayFrames.Read
            // classified it as a Request, and that arm sets them.
            var id = request.Id!;
            var op = request.Op!;
            var clock = Stopwatch.StartNew();

            Log(VoltLogLevel.Info, "relay: <- " + op + " (" + id + ")");

            // 1. The op's own outcome, and the terminal frame that carries it. Both stay null when it never ran.
            string? outcome = null;
            string? frame = null;
            try
            {
                if (!RelayFrames.Allowed.Contains(op))
                {
                    // Refused WITHOUT touching the pipe. `connect`/`disconnect` land here: a remote party does
                    // not get to rebind which project an engineer's IDE serves.
                    var refused = BridgeErrorCodes.BadRequest;
                    outcome = "refused " + refused;
                    frame = RelayFrames.Error(id, refused, "op '" + op + "' is not relayable");
                }
                else
                {
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
                            catch (Exception ex) { Log(VoltLogLevel.Debug, "relay: dropped a progress frame: " + ex.Message); }
                        }), token).ConfigureAwait(false);
                    outcome = "ok" + PushVerdict(op, result);
                    frame = RelayFrames.Result(id, result);
                }
            }
            catch (PipeCallException ex)
            {
                // A coded bridge error crosses as its code, unchanged. This is the ordinary path for
                // PLC_DISCONNECTED, WRONG_PROJECT and friends.
                outcome = "error " + ex.Code;
                frame = RelayFrames.Error(id, ex.Code, ex.Message);
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested)
            {
                // The connection went before the pipe call started: abandoned, and it never ran.
            }
            catch (Exception ex)
            {
                // Errors are coded or they are bugs. A request is NEVER dropped: every id the bridge accepts
                // gets exactly one terminal frame, or the socket closes.
                // The 3.5.17 field failure was thrown HERE (Volt.Relay is what calls PipeClient.Call) and left only its
                // message, at Warn. Now the log keeps the whole exception and, for a binding failure, every copy
                // loaded at that moment; the remote client gets the type beside the message (openspec
                // ide-identity-report 3.1).
                Log(VoltLogLevel.Error, "relay: '" + op + "' failed on pipe " + _pipeName + " — " + CallFailure.LogText(ex));
                var code = BridgeErrorCodes.InternalError;
                outcome = "error " + code;
                frame = RelayFrames.Error(id, code, CallFailure.Message(ex));
            }

            // 2. Delivery. The connection having gone is "abandoned": the relay has already failed the id to its
            // caller, and answering it on the next connection would answer an id nobody is waiting on. A send that
            // fails on a connection still live is a delivery failure, named as one.
            string? sendFailure = null;
            if (frame != null && !token.IsCancellationRequested)
            {
                try { await SendAsync(frame, token).ConfigureAwait(false); }
                catch (Exception ex) when (!token.IsCancellationRequested) { sendFailure = ex.GetType().Name + ": " + ex.Message; }
                catch (Exception) { /* the connection went during the send: abandoned, below */ }
            }
            var abandoned = frame == null || (sendFailure == null && token.IsCancellationRequested);
            var delivered = !abandoned && sendFailure == null;

            conn.InFlight.TryRemove(id, out _);
            Log(VoltLogLevel.Info, "relay: -> " + op + " (" + id + ") " +
                (abandoned ? "abandoned" + (outcome == null ? "" : " " + outcome) : outcome) +
                " " + clock.ElapsedMilliseconds + "ms" +
                (delivered ? "" : " delivered=no") + (sendFailure == null ? "" : " (" + sendFailure + ")"));
        }

        /// <summary>A push's verdict and version, read from the result the tunnel already holds: what a client
        /// whose push was abandoned cannot otherwise learn (openspec relay-outcome-ledger). Empty for other ops.</summary>
        private static string PushVerdict(string op, JsonElement result)
        {
            if (op != Ops.Push) return "";
            var accepted = result.TryGetProperty("accepted", out var a) && a.ValueKind == JsonValueKind.True;
            var version = result.TryGetProperty("newProjectVersion", out var v) && v.ValueKind == JsonValueKind.String
                ? " newProjectVersion=" + v.GetString()
                : "";
            return (accepted ? " accepted" : " rejected") + version;
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
                Log(VoltLogLevel.Error, "relay: the heartbeat died — " + ex);
                var conn = _connection;
                if (conn != null) conn.DropCause = "the heartbeat died (" + ex.GetType().Name + "): " + ex.Message;
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
                try { await Task.Delay(_pingEvery, token).ConfigureAwait(false); }
                catch (OperationCanceledException) { return; }

                // Silence means the flow is dead even though the socket says otherwise. Dropping it here is
                // what makes the reconnect happen; without this the tunnel sits "connected" forever against a
                // relay that stopped listening.
                if (DateTime.UtcNow - _lastInboundUtc > _silenceLimit)
                {
                    Log(VoltLogLevel.Warn, "relay: no frame for " + (int)_silenceLimit.TotalSeconds + "s — dropping the socket");
                    var conn = _connection;
                    if (conn != null) conn.DropCause = "the watchdog dropped it (no frame for " + (int)_silenceLimit.TotalSeconds + "s)";
                    var socket = _socket;
                    if (socket != null) { try { socket.Abort(); } catch { /* going anyway */ } }
                    return;
                }

                // Logged at Info deliberately. A tunnel that goes quiet is the failure this whole
                // design is about, and "when did the heartbeat stop" is the first question — it cannot
                // be answered from a log that only records problems.
                Log(VoltLogLevel.Info, "relay: ping (silent for " +
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
            catch (Exception ex) { Log(VoltLogLevel.Debug, "relay: send failed: " + ex.Message); }
        }

        /// <summary>A deliberate stop's Close frame: 1001 (going away), never 1008 — a redial after a restart is
        /// welcome. One reason for every stop: the relay needs "stopped on purpose" vs "dropped", not which button.</summary>
        internal const int StopStatus = 1001;
        internal const string StopReason = "bridge stopping";
        // The longest a stop waits for its Close frame to go out before it drops the socket as before. A stop
        // runs while an IDE is closing, and must never hold that up on a relay that stopped reading.
        private static readonly TimeSpan CloseBound = TimeSpan.FromSeconds(1);

        private async Task SendCloseAsync(IRelaySocket socket, CancellationToken token)
        {
            // Under the send lock: a Close is a send, and ClientWebSocket permits one at a time.
            await _sendLock.WaitAsync(token).ConfigureAwait(false);
            try { await socket.CloseOutputAsync(StopStatus, StopReason, token).ConfigureAwait(false); }
            finally { _sendLock.Release(); }
        }

        public void Dispose()
        {
            var socket = _socket;
            // The close goes out BEFORE the stop cancels: cancelling a pending ClientWebSocket receive aborts the
            // socket, and the frame would never leave. Bounded twice — the token for a socket that honours it,
            // the Wait for one that does not.
            if (socket != null)
            {
                using (var bound = new CancellationTokenSource(CloseBound))
                {
                    bool sent;
                    try { sent = SendCloseAsync(socket, bound.Token).Wait(CloseBound); }
                    catch (Exception) { sent = false; }
                    Log(VoltLogLevel.Info, sent
                        ? "relay: stopping — sent close " + StopStatus + " " + StopReason
                        : "relay: stopping — the close did not go out within " + CloseBound.TotalSeconds + "s, dropping the socket");
                }
            }
            try { _stopping.Cancel(); } catch { /* already */ }
            if (socket != null) { try { socket.Abort(); } catch { /* going anyway */ } }
            try { _loop?.Wait(TimeSpan.FromSeconds(5)); } catch { /* best effort */ }
            _stopping.Dispose();
            _sendLock.Dispose();
        }
    }
}
