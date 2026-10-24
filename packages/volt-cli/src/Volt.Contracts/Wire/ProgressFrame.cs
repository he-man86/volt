using System.Text.Json.Serialization;

namespace Volt.Contracts;

/// <summary>One progress frame streamed on a long operation's own response (a leading run of frames before the
/// terminal result). <see cref="Total"/> is null for an indeterminate operation (a build), present with
/// <see cref="Done"/> when the total work is known up front (fetch item count, push op count).</summary>
public sealed class ProgressFrame
{
    /// <summary>The op the frame is progress of — the request's <c>op</c>.</summary>
    [JsonPropertyName("operation")]
    public string Operation { get; set; } = "";

    /// <summary>How much of <see cref="Total"/> is done (applications while walking, items while reading or searching,
    /// ops while applying); 0 on a frame that only names its phase.</summary>
    [JsonPropertyName("done")]
    public int Done { get; set; }

    /// <summary>The amount of work, when known up front; absent = indeterminate (a build, a CODESYS walk).</summary>
    [JsonPropertyName("total")]
    public int? Total { get; set; }

    /// <summary>What the op is doing (<see cref="Phases"/>); a frame without one continues the phase before it.</summary>
    [JsonPropertyName("phase")]
    public string? Phase { get; set; }

    /// <summary>The phase of a read op's WALK frames (<c>refs</c>, <c>fetch</c>, <c>grep</c>): one per application as the
    /// walk finishes it, <see cref="Done"/> applications of <see cref="Total"/> (null where the vendor learns its
    /// applications as it walks). They come before the op's item frames and count applications, not items.</summary>
    public const string WalkingPhase = "walking";

    /// <summary>A read op's item frames (<c>refs</c>, <c>fetch</c>): <see cref="Done"/> items of <see cref="Total"/>.</summary>
    public const string ReadingPhase = "reading";

    /// <summary><c>grep</c>'s item frames: <see cref="Done"/> items of <see cref="Total"/>.</summary>
    public const string SearchingPhase = "searching";

    /// <summary><c>build</c>'s one frame: the compile is opaque, so it has no fraction.</summary>
    public const string BuildingPhase = "building";

    /// <summary><c>push</c>'s pre-apply walk and pre-flight: no fraction.</summary>
    public const string CheckingPhase = "checking";

    /// <summary><c>push</c>'s apply: <see cref="Done"/> ops of <see cref="Total"/>.</summary>
    public const string ApplyingPhase = "applying";

    /// <summary>Every phase a bridge states.</summary>
    public static readonly string[] Phases = { WalkingPhase, ReadingPhase, SearchingPhase, BuildingPhase, CheckingPhase, ApplyingPhase };

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
