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
    /// <summary>The coded errors an op can answer with as an ERROR FRAME, and the ways it can fail WITHOUT
    /// one. Traced through <c>BridgePipeHost</c>'s dispatch, <c>OpGuard</c> and each service's own catch arms —
    /// which is the only way to get it right, because the interesting cases are the ones where a failure is
    /// DELIBERATELY not an error frame:
    /// <list type="bullet">
    /// <item><c>push</c> catches every exception from its pre-flight AND its apply loop and returns a REJECTION
    /// (<c>accepted:false</c> + <c>conflicts</c>). A caller therefore never sees <c>UNSUPPORTED</c> or
    /// <c>INVALID_ST</c> as an error CODE from a push — it arrives as a conflict's <c>reason</c>.</item>
    /// <item><c>build</c> catches everything after the guard and answers <c>success:false</c> with the failure
    /// as an error-severity diagnostic.</item>
    /// <item><c>refs</c>/<c>fetch</c>/<c>init</c> version items through <c>Versioning.SafeVersion</c>, which
    /// isolates a body that will not materialize into the <c>unreadable</c> list rather than failing the walk.</item>
    /// </list>
    /// <para>Anything that is not an <c>ICodedError</c> reaches the client as <c>INTERNAL_ERROR</c>
    /// (<c>PipeServer</c>), which is why every op that runs vendor code lists it.</para></summary>
    private static readonly Dictionary<string, (string[] Errors, string[] Outcomes)> Outcomes = new()
    {
        [Ops.Health] = (new[] { BridgeErrorCodes.InternalError }, new[]
        {
            "Never gated by `disconnect` — while paused every row is forced to `idle`, because the list is how "
            + "the user reconnects.",
            "Answers from the driver's cached snapshot, so it cannot report PLC_DISCONNECTED. A bridge serving "
            + "nothing is the aggregate status `unavailable` instead.",
        }),
        [Ops.Connect] = (new[] { BridgeErrorCodes.PlcDisconnected, BridgeErrorCodes.InternalError }, new[]
        {
            "PLC_DISCONNECTED here is the POST-condition: the driver attached nothing, or attached something "
            + "other than the project named. Enforced once in shared code, so both vendors refuse identically.",
            "A malformed body is a deserialization failure, not BAD_REQUEST — it reaches the client as "
            + "INTERNAL_ERROR.",
            "A REFUSED connect still leaves the bridge RESUMED: the pause flag is cleared before the IDE work, "
            + "so a `disconnect` racing a connect wins.",
        }),
        [Ops.Disconnect] = (new string[0], new[]
        {
            "Cannot fail: it sets a flag and answers. It is deliberately not marshalled onto the IDE thread, so "
            + "it answers even while a push is running — and that push runs to completion. The gate stops the "
            + "NEXT op, never the current one.",
        }),
        [Ops.Refs] = (new[] { BridgeErrorCodes.PlcDisconnected, BridgeErrorCodes.WrongProject,
                              BridgeErrorCodes.InternalError }, new[]
        {
            "An item whose body will not materialize is NOT an error: it is named in `unreadable`, keeps a "
            + "stable sentinel version so a pull does not mistake it for deleted, and is logged at Warn.",
            "A read is retried ONCE through a transient IDE failure that the driver classifies as one. The "
            + "session is marked degraded meanwhile, which `health` reports.",
        }),
        [Ops.Fetch] = (new[] { BridgeErrorCodes.PlcDisconnected, BridgeErrorCodes.WrongProject,
                               BridgeErrorCodes.NoSidecar, BridgeErrorCodes.InternalError }, new[]
        {
            "NO_SIDECAR is specific to this op: a fetch with neither `knownItems` nor `onlyItems` is ambiguous "
            + "— it could mean \"everything\" or a client that forgot its baseline. Send `init: true` for a "
            + "first pull.",
            "A walk that could not enumerate a folder SUPPRESSES every deletion and says so at Warn, so "
            + "`removed` comes back empty rather than wrong.",
            "Items that would not materialize are named in `unreadable`, not raised.",
        }),
        [Ops.Push] = (new[] { BridgeErrorCodes.PlcDisconnected, BridgeErrorCodes.WrongProject,
                              BridgeErrorCodes.InternalError }, new[]
        {
            "MOST PUSH FAILURES ARE NOT ERROR FRAMES. Every exception from the pre-flight and from the apply "
            + "loop is caught and returned as `accepted:false` with one conflict. A client MUST check `accepted`.",
            "A refusal carries its CODE on the conflict: a `NETWORK_*` diagnostic for a body the format "
            + "refuses (with a `line`), or a BridgeErrorCodes value for everything else — UNSUPPORTED, "
            + "NOT_FOUND, DUPLICATE_CHILD, BAD_REQUEST, INVALID_ST, INVALID_CODE_HEADER. Match the code, "
            + "never the message.",
            "A version conflict is also `accepted:false` — with `yourVersion`/`currentVersion` per item, and no "
            + "code.",
            "A refusal during APPLY rather than pre-flight leaves the earlier ops WRITTEN, and they are not "
            + "rolled back. The reason says how many, because a rejection that reads as \"nothing happened\" is "
            + "a lie the user acts on.",
        }),
        [Ops.Build] = (new[] { BridgeErrorCodes.PlcDisconnected, BridgeErrorCodes.WrongProject }, new[]
        {
            "The guard sits OUTSIDE the try, deliberately — otherwise WRONG_PROJECT would be swallowed into a "
            + "fake \"build failed\" diagnostic instead of surfacing as an error frame.",
            "Everything after it IS caught: a thrown build answers `success:false` with the message as one "
            + "error-severity diagnostic. So this op essentially never returns INTERNAL_ERROR.",
            "`success` comes from a different vendor SIGNAL on each: CODESYS derives it from the diagnostics, "
            + "TwinCAT reads the IDE's own count of failed projects.",
        }),
    };

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
                        ["schema"] = Reference(param, schemas, isRequest: true),
                    }),
            };
            // A specification EXTENSION (`x-`), not OpenRPC's own `errors` field: that one wants JSON-RPC
            // INTEGER codes and these are strings. Inventing numbers to fit the shape would put a value in the
            // artefact that no part of this wire ever sends.
            var (errs, outs) = Outcomes[op];
            m["x-errorCodes"] = new JsonArray(errs.Select(e => (JsonNode?)e).ToArray());
            m["x-outcomes"] = new JsonArray(outs.Select(o => (JsonNode?)o).ToArray());
            m["result"] = result is null
                // `connect` and `disconnect` answer `{ok:true}` — a literal, not a contract type.
                ? new JsonObject { ["name"] = "ok", ["schema"] = new JsonObject
                    {
                        ["type"] = "object",
                        ["properties"] = new JsonObject { ["ok"] = new JsonObject { ["type"] = "boolean" } },
                    } }
                : new JsonObject { ["name"] = "result", ["schema"] = Reference(result, schemas, isRequest: false) };
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

    /// <summary>A `$ref` to the type's schema, generating it into <paramref name="schemas"/> on first sight.
    ///
    /// <para><paramref name="isRequest"/> travels with it because REQUIREDNESS depends on the direction — see
    /// <see cref="IsOptional"/>. No contract type is used in both directions today, and <see cref="Directions"/>
    /// is the gate that keeps it that way: a type reached from both would be emitted once, with whichever
    /// direction got there first.</para></summary>
    private static JsonObject Reference(Type t, JsonObject schemas, bool isRequest)
    {
        var name = t.Name;
        if (!schemas.ContainsKey(name))
        {
            Directions[name] = isRequest;
            schemas[name] = new JsonObject();          // placeholder FIRST, so a self-referencing type terminates
            schemas[name] = SchemaOf(t, schemas, isRequest);
        }
        else if (Directions.TryGetValue(name, out var first) && first != isRequest)
            throw new InvalidOperationException(
                $"'{name}' is reached as both a request and a response type. Requiredness differs by direction, "
                + "so one schema cannot describe both — split the type, or teach this generator to emit two.");
        return new JsonObject { ["$ref"] = "#/components/schemas/" + name };
    }

    /// <summary>Which direction each emitted schema was reached from. Reset per generation.</summary>
    private static readonly Dictionary<string, bool> Directions = new(StringComparer.Ordinal);

    /// <summary>JSON Schema for one contract type, from its properties and their <c>JsonPropertyName</c>s.</summary>
    private static JsonObject SchemaOf(Type t, JsonObject schemas, bool isRequest)
    {
        var props = new JsonObject();
        var required = new JsonArray();

        foreach (var p in t.GetProperties(BindingFlags.Public | BindingFlags.Instance)
                           .Where(p => p.GetCustomAttribute<JsonIgnoreAttribute>() is null))
        {
            var wireName = p.GetCustomAttribute<JsonPropertyNameAttribute>()?.Name
                           ?? JsonNamingPolicy.CamelCase.ConvertName(p.Name);
            props[wireName] = TypeSchema(p.PropertyType, schemas, isRequest);
            if (!IsOptional(p, isRequest)) required.Add(wireName);
        }

        var schema = new JsonObject { ["type"] = "object", ["properties"] = props };
        if (required.Count > 0) schema["required"] = required;

        // A DISCRIMINATED UNION IS EMITTED, not described in prose.
        //
        // This used to write a sentence saying `op` selects `set` or `deleteItem` and emit neither — no
        // discriminator, no `oneOf`, and no `SetItemOp`/`DeleteItemOp` schema at all. So the document called
        // "the artefact to hand to another project" described `push`, the only MUTATING op, as taking
        // `{name, ifVersion}`: no `sourceText`, no `toFolder`, no `toName`. A generated client could read but
        // not write. The gate did not catch it because it reflects PROPERTIES, and `[JsonDerivedType]` is an
        // attribute on the type — which is precisely the kind of gap a generator must close itself.
        var poly = t.GetCustomAttribute<JsonPolymorphicAttribute>();
        if (poly is not null)
        {
            var derived = t.GetCustomAttributes<JsonDerivedTypeAttribute>().ToList();
            var tag = poly.TypeDiscriminatorPropertyName ?? "$type";

            // The discriminator is a real wire field and is REQUIRED — a body without it does not deserialize.
            props[tag] = new JsonObject
            {
                ["type"] = "string",
                ["enum"] = new JsonArray(derived.Select(d => (JsonNode?)d.TypeDiscriminator?.ToString()).ToArray()),
                ["description"] = "Selects which member of the union this object is.",
            };
            if (!required.Any(r => (string?)r == tag)) required.Add(tag);
            schema["required"] = required;

            schema["oneOf"] = new JsonArray(derived.Select(d => (JsonNode?)Reference(d.DerivedType, schemas, isRequest)).ToArray());
            schema["description"] = $"A discriminated union: `{tag}` selects "
                + string.Join(" or ", derived.Select(d => $"`{d.TypeDiscriminator}`")) + ".";
        }
        return schema;
    }

    /// <summary>Whether a client may OMIT this field — which is not the same question in both directions.
    ///
    /// <para>NULLABLE is the signal on both sides: an absent field means "unchanged"/"not asked", and that
    /// distinction is load-bearing (`toFolder` absent vs `""`).</para>
    ///
    /// <para>On a REQUEST a non-nullable VALUE type is optional too, because the deserializer supplies its
    /// default and absence is the normal way to say it. `fetch` with no `init` is an ordinary incremental fetch
    /// and `push` with no `force` is an ordinary push — both were marked REQUIRED, so the document told a
    /// generated client it had to send `init: false` and `force: false` to make a plain call.</para>
    ///
    /// <para>On a RESPONSE the same type IS required: `System.Text.Json` writes every property, so `accepted`,
    /// `duration` and `librariesRefreshed` are always on the wire and a client can rely on them being there.</para></summary>
    private static bool IsOptional(PropertyInfo p, bool isRequest)
    {
        if (!p.PropertyType.IsValueType) return new NullabilityInfoContext().Create(p).WriteState != NullabilityState.NotNull;
        return isRequest || Nullable.GetUnderlyingType(p.PropertyType) != null;
    }

    private static JsonNode TypeSchema(Type t, JsonObject schemas, bool isRequest)
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
                ["additionalProperties"] = TypeSchema(t.GetGenericArguments()[1], schemas, isRequest),
            };

        if (t != typeof(string) && typeof(IEnumerable).IsAssignableFrom(t))
        {
            var item = t.IsArray ? t.GetElementType()! : t.GetGenericArguments().FirstOrDefault() ?? typeof(object);
            return new JsonObject { ["type"] = "array", ["items"] = TypeSchema(item, schemas, isRequest) };
        }

        if (t.IsClass || (t.IsValueType && !t.IsPrimitive)) return Reference(t, schemas, isRequest);
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
        // THE SECOND VOCABULARY. A push answers refusals as conflicts, so these reach a client on
        // `PushConflict.code` and never as an error frame — they were observable and undocumented.
        ["conflictCodes"] = new JsonObject
        {
            ["gate"] = new JsonArray(ConflictCodes.Gate.Select(c => (JsonNode?)c).ToArray()),
            ["fromBridge"] = new JsonArray(ConflictCodes.FromBridge.Select(c => (JsonNode?)c).ToArray()),
            ["network"] = new JsonArray(ConflictCodes.Network.Select(c => (JsonNode?)c).ToArray()),
            ["projectRow"] = ConflictCodes.ProjectName,
        },
        // The wire VALUES only — `Vendors` also carries the display spellings, which are a UI concern.
        ["vendors"] = new JsonArray(Vendors.Codesys, Vendors.Twincat),
        ["statuses"] = new JsonArray(Consts(typeof(HealthStatus)).Select(c => (JsonNode?)c).ToArray()),
        ["severities"] = new JsonArray(Consts(typeof(Severity)).Select(c => (JsonNode?)c).ToArray()),
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

    /// <summary>EVERY OP DECLARES WHAT IT CAN ANSWER WITH. The whole point of that table is debugging: someone
    /// staring at a failure wants the CLOSED set of codes the op can produce. An op with no row would silently
    /// document an empty set, which is worse than no table at all.</summary>
    [Fact]
    public void Every_op_declares_its_outcomes()
    {
        Assert.Equal(OpNames().OrderBy(x => x, StringComparer.Ordinal).ToList(),
                     Outcomes.Keys.OrderBy(x => x, StringComparer.Ordinal).ToList());
    }

    /// <summary>AND EVERY CODE IT NAMES IS A REAL ONE — a typo would document a code no client can ever match
    /// against, which is the one way a debugging aid makes debugging worse.</summary>
    [Fact]
    public void Every_declared_error_code_exists()
    {
        var known = new HashSet<string>(Consts(typeof(BridgeErrorCodes)), StringComparer.Ordinal);
        foreach (var (op, row) in Outcomes)
            foreach (var code in row.Errors)
                Assert.True(known.Contains(code),
                    $"op '{op}' names '{code}', which is not a BridgeErrorCodes value.");
    }

    /// <summary>EVERY CODE IS REACHABLE SOMEWHERE — the converse of the gate above, and the one that was
    /// missing.
    ///
    /// <para>`Every_declared_error_code_exists` checks declared ⊆ enum. Nothing checked enum ⊆ declared, which
    /// is why six of the ten codes sat in `BridgeErrorCodes` published by no op and looking unreachable: they
    /// arrive as CONFLICTS, not frames, and there was no place to say so. A code a client can never observe is
    /// a lie in the enum; a code it can observe and that appears in no document is worse.</para></summary>
    [Fact]
    public void Every_error_code_is_reachable_as_a_frame_or_a_conflict()
    {
        var asFrame = Outcomes.Values.SelectMany(o => o.Errors).ToHashSet(StringComparer.Ordinal);
        var asConflict = ConflictCodes.FromBridge.ToHashSet(StringComparer.Ordinal);

        foreach (var code in Consts(typeof(BridgeErrorCodes)))
            Assert.True(asFrame.Contains(code) || asConflict.Contains(code),
                $"'{code}' is in BridgeErrorCodes and no op declares it as an error frame, and it is not listed "
                + "as a conflict code either — so nothing tells a client it exists. Declare it on the op that "
                + "raises it, add it to ConflictCodes.FromBridge, or delete it.");
    }

    /// <summary>EVERY NETWORK_* THE ENGINE RAISES IS A PINNED CONST. Contracts holds no Engine reference, so
    /// the Engine cannot import these — the check runs the other way, over the source, which is also what
    /// stops the family drifting back into loose literals. A phantom code (`NETWORK_NESTED_EXPR`, cited in a
    /// DTO comment and existing nowhere) is what this prevents.</summary>
    [Fact]
    public void Every_network_conflict_code_is_published()
    {
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (root != null && !File.Exists(Path.Combine(root.FullName, "packages", "volt-cli", "Volt.sln")))
            root = root.Parent;
        Assert.NotNull(root);
        var engine = Path.Combine(root!.FullName, "packages", "volt-cli", "src", "Volt.Engine");

        var published = ConflictCodes.Network.ToHashSet(StringComparer.Ordinal);
        var raised = Directory.EnumerateFiles(engine, "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}")
                     && !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}"))
            .SelectMany(f => System.Text.RegularExpressions.Regex
                .Matches(File.ReadAllText(f), "\"(NETWORK_[A-Z_]+)\"")
                .Select(m => (File: Path.GetFileName(f), Code: m.Groups[1].Value)))
            .ToList();

        Assert.NotEmpty(raised);   // the regex must see the Engine, or this proves nothing
        foreach (var (file, code) in raised)
            Assert.True(published.Contains(code),
                $"{file} raises '{code}', which is not in ConflictCodes.Network — clients observe these on "
                + "PushConflict.code, so an unpublished one is a code nobody can look up.");
    }

    /// <summary>EVERY GATE CODE IS ACTUALLY PRODUCED. Same direction as the NETWORK check above and for the
    /// same reason — Contracts holds no Engine reference, so the family can only be checked against the source
    /// that raises it.
    ///
    /// <para>This family is the one most likely to rot into a lie: its four members describe four outcomes of
    /// ONE function, and deleting a branch there leaves a published code no client will ever see. That is
    /// exactly the state all four were in before they had codes at all.</para></summary>
    [Fact]
    public void Every_gate_conflict_code_is_produced()
    {
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (root != null && !File.Exists(Path.Combine(root.FullName, "packages", "volt-cli", "Volt.sln")))
            root = root.Parent;
        Assert.NotNull(root);
        var source = File.ReadAllText(Path.Combine(root!.FullName, "packages", "volt-cli",
                                                   "src", "Volt.Engine", "Sync", "PushConflicts.cs"));

        foreach (var name in typeof(ConflictCodes).GetFields(BindingFlags.Public | BindingFlags.Static)
                     .Where(f => f.IsLiteral && f.FieldType == typeof(string))
                     .Where(f => ConflictCodes.Gate.Contains((string)f.GetRawConstantValue()!))
                     .Select(f => f.Name))
            Assert.True(source.Contains($"ConflictCodes.{name}", StringComparison.Ordinal),
                $"ConflictCodes.{name} is published in the Gate family but PushConflicts.cs never raises it — "
                + "a code a client can never observe is a lie in the vocabulary.");
    }

    /// <summary>EVERY CODE HAS A ROW ON THE PAGE. The generated tables cannot go stale; the HAND-WRITTEN ones
    /// can, and this is the page a client author reads to find out what a code means.
    ///
    /// <para>It had gone stale twice over by the time this was written: <c>UNREADABLE</c> had no row at all,
    /// <c>BAD_REQUEST</c>'s row said a malformed body arrives as <c>INTERNAL_ERROR</c> (it does not any more),
    /// and the conflict section said "five of these codes" over a list that had grown to seven. Prose about a
    /// closed vocabulary is exactly the thing a gate should hold, because nobody re-reads it.</para>
    ///
    /// <para>Checks PRESENCE, not wording — the explanation is a human's job and pinning it would make a
    /// clearer sentence a test failure.</para></summary>
    [Fact]
    public void Every_code_has_a_row_on_the_wire_page()
    {
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (root != null && !File.Exists(Path.Combine(root.FullName, "packages", "volt-cli", "Volt.sln")))
            root = root.Parent;
        Assert.NotNull(root);
        var page = File.ReadAllText(Path.Combine(root!.FullName, "packages", "volt-cli", "docs", "wire.html"));

        foreach (var code in Consts(typeof(BridgeErrorCodes)).Concat(ConflictCodes.Gate))
            Assert.True(page.Contains($"class=\"name\">{code}<", StringComparison.Ordinal),
                $"'{code}' has no row in docs/wire.html — a code a client can observe and cannot look up.");

        // The count in the prose is the other half: a sentence that says "five" over seven rows is worse than
        // no sentence, because it reads as a closed list and the reader stops looking.
        Assert.Contains($"{Spell(ConflictCodes.FromBridge.Length)} of these codes", page, StringComparison.Ordinal);
    }

    private static string Spell(int n) => n switch
    {
        4 => "Four", 5 => "Five", 6 => "Six", 7 => "Seven", 8 => "Eight", 9 => "Nine", 10 => "Ten",
        _ => n.ToString(),
    };

    /// <summary>THE OP COUNT IN THE PROSE IS THE OP COUNT IN THE VOCABULARY. Two pages open by stating it, and
    /// a number in a sentence is the last thing anyone updates when an op is added or removed — deleting `init`
    /// left "Eight ops" on the page that exists to describe them.</summary>
    [Theory]
    [InlineData("wire.html")]
    [InlineData("index.html")]
    public void The_op_count_on_the_page_is_the_op_count_on_the_wire(string page)
    {
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (root != null && !File.Exists(Path.Combine(root.FullName, "packages", "volt-cli", "Volt.sln")))
            root = root.Parent;
        Assert.NotNull(root);
        var html = File.ReadAllText(Path.Combine(root!.FullName, "packages", "volt-cli", "docs", page));
        var n = OpNames().Count();

        Assert.True(html.Contains($"{Spell(n)} ops", StringComparison.Ordinal)
                 || html.Contains($"{n} ops", StringComparison.Ordinal),
            $"docs/{page} does not say there are {n} ops, and the wire has {n}.");
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
