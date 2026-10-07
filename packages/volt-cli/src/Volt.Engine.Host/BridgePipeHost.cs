using System;
using System.Linq;
using System.Text.Json;
using System.Threading;
using Volt.Engine;
using Volt.Wire;
using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Sync;
using Volt.Engine.Library;
using Volt.Engine.Format.Body;

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

    // The one gate for the ops that change the project or compile it (push, build): TRIED before the op is marshalled,
    // never waited on, so a second one is refused IDE_BUSY instead of running. Without it CODESYS ran a second build
    // and pushes NESTED inside a running build (its build pumps the primary thread, so queued invokes run inside it;
    // measured: builds finished last-in, first-out) while TwinCAT's STA queue serialized them — one vendor nested, one
    // queued. Reads and health are not gated: they change nothing (openspec codesys-build-nesting).
    private int _writing;

    /// <summary>This bridge's release (<see cref="BridgeRelease"/>, design D3), read once off the shared host's own file
    /// — <c>Volt.Engine.Host.dll</c>, stamped by the same <c>build-cli.ps1</c> pass as every binary — so both vendors
    /// answer through one read. Stamped on <c>health</c> and handed to the relay <c>hello</c>, so the two never
    /// disagree. Null only when that file cannot be read; the log names why, once.</summary>
    public static string? Release => _release.Value;

    private static readonly Lazy<string?> _release = new(() =>
    {
        var r = BridgeRelease.Of(typeof(BridgePipeHost).Assembly.Location, out var unreadable);
        if (unreadable != null) BridgeLog.Warn("bridge release unreadable, health carries no bridgeVersion: " + unreadable);
        return r;
    });

    // Why this host serves nothing although its IDE has every capability: the host process could not be served as it
    // stands (CODESYS: a Volt assembly or System.Text.Json loaded twice at start — openspec
    // codesys-single-load-dependencies). Answered exactly like a missing capability — IDE_UNSUPPORTED, the sentence on
    // health's `unsupported`, every row idle — because it is the same situation for a client: no call cures it, the
    // IDE has to change (here: be restarted). Null for a host that can serve.
    private readonly string? _cannotServe;

    public BridgePipeHost(IIdeDriver ide, string pipeName) : this(ide, pipeName, null) { }

    public BridgePipeHost(IIdeDriver ide, string pipeName, string? cannotServe)
    {
        _ide = ide;
        _cannotServe = cannotServe;
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
        // An IDE that lacks what the bridge needs serves NOTHING but `health` — not even connect/disconnect, which
        // would otherwise answer ok and leave a client believing it can sync. The driver decided it once at attach
        // and names what is missing; the refusal is here, once, so both vendors answer it identically. Checked
        // BEFORE the pause gate: "unsupported" is the truer answer, and pressing Reconnect cannot cure it.
        // A process the host cannot serve (`_cannotServe`) is refused the same way, after the IDE's own reason: a
        // missing capability outlives a restart, so it is the truer answer when both hold.
        var unsupported = _ide.Unsupported ?? _cannotServe;
        if (unsupported != null && req.Op != Ops.Health)
            throw new BridgeException(BridgeErrorCodes.IdeUnsupported, unsupported);
        if (_paused && !AllowedWhilePaused(req.Op)) throw BridgeException.Paused();
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
                // The same for an IDE the bridge cannot serve: the rows stay (they name the project), none is served,
                // and the reason plus the IDE version ride on the frame so a client can show both before any call.
                if (_paused || unsupported != null)
                    h.Projects = h.Projects.Select(p => p with { Status = HealthStatus.Idle }).ToList();
                // The identity — process facts the driver read (the release, this host) — rides on the unsupported
                // path too: a refused IDE is exactly when a client needs to know which one it is. Report only: none
                // of it decides anything (openspec ide-identity-report).
                h.IdeVersion = _ide.IdeVersion;
                h.ProductName = _ide.ProductName;
                h.ProductVersion = _ide.ProductVersion;
                h.ProductVendor = _ide.ProductVendor;
                h.BridgeVersion = Release;
                h.Unsupported = unsupported;
                // Read per poll, not at start: a second copy can load later (3.2). Cheap — one scan of the loaded
                // assemblies, each copy's version-info read once per process (LoadedCopies caches it).
                var conflicts = LoadedCopies.Conflicts();
                h.LoadConflicts = conflicts.Count == 0 ? null : conflicts.ToList();
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
            case Ops.Push:
                return Gated(() => RunOp(() => (object)PushService.Handle(_ide, Body<PushRequest>(req), f => onProgress(f))));
            case Ops.Build:
                return Gated(() => RunOp(() => (object)BuildService.Handle(_ide, Body<BuildRequest>(req), f => onProgress(f))));
            default:
                // A coded error, not a raw InvalidOperationException — so the client sees BAD_REQUEST, not the
                // catch-all INTERNAL_ERROR. Shared Core, so identical on both vendors.
                throw new BridgeException(BridgeErrorCodes.BadRequest, $"unknown op '{req.Op}'");
        }
    }

    // Run a push or build under the write gate, or refuse it at once if another one holds it.
    private object Gated(Func<object> run)
    {
        if (Interlocked.CompareExchange(ref _writing, 1, 0) != 0)
            throw new BridgeException(BridgeErrorCodes.IdeBusy, "the IDE is running a build or push — nothing was applied");
        try { return run(); }
        finally { Volatile.Write(ref _writing, 0); }
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

    /// <summary>The op's typed body, or an empty one when the caller sent none.
    ///
    /// <para>A BODY THE CALLER MIS-TYPED IS THE CALLER'S FAULT. This used to let the JsonException out, and
    /// <c>PipeServer</c> stamps anything uncoded as INTERNAL_ERROR — so `push {"ops": "all of them"}` told the
    /// client the BRIDGE had failed, and the five error codes that exist to describe a bad request described
    /// nothing. It is also the likeliest error a NEW client makes, which is when a wrong answer costs most.</para>
    ///
    /// <para>The message names the op and the type, because a client holding the OpenRPC document can look the
    /// second one up; the exception's own text says which member was wrong.</para></summary>
    private static T Body<T>(PipeRequest req) where T : new()
    {
        if (!req.Body.HasValue || req.Body.Value.ValueKind == JsonValueKind.Null) return new T();
        try { return JsonSerializer.Deserialize<T>(req.Body.Value.GetRawText(), WireJson.Read) ?? new T(); }
        catch (JsonException ex)
        {
            throw new BridgeException(BridgeErrorCodes.BadRequest,
                $"the body of `{req.Op}` is not a valid {typeof(T).Name}: {ex.Message}");
        }
    }
}
