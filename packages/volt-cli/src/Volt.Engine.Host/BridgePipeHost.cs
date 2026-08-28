using System;
using System.Linq;
using System.Text.Json;
using Volt.Engine;
using Volt.Wire;
using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Sync;
using Volt.Engine.Library;
using Volt.Engine.Format.Body;
using Volt.Engine.PlcOpen;

namespace Volt.Engine.Host;

/// <summary>
/// Serves the bridge ops over the named pipe, for the CLI and the connector alike: maps each op to its Sync service
/// (RefsService / FetchService / PushService / BuildService), marshals every project-touching call onto the driver's
/// one IDE thread, streams progress frames, and is the single error boundary.
/// </summary>
public sealed class BridgePipeHost : IDisposable
{


    private readonly IIdeDriver _ide;
    private readonly PipeServer _server;

    // "Disconnected" without tearing anything down. The tray's Disconnect sets this (`disconnect`); the host stays
    // loaded — the CODESYS in-proc host keeps running, the TwinCAT worker keeps its COM attach — but every sync op
    // is refused as PLC_DISCONNECTED until a `connect` re-binds. This is what makes Disconnect mean something: the
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
    // `health` carries the connectable-projects list, so it doubles as discovery: it is how the user reconnects.
    private static bool AllowedWhilePaused(string? op) =>
        op == Ops.Health || op == Ops.Connect || op == Ops.Disconnect;

    private object Dispatch(PipeRequest req, Action<object> onProgress)
    {
        if (_paused && !AllowedWhilePaused(req.Op)) throw BridgeException.PlcDisconnected();
        // NOTE: the not-connected precondition for the project ops (refs/fetch/init/push/build) is NOT here — it is
        // each handler's first act, on the marshalled STA thread: RefsService / FetchService / PushService /
        // BuildService all go through OpGuard. That placement is deliberate (see OpGuard): checking INSIDE
        // the op is atomic with the work, so a concurrent `select` can't slip between check and op — a pre-marshal
        // check here structurally can't guarantee that. Both vendors refuse a not-connected bridge IDENTICALLY
        // because those guards live in shared Core, keyed off the same IsConnected signal.

        switch (req.Op)
        {
            case Ops.Health:
            {
                // The one ambient poll: liveness + the connectable-projects list, both from the driver's CACHED
                // snapshot — NEVER marshalled onto the IDE thread. This is a POLL-PATH op (the connector every ~4s,
                // plus every control-plane /status); marshalling it (as the old `instances` op did) queued it behind a
                // long fetch/push/build on the single IDE thread, stalling the connector's refresh so a busy IDE read
                // as a LOST CONNECTION. BuildHealthResponse kicks the off-request single-flight refresh itself.
                var h = _ide.BuildHealthResponse();
                // One host-owned fact stamped onto the rows: while paused (disconnect) the bridge serves nothing, so
                // force every row to `idle` — the list stays (it is how the user reconnects), and serving/Connected
                // derive to "not serving".
                if (_paused) h.Projects = h.Projects.Select(p => p with { Status = HealthStatus.Idle }).ToList();
                return h;
            }
            case Ops.Connect:
                // Bind the chosen project (retarget/rebind), and un-pause: connecting anything resumes service.
            {
                // Un-pause BEFORE the IDE work, not after. Clearing it afterwards loses a `disconnect` that lands
                // while SelectProject is still on the STA thread: the disconnect sets _paused, answers ok, every UI
                // reports a clean disconnect — and then this write un-gates the bridge, so `volt push` keeps
                // writing to the IDE. That is precisely the failure the gate exists to prevent. Racing the other
                // way is safe and correct: a disconnect that arrives during a connect wins, and the user's last
                // action is the one that sticks.
                _paused = false;
                return RunOp(() =>
                {
                    var sel = Body<ConnectRequest>(req);
                    _ide.SelectProject(sel);
                    // UNIFORM post-condition, enforced ONCE here in Core so BOTH vendors behave identically over the
                    // wire (the parity point): a connect must leave the bridge actually SERVING the asked-for project.
                    // If the driver couldn't attach it — TwinCAT: the project isn't in the bound XAE window; CODESYS:
                    // the pipe's project no longer matches — the bridge is not connected, so we refuse LOUD with the
                    // shared PLC_DISCONNECTED code instead of "succeeding" into a state where the next fetch silently
                    // returns nothing (the multi-window bug). The drivers no longer each decide this; they just
                    // attach, Core verifies.
                    // SERVED-NAME half: reading IsConnected alone was not the post-condition this comment claims —
                    // CODESYS's select is a no-op refresh of its ONE primary project, so `connect {project:"Typo"}`
                    // answered ok there while TwinCAT refused: a per-vendor difference a pipe client can OBSERVE.
                    // Ordinal, matching OpGuard.RequireBoundProject, so connect and the first project op cannot
                    // disagree about the same pair of strings. An EMPTY/absent `sel.Project` stays allowed, and that
                    // carve-out is load-bearing, not an optimization: it is the soft "serve whatever you have"
                    // select the e2e harness, the VOLT_PIPE paths and the way back from `disconnect` all send.
                    // Both reads are plain driver state — no COM round-trip — and this whole body already runs on the
                    // marshalled IDE thread, which is where CODESYS's live ServedProjectName must be read.
                    // NB `_paused` is NOT rolled back when this throws: a refused connect deliberately leaves the
                    // bridge RESUMED. The un-pause above happens before the IDE work on purpose (a `disconnect`
                    // racing a connect must win), and re-writing it here would re-open exactly that race. Pinned by
                    // PipeTransportTests.A_refused_connect_still_resumes_the_bridge_the_pause_gate_is_not_restored.
                    if (!_ide.IsConnected ||
                        (!string.IsNullOrEmpty(sel.Project) &&
                         !string.Equals(_ide.ServedProjectName, sel.Project, StringComparison.Ordinal)))
                        throw new BridgeException(BridgeErrorCodes.PlcDisconnected,
                            string.IsNullOrEmpty(sel.Project)
                                ? "the bridge could not attach an IDE project"
                                : $"could not attach “{sel.Project}” — the IDE has no such project open (with more than one IDE window open, make sure it's in the one being served).");
                    return (object)new { ok = true };
                });
            }
            case Ops.Disconnect:
                // The tray's Disconnect. Refuse sync until the next `connect`; tear nothing down. Deliberately NOT
                // wrapped in RunOp(): it neither touches the IDE nor waits for the STA thread, so it answers even
                // while a push is running — and that push, already past the gate, RUNS TO COMPLETION. Disconnecting
                // mid-write must not leave the IDE half-updated; the gate stops the NEXT op, not the current one.
                _paused = true;
                return new { ok = true };
            case Ops.Refs:
                return RunRead(() => (object)RefsService.Handle(_ide, Body<RefsRequest>(req), f => onProgress(f)));
            case Ops.Fetch:
                return RunRead(() => (object)FetchService.Handle(_ide, Body<FetchRequest>(req), f => onProgress(f)));
            case Ops.Init:
                return RunRead(() => (object)FetchService.Handle(_ide, new FetchRequest { Init = true }, f => onProgress(f)));
            case Ops.Push:
                return RunOp(() => (object)PushService.Handle(_ide, Body<PushRequest>(req), f => onProgress(f)));
            case Ops.Build:
                return RunOp(() => (object)BuildService.Handle(_ide, Body<BuildRequest>(req), f => onProgress(f)));
            default:
                // A coded error, not a raw InvalidOperationException — so the client sees BAD_REQUEST, not the
                // catch-all INTERNAL_ERROR. Shared Core, so identical on both vendors.
                throw new BridgeException(BridgeErrorCodes.BadRequest, $"unknown op '{req.Op}'");
        }
    }

