using System.Text.Json.Serialization;

namespace Volt.Contracts;

/// <summary>The <c>connect</c> request: which project the connector picked, by NAME. May be null (a soft/refresh
/// select); the driver binds what it can. No vendor field — the connector routes to the right bridge/pipe by the
/// row's vendor before sending this. No PLC-app field — connecting is identity-only.
/// <para><b>The wire name is declared here, like every sibling DTO's.</b> It was the only one without a
/// <c>[JsonPropertyName]</c>, and it got away with it by coincidence: the connector could not see this type — it
/// lived in <c>Volt.Engine</c>, which the connector deliberately cannot reference — so it sent an anonymous
/// <c>new { project = … }</c> whose field name happened to be lowercase, and the host deserialized
/// case-insensitively. The moment the connector was given the real type, the same payload serialized as
/// <c>Project</c>, because there are four independent <c>JsonSerializerOptions</c> configuring this one wire and
/// the connector's is not the host's. A DTO that declares its own wire name does not care which one runs.</para></summary>
public sealed class ConnectRequest
{
    [JsonPropertyName("project")]
    public string? Project { get; set; }
}
