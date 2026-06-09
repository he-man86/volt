using System.Text.Json.Serialization;

namespace VoltBridge.Core.Errors;

public class BridgeError
{
    [JsonPropertyName("code")]
    public string Code { get; set; } = "";

    [JsonPropertyName("message")]
    public string Message { get; set; } = "";

    [JsonIgnore]
    public int StatusCode { get; set; } = 500;

    public BridgeError() { }

    public BridgeError(string code, string message, int statusCode = 500)
    {
        Code = code;
        Message = message;
        StatusCode = statusCode;
    }
}

public class ErrorResponse
{
    [JsonPropertyName("error")]
    public BridgeError Error { get; set; } = new();

    public ErrorResponse() { }

    public ErrorResponse(string code, string message)
    {
        Error = new BridgeError(code, message);
    }

    public static ErrorResponse NotFound(string name) =>
        new("NOT_FOUND", $"Item '{name}' not found");

    public static ErrorResponse BadRequest(string reason) =>
        new("BAD_REQUEST", reason);

    public static ErrorResponse AlreadyExists(string name) =>
        new("ALREADY_EXISTS", $"Item '{name}' already exists");

    public static ErrorResponse PlcDisconnected() =>
        new("PLC_DISCONNECTED", "Bridge is waiting for an IDE project");

    public static ErrorResponse PlcDegraded(string reason) =>
        new("PLC_DEGRADED", reason);

    public static ErrorResponse PlcUiUnavailable(string reason) =>
        new("PLC_UI_UNAVAILABLE", reason);

    public static ErrorResponse InternalError(string reason) =>
        new("INTERNAL_ERROR", reason);

    public static BridgeException PlcDisconnectedException() =>
        new BridgeException(503, "PLC_DISCONNECTED", "Bridge is waiting for an IDE project");
}
