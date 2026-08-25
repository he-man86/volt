using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Volt.Wire;
using Volt.Contracts;

namespace Volt.Cli.Connector
{
    /// <summary>One project the connector detected, flattened for the control plane / any first-party client.
    /// <c>Pipe</c> is the bridge pipe serving it (per-pid for CODESYS) — the shells set it as <c>VOLT_PIPE</c> for
    /// <c>volt init</c>; <c>IdeVersion</c> disambiguates same-named projects across IDE versions. <c>ProjectName</c>
    /// is the name the workspace BINDING matches on, and on EVERY row it is the same value as <c>DisplayName</c>:
    /// both come from the one <c>health</c> row field (<c>ProjectEntry.Project</c>), which is the row's identity and
    /// its <c>connect</c> address. Detection is identity-only on both vendors — it never reaches into PLC
    /// applications, so there is no TwinCAT "PLC sub-project" variant here.</summary>
    /// <param name="Status">GROUND TRUTH: the row's full connection state — "idle" (detected, not served) | "healthy"
    /// (served, channel OK) | "degraded" (served, recent errors). Clients render connection state from THIS (serving =
    /// <c>status != "idle"</c>), never from the project merely appearing in the list — a disconnected bridge stays
    /// listed (that is how you reconnect), and treating "detected" as "connected" is what let the UI claim a connection
    /// against a gated bridge.</param>
    public sealed record ProjectView(string Id, string DisplayName, string Vendor, bool Dirty, string Status, string ProjectName, string? Pipe = null, string? IdeVersion = null);

    /// <summary>The control plane's status snapshot: nothing but the ONE unified, self-describing list of detected
    /// projects across every vendor. Both status use cases read it — the init/connect surface is the list itself;
    /// a bound workspace's live status is its own row (serving/dirty/status). There is no separate per-vendor bridge
    /// view or aggregate word: the tray derives its colour internally (<see cref="ConnectionManager.Aggregate"/>),
    /// and every client just finds its row.</summary>
    public sealed record ConnectorView(IReadOnlyList<ProjectView> Projects);

    /// <summary>
    /// The connector's CONTROL PLANE: a tiny HTTP API on :8550 so the VS Code extension (and the desktop app) can
    /// see the connection state and act on it, without the user touching the tray. The data plane is the per-vendor
    /// named pipe (`volt.bridge.&lt;vendor&gt;.&lt;pid&gt;` — one per running IDE, where PLC code flows; the bare
    /// `volt.bridge.&lt;vendor&gt;` is a discovery PREFIX and is never served); this control API is purely orchestration.
    /// Localhost only.
    ///
    /// <para>The primary surface is the <b>session</b> API — a client declares the projects it is using and the
    /// connector reconciles the bridges to match (see <see cref="ConnectionManager"/>):</para>
    ///   POST   /session                       → { sessionId, leaseSeconds }    — open a session
    ///   POST   /session/{id}/sync             → ConnectorView                  — declare interests + renew + read, one call
    ///   DELETE /session/{id}                  → 204                            — clean shutdown
    ///
    ///   GET  /status                 → ConnectorView (the unified, self-describing project list — the ambient read)
    ///   POST /workers/{id}/restart   → respawn a worker
    /// </summary>
    public sealed class ControlServer : IDisposable
    {
        public const int ControlPort = 8550;

        /// <summary>The port THIS process serves its control plane on: <c>VOLT_CONTROL_PORT</c> when set, else the
        /// fixed <see cref="ControlPort"/> every client knows. The override exists for the live-test tier, which
        /// runs a SECOND connector beside the engineer's installed one — an unattended run must never fight it or
        /// reconfigure it. Read here (not in two places) so the single-instance mutex and the listener can't
        /// disagree about which instance this is.</summary>
        public static int ConfiguredPort =>
            int.TryParse(Environment.GetEnvironmentVariable("VOLT_CONTROL_PORT"), out var p) && p > 0 ? p : ControlPort;

        private readonly HttpListener _listener = new();
        // Async so GET /status can refresh-if-stale before answering: a client that polls must not read the tray
        // tick's cache, or a change made outside Volt (an IDE closing) lags by the tick PLUS the client's own poll.
        private readonly Func<Task<ConnectorView>> _snapshot;
        private readonly Action<string> _restart;             // worker id
        // The session API — the ONLY way to drive serving (a client declares its interests; the connector reconciles).
        private readonly Func<Task<(string SessionId, double LeaseSeconds)>> _openSession;
        private readonly Func<string, IReadOnlyCollection<Interest>, Task<ConnectorView>> _sync; // declare + renew + read
        private readonly Func<string, Task> _closeSession;
        private readonly int _port;
        private volatile bool _running;

