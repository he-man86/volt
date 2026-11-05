using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Volt.Contracts;
using Volt.Relay;
using Volt.Wire;
using Xunit;
using Xunit.Abstractions;

namespace Volt.Tests.Shared;

/// <summary>
/// REAL SOCKETS (openspec relay-chunked-results §5). A real <see cref="RelayTunnel"/> on its real
/// <c>ClientWebSocket</c> dials a relay served by <see cref="HttpListener"/> through a TCP proxy that carries a few KiB/s
/// each way, as the slow uplinks in the field do. The in-memory FakeRelay cannot show what this does: bytes queueing in
/// the OS's socket buffers behind a large message, which is what made a 118 KB answer starve a relay past its 60 s
/// silence limit and every other answer wait behind it (design.md, Measured).
///
/// <para>Compiled into the net10 relay suite (the TwinCAT worker's runtime) and the net48 CODESYS suite (the CODESYS
/// in-proc host's socket stack). The numbers are the protocol's own, scaled 7.5× down in time so a run stays under
/// ~20 s: a 16 KiB/s link, an 8 s relay silence limit, a 3 s ping and an 8 s bridge watchdog.</para>
/// </summary>
public static class RealSocketScale
{
    /// <summary>The link, each way.</summary>
    public const int BytesPerSecond = 16 * 1024;
    /// <summary>The relay's socket silence limit (60 s in the protocol).</summary>
    public static readonly TimeSpan RelaySilenceLimit = TimeSpan.FromSeconds(8);
    public static readonly TimeSpan BridgePingEvery = TimeSpan.FromSeconds(3);
    public static readonly TimeSpan BridgeSilenceLimit = TimeSpan.FromSeconds(8);
    /// <summary>Random bytes in the answer, base64'd: 260,000 characters, a 280,609 B frame once the JSON writer escapes
    /// each '+' as <c>+</c> (6 bytes); ~195 KiB of gzip. Sent whole it takes ~16 s at the link's rate, twice the
    /// relay's silence limit; chunked, ~12 s.</summary>
    public const int NoiseBytes = 195_000;

    // The contract's numbers (design.md), restated rather than read from the bridge so the bound is not graded by the
    // code under test: maxBytes as this relay announces it, the window's floor and its 5 s rate span.
    public const int ChunkBytes = 8192;
    public const int WindowFloor = 16 * 1024;
    public const int WindowCap = 256 * 1024;

    /// <summary>The longest a whole frame may wait behind chunks: the largest window the link can earn (the bytes acked
    /// over 5 s, at most the link's 5 s plus the chunk an ack lands on), plus the chunk in flight, at the link's rate,
    /// plus slack for the scheduler and the downlink's small frames.</summary>
    public static TimeSpan WholeFrameWaitBound(TimeSpan slack)
    {
        var window = Math.Min(WindowCap, Math.Max(WindowFloor, 5 * BytesPerSecond + ChunkBytes));
        return TimeSpan.FromSeconds((double)(window + ChunkBytes) / BytesPerSecond) + slack;
    }

    /// <summary>A bridge pipe: <c>fetch</c> answers a large, poorly compressible result, <c>health</c> a small one.</summary>
    public static PipeServer BridgePipe(string name, string noise) =>
        new PipeServer(name, (request, emit) => request.Op == Ops.Fetch
            ? (object)new { items = new[] { new { path = "Application/Big.pou", text = "(* " + noise + " *)" } } }
            : new { ok = true });

    public static string Noise()
    {
        var bytes = new byte[NoiseBytes];
        new Random(42).NextBytes(bytes);
        return Convert.ToBase64String(bytes);
    }
}

/// <summary>What a direction of a flow does with the bytes it is given, while the TCP connections stay open.</summary>
public enum FlowFault
{
    /// <summary>Forwards.</summary>
    None,
    /// <summary>Takes the bytes and forwards nothing, an end of stream included: the sender's send completes and nobody
    /// hears it. A dead path behind something that terminates TCP (a VPN, a proxy).</summary>
    Discard,
    /// <summary>Stops reading, so the sender's OS buffers fill and its send blocks. A dead path with nothing acking.</summary>
    Hold,
}

