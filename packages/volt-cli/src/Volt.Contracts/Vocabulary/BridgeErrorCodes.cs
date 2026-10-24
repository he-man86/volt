namespace Volt.Contracts;

/// <summary>The <see cref="ICodedError.ErrorCode"/> values that travel on the wire — defined once, here in the
/// transport layer beside <see cref="ICodedError"/> so every layer shares them: the Engine's <c>BridgeException</c>
/// raises them, <c>PipeServer</c> falls back to <see cref="InternalError"/>, and the CLI client matches them. They
/// are plain strings (no enum — nothing branches on them in logic; a client that wants to react matches the
/// string).</summary>
public static class BridgeErrorCodes
{
    /// <summary>The request states no <c>protocol</c>, or one this bridge does not speak: refused before its body is
    /// read, nothing done. <c>error.data.bridgeProtocol</c> (<see cref="ProtocolMismatchData"/>) is the number this
    /// bridge speaks. Remedy: the client and the bridge are of two releases — update the older one (an IDE that loaded the
    /// previous bridge is restarted).</summary>
    public const string ProtocolMismatch = "PROTOCOL_MISMATCH";

    /// <summary>A push's LEASE is stale: the project moved between the read that produced <c>expectedProjectVersion</c>
    /// and this push. Nothing was applied. An error frame, never a conflict — the lease is the request's, not an op's;
    /// <c>error.data.currentProjectVersion</c> (<see cref="StaleProjectVersionData"/>) is the version the IDE holds.
    /// Remedy: pull, then push again.</summary>
    public const string StaleProjectVersion = "STALE_PROJECT_VERSION";

    public const string PlcDisconnected = "PLC_DISCONNECTED";
    public const string WrongProject = "WRONG_PROJECT";
    /// <summary>A POST-CONDITION of the apply: the IDE no longer holds what Volt just wrote or read — a member it
    /// created and cannot find again, a node it moved that is not where the move put it, a task the IDE acknowledged
    /// and does not list. Never "the request names nothing": that is <see cref="ConflictCodes.ItemMissing"/>, answered
    /// by the gate before anything is written. Raised only during a push, so it reaches a client as a conflict, and
    /// since <c>push-keeps-what-landed</c> the earlier ops are written. Remedy: <c>volt pull</c> to see what landed,
    /// then push again (openspec <c>bridge-refusal-review</c> 7.2).</summary>
    public const string IdeLostItem = "IDE_LOST_ITEM";
    /// <summary>The request breaks the wire's OWN rules — a frame that is no JSON, an unknown op, a body that does not
    /// deserialize, a push op the engine cannot route, a malformed <c>.task</c>, a write of a read-only descriptor, a
    /// move of an item that is no source item, a <c>fetch</c> with no baseline. Remedy:
    /// change the REQUEST. One situation, whichever phase meets it (openspec <c>bridge-refusal-review</c> V.1, V.3).</summary>
    public const string BadRequest = "BAD_REQUEST";
    /// <summary>The IDE, or a documented Volt limit on a vendor shape, will not take what was sent — a shape the vendor
    /// cannot write, a create the IDE refused, a setting the vendor has no counterpart for, a body Volt's lowering has
    /// no spelling for. Remedy: change the TEXT (or do it in the IDE). Never Volt's own rule about a request
    /// (<see cref="BadRequest"/>) and never a Volt bug (<see cref="InternalError"/>).</summary>
    public const string Unsupported = "UNSUPPORTED";
    public const string DuplicateChild = "DUPLICATE_CHILD";
    public const string InvalidSt = "INVALID_ST";

    /// <summary>The item exists in the IDE and its body could not be READ — so it has no version a client can
    /// ever quote, and no content to compare against. Reaches a client as a push CONFLICT (the push refuses
    /// rather than landing a create on top of it) and names the same items the responses' `unreadable` list
    /// does. Without it that refusal said "expected to create new item but it already exists" and quoted a
    /// sentinel version no `refs` hands out, so no `ifVersion` could ever satisfy it.
    /// Remedy: fix it in the IDE, or push with force to overwrite it — except an item the IDE does not return at all
    /// (a member it holds no declaration for), which no update can write in place, forced or not: the refusal then names
    /// the way that works, a delete and then a create, in two pushes (review of <c>bridge-refusal-review</c> step V).</summary>
    public const string Unreadable = "UNREADABLE";

    /// <summary>The IDE this bridge runs in lacks something the bridge needs. Needed for everything, the bridge serves
    /// nothing: every op but <c>health</c> answers with this code, and the message is a fixed English sentence naming the
    /// IDE's platform version and what it lacks (never an OS-localized exception text); <c>health</c> carries the same
    /// sentence as <c>unsupported</c> (openspec <c>codesys-minimum-version</c>). Needed by one call — a type, member or
    /// overload of the IDE's object model this version does not have — that call answers it, as a frame, a push conflict
    /// or an unreadable entry's code, naming what is missing (openspec <c>wire-final-shape</c> step 3c). Do not retry —
    /// the IDE has to change, not the call.</summary>
    public const string IdeUnsupported = "IDE_UNSUPPORTED";

    /// <summary>A <c>push</c> or <c>build</c> arrived while another push or build held the IDE: refused at once, nothing
    /// applied and nothing compiled. One non-waiting gate in the shared host, so both vendors answer it alike — before it,
    /// CODESYS ran the second op NESTED inside the running build (its build pumps the primary thread) and TwinCAT queued
    /// it. Reads and <c>health</c> are not gated. Remedy: wait for the running op, then try once (openspec
    /// <c>codesys-build-nesting</c>).</summary>
    public const string IdeBusy = "IDE_BUSY";

    /// <summary>A Volt bug, and nothing else: Volt's OWN broken invariant (<see cref="VoltInvariantException"/> — a state
    /// Volt's code guarantees cannot happen), or a foreign exception (COM, the vendor's .NET API) that reached
    /// <c>PipeServer</c> or the push's <c>ConflictFor</c> uncaught — Volt did not classify an IDE call. Every throw in Volt
    /// states its own code (openspec <c>wire-final-shape</c> step 3c). An IDE
    /// state is never this — an unreadable folder is <c>ITEM_UNVERIFIED</c>, an IDE refusal <see cref="Unsupported"/>,
    /// a post-condition the IDE broke <see cref="IdeLostItem"/>. Remedy: report a bug; the fix for an uncoded refusal
    /// is to code it, not to widen the fallback (openspec <c>bridge-refusal-review</c> V.1).</summary>
    public const string InternalError = "INTERNAL_ERROR";
}
