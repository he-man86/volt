using System.Text.Json.Serialization;

namespace Volt.Contracts;

/// <summary>The <c>connect</c> request: which project the connector picked, by NAME. May be null (a soft/refresh
/// select); the driver binds what it can. No vendor field — the connector routes to the right bridge/pipe by the
/// row's vendor before sending this. No PLC-app field — connecting is identity-only.
/// <para><b>The wire name is declared here, like every sibling DTO's</b>, so the shape does not depend on which
/// serializer options run.</para></summary>
public sealed class ConnectRequest
{
    [JsonPropertyName("project")]
    public string? Project { get; set; }
}
