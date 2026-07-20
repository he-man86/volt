using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Volt.Engine.Wire;

public class BuildRequest
{
    [JsonPropertyName("buildType")]
    public string BuildType { get; set; } = "incremental";

    /// <summary>The project this workspace is bound to. The op refuses (WRONG_PROJECT) unless the live bridge is
    /// serving it — so `volt build` reports diagnostics for the bound project, not whatever happens to be open.
    /// Null = no identity check (older client).</summary>
    [JsonPropertyName("expectedPlatform")]
    public string? ExpectedPlatform { get; set; }

    [JsonPropertyName("expectedProjectName")]
    public string? ExpectedProjectName { get; set; }
}

public class BridgeDiagnostic
{
    [JsonPropertyName("severity")]
    public string Severity { get; set; } = "info";

    [JsonPropertyName("message")]
    public string Message { get; set; } = "";

    [JsonPropertyName("line")]
    public int Line { get; set; }

    [JsonPropertyName("column")]
    public int Column { get; set; }
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
