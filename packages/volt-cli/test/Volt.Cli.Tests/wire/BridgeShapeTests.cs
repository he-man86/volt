using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Volt.Cli.Sync;
using Volt.Contracts;
using Volt.Engine.Host;
using Volt.Wire;
using Xunit;
using static Volt.Cli.Tests.CommandHarness;

namespace Volt.Cli.Tests;

/// <summary>
/// THE CLIENT CHECKS THE BRIDGE'S SHAPE (wire-final-shape 4.3c). A bridge whose <c>health</c> states no
/// <c>languages</c> or no <c>kinds</c> predates this wire (the previous release reads our envelope leniently and serves
/// it), so the CLI refuses it by name, <c>BRIDGE_PREDATES_WIRE</c>, before any other op — nothing is read from it, so
/// nothing is misread. A bridge of an older release is a server that answers what such a bridge answers: this build's
/// bridge with that member taken out of its <c>health</c>, every other op served as it would be.
/// </summary>
public class BridgeShapeTests
{
    /// <summary>A bridge that predates this wire: a real pipe host over <paramref name="ide"/>, fronted by a server whose
    /// <c>health</c> lacks <paramref name="missing"/>; every other op is forwarded and served. <c>Ops</c> lists every op
    /// the client sent.</summary>
    internal sealed class OldBridge : IDisposable
    {
        private readonly BridgePipeHost _host;
        private readonly PipeServer _front;
        public string Pipe { get; } = "volt.test." + Guid.NewGuid().ToString("N");
        public ConcurrentQueue<string> Ops { get; } = new();

        public OldBridge(FakeIde ide, params string[] missing)
        {
            var inner = "volt.test." + Guid.NewGuid().ToString("N");
            _host = new BridgePipeHost(ide, inner);
            _host.Start();
            var client = new PipeClient(inner);
            _front = new PipeServer(Pipe, (req, emit) =>
            {
                Ops.Enqueue(req.Op);
                var answer = client.Forward(req.Op, req.Protocol, req.Body, p => emit(p));
                if (req.Op != Volt.Contracts.Ops.Health) return answer;
                var health = JsonNode.Parse(answer.GetRawText())!.AsObject();
                foreach (var m in missing) Assert.True(health.Remove(m), $"this build's health states `{m}`");
                return health;
            });
            _front.Start();
        }

        public void Dispose() { _front.Dispose(); _host.Dispose(); }
    }

    private static FakeIde.Item Prg() => FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;");

    public static IEnumerable<object[]> Missing() => new[] { new object[] { "languages" }, new object[] { "kinds" } };

    [Theory]
    [MemberData(nameof(Missing))]
    public void Every_op_on_a_bridge_whose_health_lacks_a_member_of_this_wire_is_refused_by_name_before_it_is_sent(string missing)
    {
        using var old = new OldBridge(ConnectedIde(Prg()), missing);
        var calls = new Func<BridgeClient, object>[]
        {
            c => c.GetHealth(),
            c => c.GetRefs(),
            c => c.FetchChanges(new FetchRequest { Init = true }),
            c => c.PushBatch(new PushRequest { Ops = new() { new DeleteItemOp { Name = "PLC_PRG.pou" } } }),
            c => c.Build(new BuildRequest()),
            c => c.Grep(new GrepRequest { Pattern = "x" }),
        };
        foreach (var call in calls)
        {
            var ex = Assert.Throws<BridgeError>(() => call(new BridgeClient(old.Pipe)));
            Assert.Equal(BridgeError.PredatesWireCode, ex.Code);
            Assert.Contains("predates this wire", ex.Message);
            Assert.Contains($"`{missing}`", ex.Message);
            Assert.Contains(old.Pipe, ex.Message);
        }
        Assert.All(old.Ops, op => Assert.Equal(Ops.Health, op));
        Assert.Equal(calls.Length, old.Ops.Count);
    }

    /// <summary>The check costs one <c>health</c> per client, not one per op: <c>init</c> and <c>status</c> read
    /// <c>health</c> first anyway, and that read is the check.</summary>
    [Fact]
    public void A_bridge_of_this_wire_is_checked_once_per_client_and_served()
    {
        using var front = new OldBridge(ConnectedIde(Prg())); // nothing taken out: this wire's bridge
        var client = new BridgeClient(front.Pipe);

        client.GetRefs();
        client.GetRefs();
        client.GetHealth();

        Assert.Equal(new[] { Ops.Health, Ops.Refs, Ops.Refs, Ops.Health }, front.Ops.ToArray());
    }

    [Fact]
    public void An_empty_list_is_a_fact_and_passes()
    {
        var health = JsonDocument.Parse("""{ "projects": [], "languages": [], "kinds": [] }""").RootElement;
        WireShape.Require(health, "p"); // no throw
    }

    [Theory]
    [InlineData("""{ "kinds": [] }""", "languages")]
    [InlineData("""{ "languages": ["ST"] }""", "kinds")]
    [InlineData("""{ "languages": null, "kinds": [] }""", "languages")]
    [InlineData("""{ "projects": [] }""", "languages`, `kinds")]
    public void A_health_without_either_list_is_refused_naming_what_it_lacks(string json, string named)
    {
        var health = JsonDocument.Parse(json).RootElement;
        var ex = Assert.Throws<BridgePredatesWireException>(() => WireShape.Require(health, "volt.bridge.codesys.7"));
        Assert.Contains(named, ex.Message);
        Assert.Contains("volt.bridge.codesys.7", ex.Message);
    }

    [Fact]
    public void The_refusal_names_the_bridges_own_version_when_it_states_one()
    {
        var health = JsonDocument.Parse("""{ "bridgeVersion": "0.1.17931", "projects": [] }""").RootElement;
        var ex = Assert.Throws<BridgePredatesWireException>(() => WireShape.Require(health, "p"));
        Assert.Contains("0.1.17931", ex.Message);
    }
}
