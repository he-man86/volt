using System;
using Volt.Cli.Transport;

namespace Volt.Engine;

/// <summary>A bridge-side failure with a machine-readable <see cref="ErrorCode"/> the wire carries to the client
/// (<see cref="ICodedError"/> → <c>PipeServer</c> → <c>PipeError.code</c> → <c>PipeCallException.Code</c>). Codes
/// are stable strings — <see cref="BridgeErrorCodes"/> holds the set. (No HTTP status: named pipe, not HTTP.)</summary>
public class BridgeException : Exception, ICodedError
{
    public string ErrorCode { get; }

    public BridgeException(string errorCode, string message, Exception? inner = null)
        : base(message, inner)
    {
        ErrorCode = errorCode;
    }

    /// <summary>The bridge is up but no IDE project is loaded — every project-touching op rejects with this until
    /// a project is attached.</summary>
    public static BridgeException PlcDisconnected() =>
        new(BridgeErrorCodes.PlcDisconnected, "Bridge is waiting for an IDE project");

    /// <summary>The bridge is serving a different project than the workspace is bound to — the op refuses rather
    /// than touch the wrong IDE. Mirrors the wording the client's old pre-op binding check used.</summary>
    public static BridgeException WrongProject(string? bridgePlatform, string? bridgeName, string? boundPlatform, string? boundName) =>
        new(BridgeErrorCodes.WrongProject,
            $"the bridge is serving {bridgePlatform}/{bridgeName}, but this workspace is bound to {boundPlatform}/{boundName} — open the bound project in the IDE (or Reconnect)");
}
