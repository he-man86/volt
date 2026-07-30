using System.Text.Json;
using System.Text.Json.Serialization;

namespace Volt.Cli.Transport;

/// <summary>The ONE encoding of the pipe wire — camelCase field names, nulls omitted (so each frame serializes to a
/// single key). Both directions share it (<see cref="PipeServer"/> and <see cref="PipeClient"/>), so the bytes one
/// end writes can't drift from what the other end expects.</summary>
internal static class PipeJson
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };
}

/// <summary>A request on the pipe wire: an op name (see <see cref="Ops"/>) + an optional raw JSON body the host
/// deserializes to the matching DTO — one framed line (newline-delimited JSON).</summary>
public sealed class PipeRequest
{
    [JsonPropertyName("op")] public string Op { get; set; } = "";
    [JsonPropertyName("body")] public JsonElement? Body { get; set; }
}

/// <summary>One response frame: exactly one of <c>progress</c> (zero or more), then a terminal <c>result</c> or
/// <c>error</c>. Omit-when-null means each serialized frame carries a single key — a newline-delimited JSON stream
/// over the pipe.</summary>
internal sealed class PipeFrame
{
    [JsonPropertyName("progress")] public object? Progress { get; set; }
    [JsonPropertyName("result")] public object? Result { get; set; }
    [JsonPropertyName("error")] public PipeError? Error { get; set; }
}

internal sealed class PipeError
{
    [JsonPropertyName("code")] public string Code { get; set; } = "";
    [JsonPropertyName("message")] public string Message { get; set; } = "";
}

/// <summary>Thrown by <see cref="PipeClient"/> when the server returns a terminal <c>error</c> frame.</summary>
public sealed class PipeCallException : System.Exception
{
    public string Code { get; }
    public PipeCallException(string code, string message) : base(message) => Code = code;
}

/// <summary>An exception that carries a machine-readable code onto the wire. Transport is the lower layer (it
/// can't see the Engine's <c>BridgeException</c>), so <see cref="PipeServer"/> reads the code through this seam —
/// the Engine's exception implements it. Anything else stays a generic <c>INTERNAL_ERROR</c>.</summary>
public interface ICodedError
{
    string ErrorCode { get; }
}
