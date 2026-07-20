using System.Text.Json.Serialization;

namespace Volt.Engine.Wire;

/// <summary>One progress frame streamed on a long operation's own response (a leading run of frames before the
/// terminal result). <see cref="Total"/> is null for an indeterminate operation (a build), present with
/// <see cref="Done"/> when the total work is known up front (fetch item count, push op count).</summary>
public sealed class ProgressFrame
{
    [JsonPropertyName("operation")]
    public string Operation { get; set; } = "";

    [JsonPropertyName("done")]
    public int Done { get; set; }

    [JsonPropertyName("total")]
    public int? Total { get; set; }

    [JsonPropertyName("phase")]
    public string? Phase { get; set; }
}