/// <summary>A TCP proxy that carries <c>bytesPerSecond</c> each way (0: no limit), paced over time, in 1 KiB reads. What
/// it has not read yet waits in the OS's socket buffers, as it does in front of a slow link. Faults: a blackhole of either
/// direction leaves both TCP connections open, no FIN and no RST; it applies to the flows open now, and a redial is a
/// new flow unless <see cref="BlackholeNewFlows"/>. <see cref="Latency"/> and <see cref="Stall"/> delay what it forwards.</summary>
public sealed class ThrottledProxy : IDisposable
{
    private sealed class Flow
    {
        public TcpClient Inbound = null!;
        public TcpClient Outbound = null!;
        public volatile FlowFault Up;
        public volatile FlowFault Down;
        public long UpBytes;
        public long ArmedAt = long.MaxValue;
        public FlowFault ArmedUp;
        public FlowFault ArmedDown;
    }

    private readonly TcpListener _listener = new TcpListener(IPAddress.Loopback, 0);
    private readonly int _target;
    private readonly int _bytesPerSecond;
    private readonly CancellationTokenSource _stop = new CancellationTokenSource();
    private readonly ConcurrentBag<TcpClient> _clients = new ConcurrentBag<TcpClient>();
    private readonly ConcurrentQueue<Flow> _flows = new ConcurrentQueue<Flow>();
    private readonly Stopwatch _clock = Stopwatch.StartNew();

    public ThrottledProxy(int targetPort, int bytesPerSecond)
    {
        _target = targetPort;
        _bytesPerSecond = bytesPerSecond;
        _listener.Start();
        _ = AcceptLoop();
    }

    public int Port => ((IPEndPoint)_listener.LocalEndpoint).Port;
    /// <summary>The flows accepted so far.</summary>
    public int Flows => _flows.Count;
    /// <summary>A flow accepted while this is set is dead from its first byte: TCP connects, nothing crosses.</summary>
    public volatile bool BlackholeNewFlows;
    /// <summary>Each byte forwarded this much after it was read.</summary>
    public TimeSpan Latency { get; set; }
    /// <summary>Nothing forwarded for <c>Length</c> at the start of every <c>Every</c>: what loss does to a TCP flow, a
    /// retransmission pause with no error. Bytes wait and arrive late.</summary>
    public (TimeSpan Every, TimeSpan Length)? Stall { get; set; }

    /// <summary>Every open flow goes dead now, each way as stated.</summary>
    public void Blackhole(FlowFault up, FlowFault down)
    {
        foreach (var f in _flows) { f.Up = up; f.Down = down; }
    }

    /// <summary>Every open flow goes dead once <paramref name="bytes"/> more have gone from the bridge to the relay.</summary>
    public void BlackholeAfterUpBytes(long bytes, FlowFault up, FlowFault down)
    {
        foreach (var f in _flows)
        {
            f.ArmedUp = up;
            f.ArmedDown = down;
            Interlocked.Exchange(ref f.ArmedAt, Interlocked.Read(ref f.UpBytes) + bytes);
        }
    }

    /// <summary>An RST each way on every open flow.</summary>
    public void Reset()
    {
        foreach (var f in _flows)
            foreach (var c in new[] { f.Inbound, f.Outbound })
            {
                try { c.Client.LingerState = new LingerOption(true, 0); c.Close(); } catch { }
            }
    }

