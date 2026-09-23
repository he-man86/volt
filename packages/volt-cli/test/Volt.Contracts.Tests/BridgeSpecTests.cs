using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Volt.Contracts;
using Xunit;

namespace Volt.Contracts.Tests;

/// <summary>
/// THE BRIDGE WIRE HAS A MACHINE-READABLE SPEC, AND IT IS GENERATED FROM THESE TYPES.
///
/// <para><b>Why a spec at all.</b> The pipe is the boundary — everything above it is a client, and clients exist
/// outside this repo (the e2e harness spells the op names independently, and the whole point of the driver layer
/// is that another project can drive an IDE through it). A boundary that is only described in prose is one every
/// new client re-derives by reading C#.</para>
///
/// <para><b>Why OPENRPC.</b> The wire is <c>{op, body}</c> answered with a result or a coded error, which is
/// JSON-RPC in all but framing — so the JSON-RPC description standard fits without inventing anything. OpenAPI
/// describes HTTP and there is no HTTP here; AsyncAPI fits too but models message CHANNELS, which is heavier than
/// a request/response wire needs. The document this writes is consumable by the ordinary OpenRPC tooling
/// (generators, the Inspector) with no Volt-specific step.</para>
///
/// <para><b>Why GENERATED rather than written.</b> A hand-written spec is a second source of truth, and the one
/// that drifts is always the one nobody runs. This reflects the real <c>Volt.Contracts</c> types — the same ones
/// the host serializes — so the document cannot describe a field the wire does not have. Regenerate with
/// <c>VOLT_WRITE_SPEC=1 dotnet test test/Volt.Contracts.Tests</c>; otherwise this FAILS on any difference, which
/// is what makes the file trustworthy enough to hand to another project.</para>
/// </summary>
public class BridgeSpecTests
{
    /// <summary>Every op, with the type the host deserializes its body into and the type it answers with.
    ///
    /// <para>Taken from <c>BridgePipeHost</c>'s dispatch, and it is the ONE thing here that is hand-maintained —
    /// the mapping op → types lives in a switch, not in a type. <see cref="Every_op_constant_appears_in_the_spec"/>
    /// is the guard: add an op to <see cref="Ops"/> without a row here and the build says so.</para></summary>
    private static readonly (string Op, Type? Param, Type? Result, string Summary)[] Methods =
    {
        (Ops.Health, null, typeof(HealthResponse),
            "Liveness plus the connectable projects, from the driver's CACHED snapshot — never marshalled onto " +
            "the IDE thread. This is the poll path (the connector every ~4s), so it answers while a push or " +
            "build is running. While paused every row reads `idle`."),
        (Ops.Connect, typeof(ConnectRequest), null,
            "Bind a project and resume service. An absent or empty `project` means \"serve whatever you have\". " +
            "Refuses with PLC_DISCONNECTED unless the bridge ends up actually serving the named project — the " +
            "post-condition is enforced in shared code so both vendors answer identically."),
        (Ops.Disconnect, null, null,
            "Pause the bridge: refuse sync until the next connect, tear nothing down. Answers even while a push " +
            "is running, and that push RUNS TO COMPLETION — the gate stops the NEXT op, never the current one."),
        (Ops.Refs, typeof(RefsRequest), typeof(RefsResponse),
            "The version map without any content: every tracked item's version, its folder, and the aggregate " +
            "project/structure versions. This is what a client compares against to decide what to fetch."),
        (Ops.Fetch, typeof(FetchRequest), typeof(FetchResponse),
            "Item CONTENT. `knownItems` narrows the answer to what changed; `onlyItems` restricts the walk to a " +
            "named subset. Graphical bodies arrive as network text — the bridge materializes them, so a client " +
            "never sees a vendor's own form."),
        (Ops.Init, null, typeof(FetchResponse),
            "A full fetch for a first sync: `fetch` with `init: true`. Same response shape, no `knownItems`."),
        (Ops.Push, typeof(PushRequest), typeof(PushResponse),
            "Apply ops to the IDE. Every text-decidable refusal runs in a PRE-FLIGHT before the first write, so " +
            "a push that cannot land in full lands nothing. `expectedProjectVersion` is the lease; per-item " +
            "`ifVersion` is the optimistic guard."),
        (Ops.Build, typeof(BuildRequest), typeof(BuildResponse),
            "Compile the bound project and return the IDE's own diagnostics. This is the oracle a client uses " +
            "to tell its own analysis from the vendor's."),
    };

