using System;
using System.IO;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using Volt.Bridge.Core.Diagnostics;
using Volt.Bridge.Core.Ide;
using Volt.Bridge.Core.Sync;

namespace Volt.Bridge.Core.Wire;

/// <summary>
/// The shared HTTP host for every bridge: it takes an <see cref="IIdeDriver"/> and wires the standard
/// endpoints to the Sync services, so a vendor bridge is just "implement IIdeDriver + a small bootstrap".
/// Built on <see cref="HttpListener"/> (works in-process on net48 AND standalone on net8) with a
/// self-re-arming async accept loop. Every project-touching call is marshalled onto the IDE's required
/// thread via <see cref="IIdeSession.RunOnStaThread{T}"/>, and THIS class is the single error boundary —
/// services and the driver throw; here is where a throw becomes an HTTP error.
///
/// Endpoints: GET /health, GET /instances, GET /refs, POST /fetch, POST /push, POST /build,
/// POST /shutdown, GET /debug (diagnostic), GET /openapi.yaml + GET /swagger (contract + UI).
/// </summary>
public sealed class BridgeHttpServer
{
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly IIdeDriver _ide;
    private readonly int _port;
    private readonly ManualResetEventSlim _stopped = new(false);
    private HttpListener? _listener;
    private volatile bool _running;

    // SSE (/events): open response streams we push project-change pings + keep-alives to.
    private readonly List<System.IO.StreamWriter> _sse = new();
    private readonly object _sseGate = new();
    private Timer? _keepAlive;

    public BridgeHttpServer(IIdeDriver ide, int port)
    {
        _ide = ide;
        _port = port;
        _ide.ProjectChanged += OnProjectChanged; // fan IDE changes out to SSE subscribers
    }

    public bool IsRunning => _running;
    public int Port => _port;

    public void Start()
    {
        if (_running) return;
        _listener = new HttpListener();
        _listener.Prefixes.Add($"http://127.0.0.1:{_port}/");
        _listener.Start();
        _running = true;
        _stopped.Reset();
        // Keep-alive doubles as the client's liveness signal (so a client can drop its health poll) and prunes
        // dead SSE connections (a failed write removes them).
        _keepAlive = new Timer(_ => Broadcast(": keep-alive\n\n"), null, 15_000, 15_000);
        ArmNext();
    }

    public void Stop()
    {
        if (!_running) return;
        _running = false;
        _ide.ProjectChanged -= OnProjectChanged;
        try { _keepAlive?.Dispose(); } catch { }
        _keepAlive = null;
        lock (_sseGate) { foreach (var w in _sse) { try { w.Dispose(); } catch { } } _sse.Clear(); }
        try { _listener?.Stop(); } catch { /* listener already torn down */ }
        try { _listener?.Close(); } catch { /* listener already torn down */ }
        _listener = null;
        _stopped.Set();
    }

    /// <summary>Start and block until stopped — for standalone console hosts.</summary>
    public void Run()
    {
        Start();
        _stopped.Wait();
    }

    /// <summary>Start, block until /shutdown, and report a port clash — the standalone entry point.</summary>
    public static void RunStandalone(IIdeDriver ide, string title, int port)
    {
        var server = new BridgeHttpServer(ide, port);
        Console.WriteLine($"{title} v{ide.Version} listening on http://127.0.0.1:{port}");
        VoltLog.Info($"{title} v{ide.Version} (wire v{WireProtocol.Version}) listening on http://127.0.0.1:{port}");
        try { server.Run(); }
        catch (HttpListenerException)
        {
            Console.Error.WriteLine($"Port {port} already in use — is another bridge instance running?");
            VoltLog.Error($"port {port} already in use — is another bridge instance running?");
        }
    }

    private void ArmNext()
    {
        if (!_running) return;
        try { _listener!.BeginGetContext(OnContext, null); }
        catch { /* listener stopped */ }
    }

    private void OnContext(IAsyncResult ar)
    {
        if (!_running) return;
        HttpListenerContext ctx;
        try { ctx = _listener!.EndGetContext(ar); }
        catch { if (_running) ArmNext(); return; }   // transient accept error (not shutdown) → keep listening
        ArmNext();
        try { Handle(ctx); } catch { /* never let a handler kill the accept loop */ }
    }

