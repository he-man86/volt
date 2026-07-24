using System.Collections.Generic;
using System.Text.Json.Serialization;

using Volt.Cli.Transport;

namespace Volt.Engine.Wire;

public class HealthResponse
{
    [JsonPropertyName("status")]
    public string Status { get; set; } = HealthStatus.Unavailable;

    [JsonPropertyName("platform")]
    public string Platform { get; set; } = "";

    [JsonPropertyName("platformVariant")]
    public string? PlatformVariant { get; set; }

    [JsonPropertyName("connected")]
    public bool Connected { get; set; }

    [JsonPropertyName("ideAlive")]
    public bool IdeAlive { get; set; }

    [JsonPropertyName("degraded")]
    public bool Degraded { get; set; }

    // Contract-required + nullable (openapi): must always be present (null when not
    // degraded), so override the server's global WhenWritingNull omission.
    [JsonPropertyName("degradedReason")]
    [JsonIgnore(Condition = JsonIgnoreCondition.Never)]
    public string? DegradedReason { get; set; }

    [JsonPropertyName("ideName")]
    public string? IdeName { get; set; }

    [JsonPropertyName("ideVersion")]
    public string? IdeVersion { get; set; }

    [JsonPropertyName("version")]
    public string Version { get; set; } = "";

    [JsonPropertyName("projectName")]
    public string? ProjectName { get; set; }

    [JsonPropertyName("projectDirty")]
    public bool? ProjectDirty { get; set; }

    // The mutating op currently running on the (single-threaded) IDE thread — "init"/"fetch"/"push"/"build" —
    // or null/absent when idle. The bridge is the ONE thing every frontend shares, so this is how a second
    // frontend (or a terminal `volt init`) learns a mutation is in flight and stops issuing `/refs` into a busy
    // bridge whose project is being churned. Additive + omitted-when-null: an older client just ignores it.
    [JsonPropertyName("activeOp")]
    public string? ActiveOp { get; set; }
}
