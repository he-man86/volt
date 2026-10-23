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
    /// default reads it only as the first member).
    /// <para>A null is read only where the request type declares the member nullable — there it is the member absent
    /// (<c>ifVersion</c>, <c>to</c>, <c>project</c>). A null for a member typed non-nullable (a push op's <c>name</c>,
    /// <c>ops</c>, a grep's <c>pattern</c>) and a null ENTRY of a list or a map (no request list or map holds one) is an
    /// error naming the member, like an unknown member.</para></summary>
    public static readonly JsonSerializerOptions Request = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        AllowOutOfOrderMetadataProperties = true,
        RespectNullableAnnotations = true,
        TypeInfoResolver = new System.Text.Json.Serialization.Metadata.DefaultJsonTypeInfoResolver { Modifiers = { NoNullEntries } },
    };

    /// <summary>A request list or map holds no null entry: every list and map a request carries holds values — op
    /// objects, paths, versions — and the serializer reads a generic argument's nullability nowhere, so this says it
    /// once. Checked as the serializer stores the list or map in its member, so its refusal carries the serializer's
    /// own path to that member (<c>$.ops</c>, <c>$.ops[1].x</c>) and names the entry; an entry is read by the serializer
    /// itself, so a refusal inside one keeps its full path (<c>$.ops[1].bogus</c>).</summary>
    private static void NoNullEntries(System.Text.Json.Serialization.Metadata.JsonTypeInfo info)
    {
        if (info.Kind != System.Text.Json.Serialization.Metadata.JsonTypeInfoKind.Object) return;
        foreach (var member in info.Properties)
        {
            if (member.Set is not { } set || !HoldsValues(member.PropertyType)) continue;
            var name = member.Name;
            member.Set = (owner, value) =>
            {
                if (value is System.Collections.IDictionary map)
                {
                    foreach (System.Collections.DictionaryEntry entry in map)
                        if (entry.Value is null) throw NullAt($"{name}['{entry.Key}']");
                }
                else if (value is System.Collections.IList list)
                {
                    for (var i = 0; i < list.Count; i++)
                        if (list[i] is null) throw NullAt($"{name}[{i}]");
                }
                set(owner, value);
            };
        }
    }

    private static bool HoldsValues(System.Type type) =>
        type.IsGenericType && !type.GetGenericArguments()[type.GetGenericArguments().Length - 1].IsValueType
        && (type.GetGenericTypeDefinition() == typeof(System.Collections.Generic.List<>)
            || (type.GetGenericTypeDefinition() == typeof(System.Collections.Generic.Dictionary<,>)
                && type.GetGenericArguments()[0] == typeof(string)));

    private static JsonException NullAt(string entry) =>
        new($"null is not a value of `{entry}`: a request list or map holds no null entry");
}
