using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace Volt.Cli.Connector
{
    /// <summary>One project the connector detected, flattened for the control plane / any first-party client.
    /// <c>Pipe</c> is the bridge pipe serving it (per-pid for CODESYS) — the shells set it as <c>VOLT_PIPE</c> for
    /// <c>volt init</c>; <c>IdeVersion</c> disambiguates same-named projects across IDE versions. <c>ProjectName</c>
    /// is the name the workspace BINDING matches on (the vendor's <c>health.ProjectName</c> = the TwinCAT project /
    /// the CODESYS project) — NOT <c>DisplayName</c>, which for TwinCAT is the PLC sub-project.</summary>
    /// <param name="Connected">The tray HIGHLIGHT — this is the one project the user last picked. A UI nicety; it
    /// says nothing about whether sync works.</param>
    /// <param name="Status">GROUND TRUTH: the row's full connection state — "idle" (detected, not served) | "healthy"
    /// (served, channel OK) | "degraded" (served, recent errors). Clients render connection state from THIS (serving =
    /// <c>status != "idle"</c>), never from <paramref name="Connected"/> and never from the project merely appearing in
    /// the list — a disconnected bridge stays listed (that is how you reconnect), and treating "detected" as
    /// "connected" is what let the UI claim a connection against a gated bridge.</param>
    public sealed record ProjectView(string Id, string DisplayName, string Vendor, bool Dirty, bool Connected, string Status, string? Pipe = null, string? IdeVersion = null, string? ProjectName = null);

    /// <summary>The control plane's status snapshot: nothing but the ONE unified, self-describing list of detected
    /// projects across every vendor. Both status use cases read it — the init/connect surface is the list itself;
    /// a bound workspace's live status is its own row (serving/dirty/status). There is no separate per-vendor bridge
    /// view or aggregate word: the tray derives its colour internally (<see cref="ConnectionManager.Aggregate"/>),
    /// and every client just finds its row.</summary>
    public sealed record ConnectorView(IReadOnlyList<ProjectView> Projects);

    /// <summary>
    /// The connector's CONTROL PLANE: a tiny HTTP API on :8550 so the VS Code extension (and the desktop app) can
    /// see the connection state and act on it — connect to a detected project, restart a worker — without the
    /// user touching the tray. The data plane is the per-vendor named pipe (`volt.bridge.&lt;vendor&gt;`, where PLC
    /// code flows); this control API is purely orchestration. Localhost only.
    ///
    ///   GET  /status                 → ConnectorView (the unified, self-describing project list)
    ///   POST /connect                → body { projectId } — make a detected project the active connection
    ///   POST /disconnect             → disconnect the active connection (the bridge refuses sync; hosts stay live)
    ///   POST /workers/{id}/restart   → respawn a worker
    /// </summary>
    public sealed class ControlServer : IDisposable
    {
        public const int ControlPort = 8550;

        private readonly HttpListener _listener = new();
        // Async so GET /status can refresh-if-stale before answering: a client that polls must not read the tray
        // tick's cache, or a change made outside Volt (an IDE closing) lags by the tick PLUS the client's own poll.
        private readonly Func<Task<ConnectorView>> _snapshot;
        // Both connect + disconnect are awaited before the response is written: each ends in a `select`/`deselect`
        // on the bridge pipe, and a client that refreshes its status right after the 200 would otherwise race it.
        private readonly Func<string, Task<bool>> _connect;   // projectId → connected?
        private readonly Func<string?, Task<UnbindResult>> _disconnect; // projectId (null = the active one)
        private readonly Action<string> _restart;             // worker id
        private readonly int _port;
        private volatile bool _running;

        private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };

        /// <param name="port">Defaults to <see cref="ControlPort"/> — the ONE port every client knows. Overridden
        /// only by tests, which must not fight the connector already listening on 8550 on a dev box.</param>
        public ControlServer(Func<Task<ConnectorView>> snapshot, Func<string, Task<bool>> connect, Func<string?, Task<UnbindResult>> disconnect, Action<string> restart, int port = ControlPort)
        {
            _snapshot = snapshot;
            _connect = connect;
            _disconnect = disconnect;
            _restart = restart;
            _port = port;
        }

        public void Start()
        {
            try
            {
                _listener.Prefixes.Add($"http://127.0.0.1:{_port}/");
                _listener.Start();
                _running = true;
                _listener.BeginGetContext(OnContext, null);
            }
            catch (Exception ex) { Log.Error($"control plane :{_port} failed: {ex.Message}"); }
        }

        private void OnContext(IAsyncResult ar)
        {
            if (!_running) return;
            HttpListenerContext ctx;
            try { ctx = _listener.EndGetContext(ar); }
            catch { return; }
            try { _listener.BeginGetContext(OnContext, null); } catch { /* listener stopped */ }
            // Fire-and-forget the ASYNC handler: /status can refresh (probing every bridge pipe) and
            // /connect + /disconnect await a wire call, so handling inline would tie up the listener callback
            // thread for the duration and serialize unrelated requests behind it.
            _ = HandleSafeAsync(ctx);
        }

        private async Task HandleSafeAsync(HttpListenerContext ctx)
        {
            try { await Handle(ctx).ConfigureAwait(false); }
            catch (Exception ex) { Log.Error($"control plane handler error: {ex.Message}"); try { ctx.Response.StatusCode = 500; ctx.Response.Close(); } catch { } }
        }

        private async Task Handle(HttpListenerContext ctx)
        {
            // CSRF guard (same rule as the bridge data plane): reject cross-origin browser requests. First-party
            // callers (the VS Code extension's Node fetch, the desktop app) never send an `Origin` header.
            var origin = ctx.Request.Headers["Origin"];
            if (origin != null && !string.Equals(origin, $"http://127.0.0.1:{_port}", StringComparison.OrdinalIgnoreCase))
            {
                WriteJson(ctx, 403, new { error = "cross-origin browser requests are not allowed" });
                return;
            }

            var path = ctx.Request.Url!.AbsolutePath.Trim('/');
            var method = ctx.Request.HttpMethod;

            if (method == "GET" && path == "status") { WriteJson(ctx, 200, await _snapshot().ConfigureAwait(false)); return; }

            if (method == "POST" && path == "connect")
            {
                var id = ReadBody<ConnectBody>(ctx)?.ProjectId;
                var ok = !string.IsNullOrEmpty(id) && await _connect(id!).ConfigureAwait(false);
                WriteJson(ctx, ok ? 200 : 400, new { ok });
                return;
            }

            if (method == "POST" && path == "disconnect")
            {
                // Optional projectId: a frontend disconnects the project ITS workspace is bound to, which is not
                // necessarily the tray's active one. Absent → the active connection (the tray's own menu item).
                var target = ReadBody<ConnectBody>(ctx)?.ProjectId;
                var outcome = await _disconnect(string.IsNullOrEmpty(target) ? null : target).ConfigureAwait(false);
                // Always a 200 — the highlight cleared regardless. `gated` says whether the BRIDGE actually
                // stopped serving; `reason` distinguishes an out-of-date bridge (still syncing, needs an IDE
                // restart) from one that is simply gone (nothing to warn about).
                WriteJson(ctx, 200, new { ok = true, gated = outcome == UnbindResult.Gated, reason = outcome.ToString().ToLowerInvariant() });
                return;
            }

            // POST workers/{id}/restart
            var parts = path.Split('/');
            if (method == "POST" && parts.Length == 3 && parts[0] == "workers" && parts[2] == "restart")
            {
                _restart(parts[1]);
                WriteJson(ctx, 200, new { ok = true });
                return;
            }

            WriteJson(ctx, 404, new { error = $"no route for {method} /{path}" });
        }

        private sealed record ConnectBody(string? ProjectId);

        private static T? ReadBody<T>(HttpListenerContext ctx) where T : class
        {
            try
            {
                using var r = new System.IO.StreamReader(ctx.Request.InputStream, Encoding.UTF8);
                var s = r.ReadToEnd();
                return string.IsNullOrWhiteSpace(s) ? null : JsonSerializer.Deserialize<T>(s, Json);
            }
            catch { return null; }
        }

        private static void WriteJson(HttpListenerContext ctx, int status, object payload)
        {
            var buf = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload, Json));
            ctx.Response.StatusCode = status;
            ctx.Response.ContentType = "application/json; charset=utf-8";
            ctx.Response.ContentLength64 = buf.Length;
            ctx.Response.OutputStream.Write(buf, 0, buf.Length);
            ctx.Response.OutputStream.Close();
        }

        public void Dispose()
        {
            _running = false;
            try { _listener.Stop(); } catch { }
            try { _listener.Close(); } catch { }
        }
    }
}