    private async Task AcceptLoop()
    {
        while (!_stop.IsCancellationRequested)
        {
            TcpClient inbound;
            try { inbound = await _listener.AcceptTcpClientAsync().ConfigureAwait(false); }
            catch { return; }
            var outbound = new TcpClient();
            try { await outbound.ConnectAsync(IPAddress.Loopback, _target).ConfigureAwait(false); }
            catch { inbound.Close(); continue; }
            _clients.Add(inbound);
            _clients.Add(outbound);
            var dead = BlackholeNewFlows ? FlowFault.Discard : FlowFault.None;
            var flow = new Flow { Inbound = inbound, Outbound = outbound, Up = dead, Down = dead };
            _flows.Enqueue(flow);
            _ = Pump(inbound.GetStream(), outbound.GetStream(), flow, up: true);
            _ = Pump(outbound.GetStream(), inbound.GetStream(), flow, up: false);
        }
    }

    private async Task Pump(NetworkStream from, NetworkStream to, Flow flow, bool up)
    {
        FlowFault Fault() => up ? flow.Up : flow.Down;
        var buffer = new byte[1024];
        var clock = Stopwatch.StartNew();
        long carried = 0;
        var delayed = Latency > TimeSpan.Zero || Stall != null;
        var line = new ConcurrentQueue<(TimeSpan Due, byte[] Bytes)>();
        var queued = new SemaphoreSlim(0);
        if (delayed) _ = DelayLine(line, queued, to);
        try
        {
            while (!_stop.IsCancellationRequested)
            {
                if (Fault() == FlowFault.Hold)
                {
                    await Task.Delay(50, _stop.Token).ConfigureAwait(false);
                    continue;
                }
                var n = await from.ReadAsync(buffer, 0, buffer.Length, _stop.Token).ConfigureAwait(false);
                if (n == 0) break;
                if (up && Interlocked.Add(ref flow.UpBytes, n) >= Interlocked.Read(ref flow.ArmedAt))
                {
                    flow.Up = flow.ArmedUp;
                    flow.Down = flow.ArmedDown;
                }
                if (Fault() != FlowFault.None) continue;
                if (delayed)
                {
                    line.Enqueue((_clock.Elapsed + Latency, buffer.Take(n).ToArray()));
                    queued.Release();
                }
                else await to.WriteAsync(buffer, 0, n, _stop.Token).ConfigureAwait(false);
                if (_bytesPerSecond <= 0) continue;
                carried += n;
                // Paced against the link's cumulative schedule: a pause for nothing to carry is not credit to burst.
                var due = TimeSpan.FromSeconds((double)carried / _bytesPerSecond);
                if (due < clock.Elapsed) { clock.Restart(); carried = 0; continue; }
                await Task.Delay(due - clock.Elapsed, _stop.Token).ConfigureAwait(false);
            }
        }
        catch { /* either side gone, or stopped */ }
        // A dead direction carries no end of stream either: the far side never learns.
        if (Fault() != FlowFault.None) return;
        try { flow.Inbound.Close(); } catch { }
        try { flow.Outbound.Close(); } catch { }
    }

    private async Task DelayLine(ConcurrentQueue<(TimeSpan Due, byte[] Bytes)> line, SemaphoreSlim queued, NetworkStream to)
    {
        try
        {
            while (!_stop.IsCancellationRequested)
            {
                await queued.WaitAsync(_stop.Token).ConfigureAwait(false);
                if (!line.TryDequeue(out var item)) continue;
                var wait = item.Due - _clock.Elapsed;
                if (wait > TimeSpan.Zero) await Task.Delay(wait, _stop.Token).ConfigureAwait(false);
                if (Stall is { } stall)
                {
                    var into = TimeSpan.FromTicks(_clock.Elapsed.Ticks % stall.Every.Ticks);
                    if (into < stall.Length) await Task.Delay(stall.Length - into, _stop.Token).ConfigureAwait(false);
                }
                await to.WriteAsync(item.Bytes, 0, item.Bytes.Length, _stop.Token).ConfigureAwait(false);
            }
        }
        catch { /* either side gone, or stopped */ }
    }

    public void Dispose()
    {
        _stop.Cancel();
        try { _listener.Stop(); } catch { }
        foreach (var c in _clients) { try { c.Close(); } catch { } }
    }
}

