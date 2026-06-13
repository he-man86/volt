using System;
using System.Collections.Generic;
using System.Net;
using System.Text;
using System.Text.Json;

namespace VoltBridge.Connector
{
    /// <summary>A bridge's orchestration-level view (NOT the per-vendor /health detail —
    /// the extension gets that from the bridge's own port). Immutable snapshot.</summary>
    public sealed record BridgeView(
        string Id, string DisplayName, int Port, string Archetype,
        bool Enabled, string Status, bool WorkerRunning);

    /// <summary>
    /// The connector's CONTROL PLANE: a tiny HTTP API on :8550 so the VS Code extension
    /// (and the opencode app) can see every bridge's state and act on it — restart a
    /// worker, launch an IDE — without the user touching the tray. The data plane stays
    /// the per-vendor bridge ports (855x, where PLC code flows); this is purely
    /// orchestration. Localhost only.
    ///
    ///   GET  /status                     → { bridges: BridgeView[] }
    ///   POST /bridges/{id}/restart       → respawn the worker
    ///   POST /bridges/{id}/launch        → launch the IDE (InIdeLoad: with the loader)
    ///   POST /bridges/{id}/enable|disable
    /// </summary>
    public sealed class ControlServer : IDisposable
    {
        public const int ControlPort = 8550;

        private readonly HttpListener _listener = new();
        private readonly Func<IReadOnlyList<BridgeView>> _snapshot;
        private readonly Action<string> _restart;
        private readonly Func<string, bool> _launch;
        private readonly Action<string, bool> _setEnabled;
        private volatile bool _running;

        private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

        public ControlServer(
            Func<IReadOnlyList<BridgeView>> snapshot,
            Action<string> restart,
            Func<string, bool> launch,
            Action<string, bool> setEnabled)
        {
            _snapshot = snapshot;
            _restart = restart;
            _launch = launch;
            _setEnabled = setEnabled;
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
            catch { /* port busy / ACL — the control plane is just unavailable, tray still works */ }
        }

        private void OnContext(IAsyncResult ar)
        {
            if (!_running) return;
            HttpListenerContext ctx;
            try { ctx = _listener.EndGetContext(ar); }
            catch { return; }
            try { _listener.BeginGetContext(OnContext, null); } catch { /* listener stopped */ }
            try { Handle(ctx); }
            catch { try { ctx.Response.StatusCode = 500; ctx.Response.Close(); } catch { } }
        }

        private void Handle(HttpListenerContext ctx)
        {
            var path = ctx.Request.Url!.AbsolutePath.Trim('/');
            var method = ctx.Request.HttpMethod;

            if (method == "GET" && path == "status")
            {
                WriteJson(ctx, 200, new { bridges = _snapshot() });
                return;
            }

            // POST bridges/{id}/{action}
            var parts = path.Split('/');
            if (method == "POST" && parts.Length == 3 && parts[0] == "bridges")
            {
                var id = parts[1];
                switch (parts[2])
                {
                    case "restart": _restart(id); WriteJson(ctx, 200, new { ok = true }); return;
                    case "launch": { var ok = _launch(id); WriteJson(ctx, ok ? 200 : 400, new { ok }); return; }
                    case "enable": _setEnabled(id, true); WriteJson(ctx, 200, new { ok = true }); return;
                    case "disable": _setEnabled(id, false); WriteJson(ctx, 200, new { ok = true }); return;
                }
            }

            WriteJson(ctx, 404, new { error = $"no route for {method} /{path}" });
        }

        private static void WriteJson(HttpListenerContext ctx, int status, object payload)
        {
            var buf = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload, Json));
            ctx.Response.StatusCode = status;
            ctx.Response.ContentType = "application/json; charset=utf-8";
            ctx.Response.Headers["Access-Control-Allow-Origin"] = "*";
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
