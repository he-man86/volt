using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Volt.Contracts;
using Volt.Wire;

namespace Volt.Cli.Interface;

/// <summary>
/// THE INTERFACE CONSOLE — see and CALL all three of Volt's surfaces from one page.
///
/// <para>Volt exposes three things to the outside world and they are reached three different ways: the bridge
/// WIRE over a named pipe, the connector's HTTP CONTROL PLANE on :8550, and the `volt` CLI over argv. A
/// document can describe all three, but a description is only worth what you can check — and none of them can
/// be exercised from a browser, because a browser cannot open a pipe, is refused cross-origin by the control
/// plane, and cannot run a process.</para>
///
/// <para>So this serves the documentation AND stands behind it as the one client that can reach all three:</para>
/// <list type="bullet">
/// <item><c>POST /_api/bridge</c> — opens the pipe, sends <c>{op, body}</c>, and returns <b>every frame</b>,
/// progress included, so what the page shows is the wire and not a summary of it.</item>
/// <item><c>/_api/connector/…</c> — forwards to the control plane from a process rather than a page, which is
/// what gets past its own cross-origin refusal.</item>
/// <item><c>POST /_api/cli</c> — runs this very binary with the given argv and returns stdout, stderr and the
/// EXIT CODE, which is the CLI's real contract and the part a script author otherwise has to guess.</item>
/// </list>
///
/// <para><b>Read-only unless you say otherwise.</b> Two of these surfaces write to a live PLC. Every call that
/// can change something — a <c>push</c> op on the wire, a mutating verb, any non-GET control-plane route — is
/// refused with a plain message unless the server was started with <c>--allow-write</c>. A console that can
/// silently push to the IDE the engineer is standing in front of is not a review tool.</para>
///
/// <para>Localhost only, like the control plane it talks to, and for the same reason.</para>
/// </summary>
public sealed class ConsoleServer : IDisposable
{
    private readonly HttpListener _listener = new();
    private readonly int _port;
    private readonly bool _allowWrite;
    private readonly string? _pipeOverride;
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(10) };

    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

    /// <summary>The CLI verbs that can change a project. Kept here rather than inferred from the verb name so
    /// that adding a verb does not silently add a writable one.</summary>
    private static readonly HashSet<string> MutatingVerbs =
        new(StringComparer.Ordinal) { "init", "pull", "push", "merge", "rebind" };

    /// <summary>The wire ops that change what the bridge is DOING, not just what it reports.
    ///
    /// <para><c>push</c> is the obvious one. <c>disconnect</c> and <c>connect</c> are the ones worth naming:
    /// neither writes PLC code, but both retarget the bridge the engineer is using — a disconnect pauses sync
    /// for every client until someone reconnects, and a connect can rebind it to a different project. A review
    /// tool that can do that to the IDE someone is standing in front of, silently, is not read-only in any
    /// sense that matters. <c>health</c>, <c>refs</c>, <c>fetch</c>, <c>init</c> and <c>build</c> only read
    /// (a build compiles, which the IDE does constantly anyway).</para></summary>
    private static readonly HashSet<string> StatefulOps =
        new(StringComparer.Ordinal) { Ops.Push, Ops.Connect, Ops.Disconnect };

    public ConsoleServer(int port, bool allowWrite, string? pipeOverride)
    {
        _port = port;
        _allowWrite = allowWrite;
        _pipeOverride = pipeOverride;
        _listener.Prefixes.Add($"http://127.0.0.1:{port}/");
    }

    public string Url => $"http://127.0.0.1:{_port}/";

    public void Start()
    {
        _listener.Start();
        Task.Run(Loop);
    }

    private async Task Loop()
    {
        while (_listener.IsListening)
        {
            HttpListenerContext ctx;
            try { ctx = await _listener.GetContextAsync().ConfigureAwait(false); }
            catch { return; }
            _ = Task.Run(() => Handle(ctx));
        }
    }

    private async Task Handle(HttpListenerContext ctx)
    {
        try
        {
            var path = ctx.Request.Url!.AbsolutePath.Trim('/');
            if (path.StartsWith("_api/", StringComparison.Ordinal))
                await Api(ctx, path.Substring("_api/".Length)).ConfigureAwait(false);
            else
                Static(ctx, path);
        }
        catch (Exception ex)
        {
            // The console's own failure is content, not a stack trace in a terminal nobody is watching.
            try { WriteJson(ctx, 500, new { error = ex.Message }); } catch { }
        }
        finally
        {
            try { ctx.Response.Close(); } catch { }
        }
    }

    // ── the three surfaces ──────────────────────────────────────────────────────────────────────────

    private async Task Api(HttpListenerContext ctx, string route)
    {
        if (route == "meta")
        {
            WriteJson(ctx, 200, new { allowWrite = _allowWrite, pipe = _pipeOverride, controlPort = 8550 });
            return;
        }
        if (route == "bridge") { BridgeCall(ctx); return; }
        if (route == "cli") { CliCall(ctx); return; }
        if (route.StartsWith("connector", StringComparison.Ordinal))
        {
            await ConnectorCall(ctx, route.Length > "connector".Length ? route.Substring("connector".Length).TrimStart('/') : "")
                .ConfigureAwait(false);
            return;
        }
        WriteJson(ctx, 404, new { error = $"no console route '{route}'" });
    }

    private sealed class BridgeBody
    {
        public string? Pipe { get; set; }
        public string Op { get; set; } = "";
        public JsonElement? Body { get; set; }
    }

    /// <summary>Call one wire op and return EVERY frame. The progress frames are the half a client has to
    /// handle and the half a static document cannot show, so they are carried through in order.</summary>
    private void BridgeCall(HttpListenerContext ctx)
    {
        var req = Read<BridgeBody>(ctx);
        if (req is null || req.Op.Length == 0) { WriteJson(ctx, 400, new { error = "expected { op, body }" }); return; }
        if (StatefulOps.Contains(req.Op) && !_allowWrite)
        {
            WriteJson(ctx, 403, new
            {
                error = $"`{req.Op}` changes what the bridge is doing — restart with `volt console --allow-write`",
            });
            return;
        }

        var pipe = req.Pipe ?? _pipeOverride ?? FirstPipe();
        if (pipe is null)
        {
            WriteJson(ctx, 503, new { error = "no bridge pipe found — is an IDE bridge running?" });
            return;
        }

        var progress = new List<JsonElement>();
        try
        {
            var result = new PipeClient(pipe).Call(req.Op, ToBody(req.Body), f => progress.Add(f.Clone()));
            WriteJson(ctx, 200, new
            {
                pipe,
                progress = progress.Select(p => JsonSerializer.Deserialize<JsonElement>(p.GetRawText())).ToList(),
                result = JsonSerializer.Deserialize<JsonElement>(result.GetRawText()),
            });
        }
        catch (PipeCallException e)
        {
            // A coded refusal is a RESULT of the call, not a failure of the console — it is exactly what the
            // page is here to show, so it comes back 200 with the code beside the frames that preceded it.
            WriteJson(ctx, 200, new { pipe, progress, error = new { code = e.Code, message = e.Message } });
        }
        catch (Exception e)
        {
            WriteJson(ctx, 200, new { pipe, progress, error = new { code = "TRANSPORT", message = e.Message } });
        }
    }

    private static object? ToBody(JsonElement? body) =>
        body is null || body.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined
            ? null
            : JsonSerializer.Deserialize<object>(body.Value.GetRawText());

    private static string? FirstPipe()
    {
        foreach (var vendor in new[] { Vendors.Codesys, Vendors.Twincat })
        {
            var found = PipeDiscovery.List(PipeNames.PrefixForVendor(vendor));
            if (found.Count > 0) return found[0];
        }
        return null;
    }

    /// <summary>Forward to the connector's control plane. From a PROCESS, which is the point: the control
    /// plane refuses a browser's cross-origin request by design, so a page cannot call it and this can.</summary>
    private async Task ConnectorCall(HttpListenerContext ctx, string rest)
    {
        var method = ctx.Request.Headers["X-Volt-Method"] ?? "GET";
        if (!_allowWrite && !string.Equals(method, "GET", StringComparison.OrdinalIgnoreCase))
        {
            WriteJson(ctx, 403, new { error = $"{method} on the control plane changes connector state — restart with `volt console --allow-write`" });
            return;
        }
        var body = new StreamReader(ctx.Request.InputStream, Encoding.UTF8).ReadToEnd();
        var port = Environment.GetEnvironmentVariable("VOLT_CONTROL_PORT") is { Length: > 0 } p ? p : "8550";
        using var msg = new HttpRequestMessage(new HttpMethod(method), $"http://127.0.0.1:{port}/{rest}");
        if (body.Length > 0) msg.Content = new StringContent(body, Encoding.UTF8, "application/json");
        try
        {
            using var res = await Http.SendAsync(msg).ConfigureAwait(false);
            var text = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
            WriteJson(ctx, 200, new { status = (int)res.StatusCode, body = text });
        }
        catch (Exception e)
        {
            WriteJson(ctx, 200, new { status = 0, error = $"the connector is not answering on :{port} — {e.Message}" });
        }
    }

    private sealed class CliBody
    {
        public List<string>? Args { get; set; }
        public string? Cwd { get; set; }
    }

    /// <summary>Run this binary with the given argv. The exit CODE comes back beside the streams, because that
    /// is the CLI's contract to a script and the one thing `--help` never tells you.</summary>
    private void CliCall(HttpListenerContext ctx)
    {
        var req = Read<CliBody>(ctx);
        var args = req?.Args ?? new List<string>();
        if (args.Count == 0) { WriteJson(ctx, 400, new { error = "expected { args: [...] }" }); return; }
        // A verb that never returns cannot be a panel. `console` starts a SERVER, so running it from the
        // console spawns a second one that outlives the request and holds the call open until the timeout —
        // measured: the panel simply never answered. Named rather than inferred, because "does this verb
        // return" is not something the argv can be asked.
        if (args[0] == "console")
        {
            WriteJson(ctx, 400, new
            {
                error = "`volt console` starts a server and does not return — that is this page. Run it in a "
                    + "terminal if you want a second one.",
            });
            return;
        }
        if (MutatingVerbs.Contains(args[0]) && !_allowWrite && !args.Contains("--dry-run"))
        {
            WriteJson(ctx, 403, new
            {
                error = $"`volt {args[0]}` can change a project — restart with `volt console --allow-write`, "
                    + "or add --dry-run where the verb supports it",
            });
            return;
        }

        var exe = Process.GetCurrentProcess().MainModule?.FileName ?? "volt";
        var psi = new ProcessStartInfo(exe)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            WorkingDirectory = req?.Cwd is { Length: > 0 } c && Directory.Exists(c) ? c : Environment.CurrentDirectory,
        };
        foreach (var a in args) psi.ArgumentList.Add(a);

        var sw = Stopwatch.StartNew();
        using var proc = Process.Start(psi)!;
        var stdout = proc.StandardOutput.ReadToEnd();
        var stderr = proc.StandardError.ReadToEnd();
        proc.WaitForExit(120_000);
        sw.Stop();
        WriteJson(ctx, 200, new
        {
            command = "volt " + string.Join(" ", args),
            cwd = psi.WorkingDirectory,
            exitCode = proc.HasExited ? proc.ExitCode : -1,
            stdout,
            stderr,
            ms = sw.ElapsedMilliseconds,
        });
    }

    // ── the pages ───────────────────────────────────────────────────────────────────────────────────

    /// <summary>The docs, served from resources embedded in this binary — so `volt console` works from an
    /// installed copy, not only from a checkout with the repo beside it.</summary>
    private void Static(HttpListenerContext ctx, string path)
    {
        var name = path.Length == 0 ? "index.html" : path;
        var asm = Assembly.GetExecutingAssembly();
        var key = asm.GetManifestResourceNames()
            .FirstOrDefault(r => r.EndsWith("docs." + name.Replace('/', '.'), StringComparison.OrdinalIgnoreCase));
        if (key is null)
        {
            ctx.Response.StatusCode = 404;
            var miss = Encoding.UTF8.GetBytes($"no page '{name}'");
            ctx.Response.OutputStream.Write(miss, 0, miss.Length);
            return;
        }
        using var stream = asm.GetManifestResourceStream(key)!;
        using var mem = new MemoryStream();
        stream.CopyTo(mem);
        var bytes = mem.ToArray();
        ctx.Response.ContentType = ContentType(name);
        ctx.Response.ContentLength64 = bytes.Length;
        ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
    }

    private static string ContentType(string name) =>
        name.EndsWith(".html", StringComparison.OrdinalIgnoreCase) ? "text/html; charset=utf-8"
        : name.EndsWith(".css", StringComparison.OrdinalIgnoreCase) ? "text/css; charset=utf-8"
        : name.EndsWith(".js", StringComparison.OrdinalIgnoreCase) ? "text/javascript; charset=utf-8"
        : name.EndsWith(".json", StringComparison.OrdinalIgnoreCase) ? "application/json; charset=utf-8"
        : "application/octet-stream";

    // ── plumbing ────────────────────────────────────────────────────────────────────────────────────

    private static T? Read<T>(HttpListenerContext ctx) where T : class
    {
        try
        {
            using var r = new StreamReader(ctx.Request.InputStream, Encoding.UTF8);
            var s = r.ReadToEnd();
            return string.IsNullOrWhiteSpace(s) ? null : JsonSerializer.Deserialize<T>(s, Json);
        }
        catch { return null; }
    }

    private static void WriteJson(HttpListenerContext ctx, int status, object payload)
    {
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload));
        ctx.Response.StatusCode = status;
        ctx.Response.ContentType = "application/json; charset=utf-8";
        ctx.Response.ContentLength64 = bytes.Length;
        ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
    }

    public void Dispose()
    {
        try { _listener.Stop(); } catch { }
        try { _listener.Close(); } catch { }
    }
}
