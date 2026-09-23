using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// THE DEVELOPER DOCUMENTATION'S FACTS ARE GENERATED FROM THE CODE, AND GATED AGAINST IT.
///
/// <para><b>What this writes.</b> Two artefacts under <c>packages/volt-cli/docs/</c>:</para>
/// <list type="bullet">
/// <item><c>volt-bridge.openrpc.json</c> — the wire as a conformant <b>OpenRPC 1.2.6</b> document. The pipe
/// carries <c>{op, body}</c> answered with a result or a coded error, which is JSON-RPC in all but framing, so
/// the JSON-RPC description standard fits without inventing anything. (OpenAPI describes HTTP and there is no
/// HTTP here; AsyncAPI fits but models message CHANNELS, heavier than a request/response wire needs.) This is
/// the file to hand to a project outside this repo — <c>@open-rpc/generator</c> makes a typed client from it.</item>
/// <item><c>assets/data.js</c> — the same document plus the item-kind table, the error codes and the driver
/// interface members, as <c>window.VOLT</c>. A <c>&lt;script src&gt;</c> rather than a <c>fetch</c> so the pages
/// open from <c>file://</c> with no server.</item>
/// </list>
///
/// <para><b>Why generated.</b> A hand-written table is a second source of truth and the one that drifts is
/// always the one nobody runs. Every row here is reflected off the type the runtime actually uses —
/// <see cref="Ops"/>, <see cref="BridgeErrorCodes"/>, <see cref="ItemKind"/>, <see cref="IIdeDriver"/> — so
/// the doc cannot describe a field the wire does not have or miss a kind the walk emits. The prose around the
/// tables is hand-written in the HTML; the FACTS are not.</para>
///
/// <para>Regenerate with <c>VOLT_WRITE_DOCS=1 dotnet test test/Volt.Engine.Tests</c>. Otherwise this FAILS on
/// any difference, which is what makes the artefacts trustworthy.</para>
/// </summary>
public class DocDataTests
{
    /// <summary>Every op, with the type the host deserializes its body into and the type it answers with.
    ///
    /// <para>Taken from <c>BridgePipeHost</c>'s dispatch, and it is the ONE thing here that is hand-maintained —
    /// the mapping op → types lives in a switch, not in a type. <see cref="Every_op_constant_is_described"/>
    /// is the guard: add an op to <see cref="Ops"/> without a row here and the build says so.</para></summary>
    private static readonly (string Op, Type? Param, Type? Result, string Summary)[] Methods =
    {
        (Ops.Health, null, typeof(HealthResponse),
            "Liveness plus the connectable projects, from the driver's CACHED snapshot — never marshalled onto " +
            "the IDE thread. This is the poll path (the connector every few seconds), so it answers while a push " +
            "or build is running. While paused every row reads idle."),
        (Ops.Connect, typeof(ConnectRequest), null,
            "Bind a project and resume service. An absent or empty `project` means \"serve whatever you have\". " +
            "Refuses with PLC_DISCONNECTED unless the bridge ends up actually serving the named project — the " +
            "post-condition is enforced in shared code, so both vendors answer identically."),
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

    /// <summary>The three facets of <see cref="IIdeDriver"/>, in the order the driver page presents them.</summary>
    private static readonly (string Name, Type Type, string Role)[] Facets =
    {
        ("IIdeSession", typeof(IIdeSession), "Is there an IDE, which project, and the threading rules."),
        ("IProjectTree", typeof(IProjectTree), "Navigate and mutate structure. No source text."),
        ("ICodeStore", typeof(ICodeStore), "Content in and out, in Volt's own vocabulary."),
    };

    private static string DocsDir()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "packages", "volt-cli", "Volt.sln")))
            dir = dir.Parent;
        Assert.NotNull(dir);
        return Path.Combine(dir!.FullName, "packages", "volt-cli", "docs");
    }

    private static bool Writing => Environment.GetEnvironmentVariable("VOLT_WRITE_DOCS") == "1";

    private const string Regenerate = "Regenerate with VOLT_WRITE_DOCS=1 dotnet test test/Volt.Engine.Tests";

    // ── the OpenRPC document ────────────────────────────────────────────────────────────────────────

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
                    + "GENERATED from the C# contract types by `DocDataTests`; edit those, not this file.",
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

    // ── the item-kind table ─────────────────────────────────────────────────────────────────────────

    /// <summary>Every <see cref="ItemKind"/> code constant, with what the walk does with it.
    ///
    /// <para>Reflected off the class rather than transcribed, because the transcription is what went stale: a
    /// doc listing 623 as the only DUT code was written while 605/606/607 were being dropped from every walk,
    /// and nothing could tell. A row here exists because a constant does.</para></summary>
    /// <summary>The kinds that materialize as their own workspace file — the two extension tables, which is
    /// the only definition of "has an extension" there is.</summary>
    private static readonly HashSet<string> FileKinds = new(
        ItemKind.SourceKindExtensions.Concat(ItemKind.ReferenceKindExtensions).Select(x => x.Kind),
        StringComparer.Ordinal);

    private static JsonArray BuildKinds()
    {
        var rows = new JsonArray();

        var consts = typeof(ItemKind).GetFields(BindingFlags.Public | BindingFlags.Static)
            .Where(f => f.IsLiteral && f.FieldType == typeof(int))
            .Select(f => (Name: f.Name, Code: (int)f.GetRawConstantValue()!))
            .OrderBy(x => x.Code);

        foreach (var (name, code) in consts)
        {
            var kind = ItemKind.Map(code);
            var row = new JsonObject
            {
                ["code"] = code,
                ["constant"] = name,
                ["kind"] = kind,
                ["emitted"] = kind is not null,
            };
            if (kind is not null)
            {
                // A kind has an extension only when it materializes as its OWN file. A folder is a path
                // segment and a member is folded into its POU's file, so neither has one — and `ExtFor`
                // throws rather than inventing one, which is the behaviour this mirrors instead of catching.
                row["ext"] = FileKinds.Contains(kind) ? ItemKind.ExtFor(kind) : null;
                row["source"] = ItemKind.IsSourceKind(kind);
                row["addressable"] = ItemKind.IsAddressableItem(code);
                row["member"] = ItemKind.IsMember(code);
                row["inlined"] = ItemKind.IsInlinedInPou(code);
                row["container"] = ItemKind.IsContainerManager(code);
            }
            rows.Add(row);
        }
        return rows;
    }

    /// <summary>The workspace file-extension registry, both flags — the table <c>scripts/check-wiring.ts</c>
    /// cross-checks every other runtime's copy against.</summary>
    private static JsonArray BuildExtensions() =>
        new(ItemKind.FileExtensions
            .OrderBy(x => x.Ext, StringComparer.Ordinal)
            .Select(x => (JsonNode?)new JsonObject
            {
                ["ext"] = x.Ext,
                ["source"] = x.IsSource,
                ["writable"] = x.IsWritable,
            }).ToArray());

    // ── the driver interface ────────────────────────────────────────────────────────────────────────

    /// <summary>The members of one driver facet, in DECLARATION order (metadata-token order, which is stable
    /// where reflection order is not), each rendered as the signature a C# implementer writes.</summary>
    private static JsonArray MembersOf(Type t)
    {
        var members = new JsonArray();
        // Declaration order, which metadata tokens give and reflection order does not. A PROPERTY's own token
        // sits after its accessors', so ordering by the token of whichever comes first keeps a property beside
        // the members it was declared with instead of sinking every property to the bottom of the table.
        foreach (var m in t.GetMembers(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
                           .OrderBy(m => m is PropertyInfo p
                               ? (p.GetMethod ?? p.SetMethod)!.MetadataToken
                               : m.MetadataToken))
        {
            switch (m)
            {
                case PropertyInfo p:
                    members.Add(new JsonObject
                    {
                        ["name"] = p.Name,
                        ["kind"] = "property",
                        ["signature"] = $"{Sig(p.PropertyType, Nulls.Create(p).ReadState)} {p.Name} "
                                      + $"{{ {(p.CanRead ? "get; " : "")}{(p.CanWrite ? "set; " : "")}}}",
                    });
                    break;
                case MethodInfo mi when !mi.IsSpecialName:          // skip property accessors
                    members.Add(new JsonObject
                    {
                        ["name"] = mi.Name,
                        ["kind"] = "method",
                        ["signature"] = Signature(mi),
                    });
                    break;
            }
        }
        return members;
    }

    private static readonly NullabilityInfoContext Nulls = new();

    private static string Signature(MethodInfo m)
    {
        var generics = m.IsGenericMethodDefinition
            ? "<" + string.Join(", ", m.GetGenericArguments().Select(a => a.Name)) + ">"
            : "";
        var args = string.Join(", ", m.GetParameters().Select(p =>
            $"{Sig(p.ParameterType, Nulls.Create(p).WriteState, TupleNames(p))} {p.Name}"
            + (p.HasDefaultValue ? " = …" : "")));
        var ret = Sig(m.ReturnType, Nulls.Create(m.ReturnParameter).ReadState, TupleNames(m.ReturnParameter));
        return $"{ret} {m.Name}{generics}({args})";
    }

    /// <summary>A ValueTuple's element names, which live on the PARAMETER rather than on the type — so
    /// <c>(bool Get, bool Set)</c> survives into the page. Without them that member reads <c>(bool, bool)</c>,
    /// which documents nothing at all.</summary>
    private static string[]? TupleNames(ParameterInfo p) =>
        p.GetCustomAttribute<System.Runtime.CompilerServices.TupleElementNamesAttribute>()
            ?.TransformNames.Select(n => n ?? "").ToArray();

    /// <summary>A C#-shaped type name: keywords for the primitives, angle brackets for generics, and the
    /// reference-nullability the contract actually declares — <c>string?</c> vs <c>string</c> is a rule an
    /// implementer has to honour (<c>ServedProjectName</c> is null when nothing is attached), so a page that
    /// dropped the <c>?</c> would be describing a different interface.</summary>
    private static string Sig(Type t, NullabilityState nullability = NullabilityState.Unknown,
                              string[]? tupleNames = null)
    {
        var q = nullability == NullabilityState.Nullable ? "?" : "";
        if (Nullable.GetUnderlyingType(t) is { } inner) return Sig(inner) + "?";
        if (t == typeof(void)) return "void";
        if (t == typeof(string)) return "string" + q;
        if (t == typeof(bool)) return "bool";
        if (t == typeof(int)) return "int";
        if (t == typeof(object)) return "object" + q;

        // An unconstrained generic PARAMETER reads as Nullable, which would print `T?` for a method whose
        // contract is plain `T`. It is the type ARGUMENT's own nullability that matters, not the placeholder's.
        if (t.IsGenericParameter) return t.Name;

        if (t.IsGenericType)
        {
            var args = t.GetGenericArguments();
            var name = t.Name.Substring(0, t.Name.IndexOf('`'));
            if (name == "ValueTuple")
                return "(" + string.Join(", ", args.Select((a, i) =>
                    Sig(a) + (tupleNames is { } n && i < n.Length && n[i] != "" ? " " + n[i] : ""))) + ")";
            return name + "<" + string.Join(", ", args.Select(a => Sig(a))) + ">" + q;
        }
        return t.Name + q;
    }

    // ── the bundle ──────────────────────────────────────────────────────────────────────────────────

    private static JsonObject BuildData(JsonObject spec) => new()
    {
        ["generatedBy"] = "test/Volt.Engine.Tests/docs/DocDataTests.cs",
        ["openrpc"] = JsonNode.Parse(spec.ToJsonString()),
        ["ops"] = new JsonArray(OpNames().Select(o => (JsonNode?)o).ToArray()),
        ["errors"] = new JsonArray(Consts(typeof(BridgeErrorCodes)).Select(c => (JsonNode?)c).ToArray()),
        // The wire VALUES only — `Vendors` also carries the display spellings, which are a UI concern.
        ["vendors"] = new JsonArray(Vendors.Codesys, Vendors.Twincat),
        ["kinds"] = BuildKinds(),
        ["extensions"] = BuildExtensions(),
        ["driver"] = new JsonArray(Facets.Select(f => (JsonNode?)new JsonObject
        {
            ["name"] = f.Name,
            ["role"] = f.Role,
            ["members"] = MembersOf(f.Type),
        }).ToArray()),
    };

    private static IEnumerable<string> OpNames() =>
        Consts(typeof(Volt.Contracts.Ops));

    private static IEnumerable<string> Consts(Type t) =>
        t.GetFields(BindingFlags.Public | BindingFlags.Static)
            .Where(f => f.IsLiteral && f.FieldType == typeof(string))
            .Select(f => (string)f.GetRawConstantValue()!)
            .ToList();

    private static string RenderJson(JsonNode node) =>
        node.ToJsonString(new JsonSerializerOptions { WriteIndented = true }) + "\n";

    private static string RenderDataJs(JsonObject data) =>
        "// GENERATED by test/Volt.Engine.Tests/docs/DocDataTests.cs — do not edit.\n"
        + "// Regenerate: VOLT_WRITE_DOCS=1 dotnet test test/Volt.Engine.Tests\n"
        + "window.VOLT = " + RenderJson(data).TrimEnd('\n') + "\n";

    // ── the gate ────────────────────────────────────────────────────────────────────────────────────

    private static void GateOrWrite(string path, string generated)
    {
        if (Writing)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, generated, new UTF8Encoding(false));
            return;
        }

        Assert.True(File.Exists(path), $"a generated doc artefact is missing: {path}\n{Regenerate}");
        Assert.True(File.ReadAllText(path).Replace("\r\n", "\n") == generated.Replace("\r\n", "\n"),
            $"{Path.GetFileName(path)} no longer matches the code that generates it — something in the wire, "
            + $"the item-kind table or the driver interface changed and the document did not.\n{Regenerate}");
    }

    /// <summary>THE GATE. Both committed artefacts are what this run generates, or the build says so.</summary>
    [Fact]
    public void The_committed_doc_data_is_what_the_code_generates()
    {
        var spec = BuildSpec();
        var docs = DocsDir();
        GateOrWrite(Path.Combine(docs, "volt-bridge.openrpc.json"), RenderJson(spec));
        GateOrWrite(Path.Combine(docs, "assets", "data.js"), RenderDataJs(BuildData(spec)));
    }

    /// <summary>EVERY OP IS DESCRIBED. The op→types mapping above is hand-written because it lives in a switch
    /// rather than in a type, so this is what stops a new op shipping undocumented.</summary>
    [Fact]
    public void Every_op_constant_is_described()
    {
        Assert.Equal(OpNames().OrderBy(x => x, StringComparer.Ordinal).ToList(),
                     Methods.Select(m => m.Op).OrderBy(x => x, StringComparer.Ordinal).ToList());
    }

    /// <summary>EVERY DRIVER MEMBER IS LISTED. <see cref="IIdeDriver"/> is the layer another project reuses, so
    /// a facet it does not inherit from would be a whole surface missing from the page with nothing to notice
    /// it — the reason to assert the composition rather than just walk the three types.</summary>
    [Fact]
    public void The_driver_page_covers_every_facet_of_IIdeDriver()
    {
        Assert.Equal(typeof(IIdeDriver).GetInterfaces().OrderBy(t => t.Name).Select(t => t.Name).ToList(),
                     Facets.Select(f => f.Name).OrderBy(n => n).ToList());
    }
}
