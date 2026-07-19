using System;
using System.Text.Json;
using System.Threading;
using Volt.Engine.Ide;
using Volt.Engine.Sync;
using Volt.Engine.Wire;
using Volt.Cli.Transport;

namespace Volt.Engine.Wire;

/// <summary>
/// Hosts the Volt bridge protocol over a named pipe instead of HTTP — the SAME Core services (RefsService /
/// FetchService / PushService / BuildService) and the SAME activeOp busy signal, reached by the CLI (and the
/// connector) over a local pipe. This is the transport half of the volt-cli consolidation; the IDE-access half
/// stays in Volt.Engine, and the op still runs on the driver's marshalled thread.
/// </summary>
public sealed class BridgePipeHost : IDisposable
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

    private readonly IIdeDriver _ide;
    private readonly PipeServer _server;

    // The mutating op in flight, surfaced in /health so a second client holds off on /refs — identical semantics
    // to the old HTTP host. Refcounted; Volatile.Read pairs the Interlocked writes for the off-thread health read.
    private int _activeOpDepth;
    private volatile string? _activeOpLabel;

    public BridgePipeHost(IIdeDriver ide, string pipeName)
    {
        _ide = ide;
        _server = new PipeServer(pipeName, Dispatch);
    }

    public void Start() => _server.Start();
    public void Stop() => _server.Stop();
    public void Dispose() => _server.Dispose();

    private object Dispatch(PipeRequest req, Action<object> onProgress)
    {
        switch (req.Op)
        {
            case "health":
            {
                var h = _ide.BuildHealthResponse();
                h.ActiveOp = Volatile.Read(ref _activeOpDepth) > 0 ? _activeOpLabel ?? "busy" : null;
                return h;
            }
            case "instances":
                // Read-only project discovery for the connector's selector — same STA marshalling as refs.
                return _ide.RunOnStaThread(() => (object)_ide.EnumerateInstances());
            case "select":
                // Bind the chosen project (retarget/rebind); a state change, so mark the bridge busy for it.
                return Busy("select", () => { _ide.SelectProject(Body<SelectRequest>(req)); return (object)new { ok = true }; });
            case "refs":
                return _ide.RunOnStaThread(() => (object)RefsService.Handle(_ide, f => onProgress(f)));
            case "fetch":
                return Busy("fetch", () => (object)FetchService.Handle(_ide, Body<FetchRequest>(req), f => onProgress(f)));
            case "init":
                return Busy("init", () => (object)FetchService.Handle(_ide, new FetchRequest { Init = true }, f => onProgress(f)));
            case "push":
                return Busy("push", () => (object)PushService.Handle(_ide, Body<PushRequest>(req), f => onProgress(f)));
            case "build":
                return Busy("build", () => (object)BuildService.Handle(_ide, Body<BuildRequest>(req), f => onProgress(f)));
            default:
                throw new InvalidOperationException($"unknown op '{req.Op}'");
        }
    }

    // A mutating op marks the bridge busy for its whole duration; publish the label BEFORE the depth becomes
    // visible so any concurrent health read that sees depth>0 also sees the label.
    private object Busy(string op, Func<object> run)
    {
        _activeOpLabel = op;
        Interlocked.Increment(ref _activeOpDepth);
        try { return _ide.RunOnStaThread(run); }
        finally { if (Interlocked.Decrement(ref _activeOpDepth) == 0) _activeOpLabel = null; }
    }

    private static T Body<T>(PipeRequest req) where T : new()
        => req.Body.HasValue && req.Body.Value.ValueKind != JsonValueKind.Null
            ? JsonSerializer.Deserialize<T>(req.Body.Value.GetRawText(), Json) ?? new T()
            : new T();
}
