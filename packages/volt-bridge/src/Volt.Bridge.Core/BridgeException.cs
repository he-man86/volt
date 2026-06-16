using System;
using System.Text.RegularExpressions;

namespace Volt.Bridge.Core;

public class BridgeException : Exception
{
    public int StatusCode { get; }
    public string ErrorCode { get; }
    public Exception? Cause { get; }

    public BridgeException(int statusCode, string errorCode, string message, Exception? cause = null)
        : base(message, cause)
    {
        StatusCode = statusCode;
        ErrorCode = errorCode;
        Cause = cause;
    }

    /// <summary>The bridge is up but no IDE project is loaded yet — every project-touching
    /// endpoint rejects with this until a project is attached.</summary>
    public static BridgeException PlcDisconnected() =>
        new(503, "PLC_DISCONNECTED", "Bridge is waiting for an IDE project");
}