/// <summary>One socket a relay accepted. Times on the relay's clock.</summary>
public sealed class RelayConnection
{
    public TimeSpan AcceptedAt;
    public TimeSpan LastPingAt;
    public TimeSpan? EndedAt;
    public string? End;
    public TimeSpan? PingAgeAtEnd;
    /// <summary>This dial landed while the socket before it still looked live.</summary>
    public bool ReplacedOld;
}

/// <summary>A relay on <see cref="HttpListener"/>: accepts the bridge's WebSocket, announces chunks (when told to),
/// answers pings, acks every chunk the moment it is whole, reassembles chunked answers under the whole chunk contract
/// (<see cref="RelayChunkCheck"/>), and closes with 1011 when no
/// message has arrived for its silence limit — what a hosted relay does. It counts only WHOLE messages as traffic: a
/// relay sees a message when it has arrived, not while it is arriving.</summary>
public sealed class HttpListenerRelay : IDisposable
{
    private readonly HttpListener _listener = new HttpListener();
    private readonly bool _announce;
    private readonly TimeSpan _silenceLimit;
    private readonly CancellationTokenSource _stop = new CancellationTokenSource();
    private readonly SemaphoreSlim _sendLock = new SemaphoreSlim(1, 1);
    private readonly Stopwatch _clock = Stopwatch.StartNew();
    private readonly object _gate = new object();
    private readonly RelayChunkCheck _check = new RelayChunkCheck(RealSocketScale.ChunkBytes);
    private readonly Dictionary<string, TaskCompletionSource<byte[]>> _terminal = new Dictionary<string, TaskCompletionSource<byte[]>>();
    private readonly Dictionary<string, TimeSpan> _firstChunkAt = new Dictionary<string, TimeSpan>();
    private readonly TaskCompletionSource<bool> _hello = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
    private WebSocket? _socket;
    private RelayConnection? _current;
    private TimeSpan? _lastChunk;
    private TimeSpan _lastMessage;
    private TimeSpan _helloAt;

    public HttpListenerRelay(bool announce, TimeSpan silenceLimit)
    {
        _announce = announce;
        _silenceLimit = silenceLimit;
        // A free port, then the prefix on it. "localhost" is a prefix an unelevated user may register.
        for (var attempt = 0; ; attempt++)
        {
            var probe = new TcpListener(IPAddress.Loopback, 0);
            probe.Start();
            Port = ((IPEndPoint)probe.LocalEndpoint).Port;
            probe.Stop();
            _listener.Prefixes.Clear();
            _listener.Prefixes.Add("http://localhost:" + Port + "/");
            try { _listener.Start(); break; }
            catch (HttpListenerException) when (attempt < 5) { }
        }
        _ = AcceptLoop();
        _ = Watch();
    }

    public int Port { get; }
    /// <summary>The longest time between two whole messages from the bridge, from its hello on.</summary>
    public TimeSpan LongestSilence { get; private set; }
    /// <summary>Set when the relay closed the socket for silence: when, after the hello.</summary>
    public TimeSpan? ClosedForSilenceAt { get; private set; }
    public int BinaryMessages { get; private set; }
    /// <summary>Every chunk this relay refused as <c>chunk_invalid</c>, as "&lt;id&gt;: &lt;why&gt;".</summary>
    public List<string> Refusals { get; } = new List<string>();
    public int LargestMessage { get; private set; }

    public Task Hello => _hello.Task;
    /// <summary>Every socket this relay accepted, oldest first: how each ended, as a relay's own close log has it.</summary>
    public List<RelayConnection> Connections { get; } = new List<RelayConnection>();
    public int ProgressFrames { get; private set; }
    /// <summary>When the relay's chunk-stall rule would have closed: a partial answer with no chunk for <see cref="ChunkStallLimit"/>.
    /// Recorded, not acted on.</summary>
    public TimeSpan? ChunkStallWouldFireAt { get; private set; }
    public TimeSpan ChunkStallLimit { get; set; } = TimeSpan.MaxValue;

