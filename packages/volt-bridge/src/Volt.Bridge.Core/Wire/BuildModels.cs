using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Volt.Bridge.Core.Wire;

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
