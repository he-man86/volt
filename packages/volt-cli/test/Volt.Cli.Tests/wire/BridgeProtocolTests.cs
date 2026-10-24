using System;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using Volt.Cli.Sync;
using Volt.Contracts;
using Volt.Engine.Host;
using Volt.Wire;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>
/// A REQUEST OF ANOTHER WIRE PROTOCOL IS REFUSED BY THE BRIDGE BEFORE ANY OP (wire-final-shape 3.2, design §1). Every
/// request states its protocol; an update made while CODESYS is open leaves the previous in-proc bridge loaded, and a
/// peer of another release would read the wire with another meaning. So the bridge answers <c>PROTOCOL_MISMATCH</c>,
/// naming its own number in <c>data.bridgeProtocol</c>, before the body is read — and the CLI tells the engineer which
/// side to update. A client of another release is its FRAME, written here; a bridge of another release is a server that
/// answers what such a bridge answers. Neither is a production seam.
/// </summary>
public class BridgeProtocolTests
{
    private static (FakeIde Ide, BridgePipeHost Host, string Pipe) Bridge()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"));
        var pipe = "volt.test." + Guid.NewGuid().ToString("N");
        var host = new BridgePipeHost(ide, pipe);
        host.Start();
        return (ide, host, pipe);
    }

    /// <summary>The one terminal frame the bridge answers to <paramref name="line"/>.</summary>
    private static JsonElement Answer(string pipe, string line)
    {
        using var client = new NamedPipeClientStream(".", pipe, PipeDirection.InOut);
        client.Connect(5000);
        var bytes = Encoding.UTF8.GetBytes(line + "\n");
        client.Write(bytes, 0, bytes.Length);
        client.Flush();
        using var reader = new System.IO.StreamReader(client, Encoding.UTF8);
        string? raw;
        while ((raw = reader.ReadLine()) != null)
        {
            var frame = JsonDocument.Parse(raw).RootElement.Clone();
            if (!frame.TryGetProperty("progress", out _)) return frame;
        }
        throw new Xunit.Sdk.XunitException("the bridge answered nothing to: " + line);
    }

    [Theory]
    [InlineData(@"{""op"":""refs""}", "states none")]
    [InlineData(@"{""op"":""refs"",""protocol"":null}", "states none")]
    [InlineData(@"{""op"":""refs"",""protocol"":0}", "states 0")]
    [InlineData(@"{""op"":""refs"",""protocol"":2,""body"":{""bogusMemberOfProtocol2"":1}}", "states 2")]
    [InlineData(@"{""op"":""health"",""protocol"":2}", "states 2")]
    public void A_request_stating_no_protocol_or_another_is_refused_naming_the_bridges_before_its_body_is_read(string line, string named)
    {
        var (ide, host, pipe) = Bridge();
        using (host)
        {
            var error = Answer(pipe, line).GetProperty("error");

            Assert.Equal(BridgeErrorCodes.ProtocolMismatch, error.GetProperty("code").GetString());
            Assert.Contains(named, error.GetProperty("message").GetString());
            Assert.Equal(WireProtocol.Version, error.GetProperty("data").GetProperty("bridgeProtocol").GetInt32());
            Assert.Equal(0, ide.WalkCalls);
        }
    }

    /// <summary>The protocol is a JSON integer; a string is the request's error, as is a member the envelope does not
    /// define — the envelope is read as strictly as every body.</summary>
    [Theory]
    [InlineData(@"{""op"":""refs"",""protocol"":""1""}", "protocol")]
    [InlineData(@"{""op"":""refs"",""protocol"":1,""id"":""r1""}", "id")]
    public void A_protocol_that_is_no_integer_or_an_unknown_envelope_member_is_a_BAD_REQUEST(string line, string member)
    {
        var (ide, host, pipe) = Bridge();
        using (host)
        {
            var error = Answer(pipe, line).GetProperty("error");

            Assert.Equal(BridgeErrorCodes.BadRequest, error.GetProperty("code").GetString());
            Assert.Contains(member, error.GetProperty("message").GetString());
            Assert.Equal(0, ide.WalkCalls);
        }
    }

    [Fact]
    public void A_request_of_this_protocol_is_served()
    {
        var (ide, host, pipe) = Bridge();
        using (host)
        {
            var health = Answer(pipe, $@"{{""op"":""health"",""protocol"":{WireProtocol.Version}}}").GetProperty("result");
            Assert.Equal(WireProtocol.Version, health.GetProperty("protocol").GetInt32());
            Assert.Contains("P.pou", new BridgeClient(pipe).GetRefs().Items.Keys);
            Assert.Equal(1, ide.WalkCalls);
        }
    }

    /// <summary>A bridge of another release refuses this CLI's requests the same way; the CLI names the remedy by the
    /// comparison — an older bridge is the previous release still loaded, a newer one means this CLI is the old peer.</summary>
    [Theory]
    [InlineData(0, "restart the IDE")]
    [InlineData(WireProtocol.Version + 1, "update Volt")]
    public void The_cli_says_which_side_to_update_when_a_bridge_refuses_its_protocol(int bridges, string remedy)
    {
        var pipe = "volt.test." + Guid.NewGuid().ToString("N");
        var ops = 0;
        using var server = new PipeServer(pipe, (req, emit) =>
        {
            ops++;
            throw new CodedException(BridgeErrorCodes.ProtocolMismatch, "another release",
                new ProtocolMismatchData { BridgeProtocol = bridges });
        });
        server.Start();

        var ex = Assert.Throws<BridgeError>(() => new BridgeClient(pipe).GetRefs());

        Assert.Equal(BridgeErrorCodes.ProtocolMismatch, ex.Code);
        Assert.Contains($"wire protocol {bridges}", ex.Message);
        Assert.Contains($"this volt speaks {WireProtocol.Version}", ex.Message);
        Assert.Contains(remedy, ex.Message);
        Assert.Equal(1, ops);
    }
}