    private void Handle(HttpListenerContext ctx)
    {
        var path = ctx.Request.Url!.AbsolutePath;
        var method = ctx.Request.HttpMethod;
        try
        {
            // CSRF guard (shared rule with the connector's control plane): a first-party client — the CLI via
            // node:http, the LSP, the connector's HttpClient — never sends an `Origin` header; only a browser
            // does, and only for a cross-origin call. Reject those so a web page the user happens to visit
            // cannot drive this loopback bridge (e.g. a "simple" POST /push that injects items into the live
            // project). Top-level browser navigations (viewing /swagger) send no Origin, so they still work.
            if (IsBrowserOriginRequest(ctx.Request))
            {
                WriteError(ctx, 403, "FORBIDDEN_ORIGIN", "cross-origin browser requests are not allowed");
                return;
            }

            // Health is cache-only (off the marshalled thread) and reports degraded state, never gated by it.
            if (path == "/health" && method == "GET") { Write(ctx, 200, _ide.BuildHealthResponse()); return; }
            // The SSE change stream — kept open, off the marshalled thread, served even when degraded.
            if (path == "/events" && method == "GET") { HandleSse(ctx); return; }
            if (path == "/shutdown" && method == "POST") { Write(ctx, 200, new { stopped = true }); ThreadPool.QueueUserWorkItem(_ => Stop()); return; }
            // The OpenAPI contract (single source of truth) + a static Swagger UI.
            if (path == "/openapi.yaml" && method == "GET") { WriteText(ctx, 200, "application/yaml; charset=utf-8", OpenApiYaml.Value); return; }
            if ((path == "/swagger" || path == "/swagger/" || path == "/swagger/index.html") && method == "GET") { WriteText(ctx, 200, "text/html; charset=utf-8", SwaggerHtml); return; }
            // Attachable instances — works even when degraded so the user can re-pick a target.
            if (path == "/instances" && method == "GET")
            {
                var instances = _ide is IInstanceProvider ip ? _ide.RunOnStaThread(ip.ListInstances) : (object)Array.Empty<object>();
                Write(ctx, 200, new { instances });
                return;
            }

            if (_ide.IsDegraded) { WriteError(ctx, 503, "PLC_DEGRADED", _ide.DegradedReason ?? "IDE channel degraded — retry"); return; }

            // Read-only diagnostic dump (see DebugService): the IDE tree under ?name=ITEM (whole root if
            // omitted), plus every POU's raw PLCopen XML when ?xml=1 (for corpus capture).
            if (path == "/debug" && method == "GET")
            {
                var dbgName = ctx.Request.QueryString["name"];
                var dbgBodies = ctx.Request.QueryString["xml"] is "1" or "true";
                var dbgLibSig = ctx.Request.QueryString["libsig"];
                var dbgXmlOf = ctx.Request.QueryString["xmlof"];
                var dbgReflect = ctx.Request.QueryString["reflect"];
                Write(ctx, 200, _ide.RunOnStaThread(() => (object)DebugService.Handle(_ide, dbgName, dbgBodies, dbgLibSig, dbgXmlOf, dbgReflect)));
                return;
            }

            // The three long verbs stream progress on their own response when the client sends
            // `Accept: application/x-ndjson`; otherwise they return the single JSON body (backward-compatible).
            var stream = AcceptsNdjson(ctx.Request);
            switch ($"{method} {path}")
            {
                case "GET /refs": Write(ctx, 200, _ide.RunOnStaThread(() => (object)RefsService.Handle(_ide))); return;
                case "POST /fetch":
                {
                    var req = ReadBody<FetchRequest>(ctx) ?? new FetchRequest();
                    RunOp(ctx, stream, onP => FetchService.Handle(_ide, req, onP));
                    return;
                }
                case "POST /push":
                {
                    var req = ReadBody<PushRequest>(ctx) ?? new PushRequest();
                    RunOp(ctx, stream, onP => PushService.Handle(_ide, req, onP));
                    return;
                }
                case "POST /build":
                {
                    var req = ReadBody<BuildRequest>(ctx) ?? new BuildRequest();
                    RunOp(ctx, stream, onP => BuildService.Handle(_ide, req, onP));
                    return;
                }
                default:
                    WriteError(ctx, 404, "NOT_FOUND", $"No route for {method} {path}");
                    return;
            }
        }
        catch (BridgeException ex)
        {
            if (_ide.ShouldMarkDegraded(ex.Cause ?? ex)) _ide.MarkDegraded($"{path}: {ex.Message}");
            WriteError(ctx, ex.StatusCode, ex.ErrorCode, ex.Message);
        }
        catch (Exception ex)
        {
            if (_ide.ShouldMarkDegraded(ex)) _ide.MarkDegraded($"{path}: {ex.Message}");
            VoltLog.Error($"{method} {path} → 500", ex);
            WriteError(ctx, 500, "INTERNAL_ERROR", ex.Message);
        }
    }

