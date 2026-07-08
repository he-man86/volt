using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Volt.Bridge.Core.Wire;

/// <summary>The HTTP wire-contract version. Bump <see cref="Version"/> ONLY on an incompatible wire change,
/// and bump the TS `WIRE_VERSION` in `volt-git/src/bridge/types.ts` to the SAME number — the two are kept in
/// lockstep by `volt-scripts/check-volt-integration.ts`. This is distinct from the human-readable app version
/// string on <see cref="HealthResponse.Version"/>.</summary>
public static class WireProtocol
{
    public const int Version = 1;
}

public class HealthResponse
{
    [JsonPropertyName("status")]
    public string Status { get; set; } = "unavailable";

    // The wire-contract version (see WireProtocol). A client refuses to interpret a bridge whose wireVersion
    // it does not recognize, turning silent shape-drift into one actionable error.
    [JsonPropertyName("wireVersion")]
    public int WireVersion { get; set; } = WireProtocol.Version;

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

    [JsonPropertyName("plcProjectName")]
    public string? PlcProjectName { get; set; }

    [JsonPropertyName("projectDirty")]
    public bool? ProjectDirty { get; set; }
}
