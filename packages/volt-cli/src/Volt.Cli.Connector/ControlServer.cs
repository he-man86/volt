using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.Json;

namespace Volt.Cli.Connector
{
    /// <summary>One project the connector detected, flattened for the control plane / any first-party client.</summary>
    public sealed record ProjectView(string Id, string DisplayName, string Vendor, bool Dirty, bool Connected);

    /// <summary>The orchestration-level snapshot the control plane serves: the aggregate state + the ONE unified
    /// list of detected projects across every vendor (each tagged with its vendor). NOT the per-vendor /health
    /// detail — a client gets that from the bridge's own pipe.</summary>
    public sealed record ConnectorView(string Status, IReadOnlyList<ProjectView> Projects);

    /// <summary>
    /// The connector's CONTROL PLANE: a tiny HTTP API on :8550 so the VS Code extension (and the desktop app) can
    /// see the connection state and act on it — connect to a detected project, restart a worker — without the
    /// user touching the tray. The data plane is the per-vendor named pipe (`volt.bridge.&lt;vendor&gt;`, where PLC
    /// code flows); this control API is purely orchestration. Localhost only.
    ///
    ///   GET  /status                 → ConnectorView (aggregate status + the unified project list)
    ///   POST /connect                → body { projectId } — connect to a detected project
    ///   POST /workers/{id}/restart   → respawn a worker
    /// </summary>
    public sealed class ControlServer : IDisposable
    {
        public const int ControlPort = 8550;

        private readonly HttpListener _listener = new();
        private readonly Func<ConnectorView> _snapshot;
        private readonly Func<string, bool> _connect;   // projectId → connected?
        private readonly Action<string> _restart;       // worker id
        private volatile bool _running;

        private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };

        public ControlServer(Func<ConnectorView> snapshot, Func<string, bool> connect, Action<string> restart)
        {
            _snapshot = snapshot;
            _connect = connect;
            _restart = restart;
        }

        public void Start()
        {
            try
            {
                _listener.Prefixes.Add($"http://127.0.0.1:{ControlPort}/");
                _listener.Start();
                _running = true;
                _listener.BeginGetContext(OnContext, null);
            }
            catch (Exception ex) { Log.Error($"control plane :{ControlPort} failed: {ex.Message}"); }
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
                var ok = !string.IsNullOrEmpty(id) && _connect(id!);
                WriteJson(ctx, ok ? 200 : 400, new { ok });
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
