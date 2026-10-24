using System;
using System.IO;
using System.Text.Json;
using Volt.Wire;
using Volt.Contracts;

namespace Volt.Cli.Sync;

public sealed class BridgeError : Exception
{
    /// <summary>The pipe could not be reached or died mid-call. A CLI-local code, like
    /// <see cref="BridgeResolver.AmbiguousBridge"/> — it never travels on the wire, because there is no wire.</summary>
    public const string UnreachableCode = "BRIDGE_UNREACHABLE";

    /// <summary>The pipe is there and refused this process — another user's IDE, or an elevated one (openspec
    /// environment-dependency-audit 2.2). CLI-local, like <see cref="UnreachableCode"/>; the message names the cause.</summary>
    public const string AccessDeniedCode = PipeAccessDeniedException.Code;

    /// <summary>The bridge's <c>health</c> lacks a member of this wire (<see cref="WireShape"/>, wire-final-shape 4.3c):
    /// it is the previous release, which would serve this CLI leniently. CLI-local; refused before any other op.</summary>
    public const string PredatesWireCode = WireShape.PredatesWireCode;

    public string Code { get; }
    public BridgeError(string code, string message) : base(message) => Code = code;
}

/// <summary>
/// The bridge client — the CLI's view of the live IDE, over the NAMED PIPE, using Core's wire DTOs directly.
/// No zod schemas: the DTOs ARE the contract.
///
/// <para><b>Every request states this CLI's protocol</b> (<see cref="WireProtocol.Version"/>), and a bridge of another
/// one refuses it <c>PROTOCOL_MISMATCH</c> before anything runs — an update made while CODESYS is open leaves the
/// previous bridge loaded in-proc. That refusal reaches the caller as a <see cref="BridgeError"/> naming both numbers and
/// the remedy.</para>
///
/// <para><b>Every op first checks the bridge's shape</b>, once per client (<see cref="WireShape"/>, wire-final-shape
/// 4.3c): a bridge of the previous release states the same protocol number and serves this CLI's envelope leniently, so
/// its <c>health</c> lacking <c>languages</c> or <c>kinds</c> is what refuses it — <see cref="BridgeError.PredatesWireCode"/>,
/// before that op is sent.</para>
///
/// <para>IT GUARDS NOTHING ELSE. There used to be a `GuardEmptyItems` here that re-probed the CACHED health snapshot
/// after a SUCCESSFUL refs or fetch and refused when it showed nothing serving — the staler of two signals
/// overriding the op's own live guard, and unable to tell an empty project from a walk that skipped a subtree
/// either way. That case is closed at the line that creates it: `WalkResult.UnwalkedFolders`.</para>
/// </summary>
public sealed class BridgeClient
{

    private readonly PipeClient _pipe;
    private readonly string _pipeName;
    /// <summary>This client's bridge has answered a <c>health</c> of this wire's shape. Checked once per client (one
    /// CLI process): every op asks it first; <see cref="GetHealth"/> IS that check, so <c>init</c> and <c>status</c>,
    /// which read <c>health</c> first anyway, pay nothing extra.</summary>
    private bool _shapeChecked;

    public BridgeClient(string pipeName)
    {
        _pipeName = pipeName;
        _pipe = new PipeClient(pipeName);
    }

    private static T De<T>(JsonElement e) => JsonSerializer.Deserialize<T>(e.GetRawText(), WireJson.Read)!;

    /// <summary>The bridge's <c>health</c>, refused <see cref="BridgeError.PredatesWireCode"/> when it lacks a member of
    /// this wire (<see cref="WireShape"/>). Always read live: the throttled snapshot is the bridge's, not cached here.</summary>
    public HealthResponse GetHealth()
    {
        var health = Call(Ops.Health);
        try { WireShape.Require(health, _pipeName); }
        catch (BridgePredatesWireException e) { throw new BridgeError(BridgeError.PredatesWireCode, e.Message); }
        _shapeChecked = true;
        return De<HealthResponse>(health);
    }

    /// <summary>Before any op but <c>health</c>: the bridge's shape, checked once (wire-final-shape 4.3c). A bridge of the
    /// previous release reads this CLI's envelope leniently and would SERVE the op; refused here, it is sent nothing.</summary>
    private void RequireShape()
    {
        if (!_shapeChecked) GetHealth();
    }

