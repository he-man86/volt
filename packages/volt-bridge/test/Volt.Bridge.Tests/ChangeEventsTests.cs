using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Threading.Tasks;
using Volt.Bridge.Core.Wire;
using Xunit;

namespace Volt.Bridge.Tests;

/// <summary>The SSE change stream: a subscriber to <c>GET /events</c> receives a `change` event when the IDE
/// fires one (the bridge fans the driver's debounced ProjectChanged out to all subscribers) — so a client
/// refreshes reactively, no polling.</summary>
public class ChangeEventsTests
{
    private static int FreePort()
    {
        var l = new TcpListener(IPAddress.Loopback, 0);
        l.Start();
        var port = ((IPEndPoint)l.LocalEndpoint).Port;
        l.Stop();
        return port;
    }

    [Fact]
    public async Task Events_stream_delivers_a_change_when_the_ide_fires_one()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"));
        var port = FreePort();
        var server = new BridgeHttpServer(ide, port);
        server.Start();
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
            using var stream = await http.GetStreamAsync($"http://127.0.0.1:{port}/events");
            using var reader = new StreamReader(stream);

            // Wait for the ": connected" comment — proves our writer is registered before we fire.
            Assert.True(await ReadUntil(reader, "connected", TimeSpan.FromSeconds(5)));

            ide.FireProjectChanged();

            Assert.True(await ReadUntil(reader, "event: change", TimeSpan.FromSeconds(5)));
        }
        finally { server.Stop(); }
    }

    private static async Task<bool> ReadUntil(StreamReader r, string marker, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            var read = r.ReadLineAsync();
            if (await Task.WhenAny(read, Task.Delay(deadline - DateTime.UtcNow)) != read) return false;
            var line = await read;
            if (line == null) return false;
            if (line.Contains(marker)) return true;
        }
        return false;
    }
}
