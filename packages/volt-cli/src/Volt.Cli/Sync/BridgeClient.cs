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
    public RefsResponse GetRefs(RefsRequest? req = null, Action<ProgressFrame>? onProgress = null)
    {
        var refs = De<RefsResponse>(_pipe.Call(Ops.Refs, req, Forward(onProgress)));
        GuardEmptyItems(refs.Items.Count);
        return refs;
    }

    public FetchResponse FetchChanges(FetchRequest req, Action<ProgressFrame>? onProgress = null)
    {
        var resp = De<FetchResponse>(_pipe.Call(Ops.Fetch, req, Forward(onProgress)));
        GuardEmptyItems(resp.Items.Count);
        return resp;
    }

    public FetchResponse Init(Action<ProgressFrame>? onProgress = null)
    {
        var resp = De<FetchResponse>(_pipe.Call(Ops.Init, onProgress: Forward(onProgress)));
        GuardEmptyItems(resp.Items.Count);
        return resp;
    }

    public PushResponse PushBatch(PushRequest req, Action<ProgressFrame>? onProgress = null) =>
        De<PushResponse>(_pipe.Call(Ops.Push, req, Forward(onProgress)));

    public BuildResponse Build(BuildRequest req, Action<ProgressFrame>? onProgress = null) =>
        De<BuildResponse>(_pipe.Call(Ops.Build, req, Forward(onProgress)));

    private Action<JsonElement>? Forward(Action<ProgressFrame>? onProgress) =>
        onProgress is null ? null : e => { var f = De<ProgressFrame>(e); if (f is not null) onProgress(f); };

    private void GuardEmptyItems(int itemCount)
    {
        if (itemCount > 0) return;
        var connected = false;
        try { connected = GetHealth().Connected; } catch { /* unreachable → treat as not-connected */ }
        if (!connected)
            throw new BridgeError(BridgeErrorCodes.PlcDisconnected,
                "bridge reported zero items and Volt could not confirm an IDE is attached — refusing to treat an empty project as truth (is the project open in the IDE?)");
    }
}
