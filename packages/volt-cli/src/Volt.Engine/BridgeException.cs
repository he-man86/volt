using System;
using Volt.Contracts;

namespace Volt.Engine;

/// <summary>A bridge-side failure with a machine-readable <see cref="ErrorCode"/> the wire carries to the client
/// (<see cref="ICodedError"/> → <c>PipeServer</c> → <c>PipeError.code</c> → <c>PipeCallException.Code</c>). Codes
/// are stable strings — <see cref="BridgeErrorCodes"/> holds the set. (No HTTP status: named pipe, not HTTP.)</summary>
public class BridgeException : Exception, ICodedError
{
    public string ErrorCode { get; }

    /// <summary>The bridge is PAUSED by a `disconnect` — a different situation from "no project is bound",
    /// with the same code because a client's handling is identical: it cannot sync until someone reconnects.
    ///
    /// <para>The text is the whole point. The pause gate used to answer with <see cref="PlcDisconnected"/>'s
    /// canned "Bridge is waiting for an IDE project", so a user who had just pressed Disconnect in the tray
    /// ran `volt pull` and was told to open a project that was already open. The CLI returns these messages
    /// verbatim, and the remedy appeared nowhere in them.</para></summary>
    public static BridgeException Paused() =>
        new(BridgeErrorCodes.PlcDisconnected,
            "the bridge is disconnected — press Reconnect in the Volt Connector (the IDE and its project are "
            + "still open; sync is paused until you do).");

    public BridgeException(string errorCode, string message, Exception? inner = null)
        : base(message, inner)
    {
        ErrorCode = errorCode;
    }

    /// <summary>The bridge is up but no IDE project is loaded — every project-touching op rejects with this until
    /// a project is attached.
    /// <para>NB the code has a SECOND meaning today: <c>Wire/BridgePipeHost</c> also raises it for the tray's
    /// deliberate pause gate, where nothing is "waiting for an IDE project" — so this canned message is wrong at
    /// that call site (and a third message is built inline there). ARCH FOLLOW-UP: give the pause gate its own
    /// factory with the same code; the message text is on the wire, so that is user-visible, not cosmetic.</para></summary>
    public static BridgeException PlcDisconnected() =>
        new(BridgeErrorCodes.PlcDisconnected, "Bridge is waiting for an IDE project");

    /// <summary>The bridge is serving a different project than the workspace is bound to — the op refuses rather
    /// than touch the wrong IDE. The client matches on the CODE alone (<c>Sync/Commands</c>); this text is what the
    /// user reads.</summary>
    public static BridgeException WrongProject(string? bridgePlatform, string? bridgeName, string? boundPlatform, string? boundName) =>
        new(BridgeErrorCodes.WrongProject,
            $"the bridge is serving {bridgePlatform}/{bridgeName}, but this workspace is bound to {boundPlatform}/{boundName} — open the bound project in the IDE (or Reconnect)");
}