    private async Task AcceptLoop()
    {
        while (!_stop.IsCancellationRequested)
        {
            HttpListenerContext context;
            try { context = await _listener.GetContextAsync().ConfigureAwait(false); }
            catch { return; }
            if (!context.Request.IsWebSocketRequest || context.Request.Headers["Authorization"] != "Bearer t")
            {
                context.Response.StatusCode = 400;
                context.Response.Close();
                continue;
            }
            var accepted = await context.AcceptWebSocketAsync(null).ConfigureAwait(false);
            RelayConnection record;
            var replacedOld = false;
            lock (_gate)
            {
                var old = _current;
                if (old != null && old.End == null)
                {
                    // A redial landing while the old socket still looks live: the relay replaces it.
                    replacedOld = true;
                    old.End = "replaced";
                    old.EndedAt = _clock.Elapsed;
                    old.PingAgeAtEnd = _clock.Elapsed - old.LastPingAt;
                }
                record = new RelayConnection { AcceptedAt = _clock.Elapsed, LastPingAt = _clock.Elapsed, ReplacedOld = replacedOld };
                Connections.Add(record);
                _current = record;
            }
            var replaced = _socket;
            _socket = accepted.WebSocket;
            if (replacedOld) { try { replaced?.Abort(); } catch { } }
            _ = Receive(accepted.WebSocket, record);
        }
    }

    private void Ended(RelayConnection record, string how)
    {
        lock (_gate)
        {
            if (record.End != null) return;
            record.End = how;
            record.EndedAt = _clock.Elapsed;
            record.PingAgeAtEnd = _clock.Elapsed - record.LastPingAt;
        }
    }

