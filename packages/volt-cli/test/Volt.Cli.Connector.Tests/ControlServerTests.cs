using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Xunit;

namespace Volt.Cli.Connector.Tests;

/// <summary>
/// The control plane (:8550) — the HTTP edge itself. The session API (open / sync / close) is the ONLY way to drive
/// serving; GET /status is the ambient read of the detected-project list (the connect picker); /workers/{id}/restart
/// respawns a worker. Everything else drives <see cref="ConnectionManager"/> directly.
/// </summary>
public class ControlServerTests : IDisposable
{
    // Not 8550: a dev box has the real connector listening there. A per-instance high port keeps runs independent.
    private static int _next = 18650;
    private readonly int _port = Interlocked.Increment(ref _next);
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(10) };
    private ControlServer? _server;

    /// <summary>Start a server. `openSession`/`sync`/`closeSession` default to trivial stubs; pass overrides to assert
    /// what the client sent. `snapshot` defaults to an empty view.</summary>
    private ControlServer Start(
        Func<Task<ConnectorView>>? snapshot = null,
        Func<Task<(string, double)>>? openSession = null,
        Func<string, IReadOnlyCollection<Interest>, Task<ConnectorView>>? sync = null,
        Func<string, Task>? closeSession = null,
        Action<string>? restart = null)
    {
        var empty = new ConnectorView(Array.Empty<ProjectView>());
        _server = new ControlServer(
            snapshot ?? (() => Task.FromResult(empty)),
            restart ?? (_ => { }),
            openSession ?? (() => Task.FromResult(("s1", 15.0))),
            sync ?? ((_, _) => Task.FromResult(empty)),
            closeSession ?? (_ => Task.CompletedTask),
            _port);
        _server.Start();
        return _server;
    }

    private string Url(string path) => $"http://127.0.0.1:{_port}/{path}";
    private Task<HttpResponseMessage> Post(string path, string? body = null) =>
        _http.PostAsync(Url(path), new StringContent(body ?? "{}", Encoding.UTF8, "application/json"));

    public void Dispose() { _server?.Dispose(); _http.Dispose(); }

    // ── the session API ──

    [Fact]
    public async Task Open_session_returns_the_id_and_lease_seconds()
    {
        Start(openSession: () => Task.FromResult(("abc", 15.0)));
        var root = JsonDocument.Parse(await (await Post("session")).Content.ReadAsStringAsync()).RootElement;

        Assert.Equal("abc", root.GetProperty("sessionId").GetString());
        Assert.Equal(15.0, root.GetProperty("leaseSeconds").GetDouble());
    }

    [Fact]
    public async Task Sync_passes_the_declared_interests_and_returns_the_reconciled_view()
    {
        IReadOnlyCollection<Interest>? received = null;
        var view = new ConnectorView(new[] { new ProjectView("codesys:A", "A", "codesys", false, "healthy", "A") });
        Start(sync: (id, interests) => { received = interests; return Task.FromResult(view); });

        var r = await Post("session/sess1/sync", "{\"interests\":[{\"vendor\":\"codesys\",\"projectName\":\"A\"}]}");

        Assert.Equal(200, (int)r.StatusCode);
        var i = Assert.Single(received!);
        Assert.Equal("codesys", i.Vendor);
        Assert.Equal("A", i.ProjectName);
        var root = JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("A", root.GetProperty("projects")[0].GetProperty("displayName").GetString());
    }

    [Fact]
    public async Task Sync_with_an_empty_set_declares_no_interests()
    {
        IReadOnlyCollection<Interest>? received = null;
        Start(sync: (id, interests) => { received = interests; return Task.FromResult(new ConnectorView(Array.Empty<ProjectView>())); });

        await Post("session/sess1/sync", "{\"interests\":[]}");

        Assert.Empty(received!);
    }

    [Fact]
    public async Task Sync_does_not_respond_until_the_reconcile_has_landed()
    {
        // The reconcile (bind/unbind on the bridge pipes) is awaited before the response — a client that reads its
        // status the moment the 200 arrives must see the RECONCILED view, not the one from before its declare.
        var landed = new TaskCompletionSource<bool>();
        var started = new TaskCompletionSource<bool>();
        Start(sync: async (_, _) => { started.TrySetResult(true); await landed.Task; return new ConnectorView(Array.Empty<ProjectView>()); });

        var response = Post("session/s/sync", "{\"interests\":[]}");
        Assert.True(await Task.WhenAny(started.Task, Task.Delay(5000)) == started.Task, "the handler never ran");
        Assert.NotSame(response, await Task.WhenAny(response, Task.Delay(500))); // still pending while reconcile runs

        landed.SetResult(true);
        Assert.Equal(200, (int)(await response).StatusCode);
    }

    [Fact]
    public async Task Close_session_returns_204_and_names_the_session()
    {
        string? closed = null;
        Start(closeSession: id => { closed = id; return Task.CompletedTask; });

        var r = await _http.SendAsync(new HttpRequestMessage(HttpMethod.Delete, Url("session/sess1")));

        Assert.Equal(204, (int)r.StatusCode);
        Assert.Equal("sess1", closed);
    }

    // ── the ambient read + worker restart ──

    [Fact]
    public async Task Status_returns_the_detected_project_list()
    {
        var view = new ConnectorView(new[] { new ProjectView("codesys:A", "A", "codesys", false, "idle", "A") });
        Start(snapshot: () => Task.FromResult(view));

        var root = JsonDocument.Parse(await (await _http.GetAsync(Url("status"))).Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("A", root.GetProperty("projects")[0].GetProperty("displayName").GetString());
    }

    [Fact]
    public async Task Concurrent_status_polls_from_multiple_clients_are_served_in_parallel()
    {
        // Both frontends poll /status independently; each request is handled on its own async path (the server re-arms
        // BeginGetContext before running the handler), so one slow refresh must not stall another. Proven by ORDERING.
        const int n = 8;
        var entered = new CountdownEvent(n);
        var release = new TaskCompletionSource();
        var view = new ConnectorView(Array.Empty<ProjectView>());
        Start(snapshot: async () => { entered.Signal(); await release.Task; return view; });

        var polls = Enumerable.Range(0, n).Select(_ => _http.GetAsync(Url("status"))).ToArray();
        Assert.True(entered.Wait(30_000), "status polls were serialized — one client blocked another");
        release.SetResult();
        var responses = await Task.WhenAll(polls);

        Assert.All(responses, r => Assert.Equal(200, (int)r.StatusCode));
    }

    [Fact]
    public async Task A_worker_restart_route_calls_restart_with_the_per_xae_id()
    {
        string? restarted = null;
        Start(restart: id => restarted = id);

        var r = await Post("workers/twincat.17844/restart"); // the DOT must survive the '/' split

        Assert.Equal(200, (int)r.StatusCode);
        Assert.Equal("twincat.17844", restarted);
    }

    [Fact]
    public async Task An_unknown_route_is_404()
    {
        Start();
        Assert.Equal(404, (int)(await Post("nope/route")).StatusCode);
    }

    [Fact]
    public async Task Cross_origin_browser_requests_are_refused()
    {
        // The CSRF guard: a page in the user's browser must not drive the connector. First-party callers send no Origin.
        var synced = false;
        Start(sync: (_, _) => { synced = true; return Task.FromResult(new ConnectorView(Array.Empty<ProjectView>())); });

        var req = new HttpRequestMessage(HttpMethod.Post, Url("session/s/sync")) { Content = new StringContent("{\"interests\":[]}", Encoding.UTF8, "application/json") };
        req.Headers.Add("Origin", "https://evil.example");
        var r = await _http.SendAsync(req);

        Assert.Equal(403, (int)r.StatusCode);
        Assert.False(synced);
    }
}
