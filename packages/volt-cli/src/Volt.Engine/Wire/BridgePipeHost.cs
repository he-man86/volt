using System;
using System.Text.Json;
using System.Threading;
using Volt.Engine;
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

    // "Disconnected" without tearing anything down. The tray's Disconnect sets this (`deselect`); the host stays
    // loaded — the CODESYS in-proc host keeps running, the TwinCAT worker keeps its COM attach — but every sync op
    // is refused as PLC_DISCONNECTED until a `select` re-binds. This is what makes Disconnect mean something: the
    // CLI reaches the pipe directly, so a connector-side selection flag alone can never gate sync.
    private volatile bool _paused;

    public BridgePipeHost(IIdeDriver ide, string pipeName)
    {
        _ide = ide;
        _server = new PipeServer(pipeName, Dispatch);
    }

    public void Start() => _server.Start();
    public void Stop() => _server.Stop();
    public void Dispose() => _server.Dispose();

    // The ops that stay served while paused — the ones the UI needs to SHOW you're disconnected and get back.
    private static bool AllowedWhilePaused(string? op) =>
        op == Ops.Health || op == Ops.Instances || op == Ops.Select || op == Ops.Deselect;

    private object Dispatch(PipeRequest req, Action<object> onProgress)
    {
        if (_paused && !AllowedWhilePaused(req.Op)) throw BridgeException.PlcDisconnected();
        // NOTE: the not-connected precondition for the project ops (refs/fetch/init/push/build) is NOT here — it is
        // each handler's first act, on the marshalled STA thread: RefsService guards itself, and FetchService /
        // PushService / BuildService go through OpGuard. That placement is deliberate (see OpGuard): checking INSIDE
        // the op is atomic with the work, so a concurrent `select` can't slip between check and op — a pre-marshal
        // check here structurally can't guarantee that. Both vendors refuse a not-connected bridge IDENTICALLY
        // because those guards live in shared Core, keyed off the same IsConnected signal.

        switch (req.Op)
        {
            case Ops.Health:
            {
                var h = _ide.BuildHealthResponse();
                h.ActiveOp = Volatile.Read(ref _activeOpDepth) > 0 ? _activeOpLabel ?? "busy" : null;
                if (_paused) { h.Connected = false; h.Status = HealthStatus.Unavailable; }
                return h;
            }
            case Ops.Instances:
                // Read-only project discovery for the connector's selector — same STA marshalling as refs. Stays
                // answerable while paused: that list is HOW the user reconnects.
                return _ide.RunOnStaThread(() => (object)_ide.EnumerateInstances());
            case Ops.Select:
                // Bind the chosen project (retarget/rebind); a state change, so mark the bridge busy for it.
                // Also the un-pause: connecting anything resumes service.
            {
                // Un-pause BEFORE the IDE work, not after. Clearing it afterwards loses a `deselect` that lands
                // while SelectProject is still on the STA thread: the deselect sets _paused, answers ok, every UI
                // reports a clean disconnect — and then this write un-gates the bridge, so `volt push` keeps
                // writing to the IDE. That is precisely the failure the gate exists to prevent. Racing the other
                // way is safe and correct: a deselect that arrives during a select wins, and the user's last
                // action is the one that sticks.
                _paused = false;
                return Busy(Ops.Select, () =>
                {
                    var sel = Body<SelectRequest>(req);
                    _ide.SelectProject(sel);
                    // UNIFORM post-condition, enforced ONCE here in Core so BOTH vendors behave identically over the
                    // wire (the parity point): a select must leave the bridge actually SERVING the asked-for project.
                    // If the driver couldn't attach it — TwinCAT: the project isn't in the bound XAE window; CODESYS:
                    // the pipe's project no longer matches — the bridge is not connected, so we refuse LOUD with the
                    // shared PLC_DISCONNECTED code instead of "succeeding" into a state where the next fetch silently
                    // returns nothing (the multi-window bug). IsConnected is a plain state read — no COM, safe on this
                    // STA thread. The drivers no longer each decide this; they just attach, Core verifies.
                    if (!_ide.IsConnected)
                        throw new BridgeException(BridgeErrorCodes.PlcDisconnected,
                            string.IsNullOrEmpty(sel.Project)
                                ? "the bridge could not attach an IDE project"
                                : $"could not attach “{sel.Project}” — the IDE has no such project open (with more than one IDE window open, make sure it's in the one being served).");
                    return (object)new { ok = true };
                });
            }
            case Ops.Deselect:
                // The tray's Disconnect. Refuse sync until the next `select`; tear nothing down. Deliberately NOT
                // wrapped in Busy(): it neither touches the IDE nor waits for the STA thread, so it answers even
                // while a push is running — and that push, already past the gate, RUNS TO COMPLETION. Disconnecting
                // mid-write must not leave the IDE half-updated; the gate stops the NEXT op, not the current one.
                _paused = true;
                return new { ok = true };
            case Ops.Refs:
                return _ide.RunOnStaThread(() => (object)RefsService.Handle(_ide, f => onProgress(f)));
            case Ops.Fetch:
                return Busy(Ops.Fetch, () => (object)FetchService.Handle(_ide, Body<FetchRequest>(req), f => onProgress(f)));
            case Ops.Init:
                return Busy(Ops.Init, () => (object)FetchService.Handle(_ide, new FetchRequest { Init = true }, f => onProgress(f)));
            case Ops.Push:
                return Busy(Ops.Push, () => (object)PushService.Handle(_ide, Body<PushRequest>(req), f => onProgress(f)));
            case Ops.Build:
                return Busy(Ops.Build, () => (object)BuildService.Handle(_ide, Body<BuildRequest>(req), f => onProgress(f)));
            default:
                // A coded error, not a raw InvalidOperationException — so the client sees BAD_REQUEST, not the
                // catch-all INTERNAL_ERROR. Shared Core, so identical on both vendors.
                throw new BridgeException(BridgeErrorCodes.BadRequest, $"unknown op '{req.Op}'");
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