    private async Task Receive(WebSocket socket, RelayConnection record)
    {
        var buffer = new byte[64 * 1024];
        try
        {
            while (socket.State == WebSocketState.Open)
            {
                using var message = new MemoryStream();
                WebSocketReceiveResult result;
                do
                {
                    result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), _stop.Token).ConfigureAwait(false);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        Ended(record, "close " + (int?)result.CloseStatus);
                        return;
                    }
                    message.Write(buffer, 0, result.Count);
                } while (!result.EndOfMessage);
                var bytes = message.ToArray();
                Arrived(bytes.Length);
                if (result.MessageType == WebSocketMessageType.Binary) await OnChunk(bytes).ConfigureAwait(false);
                else
                {
                    var text = Encoding.UTF8.GetString(bytes);
                    if (text == RelayFrames.Ping) lock (_gate) record.LastPingAt = _clock.Elapsed;
                    await OnText(text).ConfigureAwait(false);
                }
            }
        }
        catch { /* the socket ended */ }
        // No Close frame came: what a relay's log calls 1006.
        Ended(record, "1006");
    }

    private void Arrived(int length)
    {
        lock (_gate)
        {
            var now = _clock.Elapsed;
            if (_helloAt != TimeSpan.Zero && now - _lastMessage > LongestSilence) LongestSilence = now - _lastMessage;
            _lastMessage = now;
            if (length > LargestMessage) LargestMessage = length;
        }
    }

    private async Task OnText(string text)
    {
        using var doc = JsonDocument.Parse(text);
        var root = doc.RootElement;
        if (root.TryGetProperty("hello", out _))
        {
            lock (_gate) { _helloAt = _clock.Elapsed; _lastMessage = _helloAt; }
            if (_announce) await Send("{\"volt\":\"relay\",\"chunks\":{\"maxBytes\":" + RealSocketScale.ChunkBytes + ",\"ack\":true}}").ConfigureAwait(false);
            _hello.TrySetResult(true);
            return;
        }
        if (root.TryGetProperty("progress", out _)) lock (_gate) ProgressFrames++;
        if (text == RelayFrames.Ping) { await Send(RelayFrames.Pong).ConfigureAwait(false); return; }
        if (root.TryGetProperty("id", out var id) && (root.TryGetProperty("result", out _) || root.TryGetProperty("error", out _)))
            TerminalOf(id.GetString()!).TrySetResult(Encoding.UTF8.GetBytes(text));
    }

    private async Task OnChunk(byte[] message)
    {
        // Acked at once, before anything else, as the contract asks: every chunk whose header names an id and seq, the
        // ones then refused included.
        string id;
        try
        {
            var (headerId, seq) = RelayChunkCheck.IdAndSeq(message);
            id = headerId;
            await Send(RelayFrames.Ack(id, seq)).ConfigureAwait(false);
        }
        catch (RelayChunkCheck.Invalid e) { lock (_gate) Refusals.Add("(no id): " + e.Message); return; }
        byte[]? whole;
        lock (_gate)
        {
            BinaryMessages++;
            _lastChunk = _clock.Elapsed;
            if (!_firstChunkAt.ContainsKey(id)) _firstChunkAt[id] = _clock.Elapsed;
            try { whole = _check.Add(message); }
            catch (RelayChunkCheck.Invalid e)
            {
                // chunk_invalid: a real relay answers the call INTERNAL_ERROR; this one fails it with the reason.
                Refusals.Add(id + ": " + e.Message);
                TerminalOf(id).TrySetException(e);
                return;
            }
        }
        if (whole != null)
        {
            lock (_gate) _lastChunk = null;
            TerminalOf(id).TrySetResult(whole);
        }
    }

    private TaskCompletionSource<byte[]> TerminalOf(string id)
    {
        lock (_gate)
        {
            if (!_terminal.TryGetValue(id, out var tcs))
                _terminal[id] = tcs = new TaskCompletionSource<byte[]>(TaskCreationOptions.RunContinuationsAsynchronously);
            return tcs;
        }
    }

    /// <summary>The terminal frame of <paramref name="id"/>, whole or reassembled: its exact UTF-8.</summary>
    public Task<byte[]> Terminal(string id) => TerminalOf(id).Task;

    public bool ChunkArrived(string id) { lock (_gate) return _firstChunkAt.ContainsKey(id); }

    public TimeSpan Now => _clock.Elapsed;

    public Task Request(string id, string op) =>
        Send("{\"id\":\"" + id + "\",\"op\":\"" + op + "\",\"protocol\":" + WireProtocol.Version + ",\"body\":{}}");

    private async Task Send(string text)
    {
        var socket = _socket ?? throw new InvalidOperationException("no bridge is connected");
        await _sendLock.WaitAsync().ConfigureAwait(false);
        try
        {
            await socket.SendAsync(new ArraySegment<byte>(Encoding.UTF8.GetBytes(text)), WebSocketMessageType.Text, true, _stop.Token)
                .ConfigureAwait(false);
        }
        finally { _sendLock.Release(); }
    }

    private async Task Watch()
    {
        while (!_stop.IsCancellationRequested)
        {
            try { await Task.Delay(100, _stop.Token).ConfigureAwait(false); } catch { return; }
            TimeSpan silent, helloAt;
            lock (_gate)
            {
                helloAt = _helloAt;
                silent = _clock.Elapsed - _lastMessage;
                if (ChunkStallWouldFireAt == null && _lastChunk is { } chunk && _clock.Elapsed - chunk > ChunkStallLimit)
                    ChunkStallWouldFireAt = _clock.Elapsed;
            }
            if (helloAt == TimeSpan.Zero || ClosedForSilenceAt != null || silent <= _silenceLimit) continue;
            lock (_gate) if (silent > LongestSilence) LongestSilence = silent;
            ClosedForSilenceAt = _clock.Elapsed - helloAt;
            var socket = _socket;
            if (socket == null) continue;
            var record = _current;
            if (record != null) Ended(record, "relay silence close 1011");
            await _sendLock.WaitAsync().ConfigureAwait(false);
            try { await socket.CloseOutputAsync((WebSocketCloseStatus)1011, "silent past the limit", CancellationToken.None).ConfigureAwait(false); }
            catch { }
            finally { _sendLock.Release(); }
            socket.Abort();
        }
    }

    public void Dispose()
    {
        _stop.Cancel();
        try { _socket?.Abort(); } catch { }
        try { _listener.Stop(); } catch { }
        try { _listener.Close(); } catch { }
    }
}

