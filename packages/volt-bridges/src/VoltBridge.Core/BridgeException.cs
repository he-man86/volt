using System;
using System.Text.RegularExpressions;

namespace VoltBridge.Core;

public class BridgeException : Exception
{
    public int StatusCode { get; }
    public string ErrorCode { get; }

    public BridgeException(int statusCode, string errorCode, string message)
        : base(message)
    {
        StatusCode = statusCode;
        ErrorCode = errorCode;
    }
}
