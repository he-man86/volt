using System.Text.Json;
using Volt.Cli.Core.Wire;
using Volt.Cli.Transport;

namespace Volt.Cli.Sync;

public sealed class BridgeError : Exception
{
    public string Code { get; }
    public BridgeError(string code, string message) : base(message) => Code = code;
}

/// <summary>
/// The bridge client — the CLI's view of the live IDE, over the NAMED PIPE, using Core's wire DTOs directly. C#
/// port of the original TypeScript implementation Two simplifications the unification enables: no zod schemas
/// (the DTOs ARE the contract) and no wire-version handshake (one definition, so no drift to guard against). The
/// one guard kept is <see cref="GuardEmptyItems"/> — never treat an empty item set as truth unless the IDE is
/// provably attached (a stale bridge returning empty would otherwise look like "the engineer deleted everything").
/// </summary>
public sealed class BridgeClient
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };
    private readonly PipeClient _pipe;

    public BridgeClient(string pipeName) => _pipe = new PipeClient(pipeName);
    public static BridgeClient ForVendor(string vendor) => new(PipeNames.ForVendor(vendor));

    private static T De<T>(JsonElement e) => JsonSerializer.Deserialize<T>(e.GetRawText(), Json)!;

    public HealthResponse GetHealth() => De<HealthResponse>(_pipe.Call("health"));

    public RefsResponse GetRefs(Action<ProgressFrame>? onProgress = null)
    {
        var refs = De<RefsResponse>(_pipe.Call("refs", onProgress: Forward(onProgress)));
        GuardEmptyItems(refs.Items.Count);
        return refs;
    }

    public FetchResponse FetchChanges(FetchRequest req, Action<ProgressFrame>? onProgress = null)
    {
        var resp = De<FetchResponse>(_pipe.Call("fetch", req, Forward(onProgress)));
        GuardEmptyItems(resp.Items.Count);
        return resp;
    }

    public FetchResponse Init(Action<ProgressFrame>? onProgress = null)
    {
        var resp = De<FetchResponse>(_pipe.Call("init", onProgress: Forward(onProgress)));
        GuardEmptyItems(resp.Items.Count);
        return resp;
    }

    public PushResponse PushBatch(PushRequest req, Action<ProgressFrame>? onProgress = null) =>
        De<PushResponse>(_pipe.Call("push", req, Forward(onProgress)));

    public BuildResponse Build(BuildRequest req, Action<ProgressFrame>? onProgress = null) =>
        De<BuildResponse>(_pipe.Call("build", req, Forward(onProgress)));

    private Action<JsonElement>? Forward(Action<ProgressFrame>? onProgress) =>
        onProgress is null ? null : e => { var f = De<ProgressFrame>(e); if (f is not null) onProgress(f); };

    private void GuardEmptyItems(int itemCount)
    {
        if (itemCount > 0) return;
        var connected = false;
        try { connected = GetHealth().Connected; } catch { /* unreachable → treat as not-connected */ }
        if (!connected)
            throw new BridgeError("PLC_DISCONNECTED",
                "bridge reported zero items and Volt could not confirm an IDE is attached — refusing to treat an empty project as truth (is the project open in the IDE?)");
    }
}
