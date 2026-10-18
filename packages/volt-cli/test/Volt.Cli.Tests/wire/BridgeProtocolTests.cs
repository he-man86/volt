using System;
using Volt.Cli.Sync;
using Volt.Contracts;
using Volt.Engine.Host;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>
/// THE CLI REFUSES A BRIDGE OF ANOTHER WIRE PROTOCOL before its first op (openspec
/// <c>relay-protocol-tracks-wire-breaks</c>). An update made while CODESYS is open leaves the previous in-proc bridge
/// loaded: an older bridge does not refuse the new path wire, it misreads it, and a pull deletes files. So the CLI reads
/// <c>health.protocol</c> once and sends no op to a bridge whose number is not its own — an absent number is "none".
/// </summary>
public class BridgeProtocolTests
{
    private static (FakeIde Ide, BridgePipeHost Host, BridgeClient Client) Bridge(int? protocol)
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"));
        var pipe = "volt.test." + Guid.NewGuid().ToString("N");
        var host = new BridgePipeHost(ide, pipe, protocol);
        host.Start();
        return (ide, host, new BridgeClient(pipe));
    }

    [Theory]
    [InlineData(1, "1")]
    [InlineData(null, "none")]
    public void An_older_bridge_or_one_with_no_number_is_refused_before_any_op_and_told_to_restart_the_IDE(int? theirs, string named)
    {
        var (ide, host, client) = Bridge(theirs);
        using (host)
        {
            var ex = Assert.Throws<BridgeError>(() => client.GetRefs());

            Assert.Equal(BridgeError.ProtocolCode, ex.Code);
            Assert.Contains($"wire protocol {named}", ex.Message);
            Assert.Contains($"this volt speaks {WireProtocol.Version}", ex.Message);
            Assert.Contains("restart the IDE", ex.Message);
            Assert.Equal(0, ide.WalkCalls);
        }
    }

    [Fact]
    public void A_newer_bridge_is_refused_before_any_op_and_told_to_update_Volt()
    {
        var (ide, host, client) = Bridge(WireProtocol.Version + 1);
        using (host)
        {
            var ex = Assert.Throws<BridgeError>(() => client.FetchChanges(new FetchRequest { Init = true }));

            Assert.Equal(BridgeError.ProtocolCode, ex.Code);
            Assert.Contains($"wire protocol {WireProtocol.Version + 1}", ex.Message);
            Assert.Contains("update Volt", ex.Message);
            Assert.Equal(0, ide.WalkCalls);
        }
    }

    [Fact]
    public void A_bridge_of_this_protocol_is_served()
    {
        var (ide, host, client) = Bridge(WireProtocol.Version);
        using (host)
        {
            Assert.Contains("P.pou", client.GetRefs().Items.Keys);
            Assert.Equal(1, ide.WalkCalls);
        }
    }
}
