using System;
using System.IO;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using VoltBridge.Core.Handlers;
using VoltBridge.Core.Models;

namespace VoltBridge.Core.Http;

/// <summary>
/// The shared HTTP host for every bridge. It takes an <see cref="IAdapter"/> and
/// wires the standard endpoints to the shared handlers, so a vendor bridge is just
/// "implement IAdapter + a small bootstrap". Built on <see cref="HttpListener"/>
/// (works on net48 in-process AND net8 standalone) with a self-re-arming async
/// accept loop, so it keeps serving even when started from a CODESYS script that
/// then returns (the loop runs on the ThreadPool, not a script-owned thread).
///
/// Endpoints: GET /health, GET /refs, POST /fetch, POST /push, POST /build,
/// POST /shutdown. Every project-touching call is marshaled through
/// <see cref="IAdapter.RunOnStaThread{T}"/> onto the IDE's required thread.
/// </summary>
public sealed class HttpBridgeServer
{
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly IAdapter _adapter;
    private readonly int _port;
    private readonly ManualResetEventSlim _stopped = new(false);
    private HttpListener? _listener;
    private volatile bool _running;

    public HttpBridgeServer(IAdapter adapter, int port)
    {
        _adapter = adapter;
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
        try { _listener?.Stop(); } catch { }
        try { _listener?.Close(); } catch { }
        _listener = null;
        _stopped.Set();
    }

    /// <summary>Start and block until stopped — for standalone console hosts.</summary>
    public void Run()
    {
        Start();
        _stopped.Wait();
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
        catch { return; }
        ArmNext();
        try { Handle(ctx); } catch { /* never let a handler kill the loop */ }
    }

    private void Handle(HttpListenerContext ctx)
    {
        var path = ctx.Request.Url!.AbsolutePath;
        var method = ctx.Request.HttpMethod;
        try
        {
            // Health is served off the marshaled thread (cache-only) and is never
            // gated by degraded state — it reports it.
            if (path == "/health" && method == "GET")
            {
                Write(ctx, 200, _adapter.BuildHealthResponse());
                return;
            }
            if (path == "/shutdown" && method == "POST")
            {
                Write(ctx, 200, new { stopped = true });
                ThreadPool.QueueUserWorkItem(_ => Stop());
                return;
            }
            // OpenAPI contract (single source of truth) + a static Swagger UI.
            if (path == "/openapi.yaml" && method == "GET")
            {
                WriteText(ctx, 200, "application/yaml; charset=utf-8", OpenApiYaml.Value);
                return;
            }
            if ((path == "/swagger" || path == "/swagger/" || path == "/swagger/index.html") && method == "GET")
            {
                WriteText(ctx, 200, "text/html; charset=utf-8", SwaggerHtml);
                return;
            }
            // Attachable IDE instances/projects (TwinCAT ROT). Works even when degraded
            // so the user can re-pick a target; empty for adapters that don't support it.
            if (path == "/instances" && method == "GET")
            {
                var instances = _adapter is IInstanceProvider ip
                    ? _adapter.RunOnStaThread(() => ip.ListInstances())
                    : (object)Array.Empty<object>();
                Write(ctx, 200, new { instances });
                return;
            }

            if (_adapter.IsDegraded)
            {
                WriteError(ctx, 503, "PLC_DEGRADED", _adapter.DegradedReason ?? "IDE channel degraded — retry");
                return;
            }

            object result;
            switch ($"{method} {path}")
            {
                case "GET /refs":
                    result = _adapter.RunOnStaThread(() => (object)RefsHandler.Handle(_adapter));
                    break;
                case "POST /fetch":
                    var fetchReq = ReadBody<FetchRequest>(ctx) ?? new FetchRequest();
                    result = _adapter.RunOnStaThread(() => (object)FetchHandler.Handle(_adapter, fetchReq));
                    break;
                case "POST /push":
                    var pushReq = ReadBody<PushRequest>(ctx) ?? new PushRequest();
                    result = _adapter.RunOnStaThread(() => (object)PushHandler.Handle(_adapter, pushReq));
                    break;
                case "POST /build":
                    var buildReq = ReadBody<BuildRequest>(ctx) ?? new BuildRequest();
                    result = _adapter.RunOnStaThread(() => (object)BuildHandler.Handle(_adapter, buildReq));
                    break;
                default:
                    WriteError(ctx, 404, "NOT_FOUND", $"No route for {method} {path}");
                    return;
            }
            Write(ctx, 200, result);
        }
        catch (BridgeException ex)
        {
            if (_adapter.ShouldMarkDegraded(ex.Cause ?? ex)) _adapter.MarkDegraded($"{path}: {ex.Message}");
            WriteError(ctx, ex.StatusCode, ex.ErrorCode, ex.Message);
        }
        catch (Exception ex)
        {
            if (_adapter.ShouldMarkDegraded(ex)) _adapter.MarkDegraded($"{path}: {ex.Message}");
            WriteError(ctx, 500, "INTERNAL_ERROR", ex.Message);
        }
    }

    /// <summary>Start and block until /shutdown — the entry point for standalone
    /// bridges (the in-proc CODESYS bridge calls Start() instead and returns).</summary>
    public static void RunStandalone(IAdapter adapter, string title, int port)
    {
        var server = new HttpBridgeServer(adapter, port);
        Console.WriteLine($"{title} v{adapter.Version} listening on http://127.0.0.1:{port} (Swagger: /swagger)");
        try { server.Run(); }
        catch (HttpListenerException) { Console.Error.WriteLine($"Port {port} already in use — is another bridge instance running?"); }
    }

    private static readonly Lazy<string> OpenApiYaml = new(LoadOpenApiYaml);
    private static string LoadOpenApiYaml()
    {
        var asm = typeof(HttpBridgeServer).Assembly;
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

    private static T? ReadBody<T>(HttpListenerContext ctx)
    {
        using var reader = new StreamReader(ctx.Request.InputStream, ctx.Request.ContentEncoding ?? Encoding.UTF8);
        var body = reader.ReadToEnd();
        if (string.IsNullOrWhiteSpace(body)) return default;
        return JsonSerializer.Deserialize<T>(body, Json);
    }

    private static void Write(HttpListenerContext ctx, int status, object payload)
    {
        var buf = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload, Json));
        ctx.Response.StatusCode = status;
        ctx.Response.ContentType = "application/json; charset=utf-8";
        ctx.Response.ContentLength64 = buf.Length;
        ctx.Response.OutputStream.Write(buf, 0, buf.Length);
        ctx.Response.OutputStream.Close();
    }

    private static void WriteError(HttpListenerContext ctx, int status, string code, string message) =>
        Write(ctx, status, new { error = new { code, message } });

    private static void WriteText(HttpListenerContext ctx, int status, string contentType, string body)
    {
        var buf = Encoding.UTF8.GetBytes(body);
        ctx.Response.StatusCode = status;
        ctx.Response.ContentType = contentType;
        ctx.Response.ContentLength64 = buf.Length;
        ctx.Response.OutputStream.Write(buf, 0, buf.Length);
        ctx.Response.OutputStream.Close();
    }
}