    // Run a mutating op on the IDE thread. A clean completion CONFIRMS the channel, so it clears any degraded flag —
    // the counterpart to RunRead marking it on a transient, which together keep `health` honest. A write must NOT
    // auto-retry (it could double-apply), which is exactly why this is not RunRead: the read ops (refs/fetch/init)
    // call RunRead directly, the writes (connect/push/build) come here.
    private object RunOp(Func<object> run)
    {
        var r = _ide.RunOnStaThread(run);
        _ide.ClearDegraded();
        return r;
    }

    // Run a READ op on the IDE thread, self-healing ONE transient failure. TwinCAT's out-of-process COM can drop a
    // call mid-flight (0x800706BA "RPC server unavailable") when the IDE re-registers / goes momentarily busy; the
    // driver classifies that via ShouldMarkDegraded. On such a failure we MARK DEGRADED (so `health` reflects the
    // impaired channel instead of a stale "healthy"), Recover() (re-acquire the desired project by stable name, on
    // the IDE thread), and retry ONCE — a transient drop is invisible to the CALLER but visible in health. A clean
    // return clears degraded. Reads only: a write routed through here could double-apply. CODESYS is in-proc and never
    // classifies a transient, so this is a single plain call there (the `when` filter is false).
    private object RunRead(Func<object> run)
    {
        try { var r = _ide.RunOnStaThread(run); _ide.ClearDegraded(); return r; }
        catch (Exception ex) when (_ide.ShouldMarkDegraded(ex))
        {
            _ide.MarkDegraded($"transient IDE error: {ex.Message}");
            VoltLog.Warn($"transient IDE error ({ex.Message}) — re-acquiring the project and retrying once");
            _ide.RunOnStaThread(() => { _ide.Recover(); return (object)0; });
            var r = _ide.RunOnStaThread(run);   // one retry; a second failure propagates as a clean error
            _ide.ClearDegraded();               // retry succeeded → recovered
            return r;
        }
    }

    private static T Body<T>(PipeRequest req) where T : new()
        => req.Body.HasValue && req.Body.Value.ValueKind != JsonValueKind.Null
            ? JsonSerializer.Deserialize<T>(req.Body.Value.GetRawText(), WireJson.Read) ?? new T()
            : new T();
}
