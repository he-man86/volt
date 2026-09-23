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

    public string Code { get; }
    public BridgeError(string code, string message) : base(message) => Code = code;
}

/// <summary>
/// The bridge client — the CLI's view of the live IDE, over the NAMED PIPE, using Core's wire DTOs directly.
/// Two simplifications the unification enables: no zod schemas
/// (the DTOs ARE the contract) and no wire-version handshake (one definition, so no drift to guard against).
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