    private static string SpecPath()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "packages", "volt-cli", "Volt.sln")))
            dir = dir.Parent;
        Assert.NotNull(dir);
        return Path.Combine(dir!.FullName, "packages", "volt-cli", "docs", "bridge", "volt-bridge.openrpc.json");
    }

    // ── the document ────────────────────────────────────────────────────────────────────────────────

    private static JsonObject BuildSpec()
    {
        var schemas = new JsonObject();
        var methods = new JsonArray();

        foreach (var (op, param, result, summary) in Methods)
        {
            var m = new JsonObject
            {
                ["name"] = op,
                ["summary"] = summary,
                // NAMED, not positional: the wire carries ONE object body, so the single param is by-name.
                ["paramStructure"] = "by-name",
                ["params"] = param is null
                    ? new JsonArray()
                    : new JsonArray(new JsonObject
                    {
                        ["name"] = "body",
                        ["required"] = true,
                        ["schema"] = Reference(param, schemas),
                    }),
            };
            m["result"] = result is null
                // `connect` and `disconnect` answer `{ok:true}` — a literal, not a contract type.
                ? new JsonObject { ["name"] = "ok", ["schema"] = new JsonObject
                    {
                        ["type"] = "object",
                        ["properties"] = new JsonObject { ["ok"] = new JsonObject { ["type"] = "boolean" } },
                    } }
                : new JsonObject { ["name"] = "result", ["schema"] = Reference(result, schemas) };
            methods.Add(m);
        }

        return new JsonObject
        {
            ["openrpc"] = "1.2.6",
            ["info"] = new JsonObject
            {
                ["title"] = "Volt bridge",
                ["version"] = "1.0.0",
                ["description"] =
                    "The wire a Volt bridge serves over a Windows NAMED PIPE — `volt.bridge.<vendor>.<pid>`, one "
                    + "per live IDE. One request object per call: `{ \"op\": \"<name>\", \"body\": { ... } }`, "
                    + "answered with the method's result or `{ \"error\": { \"code\": \"...\", \"message\": \"...\" } }`.\n\n"
                    + "GENERATED from the C# contract types by `BridgeSpecTests`; edit those, not this file.",
            },
            ["servers"] = new JsonArray(new JsonObject
            {
                ["name"] = "named-pipe",
                ["url"] = "npipe://./pipe/volt.bridge.{vendor}.{pid}",
                ["summary"] = "One pipe per live IDE. Discover by PREFIX — the pid suffix changes when the IDE restarts.",
                ["variables"] = new JsonObject
                {
                    ["vendor"] = new JsonObject { ["default"] = "codesys", ["enum"] = new JsonArray("codesys", "twincat") },
                    ["pid"] = new JsonObject { ["default"] = "0", ["description"] = "The IDE process id the bridge is attached to." },
                },
            }),
            ["methods"] = methods,
            ["components"] = new JsonObject { ["schemas"] = schemas },
        };
    }

    /// <summary>A `$ref` to the type's schema, generating it into <paramref name="schemas"/> on first sight.</summary>
    private static JsonObject Reference(Type t, JsonObject schemas)
    {
        var name = t.Name;
        if (!schemas.ContainsKey(name))
        {
            schemas[name] = new JsonObject();          // placeholder FIRST, so a self-referencing type terminates
            schemas[name] = SchemaOf(t, schemas);
        }
        return new JsonObject { ["$ref"] = "#/components/schemas/" + name };
    }

    /// <summary>JSON Schema for one contract type, from its properties and their <c>JsonPropertyName</c>s.</summary>
    private static JsonObject SchemaOf(Type t, JsonObject schemas)
    {
        var props = new JsonObject();
        var required = new JsonArray();

        foreach (var p in t.GetProperties(BindingFlags.Public | BindingFlags.Instance)
                           .Where(p => p.GetCustomAttribute<JsonIgnoreAttribute>() is null))
        {
            var wireName = p.GetCustomAttribute<JsonPropertyNameAttribute>()?.Name
                           ?? JsonNamingPolicy.CamelCase.ConvertName(p.Name);
            props[wireName] = TypeSchema(p.PropertyType, schemas);
            // NULLABLE is the signal for optional, which is how the wire reads it: an ABSENT field means
            // "unchanged"/"not asked", and that distinction is load-bearing (`toFolder` absent vs `""`).
            if (!IsOptional(p)) required.Add(wireName);
        }

        var schema = new JsonObject { ["type"] = "object", ["properties"] = props };
        if (required.Count > 0) schema["required"] = required;

        // A push op is a DISCRIMINATED UNION on the wire — the `op` field picks the subtype.
        if (t == typeof(PushOp))
            schema["description"] = "Base of the push-op union. The wire's `op` field selects `set` or `deleteItem`.";
        return schema;
    }

    private static bool IsOptional(PropertyInfo p)
    {
        if (!p.PropertyType.IsValueType) return new NullabilityInfoContext().Create(p).WriteState != NullabilityState.NotNull;
        return Nullable.GetUnderlyingType(p.PropertyType) != null;
    }

    private static JsonNode TypeSchema(Type t, JsonObject schemas)
    {
        t = Nullable.GetUnderlyingType(t) ?? t;
        if (t == typeof(string)) return new JsonObject { ["type"] = "string" };
        if (t == typeof(bool)) return new JsonObject { ["type"] = "boolean" };
        if (t == typeof(int) || t == typeof(long)) return new JsonObject { ["type"] = "integer" };
        if (t == typeof(double) || t == typeof(float) || t == typeof(decimal)) return new JsonObject { ["type"] = "number" };
        if (t.IsEnum)
            return new JsonObject { ["type"] = "string", ["enum"] = new JsonArray(Enum.GetNames(t).Select(n => (JsonNode?)n).ToArray()) };

        if (t.IsGenericType && t.GetGenericTypeDefinition() is { } g
            && (g == typeof(Dictionary<,>) || g == typeof(IReadOnlyDictionary<,>) || g == typeof(IDictionary<,>)))
            return new JsonObject
            {
                ["type"] = "object",
                ["additionalProperties"] = TypeSchema(t.GetGenericArguments()[1], schemas),
            };

        if (t != typeof(string) && typeof(IEnumerable).IsAssignableFrom(t))
        {
            var item = t.IsArray ? t.GetElementType()! : t.GetGenericArguments().FirstOrDefault() ?? typeof(object);
            return new JsonObject { ["type"] = "array", ["items"] = TypeSchema(item, schemas) };
        }

        if (t.IsClass || (t.IsValueType && !t.IsPrimitive)) return Reference(t, schemas);
        return new JsonObject { };
    }

    // ── the gate ────────────────────────────────────────────────────────────────────────────────────

    private static string Render(JsonObject spec) =>
        spec.ToJsonString(new JsonSerializerOptions { WriteIndented = true }) + "\n";

    /// <summary>THE GATE. The committed document is what this run generates, or the build says so.
    ///
    /// <para>Set <c>VOLT_WRITE_SPEC=1</c> to adopt a change. That is the whole workflow: edit the contract types,
    /// regenerate, commit both. A spec nobody regenerates is a spec that lies, and this is the one mechanism
    /// that makes the file safe to hand to a project outside this repo.</para></summary>
    [Fact]
    public void The_committed_spec_is_what_these_contracts_generate()
    {
        var generated = Render(BuildSpec());
        var path = SpecPath();

        if (Environment.GetEnvironmentVariable("VOLT_WRITE_SPEC") == "1")
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, generated);
            return;
        }

        Assert.True(File.Exists(path),
            $"the bridge spec is missing: {path}\nRegenerate with VOLT_WRITE_SPEC=1 dotnet test test/Volt.Contracts.Tests");
        Assert.True(File.ReadAllText(path).Replace("\r\n", "\n") == generated.Replace("\r\n", "\n"),
            "the committed bridge spec no longer matches the contract types — a wire field changed and the "
            + "document did not. Regenerate with VOLT_WRITE_SPEC=1 dotnet test test/Volt.Contracts.Tests");
    }

    /// <summary>EVERY OP IS DESCRIBED. The op→types mapping above is hand-written because it lives in a switch
    /// rather than in a type, so this is what stops a new op shipping undocumented.</summary>
    [Fact]
    public void Every_op_constant_appears_in_the_spec()
    {
        var declared = typeof(Ops).GetFields(BindingFlags.Public | BindingFlags.Static)
            .Where(f => f.IsLiteral && f.FieldType == typeof(string))
            .Select(f => (string)f.GetRawConstantValue()!)
            .ToList();

        var described = Methods.Select(m => m.Op).ToList();

        Assert.Equal(declared.OrderBy(x => x, StringComparer.Ordinal).ToList(),
                     described.OrderBy(x => x, StringComparer.Ordinal).ToList());
    }
}
