using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace VoltBridge.Core.Models;

public class HealthResponse
{
    [JsonPropertyName("status")]
    public string Status { get; set; } = "unavailable";

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

    [JsonPropertyName("degradedReason")]
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
