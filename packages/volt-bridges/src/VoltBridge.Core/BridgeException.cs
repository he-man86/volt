using System;
using System.Text.RegularExpressions;

namespace VoltBridge.Core;

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
}
