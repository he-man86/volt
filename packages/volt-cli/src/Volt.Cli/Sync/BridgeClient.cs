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
    public const string AccessDeniedCode = "BRIDGE_ACCESS_DENIED";

    /// <summary>The bridge speaks another wire protocol (<see cref="WireProtocol"/>) — its <c>health.protocol</c> is not
    /// this CLI's, or absent. CLI-local, like <see cref="UnreachableCode"/>; the message names both numbers and the
    /// remedy (openspec relay-protocol-tracks-wire-breaks).</summary>
    public const string ProtocolCode = "BRIDGE_PROTOCOL";

    public string Code { get; }
    public BridgeError(string code, string message) : base(message) => Code = code;
}

/// <summary>
/// The bridge client — the CLI's view of the live IDE, over the NAMED PIPE, using Core's wire DTOs directly.
/// No zod schemas: the DTOs ARE the contract.
///
/// <para><b>One protocol check, before the first op.</b> The DTOs are one definition only within one release: an update
/// made while CODESYS is open leaves the previous bridge loaded in-proc, and an older bridge does not refuse the newer
/// wire, it misreads it (a path-keyed baseline read as removed items, and the pull deletes files). So the first
/// <c>refs</c>/<c>fetch</c>/<c>push</c>/<c>build</c> of a process reads <c>health</c> once and refuses a bridge whose
/// <c>protocol</c> is not <see cref="WireProtocol.Version"/> — no op is sent to it. <c>health</c> itself is not refused:
/// it is the probe, and it is how the engineer sees which bridge is there.</para>
///
/// <para>IT GUARDS NOTHING. There used to be a `GuardEmptyItems` here that re-probed the CACHED health snapshot
/// after a SUCCESSFUL refs or fetch and refused when it showed nothing serving — the staler of two signals
/// overriding the op's own live guard, and unable to tell an empty project from a walk that skipped a subtree
/// either way. That case is closed at the line that creates it: `WalkResult.UnwalkedFolders`.</para>
/// </summary>
public sealed class BridgeClient
{

    private readonly PipeClient _pipe;

    public BridgeClient(string pipeName) => _pipe = new PipeClient(pipeName);

    private static T De<T>(JsonElement e) => JsonSerializer.Deserialize<T>(e.GetRawText(), WireJson.Read)!;

    public HealthResponse GetHealth() => De<HealthResponse>(Call(Ops.Health));

    private bool _protocolChecked;

    /// <summary>Refuse a bridge of another wire protocol, once per client, before its first op. The remedy follows the
    /// comparison: an older bridge (or one from before the number) is the previous release still loaded — restart the
    /// IDE; a newer one means this CLI is the old peer — update Volt.</summary>
    private void RequireOurProtocol()
    {
        if (_protocolChecked) return;
        var theirs = GetHealth().Protocol;
        if (theirs != WireProtocol.Version)
        {
            var named = theirs?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "none";
            var remedy = theirs is { } n && n > WireProtocol.Version
                ? "update Volt to the release that bridge belongs to"
                : "restart the IDE to load the updated bridge";
            throw new BridgeError(BridgeError.ProtocolCode,
                $"the bridge speaks wire protocol {named}, this volt speaks {WireProtocol.Version}: {remedy}. Nothing was sent to it.");
        }
        _protocolChecked = true;
    }

    /// <summary>The project snapshot. Pass the workspace's bound identity in <paramref name="req"/> so the bridge
    /// guards it IN the op (WRONG_PROJECT) like every other project-touching op; null asks without an identity —
    /// discovery, and callers that only want the shape back.</summary>
    public RefsResponse GetRefs(RefsRequest? req = null, Action<ProgressFrame>? onProgress = null) =>
        De<RefsResponse>(Call(Ops.Refs, req, Forward(onProgress)));

    /// <summary>`fetch`, which is also how a first pull is taken — <c>init: true</c> asks for every item
    /// regardless of <c>knownItems</c>.
    ///
    /// <para>There used to be a separate <c>init</c> OP for that, and it was the same call with one difference:
    /// the host built its own <c>FetchRequest</c>, so an init could not carry <c>expectedPlatform</c>/
    /// <c>expectedProjectName</c> and was the one read on this wire with no identity guard. It also labelled its
    /// own progress frames <c>operation: "fetch"</c>, because underneath it was one.</para></summary>
    public FetchResponse FetchChanges(FetchRequest req, Action<ProgressFrame>? onProgress = null) =>
        De<FetchResponse>(Call(Ops.Fetch, req, Forward(onProgress)));

    public PushResponse PushBatch(PushRequest req, Action<ProgressFrame>? onProgress = null) =>
        De<PushResponse>(Call(Ops.Push, req, Forward(onProgress)));

    public BuildResponse Build(BuildRequest req, Action<ProgressFrame>? onProgress = null) =>
        De<BuildResponse>(Call(Ops.Build, req, Forward(onProgress)));

    public GrepResponse Grep(GrepRequest req, Action<ProgressFrame>? onProgress = null) =>
        De<GrepResponse>(Call(Ops.Grep, req, Forward(onProgress)));

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
        if (op != Ops.Health) RequireOurProtocol();
        try { return _pipe.Call(op, body, onProgress); }
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
