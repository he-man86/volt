using System.Text.Json;
using Volt.Wire;
using Volt.Contracts;

namespace Volt.Cli.Sync;

public sealed class BridgeError : Exception
{
    public string Code { get; }
    public BridgeError(string code, string message) : base(message) => Code = code;
}

/// <summary>
/// The bridge client — the CLI's view of the live IDE, over the NAMED PIPE, using Core's wire DTOs directly.
/// Two simplifications the unification enables: no zod schemas
/// (the DTOs ARE the contract) and no wire-version handshake (one definition, so no drift to guard against). The
/// one guard kept is <see cref="GuardEmptyItems"/> — never treat an empty item set as truth unless the IDE is
/// provably attached (a stale bridge returning empty would otherwise look like "the engineer deleted everything").
/// </summary>
public sealed class BridgeClient
{

    private readonly PipeClient _pipe;

    public BridgeClient(string pipeName) => _pipe = new PipeClient(pipeName);

    private static T De<T>(JsonElement e) => JsonSerializer.Deserialize<T>(e.GetRawText(), WireJson.Read)!;

    public HealthResponse GetHealth() => De<HealthResponse>(_pipe.Call(Ops.Health));

    /// <summary>The project snapshot. Pass the workspace's bound identity in <paramref name="req"/> so the bridge
    /// guards it IN the op (WRONG_PROJECT) like every other project-touching op; null asks without an identity —
    /// discovery, and callers that only want the shape back.</summary>
    public RefsResponse GetRefs(RefsRequest? req = null, Action<ProgressFrame>? onProgress = null) =>
        De<RefsResponse>(_pipe.Call(Ops.Refs, req, Forward(onProgress)));

    /// <summary>`fetch`, which is also how a first pull is taken — <c>init: true</c> asks for every item
    /// regardless of <c>knownItems</c>.
    ///
    /// <para>There used to be a separate <c>init</c> OP for that, and it was the same call with one difference:
    /// the host built its own <c>FetchRequest</c>, so an init could not carry <c>expectedPlatform</c>/
    /// <c>expectedProjectName</c> and was the one read on this wire with no identity guard. It also labelled its
    /// own progress frames <c>operation: "fetch"</c>, because underneath it was one.</para></summary>
    public FetchResponse FetchChanges(FetchRequest req, Action<ProgressFrame>? onProgress = null) =>
        De<FetchResponse>(_pipe.Call(Ops.Fetch, req, Forward(onProgress)));

    public PushResponse PushBatch(PushRequest req, Action<ProgressFrame>? onProgress = null) =>
        De<PushResponse>(_pipe.Call(Ops.Push, req, Forward(onProgress)));

    public BuildResponse Build(BuildRequest req, Action<ProgressFrame>? onProgress = null) =>
        De<BuildResponse>(_pipe.Call(Ops.Build, req, Forward(onProgress)));

    private Action<JsonElement>? Forward(Action<ProgressFrame>? onProgress) =>
        onProgress is null ? null : e => { var f = De<ProgressFrame>(e); if (f is not null) onProgress(f); };
}
