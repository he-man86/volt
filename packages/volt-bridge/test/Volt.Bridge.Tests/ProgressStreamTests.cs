using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Volt.Bridge.Core.Wire;
using Xunit;

namespace Volt.Bridge.Tests;

/// <summary>A long operation streams progress on its OWN response as NDJSON when the client sends
/// `Accept: application/x-ndjson` — progress frames then exactly one terminal `result` frame — and returns the
/// unchanged single JSON body otherwise (backward-compatible).</summary>
public class ProgressStreamTests
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
    public async Task Fetch_streams_progress_frames_then_a_result_frame_when_ndjson_requested()
    {
        // Enough items that the every-25 throttle emits at least one progress frame.
        var items = Enumerable.Range(0, 60)
            .Select(i => FakeIde.Item.TextualPou($"P{i}", $"PROGRAM P{i}\nVAR\nEND_VAR", "x := 1;"))
            .ToArray();
        var port = FreePort();
        var server = new BridgeHttpServer(new FakeIde(items), port);
        server.Start();
        try
        {
            using var http = new HttpClient();
            var req = new HttpRequestMessage(HttpMethod.Post, $"http://127.0.0.1:{port}/fetch")
            {
                Content = new StringContent("{\"knownItems\":{}}", Encoding.UTF8, "application/json"),
            };
            req.Headers.Accept.ParseAdd("application/x-ndjson");

            var res = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead);
            Assert.Equal("application/x-ndjson", res.Content.Headers.ContentType?.MediaType);

            var frames = (await res.Content.ReadAsStringAsync())
                .Split('\n', StringSplitOptions.RemoveEmptyEntries)
                .Select(l => JsonDocument.Parse(l).RootElement)
                .ToList();

            Assert.Contains(frames, f => f.TryGetProperty("progress", out _)); // ≥1 progress frame
            Assert.True(frames[^1].TryGetProperty("result", out var result));  // terminal frame is the result
            Assert.True(result.TryGetProperty("changed", out _));              // and it IS a FetchResponse
        }
        finally { server.Stop(); }
    }

    [Fact]
    public async Task Fetch_returns_a_single_json_body_without_the_ndjson_accept_header()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"));
        var port = FreePort();
        var server = new BridgeHttpServer(ide, port);
        server.Start();
        try
        {
            using var http = new HttpClient();
            var res = await http.PostAsync($"http://127.0.0.1:{port}/fetch",
                new StringContent("{\"knownItems\":{}}", Encoding.UTF8, "application/json"));

            Assert.Equal("application/json", res.Content.Headers.ContentType?.MediaType); // unchanged
            var body = await res.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(body);                    // one object, not NDJSON frames
            Assert.True(doc.RootElement.TryGetProperty("changed", out _));
        }
        finally { server.Stop(); }
    }
}
