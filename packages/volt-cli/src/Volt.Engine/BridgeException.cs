using System;
using Volt.Contracts;

namespace Volt.Engine;

/// <summary>A bridge-side failure with a machine-readable <see cref="ErrorCode"/> the wire carries to the client
/// (<see cref="ICodedError"/> → <c>PipeServer</c> → <c>PipeError.code</c> → <c>PipeCallException.Code</c>). Codes
/// are stable strings — <see cref="BridgeErrorCodes"/> holds the set. (No HTTP status: named pipe, not HTTP.)</summary>
public class BridgeException : CodedException
{

    /// <summary>The bridge is PAUSED by a `disconnect` — a different situation from "no project is bound",
    /// with the same code because a client's handling is identical: it cannot sync until someone reconnects.
    ///
    /// <para>The text is the whole point. <see cref="PlcDisconnected"/>'s canned "Bridge is waiting for an IDE
    /// project" would tell a user who just pressed Disconnect in the tray to open a project that is already open.
    /// The CLI returns these messages verbatim, so this one names the remedy.</para></summary>
    public static BridgeException Paused() =>
        new(BridgeErrorCodes.PlcDisconnected,
            "the bridge is disconnected — press Reconnect in the Volt Connector (the IDE and its project are "
            + "still open; sync is paused until you do).");

    public BridgeException(string errorCode, string message, Exception? inner = null)
        : base(errorCode, message, inner) { }

    /// <summary>A refusal whose facts a client acts on: <paramref name="errorData"/> is the error frame's <c>data</c>.</summary>
    public BridgeException(string errorCode, string message, object errorData)
        : base(errorCode, message, errorData) { }

    /// <summary>The bridge is up but no IDE project is loaded — every project-touching op rejects with this until
    /// a project is attached. The tray's deliberate PAUSE shares the code and has its own text; see
    /// <see cref="Paused"/>.</summary>
    public static BridgeException PlcDisconnected(string? cause = null) =>
        new(BridgeErrorCodes.PlcDisconnected, cause ?? "Bridge is waiting for an IDE project");

    /// <summary>The bridge is serving a different project than the workspace is bound to — the op refuses rather
    /// than touch the wrong IDE. The client matches on the CODE alone (<c>Sync/Commands</c>); this text is what the
    /// user reads.</summary>
    public static BridgeException WrongProject(string? bridgePlatform, string? bridgeName, string? boundPlatform, string? boundName) =>
        new(BridgeErrorCodes.WrongProject,
            $"the bridge is serving {bridgePlatform}/{bridgeName}, but this workspace is bound to {boundPlatform}/{boundName} — open the bound project in the IDE (or Reconnect)");
}
