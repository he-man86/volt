using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Volt.Contracts;
using Volt.Relay;
using Volt.Wire;
using Xunit;
using Xunit.Abstractions;

namespace Volt.Tests.Shared;

/// <summary>THE PATH GOES BAD WITH A LARGE ANSWER IN FLIGHT: a real tunnel on its real socket, through a proxy that keeps
/// the TCP connections open and stops carrying bytes, against a relay that records what its own close log would.
///
/// <para>Time decides the diagnosis here, so every case runs at any of three timings, chosen by
/// <c>VOLT_RELAY_FAULT_TIMING</c>: <c>scaled</c> (the default, a few seconds, what the suite runs) and <c>real</c> (the
/// protocol's own 10 s / 25 s: the tunnel gets no injected limit at all).</para>
///
/// <para>What a proxy cannot show: a real dead path also drops the bridge's TCP segments, so its OS retransmits and gives
/// up by itself. Here the proxy's OS acks every byte, so only the tunnel's own limits can end the connection.</para></summary>
public class RelayFaultTests
{
    private readonly ITestOutputHelper _output;
    public RelayFaultTests(ITestOutputHelper output) => _output = output;

    private sealed class Timing
    {
        public string Name = "";
        public TimeSpan? Ping;
        public TimeSpan? Silence;
        public TimeSpan PingEvery;
        public TimeSpan SilenceLimit;
        public TimeSpan RelaySilence;
        public TimeSpan ChunkStall;
    }

    private static Timing Chosen()
    {
        var name = Environment.GetEnvironmentVariable("VOLT_RELAY_FAULT_TIMING") ?? "scaled";
        switch (name)
        {
            case "real":
                return new Timing { Name = name, PingEvery = TimeSpan.FromSeconds(10), SilenceLimit = TimeSpan.FromSeconds(25),
                    RelaySilence = TimeSpan.FromSeconds(60), ChunkStall = TimeSpan.FromSeconds(60) };
            case "scaled":
                return new Timing { Name = name, Ping = TimeSpan.FromSeconds(1.25), Silence = TimeSpan.FromSeconds(3),
                    PingEvery = TimeSpan.FromSeconds(1.25), SilenceLimit = TimeSpan.FromSeconds(3),
                    RelaySilence = TimeSpan.FromSeconds(3), ChunkStall = TimeSpan.FromSeconds(3) };
            default:
                throw new ArgumentException("VOLT_RELAY_FAULT_TIMING is scaled or real, not " + name);
        }
    }

    private const int Progress = 11;
    private const int LargeNoise = 195_000;
    // Gzips under the window's 16 KiB floor, so all its chunks go out with no ack back.
    private const int SmallNoise = 9_000;

    private const string SilenceClose = "relay silence close 1011";

    private sealed class Case
    {
        public FlowFault Up;
        public FlowFault Down;
        public long? AfterUpBytes;
        public bool Rst;
        public int Noise = LargeNoise;
        public bool Announce = true;
        /// <summary>How the relay's log has the first connection ending; null when the answer gets through.</summary>
        public string? RelayEnd = SilenceClose;
    }

    private static readonly Dictionary<string, Case> Cases = new Dictionary<string, Case>
    {
        ["both-discard"] = new Case { Up = FlowFault.Discard, Down = FlowFault.Discard },
        ["both-hold"] = new Case { Up = FlowFault.Hold, Down = FlowFault.Hold },
        ["up-only"] = new Case { Up = FlowFault.Discard },
        ["down-only"] = new Case { Down = FlowFault.Discard, RelayEnd = "1006" },
        ["down-only-small-answer"] = new Case { Down = FlowFault.Discard, Noise = SmallNoise, RelayEnd = null },
        ["both-after-16k"] = new Case { Up = FlowFault.Discard, Down = FlowFault.Discard, AfterUpBytes = 16 * 1024 },
        ["up-after-16k"] = new Case { Up = FlowFault.Discard, AfterUpBytes = 16 * 1024 },
        ["rst"] = new Case { Rst = true, RelayEnd = "1006" },
        // Nothing announced, a whole frame far over the OS's buffers, into a path that stopped reading: the blocked send.
        ["both-hold-whole-frame"] = new Case { Up = FlowFault.Hold, Down = FlowFault.Hold, Noise = 2_000_000, Announce = false },
    };

