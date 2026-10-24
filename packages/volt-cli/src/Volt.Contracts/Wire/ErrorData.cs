using System.Text.Json.Serialization;

namespace Volt.Contracts;

/// <summary><c>error.data</c> of <see cref="BridgeErrorCodes.ProtocolMismatch"/>: the protocol the bridge speaks. The
/// request's own number is the one the client sent (absent when it sent none), so it is not repeated.</summary>
public sealed class ProtocolMismatchData
{
    [JsonPropertyName("bridgeProtocol")]
    public int BridgeProtocol { get; set; }
}

/// <summary><c>error.data</c> of <see cref="BridgeErrorCodes.StaleProjectVersion"/>: the project version the IDE holds
/// now — what a fresh <c>refs</c> answers as <c>projectVersion</c>.</summary>
public sealed class StaleProjectVersionData
{
    [JsonPropertyName("currentProjectVersion")]
    public string CurrentProjectVersion { get; set; } = "";
}