    /// <summary>The bridge refused this CLI's protocol: the remedy follows the comparison — an older bridge is the
    /// previous release still loaded (restart the IDE); a newer one means this CLI is the old peer (update Volt).</summary>
    private static BridgeError ProtocolRefused(PipeCallException e)
    {
        int? theirs = e.ErrorData is { ValueKind: JsonValueKind.Object } data
                      && data.TryGetProperty("bridgeProtocol", out var p) && p.ValueKind == JsonValueKind.Number
            ? p.GetInt32() : null;
        if (theirs is null) return new BridgeError(e.Code, e.Message);
        var remedy = theirs > WireProtocol.Version
            ? "update Volt to the release that bridge belongs to"
            : "restart the IDE to load the updated bridge";
        return new BridgeError(e.Code,
            $"the bridge speaks wire protocol {theirs.Value.ToString(System.Globalization.CultureInfo.InvariantCulture)}, " +
            $"this volt speaks {WireProtocol.Version}: {remedy}. Nothing was done.");
    }

    /// <summary>The project snapshot. Pass the workspace's bound identity in <paramref name="req"/> so the bridge
    /// guards it IN the op (WRONG_PROJECT) like every other project-touching op; null asks without an identity —
    /// discovery, and callers that only want the shape back.</summary>
    public RefsResponse GetRefs(RefsRequest? req = null, Action<ProgressFrame>? onProgress = null)
    {
        RequireShape();
        return De<RefsResponse>(Call(Ops.Refs, req, Forward(onProgress)));
    }

    /// <summary>`fetch`, which is also how a first pull is taken — <c>init: true</c> asks for every item
    /// regardless of <c>knownItems</c>.
    ///
    /// <para>There used to be a separate <c>init</c> OP for that, and it was the same call with one difference:
    /// the host built its own <c>FetchRequest</c>, so an init could not carry <c>expectedPlatform</c>/
    /// <c>expectedProjectName</c> and was the one read on this wire with no identity guard. It also labelled its
    /// own progress frames <c>operation: "fetch"</c>, because underneath it was one.</para></summary>
    public FetchResponse FetchChanges(FetchRequest req, Action<ProgressFrame>? onProgress = null)
    {
        RequireShape();
        return De<FetchResponse>(Call(Ops.Fetch, req, Forward(onProgress)));
    }

    public PushResponse PushBatch(PushRequest req, Action<ProgressFrame>? onProgress = null)
    {
        RequireShape();
        return De<PushResponse>(Call(Ops.Push, req, Forward(onProgress)));
    }

    public BuildResponse Build(BuildRequest req, Action<ProgressFrame>? onProgress = null)
    {
        RequireShape();
        return De<BuildResponse>(Call(Ops.Build, req, Forward(onProgress)));
    }

    public GrepResponse Grep(GrepRequest req, Action<ProgressFrame>? onProgress = null)
    {
        RequireShape();
        return De<GrepResponse>(Call(Ops.Grep, req, Forward(onProgress)));
    }

    /// <summary>Every pipe call goes through here, so "the bridge is unreachable" is decided AT THE TRANSPORT
    /// and nowhere else.
    ///
    /// <para>`Program.Main` used to map `IOException`/`TimeoutException` to that verdict — around the ENTIRE
    /// dispatch, five layers above this. So a disk full while writing `src/`, a locked `ide-refs.json`, an
    /// unreadable config, a git index directory it could not delete: every one printed "bridge is not
    /// reachable — is the IDE bridge running?" and discarded the exception's own message, sending the user to
    /// restart an IDE that was working for a problem on their own disk.</para></summary>
    private JsonElement Call(string op, object? body = null, Action<JsonElement>? onProgress = null)
    {
        try { return _pipe.Call(op, body, onProgress); }
        catch (PipeCallException e) when (e.Code == BridgeErrorCodes.ProtocolMismatch) { throw ProtocolRefused(e); }
        catch (PipeAccessDeniedException e) { throw new BridgeError(BridgeError.AccessDeniedCode, e.Message); }
        catch (Exception e) when (e is IOException or TimeoutException)
        {
            throw new BridgeError(BridgeError.UnreachableCode,
                "bridge is not reachable — is the IDE bridge running? (start it from the Volt Connector) " +
                $"[{e.GetType().Name}: {e.Message}]");
        }
    }

    private Action<JsonElement>? Forward(Action<ProgressFrame>? onProgress) =>
        onProgress is null ? null : e => { var f = De<ProgressFrame>(e); if (f is not null) onProgress(f); };
}