    public static IEnumerable<object[]> CaseNames() => Cases.Keys.Select(k => new object[] { k });

    [Theory]
    [MemberData(nameof(CaseNames))]
    public async Task A_dead_path_under_a_large_answer_ends_the_connection_and_the_tunnel_redials(string name)
    {
        var c = Cases[name];
        var t = Chosen();
        var pipe = "volt.test.relay.fault." + Guid.NewGuid().ToString("N");
        var noise = new byte[c.Noise];
        new Random(42).NextBytes(noise);
        var text = Convert.ToBase64String(noise);
        using var bridge = new PipeServer(pipe, (request, emit) =>
        {
            if (request.Op != Ops.Fetch) return new { ok = true };
            // The read: the field's 11 progress frames, then its median 1.37 s before the answer.
            for (var i = 0; i < Progress; i++) emit(new { done = i });
            Thread.Sleep(TimeSpan.FromMilliseconds(1370));
            return new { items = new[] { new { path = "Application/Big.pou", text = "(* " + text + " *)" } } };
        });
        bridge.Start();

        using var relay = new HttpListenerRelay(c.Announce, t.RelaySilence) { ChunkStallLimit = t.ChunkStall };
        using var proxy = new ThrottledProxy(relay.Port, 0);
        var lines = new ConcurrentQueue<string>();
        var clock = System.Diagnostics.Stopwatch.StartNew();
        using var tunnel = new RelayTunnel(
            RelaySidecar.Parse("{\"url\":\"ws://localhost:" + proxy.Port + "/bridge\",\"token\":\"t\"}", "test"),
            pipe, "codesys", "0.0.0-test", socketFactory: null, reconnectDelay: null,
            log: (level, message) => lines.Enqueue(clock.Elapsed.TotalSeconds.ToString("F1", CultureInfo.InvariantCulture) + " [" + level + "] " + message),
            pingEvery: t.Ping, silenceLimit: t.Silence);
        tunnel.Start();
        Assert.True(await Task.WhenAny(relay.Hello, Task.Delay(10_000)) == relay.Hello, "no hello:\n" + string.Join("\n", lines));

        // Past a ping and its pong, mid-cycle, as a connection in service is.
        await Task.Delay(TimeSpan.FromTicks(t.PingEvery.Ticks * 7 / 5));
        var asked = relay.Now;
        await relay.Request("r1", Ops.Fetch);

        // The read finished as far as the relay can tell: every progress frame arrived. Only then does the path go bad.
        var armBy = DateTime.UtcNow.AddSeconds(10);
        while (relay.ProgressFrames < Progress && DateTime.UtcNow < armBy) await Task.Delay(2);
        Assert.Equal(Progress, relay.ProgressFrames);
        var faultAt = relay.Now;
        if (c.Rst) proxy.Reset();
        else if (c.AfterUpBytes is { } n) proxy.BlackholeAfterUpBytes(n, c.Up, c.Down);
        else proxy.Blackhole(c.Up, c.Down);

        // Long enough for any limit the tunnel has: a send bound, then a tick to notice, then the longest backoff before
        // the second dial. Passing it is a bug to explain.
        var budget = t.SilenceLimit + t.SilenceLimit + t.PingEvery + t.PingEvery + TimeSpan.FromSeconds(5);
        var deadline = DateTime.UtcNow + budget;
        var answer = relay.Terminal("r1");
        while (DateTime.UtcNow < deadline && !answer.IsCompleted && relay.Connections.Count < 2) await Task.Delay(20);
        // A moment for an end the redial raced, then read.
        await Task.Delay(300);

        double S(TimeSpan? at) => at == null ? double.NaN : (at.Value - asked).TotalSeconds;
        var first = relay.Connections[0];
        var redial = relay.Connections.Count > 1 ? relay.Connections[1] : null;
        var warnings = lines.Where(l => l.Contains("[Warn]") || l.Contains("-> fetch")).ToList();
        _output.WriteLine(string.Join(" | ",
            name,
            "timing " + t.Name + " (" + System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription + ")",
            "fault +" + S(faultAt).ToString("F1", CultureInfo.InvariantCulture) + "s",
            "answer " + (answer.IsCompleted ? "delivered +" + S(relay.Now).ToString("F1", CultureInfo.InvariantCulture) + "s" : "not delivered"),
            "relay end: " + (first.End ?? "still open") + " +" + S(first.EndedAt).ToString("F1", CultureInfo.InvariantCulture) +
                "s, ping age " + (first.PingAgeAtEnd?.TotalSeconds ?? double.NaN).ToString("F1", CultureInfo.InvariantCulture) + "s",
            "redial: " + (redial == null ? "none" : "+" + S(redial.AcceptedAt).ToString("F1", CultureInfo.InvariantCulture) + "s, old socket live: " + redial.ReplacedOld),
            "chunks at relay " + relay.BinaryMessages,
            "chunk stall would fire " + (relay.ChunkStallWouldFireAt == null ? "no" : "+" + S(relay.ChunkStallWouldFireAt).ToString("F1", CultureInfo.InvariantCulture) + "s")));
        foreach (var line in warnings) _output.WriteLine("  " + line);

        // The redial happens, or the answer got through; the dead flow is never kept.
        Assert.Equal(c.RelayEnd, first.End);
        if (name == "down-only")
        {
            // The relay kept hearing the pings: the bridge dropped on the tick where the next one was due.
            Assert.True(Math.Abs((first.PingAgeAtEnd!.Value - t.PingEvery).TotalSeconds) < 0.5, "ping age at close " + first.PingAgeAtEnd);
        }
        Assert.True(answer.IsCompleted || redial != null, name + " neither delivered nor redialed within " + budget + ":\n" + string.Join("\n", lines));
    }

