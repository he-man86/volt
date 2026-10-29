using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Volt.Contracts;
using Volt.Engine.Host;
using Volt.Relay;
using Volt.Wire;
using Xunit;

namespace Volt.Relay.Tests;

/// <summary>Classes whose tests time the tunnel's own clock run ALONE, never beside another class.
///
/// <para>xunit runs every test body on the thread pool, and the suite's bodies block pool threads synchronously
/// (<c>Connected.Wait</c>, <c>entered.Wait</c>, a tunnel's <c>Dispose</c>). On a 2-core runner the pool's minimum is
/// two threads, so two such waits in parallel classes leave none for the tunnel's continuations until the pool's
/// starvation injection adds one (~0.5 s per thread): the ping loop then stalls for a second for reasons that are not
/// the tunnel's. Measured: one foreign blocked pool thread beside this test at <c>DOTNET_PROCESSOR_COUNT=2</c> (with the
/// fake relay holding one too) gave 6 pings in 1.5 s, the first at 940 ms — the CI failure's shape. A cadence measured
/// with another class's waits in the same pool measures that class.</para></summary>
[CollectionDefinition(Name, DisableParallelization = true)]
public sealed class TunnelClockCollection
{
    public const string Name = "the tunnel's own clock";
}

[Collection(TunnelClockCollection.Name)]
public sealed class HeartbeatCadenceTests : IDisposable
{
    private readonly List<IDisposable> _disposables = new();

    public void Dispose()
    {
        foreach (var d in _disposables) { try { d.Dispose(); } catch { } }
    }

    /// <summary>THE HEARTBEAT NEVER WAITS FOR THE IDE (openspec <c>twincat-large-solution-refs</c> 1). A field log of a
    /// 148 s <c>refs</c> on an 18-PLC-project TwinCAT solution, retried by its caller while it ran, was read as "the
    /// bridge stops answering pings". The ping is the tunnel's own frame, sent on its own clock; every request holds a
    /// thread of its own for its pipe call (never one of the pool's, which a pile of held calls could starve), so neither
    /// a long walk on the IDE's one thread nor the retries waiting for it delay a ping.</summary>
    [Fact]
    public async Task Pings_keep_their_cadence_while_retried_refs_hold_the_IDE_thread()
    {
        var entered = new ManualResetEventSlim(false);
        var release = new ManualResetEventSlim(false);
        var ide = new FakeIde(serializeSta: true, FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"))
        {
            Projects = new List<ProjectEntry> { new("codesys", "Proj", "healthy", false) },
        };
        ide.OnWalkItems = () => { entered.Set(); release.Wait(TimeSpan.FromSeconds(30)); };
        var relay = Start(ide, pingEvery: TimeSpan.FromMilliseconds(100));
        await relay.AwaitHello();

        relay.SendRequest("r0", Ops.Refs);
        Assert.True(entered.Wait(15_000), "the refs never reached its walk");
        for (var i = 1; i <= 2 * Environment.ProcessorCount + 4; i++) relay.SendRequest("r" + i, Ops.Refs);
        int Pings() => relay.Received.Count(f => f == "{\"volt\":\"ping\"}");
        var before = Pings();
        await Task.Delay(1500);
        var during = Pings() - before;

        release.Set();
        await relay.AwaitFrame("r0", "result");
        Assert.True(during >= 8, $"{during} pings in 1.5 s at a 100 ms cadence while the refs ran");
    }

    private FakeRelay Start(FakeIde ide, TimeSpan pingEvery)
    {
        var pipe = "volt.test.relay." + Guid.NewGuid().ToString("N");
        var host = new BridgePipeHost(ide, pipe);
        host.Start();
        _disposables.Add(host);

        var relay = new FakeRelay();
        var config = RelaySidecar.Parse("{\"url\":\"wss://relay.test/bridge\",\"token\":\"t\"}", "test");
        var tunnel = new RelayTunnel(config, pipe, "codesys", "0.0.0-test", relay.NewSocket, null, null, pingEvery, null);
        _disposables.Add(tunnel);
        tunnel.Start();

        Assert.True(relay.Connected.Wait(10_000), "the tunnel never dialed out");
        return relay;
    }
}
