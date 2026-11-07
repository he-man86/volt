using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Volt.Contracts;
using Volt.Engine.Host;
using Volt.Relay;
using Volt.Wire;
using Xunit;

namespace Volt.Relay.Tests;

/// <summary>
/// openspec <c>relay-last-drop-cause</c> 1.1: every <c>hello</c> after a connection's first carries <c>lastDrop</c>,
/// <c>{cause, ageS, silentS, inFlight, dialMs}</c> — how the previous connection ended, as a fixed token (never exception
/// text, which is localized), and what this redial took. The relay's logs cannot say why a bridge's connection ended;
/// only the bridge knows, and its log stays on the customer's machine.
/// </summary>
public class LastDropTests : IDisposable
{
    private readonly List<IDisposable> _disposables = new();

    public void Dispose()
    {
        foreach (var d in _disposables) { try { d.Dispose(); } catch { } }
    }

    private FakeRelay Start(FakeDelay delay, TimeSpan? pingEvery = null, TimeSpan? silenceLimit = null, FakeIde? ide = null)
    {
        var pipe = "volt.test.relay." + Guid.NewGuid().ToString("N");
        var host = new BridgePipeHost(ide ?? new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;")), pipe);
        host.Start();
        _disposables.Add(host);
        var relay = new FakeRelay();
        var config = RelaySidecar.Parse("{\"url\":\"wss://relay.test/bridge\",\"token\":\"t\"}", "test");
        var tunnel = new RelayTunnel(config, pipe, "codesys", "0.0.0-test", relay.NewSocket, delay.Delay, (_, _) => { },
            pingEvery, silenceLimit);
        _disposables.Add(tunnel);
        tunnel.Start();
        Assert.True(relay.Connected.Wait(10_000), "the tunnel never dialed out");
        return relay;
    }

    private static List<JsonElement> Hellos(FakeRelay relay) =>
        relay.Received.Select(f => { using var d = JsonDocument.Parse(f); return d.RootElement.Clone(); })
            .Where(r => r.TryGetProperty("hello", out _)).Select(r => r.GetProperty("hello")).ToList();

    private static async Task<JsonElement> AwaitHello(FakeRelay relay, int n)
    {
        var deadline = DateTime.UtcNow.AddSeconds(15);
        while (DateTime.UtcNow < deadline)
        {
            var hellos = Hellos(relay);
            if (hellos.Count >= n) return hellos[n - 1];
            await Task.Delay(25);
        }
        throw new TimeoutException("no hello #" + n + "; frames: " + string.Join(" | ", relay.Received));
    }

    [Fact]
    public async Task The_first_hello_carries_no_lastDrop_and_a_redial_names_how_the_connection_ended()
    {
        var delay = new FakeDelay();
        var relay = Start(delay);
        var first = await AwaitHello(relay, 1);
        Assert.False(first.TryGetProperty("lastDrop", out _));

        relay.DieWithoutClose();
        await delay.NextWait();
        delay.Release();
        var second = await AwaitHello(relay, 2);

        Assert.Equal(new[] { "protocol", "volt", "vendor", "pipe", "chunks", "lastDrop" },
            second.EnumerateObject().Select(p => p.Name).ToArray());
        var drop = second.GetProperty("lastDrop");
        Assert.Equal(new[] { "cause", "ageS", "silentS", "inFlight", "dialMs" },
            drop.EnumerateObject().Select(p => p.Name).ToArray());
        Assert.Equal("no_close:WebSocketException", drop.GetProperty("cause").GetString());
        Assert.True(drop.GetProperty("ageS").GetInt32() >= 0);
        Assert.True(drop.GetProperty("silentS").GetInt32() >= 0);
        Assert.Equal(0, drop.GetProperty("inFlight").GetInt32());
        Assert.True(drop.GetProperty("dialMs").GetInt64() >= 0);
    }

    [Fact]
    public async Task A_relay_close_is_named_by_its_status()
    {
        var delay = new FakeDelay();
        var relay = Start(delay);
        await AwaitHello(relay, 1);

        relay.Close(1001, "relay restarting");
        await delay.NextWait();
        delay.Release();

        Assert.Equal("relay_close:1001", (await AwaitHello(relay, 2)).GetProperty("lastDrop").GetProperty("cause").GetString());
    }

    [Fact]
    public async Task The_watchdog_drop_is_watchdog_silence_and_counts_the_requests_it_abandoned()
    {
        var entered = new ManualResetEventSlim(false);
        var release = new ManualResetEventSlim(false);
        var ide = new FakeIde(serializeSta: true, FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"))
        {
            ExtractEntered = entered,
            ExtractBlock = release,
        };
        var delay = new FakeDelay();
        var relay = Start(delay, TimeSpan.FromMilliseconds(100), TimeSpan.FromMilliseconds(600), ide);
        await AwaitHello(relay, 1);

        relay.SendRequest("a", Ops.Fetch, new { init = true });
        relay.SendRequest("b", Ops.Fetch, new { init = true });
        Assert.True(entered.Wait(15_000), "the fetch never reached the blocking step");
        await delay.NextWait();
        release.Set();
        delay.Release();

        var drop = (await AwaitHello(relay, 2)).GetProperty("lastDrop");
        Assert.Equal("watchdog_silence", drop.GetProperty("cause").GetString());
        Assert.Equal(2, drop.GetProperty("inFlight").GetInt32());
    }

    [Fact]
    public async Task A_stalled_send_is_send_stalled()
    {
        var delay = new FakeDelay();
        var relay = Start(delay, TimeSpan.FromMilliseconds(100), TimeSpan.FromMilliseconds(600));
        await AwaitHello(relay, 1);
        relay.StallSendWhen = frame => frame.StartsWith("{\"id\":\"r1\",\"result\"");

        relay.SendRequest("r1", Ops.Health);
        await delay.NextWait();
        relay.StallSendWhen = null;
        delay.Release();

        Assert.Equal("send_stalled", (await AwaitHello(relay, 2)).GetProperty("lastDrop").GetProperty("cause").GetString());
    }

    /// <summary>A dial that failed is the last end the next hello reports — it never connected, so it has no age and no
    /// silence: those are null, stated, never a made-up 0.</summary>
    [Fact]
    public async Task A_failed_redial_is_named_and_has_no_age()
    {
        var delay = new FakeDelay();
        var relay = Start(delay);
        await AwaitHello(relay, 1);

        relay.RefuseConnect = true;
        relay.DieWithoutClose();
        await delay.NextWait();
        delay.Release();
        await delay.NextWait();   // the refused dial ended
        relay.RefuseConnect = false;
        delay.Release();

        var drop = (await AwaitHello(relay, 2)).GetProperty("lastDrop");
        Assert.Equal("dial_failed:InvalidOperationException", drop.GetProperty("cause").GetString());
        Assert.Equal(JsonValueKind.Null, drop.GetProperty("ageS").ValueKind);
        Assert.Equal(JsonValueKind.Null, drop.GetProperty("silentS").ValueKind);
        Assert.Equal(0, drop.GetProperty("inFlight").GetInt32());
    }
}