    /// <summary>A REDIAL INTO THE DEAD PATH: TCP connects (a proxy, a VPN, an edge answered it) and the upgrade's answer
    /// never comes. No heartbeat runs before a connection is up, so the dial needs its own bound; without one the tunnel
    /// waits there for ever, and the bridge is off the relay until the IDE restarts, the path long healed.</summary>
    [Fact]
    public async Task A_dial_whose_upgrade_never_answers_gives_up_and_the_next_dial_lands_once_the_path_heals()
    {
        // Over the ~2 s Windows spends on a refused ::1 before it tries 127.0.0.1: that is a dial too.
        var limit = TimeSpan.FromSeconds(4);
        using var relay = new HttpListenerRelay(announce: true, TimeSpan.FromSeconds(60));
        using var proxy = new ThrottledProxy(relay.Port, 0) { BlackholeNewFlows = true };
        var lines = new ConcurrentQueue<string>();
        using var tunnel = new RelayTunnel(
            RelaySidecar.Parse("{\"url\":\"ws://localhost:" + proxy.Port + "/bridge\",\"token\":\"t\"}", "test"),
            "volt.test.relay.fault.none", "codesys", "0.0.0-test", socketFactory: null, reconnectDelay: null,
            log: (level, message) => lines.Enqueue("[" + level + "] " + message),
            pingEvery: TimeSpan.FromSeconds(1), silenceLimit: limit);
        tunnel.Start();
        // The first dial is in its wait when the path heals. (Windows tries ::1 first and a refused connect takes it ~2 s.)
        while (proxy.Flows == 0) await Task.Delay(10);
        await Task.Delay(TimeSpan.FromMilliseconds(200));
        proxy.BlackholeNewFlows = false;
        // The bound, the backoff with its jitter (at most 2 s), and a dial (~2 s of refused ::1, then the relay).
        var landed = await Task.WhenAny(relay.Hello, Task.Delay(limit + TimeSpan.FromSeconds(6))) == relay.Hello;
        Assert.True(landed, "the tunnel is still in its first dial, the path healed:\n" + string.Join("\n", lines));
        Assert.Contains(lines, l => l.Contains("ended before it connected") && l.Contains("could not connect (TimeoutException)") &&
            l.Contains("the upgrade did not complete within 4s"));
    }