/// <summary>A large answer over a slow uplink, chunked: the relay never goes silent past its limit, a concurrent
/// <c>health</c> waits at most the window at the link's rate, and the reassembled frame is the bridge's whole frame byte
/// for byte.</summary>
public class RealSocketChunkedTests
{
    private readonly ITestOutputHelper _output;
    public RealSocketChunkedTests(ITestOutputHelper output) => _output = output;

    [Fact]
    public async Task A_large_answer_over_a_slow_real_socket_keeps_the_relay_alive_and_a_concurrent_health_answers_within_the_window()
    {
        var noise = RealSocketScale.Noise();
        var pipe = "volt.test.relay.real." + Guid.NewGuid().ToString("N");
        using var bridge = RealSocketScale.BridgePipe(pipe, noise);
        bridge.Start();
        // The frame the bridge sends whole, built the way the tunnel builds it, from the pipe's own answer.
        var whole = Encoding.UTF8.GetBytes(RelayFrames.Result("r1", new PipeClient(pipe).Call(Ops.Fetch, connectTimeoutMs: 5000)));

        using var relay = new HttpListenerRelay(announce: true, RealSocketScale.RelaySilenceLimit);
        using var proxy = new ThrottledProxy(relay.Port, RealSocketScale.BytesPerSecond);
        var lines = new ConcurrentQueue<string>();
        using var tunnel = new RelayTunnel(
            RelaySidecar.Parse("{\"url\":\"ws://localhost:" + proxy.Port + "/bridge\",\"token\":\"t\"}", "test"),
            pipe, "codesys", "0.0.0-test", socketFactory: null, reconnectDelay: null,
            log: (level, message) => lines.Enqueue("[" + level + "] " + message),
            pingEvery: RealSocketScale.BridgePingEvery, silenceLimit: RealSocketScale.BridgeSilenceLimit);
        tunnel.Start();
        Assert.True(await Task.WhenAny(relay.Hello, Task.Delay(10_000)) == relay.Hello, "no hello through the proxy:\n" + string.Join("\n", lines));

        var asked = relay.Now;
        await relay.Request("r1", Ops.Fetch);
        // The health goes out once the answer is on the wire: the window is full and the OS buffers hold what it allows.
        var deadline = DateTime.UtcNow.AddSeconds(10);
        while (!relay.ChunkArrived("r1") && DateTime.UtcNow < deadline) await Task.Delay(20);
        Assert.True(relay.ChunkArrived("r1"), "no chunk of the answer arrived:\n" + string.Join("\n", lines));
        // Two healths: as the answer starts (the window at its 16 KiB floor), then 4 s after the first answered, when the acks
        // have grown it to what the link earns. Each waits behind what the window let into the OS buffers.
        var answer = relay.Terminal("r1");
        var healthWaits = new List<TimeSpan>();
        for (var h = 0; h < 2; h++)
        {
            if (h > 0) await Task.WhenAny(answer, Task.Delay(TimeSpan.FromSeconds(4)));
            if (answer.IsCompleted) break;
            var healthAsked = relay.Now;
            await relay.Request("h" + h, Ops.Health);
            var health = relay.Terminal("h" + h);
            Assert.True(await Task.WhenAny(health, Task.Delay(20_000)) == health, "health h" + h + " never answered:\n" + string.Join("\n", lines));
            healthWaits.Add(relay.Now - healthAsked);
        }
        Assert.True(await Task.WhenAny(answer, Task.Delay(30_000)) == answer, "the answer never completed:\n" + string.Join("\n", lines));
        var answerTook = relay.Now - asked;
        var reassembled = await answer;

        var bound = RealSocketScale.WholeFrameWaitBound(TimeSpan.FromSeconds(2));
        _output.WriteLine(System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription + (IntPtr.Size == 8 ? " x64" : " x86") +
            $": frame {whole.Length} B as {relay.BinaryMessages} chunks (largest message {relay.LargestMessage} B) in {answerTook.TotalSeconds:F1} s; " +
            "health waited " + string.Join(", ", healthWaits.Select(w => w.TotalSeconds.ToString("F1", System.Globalization.CultureInfo.InvariantCulture))) +
            $" s (bound {bound.TotalSeconds:F1} s); longest relay silence {relay.LongestSilence.TotalSeconds:F1} s " +
            $"(limit {RealSocketScale.RelaySilenceLimit.TotalSeconds:F0} s)");
        foreach (var line in lines) _output.WriteLine(line);

        Assert.Empty(relay.Refusals);
        Assert.Equal(whole, reassembled);
        Assert.True(relay.ClosedForSilenceAt == null, "the relay went silent past its limit at " + relay.ClosedForSilenceAt);
        Assert.True(relay.LongestSilence < RealSocketScale.RelaySilenceLimit, "longest silence " + relay.LongestSilence);
        Assert.True(healthWaits.Count == 2, "the answer finished before the second health went out: " + healthWaits.Count);
        Assert.All(healthWaits, w => Assert.True(w <= bound, "a health waited " + w + ", over " + bound));
        Assert.True(relay.BinaryMessages > 1 && relay.LargestMessage <= RealSocketScale.ChunkBytes,
            relay.BinaryMessages + " chunks, largest " + relay.LargestMessage);
    }
}

