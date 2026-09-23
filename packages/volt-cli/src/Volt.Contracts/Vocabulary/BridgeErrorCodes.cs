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
    public const string NotFound = "NOT_FOUND";
    public const string BadRequest = "BAD_REQUEST";
    public const string Unsupported = "UNSUPPORTED";
    public const string DuplicateChild = "DUPLICATE_CHILD";
    public const string InvalidCodeHeader = "INVALID_CODE_HEADER";
    public const string InvalidSt = "INVALID_ST";

    /// <summary>The item exists in the IDE and its body could not be READ — so it has no version a client can
    /// ever quote, and no content to compare against. Reaches a client as a push CONFLICT (the push refuses
    /// rather than landing a create on top of it) and names the same items the responses' `unreadable` list
    /// does. Without it that refusal said "expected to create new item but it already exists" and quoted a
    /// sentinel version no `refs` hands out, so no `ifVersion` could ever satisfy it.</summary>
    public const string Unreadable = "UNREADABLE";

    /// <summary>The catch-all <c>PipeServer</c> assigns to any exception that isn't an <see cref="ICodedError"/>.</summary>
    public const string InternalError = "INTERNAL_ERROR";
}
