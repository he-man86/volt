using System.Text.Json;
using System.Text.Json.Serialization;

namespace Volt.Contracts;

/// <summary>The ONE encoding of the pipe wire — both directions, both ends.
/// <para><b>Write</b>: camelCase field names, nulls omitted (so each response frame serializes to a single key).
/// <b>Read</b>: case-insensitive, because a client that predates a DTO's explicit
/// <c>[JsonPropertyName]</c> may still be sending the property's PascalCase name.</para>
/// <para>It lives in Contracts rather than beside the pipe because the ENCODING is part of the wire contract, not
/// of the transport that carries it. Before this, one writer config sat <c>internal</c> inside the pipe assembly
/// and THREE separate reader configs were declared independently — by the bridge host, by the CLI's client and by
/// the connector's — each spelling the same intent, none able to be asserted by a test in the assembly that
/// documents the behaviour. A DTO's serialized shape should not depend on which of four option objects happens to
/// be in scope at the call site.</para>
/// <para>Every DTO still declares its own <c>[JsonPropertyName]</c>. That is deliberate belt-and-braces: the
/// naming policy here is what a payload falls back to, and the one DTO that relied on the policy alone
/// (<c>ConnectRequest</c>) silently changed shape the moment a different options object serialized it.</para></summary>
public static class WireJson
{
    /// <summary>Serializing a request body or a response frame.</summary>
    public static readonly JsonSerializerOptions Write = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    /// <summary>Deserializing a request body or a response frame.</summary>
    public static readonly JsonSerializerOptions Read = new()
    {
        PropertyNameCaseInsensitive = true,
    };
}