    /// <summary>Runs only at a real timing: 300 s of the protocol's own clock, the joint gate's 2 KB/s link.</summary>
    public sealed class RealTimingTheory : TheoryAttribute
    {
        public RealTimingTheory()
        {
            if ((Environment.GetEnvironmentVariable("VOLT_RELAY_FAULT_TIMING") ?? "scaled") == "scaled")
                Skip = "300 s; set VOLT_RELAY_FAULT_TIMING to real";
        }
    }

    /// <summary>THE CHUNK RULE ON A SLOW LINK: at the timing chosen, a 110-chunk answer over <paramref name="bytesPerSecond"/>
    /// each way for 300 s, with a health every 11 s. Whatever limits the timing has must not drop a link that is slow and
    /// alive.</summary>
    [RealTimingTheory]
    [InlineData(2000)]
    [InlineData(1000)]
    [InlineData(600)]
    public async Task A_slow_live_link_keeps_its_connection_for_300_s(int bytesPerSecond)
    {
        var t = Chosen();
        var pipe = "volt.test.relay.fault." + Guid.NewGuid().ToString("N");
        var noise = new byte[880_000];
        new Random(42).NextBytes(noise);
        var text = Convert.ToBase64String(noise);
        using var bridge = new PipeServer(pipe, (request, emit) => request.Op == Ops.Fetch
            ? (object)new { items = new[] { new { path = "Application/Big.pou", text = "(* " + text + " *)" } } }
            : new { ok = true });
        bridge.Start();
        using var relay = new HttpListenerRelay(true, t.RelaySilence) { ChunkStallLimit = t.ChunkStall };
        using var proxy = new ThrottledProxy(relay.Port, bytesPerSecond);
        var lines = new ConcurrentQueue<string>();
        using var tunnel = new RelayTunnel(
            RelaySidecar.Parse("{\"url\":\"ws://localhost:" + proxy.Port + "/bridge\",\"token\":\"t\"}", "test"),
            pipe, "codesys", "0.0.0-test", socketFactory: null, reconnectDelay: null,
            log: (level, message) => lines.Enqueue("[" + level + "] " + message),
            pingEvery: t.Ping, silenceLimit: t.Silence);
        tunnel.Start();
        Assert.True(await Task.WhenAny(relay.Hello, Task.Delay(30_000)) == relay.Hello, "no hello:\n" + string.Join("\n", lines));
        var start = relay.Now;
        await relay.Request("r1", Ops.Fetch);
        var waits = new List<double>();
        var unanswered = 0;
        for (var h = 0; relay.Now - start < TimeSpan.FromSeconds(300); h++)
        {
            await Task.Delay(TimeSpan.FromSeconds(11));
            var asked = relay.Now;
            var id = "h" + h;
            await relay.Request(id, Ops.Health);
            var health = relay.Terminal(id);
            if (await Task.WhenAny(health, Task.Delay(TimeSpan.FromSeconds(60))) == health) waits.Add((relay.Now - asked).TotalSeconds);
            else unanswered++;
            if (relay.Connections.Count > 1 || relay.Connections[0].End != null) break;
        }
        var first = relay.Connections[0];
        var ended = first.End == null ? "still open" : first.End + " at +" + (first.EndedAt!.Value - start).TotalSeconds.ToString("F1", CultureInfo.InvariantCulture) + "s";
        _output.WriteLine(string.Join(" | ", "slow link " + bytesPerSecond + " B/s", "timing " + t.Name,
            "chunks " + relay.BinaryMessages, "healths " + waits.Count + " answered, " + unanswered + " not",
            "health wait max " + (waits.Count == 0 ? double.NaN : waits.Max()).ToString("F1", CultureInfo.InvariantCulture) + "s",
            "longest relay silence " + relay.LongestSilence.TotalSeconds.ToString("F1", CultureInfo.InvariantCulture) + "s",
            "connection " + ended));
        foreach (var line in lines.Where(l => l.Contains("[Warn]"))) _output.WriteLine("  " + line);
        Assert.True(first.End == null, "a live link was dropped: " + ended + "\n" + string.Join("\n", lines.Where(l => l.Contains("[Warn]"))));
    }