/// <summary>The same answer over the same link on a connection whose relay announced nothing: sent whole, it starves
/// the relay past its silence limit. What makes the chunked test sharp — the link really is slow enough to break.</summary>
public class RealSocketWholeFrameTests
{
    private readonly ITestOutputHelper _output;
    public RealSocketWholeFrameTests(ITestOutputHelper output) => _output = output;

    [Fact]
    public async Task Without_an_announcement_the_same_answer_over_the_same_link_starves_the_relay_past_its_silence_limit()
    {
        var pipe = "volt.test.relay.real." + Guid.NewGuid().ToString("N");
        using var bridge = RealSocketScale.BridgePipe(pipe, RealSocketScale.Noise());
        bridge.Start();
        using var relay = new HttpListenerRelay(announce: false, RealSocketScale.RelaySilenceLimit);
        using var proxy = new ThrottledProxy(relay.Port, RealSocketScale.BytesPerSecond);
        var lines = new ConcurrentQueue<string>();
        using var tunnel = new RelayTunnel(
            RelaySidecar.Parse("{\"url\":\"ws://localhost:" + proxy.Port + "/bridge\",\"token\":\"t\"}", "test"),
            pipe, "codesys", "0.0.0-test", socketFactory: null, reconnectDelay: null,
            log: (level, message) => lines.Enqueue("[" + level + "] " + message),
            pingEvery: RealSocketScale.BridgePingEvery, silenceLimit: RealSocketScale.BridgeSilenceLimit);
        tunnel.Start();
        Assert.True(await Task.WhenAny(relay.Hello, Task.Delay(10_000)) == relay.Hello, "no hello through the proxy:\n" + string.Join("\n", lines));

        await relay.Request("r1", Ops.Fetch);
        var deadline = DateTime.UtcNow + RealSocketScale.RelaySilenceLimit + TimeSpan.FromSeconds(4);
        while (relay.ClosedForSilenceAt == null && DateTime.UtcNow < deadline) await Task.Delay(50);

        _output.WriteLine(System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription + (IntPtr.Size == 8 ? " x64" : " x86") +
            $": closed for silence at {relay.ClosedForSilenceAt?.TotalSeconds:F1} s; answer arrived: {relay.Terminal("r1").IsCompleted}");
        foreach (var line in lines) _output.WriteLine(line);

        Assert.NotNull(relay.ClosedForSilenceAt);
        Assert.False(relay.Terminal("r1").IsCompleted, "the whole answer arrived before the silence limit: the link is not slow enough to test anything");
    }
}
