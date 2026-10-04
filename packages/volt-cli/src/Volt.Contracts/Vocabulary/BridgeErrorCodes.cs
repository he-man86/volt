namespace Volt.Contracts;

/// <summary>The <see cref="ICodedError.ErrorCode"/> values that travel on the wire — defined once, here in the
/// transport layer beside <see cref="ICodedError"/> so every layer shares them: the Engine's <c>BridgeException</c>
/// raises them, <c>PipeServer</c> falls back to <see cref="InternalError"/>, and the CLI client matches them. They
/// are plain strings (no enum — nothing branches on them in logic; a client that wants to react matches the
/// string).</summary>
public static class BridgeErrorCodes
{
    public const string PlcDisconnected = "PLC_DISCONNECTED";
    public const string WrongProject = "WRONG_PROJECT";
    public const string NoSidecar = "NO_SIDECAR";
    /// <summary>A POST-CONDITION of the apply: the IDE no longer holds what Volt just wrote or read — a member it
    /// created and cannot find again, a node it moved that is not where the move put it, a task the IDE acknowledged
    /// and does not list. Never "the request names nothing": that is <see cref="ConflictCodes.ItemMissing"/>, answered
    /// by the gate before anything is written. Raised only during a push, so it reaches a client as a conflict, and
    /// since <c>push-keeps-what-landed</c> the earlier ops are written. Remedy: <c>volt pull</c> to see what landed,
    /// then push again. It was <c>NOT_FOUND</c>, a name a client could not tell from <c>ITEM_MISSING</c>
    /// (openspec <c>bridge-refusal-review</c> 7.2).</summary>
    public const string IdeLostItem = "IDE_LOST_ITEM";
    public const string BadRequest = "BAD_REQUEST";
    public const string Unsupported = "UNSUPPORTED";
    public const string DuplicateChild = "DUPLICATE_CHILD";
    public const string InvalidSt = "INVALID_ST";

    /// <summary>The item exists in the IDE and its body could not be READ — so it has no version a client can
    /// ever quote, and no content to compare against. Reaches a client as a push CONFLICT (the push refuses
    /// rather than landing a create on top of it) and names the same items the responses' `unreadable` list
    /// does. Without it that refusal said "expected to create new item but it already exists" and quoted a
    /// sentinel version no `refs` hands out, so no `ifVersion` could ever satisfy it.</summary>
    public const string Unreadable = "UNREADABLE";

    /// <summary>The IDE this bridge runs in lacks something the bridge needs, so it serves nothing: every op but
    /// <c>health</c> answers with this code, and the message is a fixed English sentence naming the IDE's platform
    /// version and what it lacks (never an OS-localized exception text). <c>health</c> carries the same sentence as
    /// <c>unsupported</c>. Do not retry — the IDE has to change, not the call. A NEW code on purpose: a client maps by
    /// code, and an old code would be read as its old meaning (openspec <c>codesys-minimum-version</c>).</summary>
    public const string IdeUnsupported = "IDE_UNSUPPORTED";

    /// <summary>The catch-all <c>PipeServer</c> assigns to any exception that isn't an <see cref="ICodedError"/>.</summary>
    public const string InternalError = "INTERNAL_ERROR";
}