    /// <summary>Latency and loss's retransmission pauses, no blackhole: a slow answer, and a live connection.</summary>
    [Fact]
    public Task Latency_alone_keeps_the_connection() => Latency_and_retransmission_pauses(0.04, 0.0, 0.0);

    /// <summary>At a real timing only: a pause scaled down to a second is the scheduler's noise on a busy machine.</summary>
    [RealTimingTheory]
    [InlineData(0.04, 0.8, 0.2)]
    [InlineData(0.08, 0.8, 0.5)]
    public async Task Latency_and_retransmission_pauses(double latencyOfSilence, double everyOfSilence, double lengthOfSilence)
    {
        var t = Chosen();
        var limit = t.SilenceLimit;
        var pipe = "volt.test.relay.fault." + Guid.NewGuid().ToString("N");
        var noise = new byte[LargeNoise];
        new Random(42).NextBytes(noise);
        var text = Convert.ToBase64String(noise);
        using var bridge = new PipeServer(pipe, (request, emit) =>
        {
            if (request.Op != Ops.Fetch) return new { ok = true };
            for (var i = 0; i < Progress; i++) emit(new { done = i });
            return new { items = new[] { new { path = "Application/Big.pou", text = "(* " + text + " *)" } } };
        });
        bridge.Start();
        using var relay = new HttpListenerRelay(true, t.RelaySilence) { ChunkStallLimit = t.ChunkStall };
        using var proxy = new ThrottledProxy(relay.Port, 0)
        {
            Latency = TimeSpan.FromTicks((long)(limit.Ticks * latencyOfSilence)),
            Stall = everyOfSilence > 0 ? (TimeSpan.FromTicks((long)(limit.Ticks * everyOfSilence)), TimeSpan.FromTicks((long)(limit.Ticks * lengthOfSilence))) : ((TimeSpan, TimeSpan)?)null,
        };
        var lines = new ConcurrentQueue<string>();
        using var tunnel = new RelayTunnel(
            RelaySidecar.Parse("{\"url\":\"ws://localhost:" + proxy.Port + "/bridge\",\"token\":\"t\"}", "test"),
            pipe, "codesys", "0.0.0-test", socketFactory: null, reconnectDelay: null,
            log: (level, message) => lines.Enqueue("[" + level + "] " + message),
            pingEvery: t.Ping, silenceLimit: t.Silence);
        tunnel.Start();
        Assert.True(await Task.WhenAny(relay.Hello, Task.Delay(limit + limit)) == relay.Hello, "no hello:\n" + string.Join("\n", lines));
        var asked = relay.Now;
        await relay.Request("r1", Ops.Fetch);
        var budget = limit + limit + limit;
        var answer = relay.Terminal("r1");
        await Task.WhenAny(answer, Task.Delay(budget));
        var took = relay.Now - asked;
        var first = relay.Connections[0];
        _output.WriteLine("latency " + proxy.Latency.TotalSeconds + "s stall " + proxy.Stall + " | timing " + t.Name +
            " | answer " + (answer.IsCompleted ? "delivered in " + took.TotalSeconds.ToString("F1", CultureInfo.InvariantCulture) + "s" : "not delivered") +
            " | connections " + relay.Connections.Count + " | first end " + (first.End ?? "still open") +
            " | longest relay silence " + relay.LongestSilence.TotalSeconds.ToString("F1", CultureInfo.InvariantCulture) + "s");
        foreach (var line in lines.Where(l => l.Contains("[Warn]"))) _output.WriteLine("  " + line);
        // Not that the answer arrived: a pause longer than the window's 5 s rate span holds it at its floor, 16 KiB a cycle
        // (real timing, 30 s in 48 s: ~10 min for 195 KiB). Slow is allowed; no limit may read it as dead.
        Assert.True(first.End == null, "no blackhole, and the connection ended: " + first.End + "\n" + string.Join("\n", lines));
    }

