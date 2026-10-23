using System.Text.Json;
using System.Text.Json.Serialization;

namespace Volt.Contracts;

/// <summary>The ONE encoding of the pipe wire — both directions, both ends.
/// <para><b>Write</b>: camelCase field names, nulls omitted (so each response frame serializes to a single key).
/// <b>Read</b>: member names match exactly. A request body (<see cref="Request"/>) also refuses a member its type
/// does not define; the envelope and the responses (<see cref="Read"/>) skip one, which is what lets an added response
/// member ship without a protocol bump (<c>docs/relay-protocol.md</c>).</para>
/// <para>It lives in Contracts rather than beside the pipe because the ENCODING is part of the wire contract, not
/// of the transport that carries it: the bridge host, the CLI's client and the connector all read and write with
/// these options, so a DTO's serialized shape never depends on the call site.</para>
/// <para>Every DTO still declares its own <c>[JsonPropertyName]</c>. That is deliberate belt-and-braces: the
/// naming policy here is what a payload falls back to.</para></summary>
public static class WireJson
{
    /// <summary>Serializing a request body or a response frame.</summary>
    public static readonly JsonSerializerOptions Write = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    /// <summary>Deserializing the request envelope or a response frame: exact member names — the spelling
    /// <see cref="Write"/> produces, so a member without its own <c>[JsonPropertyName]</c> (<c>ProjectEntry</c>'s
    /// positional members) reads back as written — and an unknown member skipped.</summary>
    public static readonly JsonSerializerOptions Read = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    /// <summary>Deserializing a request BODY: exact member names, and a member the op's request type does not define
    /// is an error — a client sending a member the wire does not define is told so instead of having it dropped. A
    /// push op's <c>op</c> discriminator may stand anywhere in its object: JSON members are unordered (the serializer's
    /// default reads it only as the first member).</summary>
    public static readonly JsonSerializerOptions Request = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        AllowOutOfOrderMetadataProperties = true,
    };
}