        private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };

        /// <param name="port">Required, never defaulted: production passes <see cref="ConfiguredPort"/> (the ONE port
        /// every client knows, unless <c>VOLT_CONTROL_PORT</c> overrides it) so the single-instance mutex and this
        /// listener are read from the same place; the test tiers pass their own port, which must not fight the
        /// connector already listening on 8550 on a dev box.</param>
        public ControlServer(
            Func<Task<ConnectorView>> snapshot,
            Action<string> restart,
            Func<Task<(string SessionId, double LeaseSeconds)>> openSession,
            Func<string, IReadOnlyCollection<Interest>, Task<ConnectorView>> sync,
            Func<string, Task> closeSession,
            int port)
        {
            _snapshot = snapshot;
            _restart = restart;
            _openSession = openSession;
            _sync = sync;
            _closeSession = closeSession;
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
            catch (Exception ex) { VoltLog.Error($"control plane :{_port} failed: {ex.Message}"); }
        }

        private void OnContext(IAsyncResult ar)
        {
            if (!_running) return;
            HttpListenerContext ctx;
            try { ctx = _listener.EndGetContext(ar); }
            catch { return; }
            try { _listener.BeginGetContext(OnContext, null); } catch { /* listener stopped */ }
            // Fire-and-forget the ASYNC handler: /status can refresh (probing every bridge pipe) and /session/sync
            // awaits a reconcile, so handling inline would tie up the listener callback thread for the duration and
            // serialize unrelated requests behind it.
            _ = HandleSafeAsync(ctx);
        }

        private async Task HandleSafeAsync(HttpListenerContext ctx)
        {
            try { await Handle(ctx).ConfigureAwait(false); }
            catch (Exception ex) { VoltLog.Error($"control plane handler error: {ex.Message}"); try { ctx.Response.StatusCode = 500; ctx.Response.Close(); } catch { } }
        }

        private async Task Handle(HttpListenerContext ctx)
        {
            // CSRF guard: reject cross-origin browser requests. This HTTP listener is the ONE browser-reachable
            // surface in the product — the bridge data plane is a named pipe with no origin and no port, so it needs
            // no such check and has none. First-party callers (the VS Code extension's Node fetch, the desktop app)
            // never send an `Origin` header.
            var origin = ctx.Request.Headers["Origin"];
            if (origin != null && !string.Equals(origin, $"http://127.0.0.1:{_port}", StringComparison.OrdinalIgnoreCase))
            {
                WriteJson(ctx, 403, new { error = "cross-origin browser requests are not allowed" });
                return;
            }

            var path = ctx.Request.Url!.AbsolutePath.Trim('/');
            var method = ctx.Request.HttpMethod;
            var parts = path.Split('/');

            // ── the session API: open → sync (declare interests + renew + read) → close ──
            if (method == "POST" && path == "session")
            {
                var (sid, lease) = await _openSession().ConfigureAwait(false);
                WriteJson(ctx, 200, new { sessionId = sid, leaseSeconds = lease });
                return;
            }
            if (parts.Length >= 2 && parts[0] == "session")
            {
                var sid = parts[1];
                if (method == "POST" && parts.Length == 3 && parts[2] == "sync")
                {
                    var body = ReadBody<SyncBody>(ctx);
                    var interests = (body?.Interests ?? new List<InterestDto>())
                        .Where(i => !string.IsNullOrEmpty(i.Vendor) && !string.IsNullOrEmpty(i.ProjectName))
                        .Select(i => new Interest(i.Vendor!, i.ProjectName!))
                        .ToList();
                    WriteJson(ctx, 200, await _sync(sid, interests).ConfigureAwait(false));
                    return;
                }
                if (method == "DELETE" && parts.Length == 2)
                {
                    await _closeSession(sid).ConfigureAwait(false);
                    ctx.Response.StatusCode = 204;
                    ctx.Response.Close();
                    return;
                }
            }

            // The ambient read — the detected-project list (the init/connect picker reads this before any session).
            if (method == "GET" && path == "status") { WriteJson(ctx, 200, await _snapshot().ConfigureAwait(false)); return; }

            // POST workers/{id}/restart
            if (method == "POST" && parts.Length == 3 && parts[0] == "workers" && parts[2] == "restart")
            {
                _restart(parts[1]);
                WriteJson(ctx, 200, new { ok = true });
                return;
            }

            WriteJson(ctx, 404, new { error = $"no route for {method} /{path}" });
        }

        private sealed record InterestDto(string? Vendor, string? ProjectName);
        private sealed record SyncBody(List<InterestDto>? Interests);

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
