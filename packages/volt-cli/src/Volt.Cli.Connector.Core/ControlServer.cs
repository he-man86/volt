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
    /// <param name="Serving">GROUND TRUTH: this project's own bridge is serving it right now, so pull/push work.
    /// Clients must render connection state from THIS, never from <paramref name="Connected"/> and never from the
    /// project merely appearing in the list — a disconnected bridge stays listed (that is how you reconnect), and
    /// treating "detected" as "connected" is what let the UI claim a connection against a gated bridge.</param>
    public sealed record ProjectView(string Id, string DisplayName, string Vendor, bool Dirty, bool Connected, string? Pipe = null, string? IdeVersion = null, string? ProjectName = null, bool Serving = false);

    /// <summary>Per-vendor live bridge health — the connector is the one aggregator, so the UI reads connection
    /// status here instead of re-probing the bridge pipes. <c>Status</c> is the <see cref="BridgeStatus"/> word;
    /// <c>ActiveOp</c> is a mutating op in flight ("pull"/"push"/"build") or null.</summary>
    public sealed record BridgeStatusView(string Vendor, string DisplayName, string Status, string? ProjectName, bool Dirty, string? ActiveOp);

    /// <summary>The control plane's single status snapshot — everything the UI needs in one shape: the aggregate
    /// state, per-vendor bridge health (use case A: the bound workspace's live status), and the ONE unified list
    /// of detected projects across every vendor (use case B: the init/connect surface).</summary>
    public sealed record ConnectorView(string Status, IReadOnlyList<BridgeStatusView> Bridges, IReadOnlyList<ProjectView> Projects);

    /// <summary>
    /// The connector's CONTROL PLANE: a tiny HTTP API on :8550 so the VS Code extension (and the desktop app) can
    /// see the connection state and act on it — connect to a detected project, restart a worker — without the
    /// user touching the tray. The data plane is the per-vendor named pipe (`volt.bridge.&lt;vendor&gt;`, where PLC
    /// code flows); this control API is purely orchestration. Localhost only.
    ///
    ///   GET  /status                 → ConnectorView (aggregate status + the unified project list)
    ///   POST /connect                → body { projectId } — make a detected project the active connection
    ///   POST /disconnect             → disconnect the active connection (the bridge refuses sync; hosts stay live)
    ///   POST /workers/{id}/restart   → respawn a worker
    /// </summary>
    public sealed class ControlServer : IDisposable
    {
        public const int ControlPort = 8550;

        private readonly HttpListener _listener = new();
        private readonly Func<ConnectorView> _snapshot;
        // Both connect + disconnect are awaited before the response is written: each ends in a `select`/`deselect`
        // on the bridge pipe, and a client that refreshes its status right after the 200 would otherwise race it.
        private readonly Func<string, Task<bool>> _connect;   // projectId → connected?
        private readonly Func<Task<bool>> _disconnect;        // → false when the bridge was too old to be gated
        private readonly Action<string> _restart;             // worker id
        private readonly int _port;
        private volatile bool _running;

        private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };

        /// <param name="port">Defaults to <see cref="ControlPort"/> — the ONE port every client knows. Overridden
        /// only by tests, which must not fight the connector already listening on 8550 on a dev box.</param>
        public ControlServer(Func<ConnectorView> snapshot, Func<string, Task<bool>> connect, Func<Task<bool>> disconnect, Action<string> restart, int port = ControlPort)
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
            try { Handle(ctx); }
            catch (Exception ex) { Log.Error($"control plane handler error: {ex.Message}"); try { ctx.Response.StatusCode = 500; ctx.Response.Close(); } catch { } }
        }

        private void Handle(HttpListenerContext ctx)
        {
            // CSRF guard (same rule as the bridge data plane): reject cross-origin browser requests. First-party
            // callers (the VS Code extension's Node fetch, the desktop app) never send an `Origin` header.
            var origin = ctx.Request.Headers["Origin"];
            if (origin != null && !string.Equals(origin, $"http://127.0.0.1:{ControlPort}", StringComparison.OrdinalIgnoreCase))
            {
                WriteJson(ctx, 403, new { error = "cross-origin browser requests are not allowed" });
                return;
            }

            var path = ctx.Request.Url!.AbsolutePath.Trim('/');
            var method = ctx.Request.HttpMethod;

            if (method == "GET" && path == "status") { WriteJson(ctx, 200, _snapshot()); return; }

            if (method == "POST" && path == "connect")
            {
                var id = ReadBody<ConnectBody>(ctx)?.ProjectId;
                var ok = !string.IsNullOrEmpty(id) && _connect(id!).GetAwaiter().GetResult();
                WriteJson(ctx, ok ? 200 : 400, new { ok });
                return;
            }

            if (method == "POST" && path == "disconnect")
            {
                // The bridge stops serving sync; every host stays live and re-connectable. `gated` is false when
                // the bridge is too old to have the op — still a 200 (the selection DID clear), but the caller
                // must warn: that bridge keeps serving the CLI, so "disconnected" would be a lie.
                var gated = _disconnect().GetAwaiter().GetResult();
                WriteJson(ctx, 200, new { ok = true, gated });
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
