using System.Text.Json.Serialization;

namespace Volt.Contracts;

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

    // NEVER SET BY THE BRIDGE. A pipe client sees these null on every frame, always: the bridge serves one op
    // at a time and has no idea it is step 2 of a `volt pull`. They are filled in CLI-side by `PhaseProgress`,
    // which wraps the bridge's frames as a multi-step VERB runs (pull/init: fetch → write → finalize) so a
    // frontend can fold the per-phase fraction into one monotonic bar: (PhaseIndex + Done/Total) / PhaseCount.
    //
    // They live on the wire type because the CLI re-emits that type to ITS clients rather than defining a second
    // one. Anyone reading this as a bridge contract will wait for a value that never arrives.
    [JsonPropertyName("phaseIndex")]
    public int? PhaseIndex { get; set; }

    [JsonPropertyName("phaseCount")]
    public int? PhaseCount { get; set; }
}
