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
        catch { return; }
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
            // Attachable instances — works even when degraded so the user can re-pick a target.
            if (path == "/instances" && method == "GET")
            {
                var instances = _ide is IInstanceProvider ip ? _ide.RunOnStaThread(ip.ListInstances) : (object)Array.Empty<object>();
                Write(ctx, 200, new { instances });
                return;
            }

            if (_ide.IsDegraded) { WriteError(ctx, 503, "PLC_DEGRADED", _ide.DegradedReason ?? "IDE channel degraded — retry"); return; }

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
}
