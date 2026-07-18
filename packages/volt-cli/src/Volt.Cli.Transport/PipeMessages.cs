using System.Text.Json;
using System.Text.Json.Serialization;

namespace Volt.Cli.Transport;

/// <summary>A request on the pipe wire: an op name (<c>health|refs|fetch|init|push|build</c>) + an optional raw
/// JSON body the host deserializes to the matching DTO. This collapses the old HTTP method+path+body to one
/// framed line — the wire is otherwise identical (newline-delimited JSON frames).</summary>
public sealed class PipeRequest
{
    [JsonPropertyName("op")] public string Op { get; set; } = "";
    [JsonPropertyName("body")] public JsonElement? Body { get; set; }
}

/// <summary>One response frame: exactly one of <c>progress</c> (zero or more), then a terminal <c>result</c> or
/// <c>error</c>. Omit-when-null means each serialized frame carries a single key — same shape the HTTP NDJSON
/// stream used, so clients port over unchanged.</summary>
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
