using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Volt.Bridge.Core.Library;
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

    [Fact]
    public async Task Verbose_init_folds_library_signatures_into_one_phaseless_progress_total()
    {
        // 30 project items + 40 library element signatures. The signatures must ride the SAME progress bar as the
        // items (one continuous total), with NO separate "rendering libraries" phase — the fix for the confusing
        // two-phase progress. `Function` sigs render cleanly (see LibSignatureRendererTests).
        var items = Enumerable.Range(0, 30)
            .Select(i => FakeIde.Item.TextualPou($"P{i}", $"PROGRAM P{i}\nVAR\nEND_VAR", "x := 1;"))
            .ToArray();
        var libs = Enumerable.Range(0, 40)
            .Select(i => new LibSignature($"F{i}", "MyLib, 1.0.0.0 (v)", "Function",
                Array.Empty<LibVar>(), Array.Empty<LibVar>(), Array.Empty<LibVar>(), Array.Empty<LibVar>(), null, "INT"))
            .ToList();
        var port = FreePort();
        var server = new BridgeHttpServer(new FakeIde(items) { LibSignatures = libs }, port);
        server.Start();
        try
        {
            using var http = new HttpClient();
            var req = new HttpRequestMessage(HttpMethod.Post, $"http://127.0.0.1:{port}/init")
            {
                Content = new StringContent("{}", Encoding.UTF8, "application/json"),
            };
            req.Headers.Accept.ParseAdd("application/x-ndjson");

            var res = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead);
            var frames = (await res.Content.ReadAsStringAsync())
                .Split('\n', StringSplitOptions.RemoveEmptyEntries)
                .Select(l => JsonDocument.Parse(l).RootElement)
                .ToList();

            var progress = frames.Where(f => f.TryGetProperty("progress", out _))
                .Select(f => f.GetProperty("progress")).ToList();
            Assert.NotEmpty(progress);
            // No progress frame carries a phase — init reports a single continuous done/total (WhenWritingNull
            // omits the null Phase entirely, so the property is simply absent).
            Assert.All(progress, p => Assert.False(p.TryGetProperty("phase", out _)));
            // The library signatures fold into the SAME total as the project items, and the bar reaches it.
            var last = progress[^1];
            Assert.Equal(items.Length + libs.Count, last.GetProperty("total").GetInt32());
            Assert.Equal(items.Length + libs.Count, last.GetProperty("done").GetInt32());
            // And the rendered signatures ride through as read-only items ALONGSIDE the project items (so `changed`
            // exceeds the item count — this is exactly the "880 items but 8104 changed" the log now separates).
            var changed = frames[^1].GetProperty("result").GetProperty("changed").GetArrayLength();
            Assert.True(changed > items.Length, $"expected library files beyond the {items.Length} items, got {changed}");
        }
        finally { server.Stop(); }
    }

    [Fact]
    public async Task Health_reports_the_active_op_while_a_mutation_is_in_flight_then_clears()
    {
        // The shared busy signal: while a mutation runs, /health advertises it so a SECOND frontend (or a terminal
        // `volt init`) holds off on /refs. Hold an /init in flight inside its (first) library-extract step and
        // observe /health from a concurrent request.
        var entered = new ManualResetEventSlim(false);
        var release = new ManualResetEventSlim(false);
        var ide = new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"))
        {
            ExtractEntered = entered,
            ExtractBlock = release,
        };
        var port = FreePort();
        var server = new BridgeHttpServer(ide, port);
        server.Start();
        try
        {
            using var http = new HttpClient();
            Assert.Null(await ActiveOp(http, port)); // idle → no activeOp

            var init = http.PostAsync($"http://127.0.0.1:{port}/init",
                new StringContent("{}", Encoding.UTF8, "application/json"));
            Assert.True(entered.Wait(5000), "init never reached the library-extract step");

            Assert.Equal("init", await ActiveOp(http, port)); // in flight → advertised

            release.Set();
            await init;

            // Cleared in RunOp's finally, which runs just after the response stream closes — poll briefly.
            string? op = "init";
            for (var i = 0; i < 100 && op != null; i++) { op = await ActiveOp(http, port); if (op != null) await Task.Delay(20); }
            Assert.Null(op);
        }
        finally { release.Set(); server.Stop(); }
    }

    private static async Task<string?> ActiveOp(HttpClient http, int port)
    {
        var el = JsonDocument.Parse(await http.GetStringAsync($"http://127.0.0.1:{port}/health")).RootElement;
        return el.TryGetProperty("activeOp", out var op) && op.ValueKind == JsonValueKind.String ? op.GetString() : null;
    }
}
