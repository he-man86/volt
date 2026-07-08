using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Threading.Tasks;
using Volt.Bridge.Core.Wire;
using Xunit;

namespace Volt.Bridge.Tests;

/// <summary>The data-plane CSRF guard: a request carrying an `Origin` header is a browser cross-origin call
/// (first-party clients — the CLI via node:http, the LSP, the connector's HttpClient — never send one). Such a
/// request must be rejected BEFORE it can act, so a web page the user happens to visit cannot POST /push and
/// inject items into the live PLC project. The connector's control plane applies the identical rule.</summary>
public class OriginGuardTests
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
    public async Task Data_plane_rejects_a_cross_origin_push_and_creates_nothing()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("Good", "PROGRAM Good\nVAR\nEND_VAR", "x := 1;"));
        var port = FreePort();
        var server = new BridgeHttpServer(ide, port);
        server.Start();
        try
        {
            using var http = new HttpClient();
            var req = new HttpRequestMessage(HttpMethod.Post, $"http://127.0.0.1:{port}/push")
            {
                Content = new StringContent(
                    "{\"ops\":[{\"op\":\"set\",\"name\":\"Evil.prg\",\"ifVersion\":null,\"sourceText\":\"PROGRAM Evil\\nVAR\\nEND_VAR\\n\"}]}",
                    Encoding.UTF8, "application/json"),
            };
            req.Headers.Add("Origin", "http://evil.example"); // a browser cross-origin call

            var res = await http.SendAsync(req);

            Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
            Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("write:")); // the injection never reached the IDE
        }
        finally { server.Stop(); }
    }

    [Fact]
    public async Task Data_plane_serves_a_first_party_request_with_no_Origin()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("Good", "PROGRAM Good\nVAR\nEND_VAR", "x := 1;"));
        var port = FreePort();
        var server = new BridgeHttpServer(ide, port);
        server.Start();
        try
        {
            using var http = new HttpClient();
            var res = await http.GetAsync($"http://127.0.0.1:{port}/health"); // no Origin header (first-party)

            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        }
        finally { server.Stop(); }
    }
}