    /// <summary>DOWNSTREAM DELAYED, THEN RESUMES, at the tunnel's OWN defaults (nothing injected): the field's stalled
    /// socket (PLC Assist, 2026-11-05: relay-to-bridge frames held 53 s and ~61 s on one live WebSocket while other HTTP to
    /// the relay worked). The tunnel must drop the socket within its silence limit plus one ping tick and redial, and the
    /// request in flight on it is abandoned by name — never answered late on the new connection, never left hanging.</summary>
    [Fact]
    public async Task A_downstream_held_53_s_then_resumed_is_dropped_within_silence_plus_one_tick_and_the_in_flight_request_is_abandoned_by_name()
    {
        // The defaults this pins: ping 10 s, silence 25 s. Detection lands at most a tick after the limit.
        var bound = TimeSpan.FromSeconds(25 + 10 + 2);
        var pipe = "volt.test.relay.fault." + Guid.NewGuid().ToString("N");
        var release = new ManualResetEventSlim(false);
        using var bridge = new PipeServer(pipe, (request, emit) =>
        {
            if (request.Op != Ops.Fetch) return new { ok = true };
            // In flight across the stall: answers only after the old socket is gone.
            release.Wait(TimeSpan.FromSeconds(90));
            return new { items = Array.Empty<object>() };
        });
        bridge.Start();

        // The relay itself never closes for silence here: only the bridge's own watchdog may end the connection.
        using var relay = new HttpListenerRelay(true, TimeSpan.FromSeconds(300));
        using var proxy = new ThrottledProxy(relay.Port, 0);
        var lines = new ConcurrentQueue<string>();
        var clock = System.Diagnostics.Stopwatch.StartNew();
        using var tunnel = new RelayTunnel(
            RelaySidecar.Parse("{\"url\":\"ws://localhost:" + proxy.Port + "/bridge\",\"token\":\"t\"}", "test"),
            pipe, "codesys", "0.0.0-test", socketFactory: null, reconnectDelay: null,
            log: (level, message) => lines.Enqueue(clock.Elapsed.TotalSeconds.ToString("F1", CultureInfo.InvariantCulture) + " [" + level + "] " + message));
        tunnel.Start();
        Assert.True(await Task.WhenAny(relay.Hello, Task.Delay(10_000)) == relay.Hello, "no hello:\n" + string.Join("\n", lines));

        await relay.Request("r1", Ops.Fetch);
        await Task.Delay(500);
        // Downstream stops being read: the relay's frames wait in the OS buffers and arrive late, nothing is lost.
        var heldAt = DateTime.UtcNow;
        proxy.Blackhole(FlowFault.None, FlowFault.Hold);

        while (DateTime.UtcNow - heldAt < bound && relay.Connections.Count < 2) await Task.Delay(50);
        var detectedIn = DateTime.UtcNow - heldAt;
        Assert.True(relay.Connections.Count >= 2,
            "no redial within " + bound.TotalSeconds + "s of the hold:\n" + string.Join("\n", lines));

        // The drop names the request it abandoned.
        Assert.Contains(lines, l => l.Contains("no frame for 25s") );
        Assert.Contains(lines, l => l.Contains("ended") && l.Contains("in flight: r1"));

        // The path resumes at the field's 53 s; then the bridge finishes the read.
        var resumeIn = TimeSpan.FromSeconds(53) - (DateTime.UtcNow - heldAt);
        if (resumeIn > TimeSpan.Zero) await Task.Delay(resumeIn);
        proxy.Blackhole(FlowFault.None, FlowFault.None);
        release.Set();
        await Task.Delay(3000);

        _output.WriteLine("detected and redialed " + detectedIn.TotalSeconds.ToString("F1", CultureInfo.InvariantCulture) + "s after the hold");
        foreach (var line in lines.Where(l => l.Contains("[Warn]") || l.Contains("ended"))) _output.WriteLine("  " + line);
        // Abandoned, not replayed: the late answer never reaches the relay on the new connection.
        Assert.False(relay.Terminal("r1").IsCompleted, "r1 was answered after its connection was dropped:\n" + string.Join("\n", lines));
    }
}
