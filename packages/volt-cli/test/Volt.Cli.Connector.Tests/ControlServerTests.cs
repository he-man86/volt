using System;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using Xunit;

namespace Volt.Cli.Connector.Tests;

/// <summary>
/// The control plane (:8550) — the ONLY path the VS Code extension and the desktop app use to connect and
/// disconnect. Everything else in this suite drives <see cref="ConnectionManager"/> directly, which skips this
/// layer entirely; these tests cover the HTTP edge itself.
///
/// The invariant they exist for: /connect and /disconnect must NOT answer until their wire call has landed. Both
/// end in a `select`/`deselect` on the bridge pipe, and every caller refreshes its status the moment the response
/// arrives — so an early 200 makes the UI read the state it had a moment ago and render "still connected" right
/// after a successful disconnect. They used to be fire-and-forget.
/// </summary>
public class ControlServerTests : IDisposable
{
    // Not 8550: a dev box has the real connector listening there, and a test must never fight it (or, worse,
    // silently drive it). A per-instance high port keeps runs independent.
    private static int _next = 18550;
    private readonly int _port = System.Threading.Interlocked.Increment(ref _next);
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(10) };
    private ControlServer? _server;

    private ControlServer Start(Func<string, Task<bool>> connect, Func<string?, Task<UnbindResult>> disconnect)
    {
        var view = new ConnectorView("Connected", Array.Empty<BridgeStatusView>(), Array.Empty<ProjectView>());
        _server = new ControlServer(() => Task.FromResult(view), connect, disconnect, _ => { }, _port);
        _server.Start();
        return _server;
    }

    private Task<HttpResponseMessage> Post(string path, string? body = null) =>
        _http.PostAsync($"http://127.0.0.1:{_port}/{path}", new StringContent(body ?? "{}", Encoding.UTF8, "application/json"));

    public void Dispose() { _server?.Dispose(); _http.Dispose(); }

    [Fact]
    public async Task Disconnect_does_not_respond_until_the_deselect_has_landed()
    {
        var landed = new TaskCompletionSource<bool>();
        var started = new TaskCompletionSource<bool>();
        Start(_ => Task.FromResult(true), async _ => { started.TrySetResult(true); await landed.Task; return UnbindResult.Gated; });

        var response = Post("disconnect");
        Assert.True(await Task.WhenAny(started.Task, Task.Delay(5000)) == started.Task, "the handler never ran");

        // The slow deselect is still in flight — the response MUST still be pending. Checked by RACING it against
        // a delay, not by reading IsCompleted: the task hasn't necessarily transitioned the instant the server
        // writes, so IsCompleted passes even when the handler answered early (verified — it did).
        Assert.NotSame(response, await Task.WhenAny(response, Task.Delay(500)));

        landed.SetResult(true);
        var r = await response;
        Assert.Equal(200, (int)r.StatusCode);
    }

    [Fact]
    public async Task Connect_does_not_respond_until_the_select_has_landed()
    {
        // Same race on the way back IN: `select` is what RESUMES a disconnected bridge, so an early 200 makes
        // "Reconnect" report success while the bridge is still refusing sync.
        var landed = new TaskCompletionSource<bool>();
        var started = new TaskCompletionSource<bool>();
        Start(async _ => { started.TrySetResult(true); await landed.Task; return true; }, _ => Task.FromResult(UnbindResult.Gated));

        var response = Post("connect", "{\"projectId\":\"codesys::MachineA:\"}");
        Assert.True(await Task.WhenAny(started.Task, Task.Delay(5000)) == started.Task, "the handler never ran");
        Assert.NotSame(response, await Task.WhenAny(response, Task.Delay(500)));

        landed.SetResult(true);
        var r = await response;
        Assert.Equal(200, (int)r.StatusCode);
    }

    // `gated` is how a shell tells a REAL disconnect from one against an out-of-date bridge (no `deselect` op,
    // still serving `volt push`). Both are a 200 — the selection cleared either way — so the status code can't
    // carry it and the shells must switch on this field. One test per case: each xunit instance gets its own port.
    [Fact]
    public async Task A_real_disconnect_reports_gated_true()
    {
        Start(_ => Task.FromResult(true), _ => Task.FromResult(UnbindResult.Gated));
        var body = await (await Post("disconnect")).Content.ReadAsStringAsync();
        Assert.Contains("\"gated\":true", body);
    }

    [Fact]
    public async Task A_disconnect_against_an_out_of_date_bridge_reports_gated_false()
    {
        Start(_ => Task.FromResult(true), _ => Task.FromResult(UnbindResult.Unsupported));
        var r = await Post("disconnect");
        Assert.Equal(200, (int)r.StatusCode); // still a 200 — the selection DID clear
        Assert.Contains("\"gated\":false", await r.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task A_connect_that_fails_answers_400_so_the_UI_can_report_it()
    {
        Start(_ => Task.FromResult(false), _ => Task.FromResult(UnbindResult.Gated));
        var r = await Post("connect", "{\"projectId\":\"nope\"}");
        Assert.Equal(400, (int)r.StatusCode);
    }

    [Fact]
    public async Task A_connect_with_no_projectId_is_rejected_and_never_reaches_the_model()
    {
        var reached = false;
        Start(_ => { reached = true; return Task.FromResult(true); }, _ => Task.FromResult(UnbindResult.Gated));
        var r = await Post("connect", "{}");
        Assert.Equal(400, (int)r.StatusCode);
        Assert.False(reached);
    }

    [Fact]
    public async Task Cross_origin_browser_requests_are_refused()
    {
        // The CSRF guard: a page in the user's browser must not be able to disconnect their IDE. First-party
        // callers (the extension's Node fetch, the desktop) send no Origin at all.
        var disconnected = false;
        Start(_ => Task.FromResult(true), _ => { disconnected = true; return Task.FromResult(UnbindResult.Gated); });

        var req = new HttpRequestMessage(HttpMethod.Post, $"http://127.0.0.1:{_port}/disconnect");
        req.Headers.Add("Origin", "https://evil.example");
        var r = await _http.SendAsync(req);

        Assert.Equal(403, (int)r.StatusCode);
        Assert.False(disconnected);
    }
}
