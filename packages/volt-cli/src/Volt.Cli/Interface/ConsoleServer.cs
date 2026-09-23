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

    /// <summary>The control-plane port this console forwards to — the same override the connector itself
    /// honours, read in one place so the page and the proxy cannot disagree about where it is.</summary>
    private static int ControlPort() =>
        int.TryParse(Environment.GetEnvironmentVariable("VOLT_CONTROL_PORT"), out var p) && p > 0 ? p : 8550;

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
    /// <summary>How long a spawned verb may take before the console stops it. Generous enough for a real
    /// build, short enough that a hung panel is a message rather than a wedged request.</summary>
    private const int RunTimeoutMs = 120_000;

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
            // CSRF GUARD, the same one the control plane carries — and this surface needs it MORE, because
            // `/_api/cli` spawns a process with caller-supplied argv. A cross-origin `fetch` with a plain
            // content-type is a CORS-safelisted simple request, so there is no preflight to refuse; the Origin
            // header is what a browser always sends and a first-party caller never does. Without this, any page
            // the engineer visits while the console runs could enumerate the project and, with --allow-write,
            // drive a push into the live PLC.
            var origin = ctx.Request.Headers["Origin"];
            if (origin != null && !string.Equals(origin, $"http://127.0.0.1:{_port}", StringComparison.OrdinalIgnoreCase))
            {
                WriteJson(ctx, 403, new { error = "cross-origin browser requests are not allowed" });
                return;
            }

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
            // The port this console really forwards to, not the default — the live-test tier stands a second
            // connector on another one, and a page that reports 8550 while talking to 8560 is the exact class
            // of wrong-information this whole feature exists to remove.
            WriteJson(ctx, 200, new { allowWrite = _allowWrite, pipe = _pipeOverride, controlPort = ControlPort() });
            return;
        }
        if (route == "bridge") { BridgeCall(ctx); return; }
        if (route == "cli") { CliCall(ctx); return; }
        if (route.StartsWith("connector", StringComparison.Ordinal))
        {
            // WITH the query string. `AbsolutePath` drops it, so `?refresh=1` reached the control plane as a
            // bare path and any parameterised route answered as if nothing had been passed — a wrong answer
            // with no error, on the surface whose job is to let a reader check the docs against reality.
            var rest = route.Length > "connector".Length ? route.Substring("connector".Length).TrimStart('/') : "";
            await ConnectorCall(ctx, rest + (ctx.Request.Url!.Query ?? "")).ConfigureAwait(false);
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

        var pipe = req.Pipe ?? _pipeOverride;
        if (pipe is null)
        {
            var (found, ambiguity) = FirstPipe();
            if (ambiguity is not null) { WriteJson(ctx, 409, new { error = ambiguity }); return; }
            if (found is null)
            {
                WriteJson(ctx, 503, new { error = "no bridge pipe found — is an IDE bridge running?" });
                return;
            }
            pipe = found;
        }

        var progress = new List<JsonElement>();
        try
        {
            // The frames are already `JsonElement`s and serialize as themselves — the round trip through
            // GetRawText + Deserialize that used to sit here allocated and re-parsed the whole payload twice,
            // which on an `init` of a real project is megabytes, for an identical result.
            var result = new PipeClient(pipe).Call(req.Op, ToBody(req.Body), f => progress.Add(f.Clone()));
            WriteJson(ctx, 200, new { pipe, progress, result });
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

    /// <summary>The one live bridge pipe — or NOTHING, when the answer is not obvious.
    ///
    /// <para>This used to probe CODESYS then TwinCAT and return the first hit, so an engineer with both IDEs
    /// open had every panel silently driving CODESYS from a TwinCAT-bound workspace. The console holds no
    /// workspace binding to break the tie with, so it does not invent one: several candidates is a question,
    /// and the honest answer is to name them and ask which, not to pick.</para></summary>
    private static (string? Pipe, string? Ambiguity) FirstPipe()
    {
        var found = new[] { Vendors.Codesys, Vendors.Twincat }
            .SelectMany(v => PipeDiscovery.List(PipeNames.PrefixForVendor(v)))
            .ToList();
        if (found.Count == 1) return (found[0], null);
        if (found.Count == 0) return (null, null);
        return (null, "several bridges are live (" + string.Join(", ", found)
            + ") — name one in the request's `pipe` field, or start the console with --pipe");
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
        var port = ControlPort();
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
        // THE VERB IS NOT args[0]. It is the first POSITIONAL token, because `ParseArgs` routes every
        // `--`-prefixed token into flags first — so `volt --json push` has verb `push` while args[0] is
        // `--json`. Gating on args[0] therefore let `--json push`, `--workspace X push` and every other
        // flag-first spelling walk straight past a read-only console and write to the live PLC. Asked of the
        // ONE parser rather than re-derived here: a second implementation of "which word is the verb" is
        // exactly how this hole reappears.
        var verb = Program.VerbOf(args);
        if (verb is null)
        {
            WriteJson(ctx, 400, new { error = "no verb in that command line" });
            return;
        }

        // A verb that never returns cannot be a panel. `console` starts a SERVER, so running it from the
        // console spawns a second one that outlives the request — measured: the panel simply never answered.
        // The hard timeout below is the general safety net for a verb that hangs; this is the specific one,
        // named because the message can then say what to do instead.
        if (verb == "console")
        {
            WriteJson(ctx, 400, new
            {
                error = "`volt console` starts a server and does not return — that is this page. Run it in a "
                    + "terminal if you want a second one.",
            });
            return;
        }

        // `--dry-run` only exempts the verbs that IMPLEMENT it. `ParseArgs` drops an unrecognised flag into a
        // set nothing reads, so `volt init --dry-run` used to pass this gate and then really git-init the
        // project and pull — a flag the verb ignores was opening the door the gate exists to hold shut.
        var dryRunnable = verb is "pull" or "push";
        if (MutatingVerbs.Contains(verb) && !_allowWrite && !(dryRunnable && args.Contains("--dry-run")))
        {
            WriteJson(ctx, 403, new
            {
                error = $"`volt {verb}` can change a project — restart with `volt console --allow-write`"
                    + (dryRunnable ? ", or add --dry-run" : ""),
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

        // BOTH STREAMS AT ONCE, and never a blocking read. Reading stdout to the end and THEN stderr is the
        // classic deadlock: a child that fills the stderr pipe buffer blocks on write while the parent is
        // still waiting on stdout, and neither moves again. `volt build` on a project with many diagnostics
        // is exactly that shape.
        var outTask = proc.StandardOutput.ReadToEndAsync();
        var errTask = proc.StandardError.ReadToEndAsync();

        // AND A REAL DEADLINE. `WaitForExit(120_000)` bounded nothing while the reads above blocked first, so
        // a verb that never returns held the request and left the child running — `Process.Dispose` closes a
        // handle, it does not kill. Killing the TREE matters because a verb may itself have spawned something.
        var finished = proc.WaitForExit(RunTimeoutMs);
        if (!finished)
        {
            try { proc.Kill(entireProcessTree: true); } catch { /* already gone */ }
            sw.Stop();
            WriteJson(ctx, 200, new
            {
                command = "volt " + string.Join(" ", args),
                cwd = psi.WorkingDirectory,
                exitCode = -1,
                stdout = "",
                stderr = $"the command did not finish within {RunTimeoutMs / 1000}s and was stopped",
                ms = sw.ElapsedMilliseconds,
            });
            return;
        }
        sw.Stop();
        WriteJson(ctx, 200, new
        {
            command = "volt " + string.Join(" ", args),
            cwd = psi.WorkingDirectory,
            exitCode = proc.ExitCode,
            stdout = outTask.GetAwaiter().GetResult(),
            stderr = errTask.GetAwaiter().GetResult(),
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

    /// <summary>The request body, or a THROWN JsonException naming what is wrong with it.
    ///
    /// <para>This used to swallow a parse failure into <c>null</c>, which the callers then reported as
    /// "expected { op, body }" — so a misplaced comma in the textarea came back as a message about a field
    /// that was right there. The outer handler turns the exception into the parser's own words.</para></summary>
    private static T? Read<T>(HttpListenerContext ctx) where T : class
    {
        using var r = new StreamReader(ctx.Request.InputStream, Encoding.UTF8);
        var s = r.ReadToEnd();
        return string.IsNullOrWhiteSpace(s) ? null : JsonSerializer.Deserialize<T>(s, Json);
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
