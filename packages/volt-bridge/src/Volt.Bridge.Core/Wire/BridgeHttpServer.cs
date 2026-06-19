using System;
using System.IO;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
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
/// Endpoints: GET /health, GET /instances, GET /refs, GET /raw, POST /fetch, POST /push, POST /build,
/// POST /shutdown.
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

    public BridgeHttpServer(IIdeDriver ide, int port)
    {
        _ide = ide;
        _port = port;
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
        ArmNext();
    }

    public void Stop()
    {
        if (!_running) return;
        _running = false;
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
        try { server.Run(); }
        catch (HttpListenerException) { Console.Error.WriteLine($"Port {port} already in use — is another bridge instance running?"); }
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
            // Health is cache-only (off the marshalled thread) and reports degraded state, never gated by it.
            if (path == "/health" && method == "GET") { Write(ctx, 200, _ide.BuildHealthResponse()); return; }
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

            // Read-only raw-tree dump (diagnostic) — see DebugService. ?name=ITEM, or whole root if omitted.
            if (path == "/debug" && method == "GET")
            {
                var dbgName = ctx.Request.QueryString["name"];
                Write(ctx, 200, _ide.RunOnStaThread(() => (object)DebugService.Handle(_ide, dbgName)));
                return;
            }

            object result;
            switch ($"{method} {path}")
            {
                case "GET /refs": result = _ide.RunOnStaThread(() => (object)RefsService.Handle(_ide)); break;
                case "GET /raw": result = _ide.RunOnStaThread(() => (object)RawService.Handle(_ide)); break;
                case "POST /fetch":
                    var fetchReq = ReadBody<FetchRequest>(ctx) ?? new FetchRequest();
                    result = _ide.RunOnStaThread(() => (object)FetchService.Handle(_ide, fetchReq));
                    break;
                case "POST /push":
                    var pushReq = ReadBody<PushRequest>(ctx) ?? new PushRequest();
                    result = _ide.RunOnStaThread(() => (object)PushService.Handle(_ide, pushReq));
                    break;
                case "POST /build":
                    var buildReq = ReadBody<BuildRequest>(ctx) ?? new BuildRequest();
                    result = _ide.RunOnStaThread(() => (object)BuildService.Handle(_ide, buildReq));
                    break;
                default:
                    WriteError(ctx, 404, "NOT_FOUND", $"No route for {method} {path}");
                    return;
            }
            Write(ctx, 200, result);
        }
        catch (BridgeException ex)
        {
            if (_ide.ShouldMarkDegraded(ex.Cause ?? ex)) _ide.MarkDegraded($"{path}: {ex.Message}");
            WriteError(ctx, ex.StatusCode, ex.ErrorCode, ex.Message);
        }
        catch (Exception ex)
        {
            if (_ide.ShouldMarkDegraded(ex)) _ide.MarkDegraded($"{path}: {ex.Message}");
            WriteError(ctx, 500, "INTERNAL_ERROR", ex.Message);
        }
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