    /// <summary>A request is a browser cross-origin call iff it carries an `Origin` header — first-party
    /// clients (node:http/LSP/HttpClient) never set one. The connector's control plane enforces the same rule.</summary>
    private static bool IsBrowserOriginRequest(HttpListenerRequest req) => req.Headers["Origin"] != null;

    private static bool AcceptsNdjson(HttpListenerRequest req) =>
        req.Headers["Accept"]?.IndexOf("application/x-ndjson", StringComparison.OrdinalIgnoreCase) >= 0;

    // ── SSE change stream (/events) ───────────────────────────────────────
    /// <summary>Register an SSE subscriber: hold the response open and add its writer to the fan-out set. We do
    /// NOT close it — a project change (or the keep-alive detecting a dead peer) drives it. The accept loop has
    /// already re-armed, so an open stream never blocks other requests.</summary>
    private void HandleSse(HttpListenerContext ctx)
    {
        ctx.Response.StatusCode = 200;
        ctx.Response.ContentType = "text/event-stream";
        ctx.Response.Headers["Cache-Control"] = "no-cache";
        ctx.Response.SendChunked = true;
        var writer = new System.IO.StreamWriter(ctx.Response.OutputStream, new UTF8Encoding(false)) { AutoFlush = true };
        // Greet BEFORE publishing to _sse: the writer isn't visible to Broadcast yet, so this can't race with a
        // concurrent write to the same StreamWriter (which is not thread-safe).
        try { writer.Write(": connected\n\n"); }
        catch { try { writer.Dispose(); } catch { } return; }
        lock (_sseGate) _sse.Add(writer);
    }

    /// <summary>Debounced IDE change → one `change` event to every subscriber.</summary>
    private void OnProjectChanged() => Broadcast("event: change\ndata: {}\n\n");

    private void Broadcast(string message)
    {
        // Snapshot under the gate (fast), then write OUTSIDE it so one slow/half-open client never stalls event
        // delivery to the others, new subscriptions, or Stop(). Per-writer `lock (w)` serializes the two
        // Broadcast sources (keep-alive Timer + change) on the same StreamWriter without a global stall.
        System.IO.StreamWriter[] snapshot;
        lock (_sseGate) snapshot = _sse.ToArray();
        foreach (var w in snapshot)
        {
            try { lock (w) w.Write(message); }
            catch { RemoveSse(w); } // dead peer → prune
        }
    }

    private void RemoveSse(System.IO.StreamWriter w)
    {
        lock (_sseGate) { _sse.Remove(w); }
        try { w.Dispose(); } catch { }
    }

    /// <summary>Run a long op either BUFFERED (one JSON body) or STREAMED (NDJSON: progress frames then one
    /// terminal result/error frame), chosen by the Accept header. The op runs on the marshalled IDE thread; when
    /// streaming, its progress callback writes frames to the already-open response — and because the status is
    /// committed the moment we start streaming, a failure is a terminal `error` frame, not an HTTP error code.</summary>
    private void RunOp<T>(HttpListenerContext ctx, bool stream, Func<Action<ProgressFrame>?, T> op) where T : class
    {
        if (!stream)
        {
            // Buffered: a service throw propagates to the outer handler (normal HTTP error) — unchanged behavior.
            Write(ctx, 200, _ide.RunOnStaThread(() => (object)op(null)!));
            return;
        }

        var path = ctx.Request.Url!.AbsolutePath;
        ctx.Response.StatusCode = 200;
        ctx.Response.ContentType = "application/x-ndjson; charset=utf-8";
        ctx.Response.SendChunked = true;
        // All frames go through `Frame` (single write lock), so the op's progress writes (STA thread) and this
        // thread's heartbeats never race on the response stream.
        var writeGate = new object();
        void Frame(object f) { lock (writeGate) WriteFrame(ctx, f); }
        Action<ProgressFrame> onProgress = f => Frame(new { progress = f });
        try
        {
            // Run the marshalled op on a worker so THIS thread can emit heartbeat frames during a long SILENT
            // phase (a build, or verbose library rendering) that produces no progress — otherwise no bytes flow
            // and the client's socket-idle timeout would abort a legitimately-slow op. The heartbeat is an empty
            // frame the client ignores; it only keeps the connection warm.
            var task = System.Threading.Tasks.Task.Run(() => _ide.RunOnStaThread(() => op(onProgress)));
            while (!task.Wait(10_000)) Frame(new { keepAlive = true });
            Frame(new { result = task.GetAwaiter().GetResult() });
        }
        catch (Exception ex)
        {
            // Task.Wait wraps a service throw in AggregateException — unwrap to preserve the BridgeException code.
            var e = (ex as AggregateException)?.InnerException ?? ex;
            if (e is BridgeException be)
            {
                if (_ide.ShouldMarkDegraded(be.Cause ?? be)) _ide.MarkDegraded($"{path}: {be.Message}");
                Frame(new { error = new { code = be.ErrorCode, message = be.Message } });
            }
            else
            {
                if (_ide.ShouldMarkDegraded(e)) _ide.MarkDegraded($"{path}: {e.Message}");
                VoltLog.Error($"{ctx.Request.HttpMethod} {path} (streamed) → error", e);
                Frame(new { error = new { code = "INTERNAL_ERROR", message = e.Message } });
            }
        }
        finally
        {
            try { ctx.Response.OutputStream.Close(); } catch { /* client already gone */ }
        }
    }

