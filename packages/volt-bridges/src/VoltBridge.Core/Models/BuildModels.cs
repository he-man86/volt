using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace VoltBridge.Core.Models;

public class BuildRequest
{
    [JsonPropertyName("buildType")]
    public string BuildType { get; set; } = "incremental";
}

public class BridgeDiagnostic
{
    [JsonPropertyName("severity")]
    public string Severity { get; set; } = "info";

    [JsonPropertyName("message")]
    public string Message { get; set; } = "";

    [JsonPropertyName("line")]
    public int Line { get; set; }

    [JsonPropertyName("object")]
    public string? Object { get; set; }

    [JsonPropertyName("section")]
    public string? Section { get; set; }
}

public class BuildResponse
{
    [JsonPropertyName("success")]
    public bool Success { get; set; }

    [JsonPropertyName("duration")]
    public double Duration { get; set; }

    [JsonPropertyName("diagnostics")]
    public List<BridgeDiagnostic> Diagnostics { get; set; } = new();
}