    /// <summary>Write one NDJSON frame and flush, so a streaming client sees progress live (not at the end).</summary>
    private static void WriteFrame(HttpListenerContext ctx, object frame)
    {
        var buf = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(frame, Json) + "\n");
        var os = ctx.Response.OutputStream;
        os.Write(buf, 0, buf.Length);
        os.Flush();
    }

    private static T? ReadBody<T>(HttpListenerContext ctx)
    {
        using var reader = new StreamReader(ctx.Request.InputStream, ctx.Request.ContentEncoding ?? Encoding.UTF8);
        var body = reader.ReadToEnd();
        if (string.IsNullOrWhiteSpace(body)) return default;
        return JsonSerializer.Deserialize<T>(body, Json);
    }

    private static void Write(HttpListenerContext ctx, int status, object payload)
        => WriteBytes(ctx, status, "application/json; charset=utf-8",
            Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload, Json)));

    private static void WriteError(HttpListenerContext ctx, int status, string code, string message) =>
        Write(ctx, status, new { error = new { code, message } });

    private static void WriteText(HttpListenerContext ctx, int status, string contentType, string body)
        => WriteBytes(ctx, status, contentType, Encoding.UTF8.GetBytes(body));

    private static void WriteBytes(HttpListenerContext ctx, int status, string contentType, byte[] buf)
    {
        ctx.Response.StatusCode = status;
        ctx.Response.ContentType = contentType;
        ctx.Response.ContentLength64 = buf.Length;
        // Always close the response, even if the write fails mid-stream (client disconnect) — otherwise
        // the request leaks. The serialize-then-set-headers order above means a serialization failure
        // never half-sends a response; only a transport write can throw here.
        try { ctx.Response.OutputStream.Write(buf, 0, buf.Length); }
        finally { try { ctx.Response.OutputStream.Close(); } catch { /* already torn down */ } }
    }

    // The hand-maintained OpenAPI contract is embedded (see the .csproj EmbeddedResource); the server
    // hands it out verbatim plus a static Swagger UI that points at it.
    private static readonly Lazy<string> OpenApiYaml = new(LoadOpenApiYaml);
    private static string LoadOpenApiYaml()
    {
        var asm = typeof(BridgeHttpServer).Assembly;
        var name = Array.Find(asm.GetManifestResourceNames(), n => n.EndsWith("openapi.yaml", StringComparison.OrdinalIgnoreCase));
        if (name == null) return "openapi: 3.1.0\ninfo:\n  title: Volt Bridge\n  version: 1.0.0\n";
        using var s = asm.GetManifestResourceStream(name)!;
        using var r = new StreamReader(s);
        return r.ReadToEnd();
    }

    private const string SwaggerHtml =
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Volt Bridge API</title>" +
        "<link rel=\"stylesheet\" href=\"https://unpkg.com/swagger-ui-dist@5/swagger-ui.css\"></head>" +
        "<body><div id=\"swagger-ui\"></div>" +
        "<script src=\"https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js\"></script>" +
        "<script>window.ui=SwaggerUIBundle({url:'/openapi.yaml',dom_id:'#swagger-ui'});</script>" +
        "</body></html>";
}
