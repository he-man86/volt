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
using Volt.Tests.Shared;

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
/// <see cref="Ops"/>, <see cref="BridgeErrorCodes"/>, <see cref="ItemKind"/>, <see cref="Volt.Engine.Seam.IVendorDriver"/> — so
/// the doc cannot describe a field the wire does not have or miss a kind the walk emits. The prose around the
/// tables is hand-written in the HTML; the FACTS are not.</para>
///
/// <para>Regenerate with <c>VOLT_WRITE_DOCS=1 dotnet test test/Volt.Engine.Tests</c>. Otherwise this FAILS on
/// any difference, which is what makes the artefacts trustworthy.</para>
/// </summary>
public class DocDataTests
{
    /// <summary>The coded errors an op can answer with as an ERROR FRAME beyond the <see cref="CommonFrameCodes"/>, and how
    /// else it can fail. Traced through <c>BridgePipeHost</c>'s dispatch, <c>OpGuard</c> and each service's own catch arms.
    /// A push catches every refusal of an op and answers it as a CONFLICT; a build catches everything after its guard and
    /// answers <c>success:false</c>; the reads isolate a body that will not materialize into <c>unreadable</c>.</summary>
    private const string UnverifiedProjectFrame =
        "ITEM_UNVERIFIED as an error frame (TwinCAT): the Solution Explorer cannot vouch for the PLC project itself, so the "
        + "walk stops before anything is read. Fix what stops the IDE enumerating it.";

    private const string WriteNamesItsProject =
        "BAD_REQUEST when `expectedPlatform` or `expectedProjectName` is absent or empty, naming each missing member, before "
        + "anything is walked: a write names the project it writes. The reads keep both optional.";

    private const string BusyFrame =
        "IDE_BUSY when another push or build holds the IDE: refused at once, before the IDE is touched, so nothing is "
        + "applied or compiled. Reads and `health` are never refused with it. Wait for the running op, then try once.";

    /// <summary>The frame codes beyond <see cref="BridgeErrorCodes"/>: exactly the one gate code a walk can stop on.</summary>
    private static readonly string[] GateCodesAsFrames = { ConflictCodes.ItemUnverified };

    /// <summary>The error frames EVERY op may answer: the envelope's (<c>PROTOCOL_MISMATCH</c>, <c>BAD_REQUEST</c>), the IDE
    /// the bridge cannot serve (<c>IDE_UNSUPPORTED</c> — never on <c>health</c>, which reports it), and Volt's own broken
    /// invariant (<c>INTERNAL_ERROR</c>). Each op's own codes follow them in its <c>x-errorCodes</c>.</summary>
    private static readonly string[] CommonFrameCodes =
        { BridgeErrorCodes.ProtocolMismatch, BridgeErrorCodes.BadRequest, BridgeErrorCodes.IdeUnsupported, BridgeErrorCodes.InternalError };

    /// <summary>The error frames <paramref name="op"/> can answer with: the common set, then the op's own.</summary>
    private static IEnumerable<string> FrameCodesOf(string op) =>
        CommonFrameCodes.Where(c => !(op == Ops.Health && c == BridgeErrorCodes.IdeUnsupported)).Concat(Outcomes[op].Errors);

    /// <summary>The progress a read op sends while it walks.</summary>
    private const string WalkFrames =
        "Progress frames start with the walk: one per application as the walk finishes it, `phase: \"walking\"`, `done` "
        + "applications of `total` (a TwinCAT PLC project is an application; CODESYS states no `total`). The item frames "
        + "follow: the first with its phase and `done` 0 of `total` items, then one every 25 items and one at the last.";

    private static readonly Dictionary<string, (string[] Errors, string[] Outcomes)> Outcomes = new()
    {
        [Ops.Health] = (Array.Empty<string>(), new[]
        {
            "Answers from the bridge's cached snapshot, never on the IDE thread: it answers while a push or build runs, "
            + "never reports PLC_DISCONNECTED, and is not gated by `disconnect` — while paused every row is `idle`.",
            "Answers on an IDE the bridge cannot serve: `unsupported` carries the sentence every other op answers "
            + "IDE_UNSUPPORTED with, and every row is idle. An IDE is refused for what it lacks, never for its version number.",
            "States the bridge identity at top level, rows or not: `productName`, `productVersion`, `productVendor`, "
            + "`ideVersion` (the platform under the product) and `bridgeVersion` (the stamped release, or `(dev) <commit>`). "
            + "Each is absent when its source does not answer, never filled from another.",
            "States the bridge's catalog, from its own declarations: `ops` (every op it answers), `languages` (every language "
            + "it writes as `IMPLEMENTATION <LANG>`) and `kinds` (every item kind, by extension, and whether a push writes it). "
            + "A value the bridge does not list there is one it never sends.",
            "A row's `dirty` is absent when the IDE did not answer whether the project is saved: unknown, never clean.",
        }),
        [Ops.Connect] = (new[] { BridgeErrorCodes.PlcDisconnected }, new[]
        {
            "PLC_DISCONNECTED when the bridge does not end up serving the named project: it attached nothing, or "
            + "something other than the project named. `project` is compared like a path, ignoring case.",
            "A refused connect still leaves the bridge resumed: a `disconnect` racing a connect wins.",
        }),
        [Ops.Disconnect] = (Array.Empty<string>(), new[]
        {
            "Sets a flag and answers, without the IDE thread: it answers while a push runs, and that push runs to "
            + "completion. The flag stops the next op, never the current one.",
        }),
        [Ops.Refs] = (new[] { BridgeErrorCodes.PlcDisconnected, BridgeErrorCodes.WrongProject, ConflictCodes.ItemUnverified }, new[]
        {
            UnverifiedProjectFrame,
            "An item whose body will not materialize is no error: it is in `unreadable` with its code, and keeps a stable "
            + "version so a pull does not read it as deleted.",
            "A read is retried once through a transient IDE failure; `health` reports the session degraded meanwhile.",
            WalkFrames,
            "A `refs` that arrives while one with the same body runs joins it: it receives that one's progress frames from "
            + "then on and the same terminal frame. Nothing is kept once it answers: the next `refs` walks again.",
        }),
        [Ops.Fetch] = (new[] { BridgeErrorCodes.PlcDisconnected, BridgeErrorCodes.WrongProject, ConflictCodes.ItemUnverified }, new[]
        {
            UnverifiedProjectFrame,
            "BAD_REQUEST for a fetch with neither `knownItems` nor `onlyItems` nor `init: true`.",
            "A known path under a folder the walk could not read is never in `removed`; one absent from a folder it did "
            + "read is.",
            "Items that would not materialize are in `unreadable`, not raised.",
            WalkFrames,
        }),
        [Ops.Push] = (new[] { BridgeErrorCodes.PlcDisconnected, BridgeErrorCodes.WrongProject, BridgeErrorCodes.StaleProjectVersion,
                              ConflictCodes.ItemUnverified, BridgeErrorCodes.IdeBusy }, new[]
        {
            UnverifiedProjectFrame,
            BusyFrame,
            WriteNamesItsProject,
            "STALE_PROJECT_VERSION when `expectedProjectVersion` is not the project's version: nothing is applied, and "
            + "`error.data.currentProjectVersion` is the version the IDE holds.",
            "Writes into the open project and saves nothing: the engineer saves.",
            "A refused op is no error frame: it is a conflict in the result, named by the op's `name`, with its code. "
            + "Every op `conflicts` does not name landed in full.",
            "A refusal decidable before the first write lands nothing: each refused op answers its code, every other op "
            + "NOT_ATTEMPTED.",
            "A refusal during the apply lands the ops before it and stops: the refused op answers its code, every later op "
            + "NOT_ATTEMPTED.",
            "`newProjectVersion` is present exactly when something landed; `newItems` and `removed` are what the push "
            + "changed, so `baseline − removed + newItems` is the IDE after it.",
            "What of a refused op the IDE kept is stated on its conflict: `partiallyApplied`, `renamedTo`, `remains` — each "
            + "absent when it does not apply.",
        }),
        [Ops.Build] = (new[] { BridgeErrorCodes.PlcDisconnected, BridgeErrorCodes.WrongProject, BridgeErrorCodes.IdeBusy,
                               BridgeErrorCodes.Unsupported }, new[]
        {
            BusyFrame,
            WriteNamesItsProject,
            "UNSUPPORTED for a project that holds no application (a CODESYS library project): there is nothing to build.",
            "BAD_REQUEST for an `applications` root the project does not hold, or an empty list, before anything is built. "
            + "Named roots build those applications alone and report only their diagnostics; absent, every application is "
            + "built.",
            "A project that does not compile is `success: false` with its diagnostics, never an error frame; a compile "
            + "that throws answers `success: false` with the reason as an error diagnostic.",
            "`success` is each vendor's own signal: CODESYS has it from its diagnostics, TwinCAT from the IDE's count of "
            + "failed projects. A failed build always carries an error diagnostic: when the IDE wrote none Volt could read, "
            + "one says so, with no position.",
            "`severity` is absent when the vendor's value is not in its host's declared table. `line` and `column` are "
            + "1-based and absent when the vendor stated none: CODESYS states no position, TwinCAT a line and no column.",
            "Compiles what the IDE holds in memory; Volt calls no save. On TwinCAT a build saves changed documents, as "
            + "XAE's own Build does.",
        }),
        [Ops.Grep] = (new[] { BridgeErrorCodes.PlcDisconnected, BridgeErrorCodes.WrongProject, ConflictCodes.ItemUnverified }, new[]
        {
            UnverifiedProjectFrame,
            "BAD_REQUEST, before the walk, for an empty `pattern`, a regular expression that does not compile (the parse "
            + "error named) or a `limit` outside 1–1000; and, with no partial answer, for a pattern that takes longer than "
            + "100 ms on one line.",
            "What it searches is what `fetch` ships as text, from the same walk: a matched line is the fetched line at that "
            + "number. An `unreadable` item, and a body that reads `IMPLEMENTATION <LANG> UNSUPPORTED`, are in `notSearched` "
            + "with a code; libraries are not searched and not listed.",
            "The answer is bounded: at most `limit` matches, counted up to 10000 in `totalMatches`; `truncated` when more "
            + "were found than answered. A line longer than 500 UTF-16 code units is cut, ends in `…` and carries `cut: true`.",
        }),
    };

    private static readonly (string Op, Type? Param, Type Result, string Summary)[] Methods =
    {
        (Ops.Health, null, typeof(HealthResponse),
            "Liveness, the bridge's catalog and the connectable projects, from the bridge's cached snapshot — never on the " +
            "IDE thread, so it answers while a push or build runs. While paused every row reads idle."),
        (Ops.Connect, typeof(ConnectRequest), typeof(EmptyResult),
            "Bind a project and resume service. An absent or empty `project` means \"serve whatever you have\". " +
            "Refuses with PLC_DISCONNECTED unless the bridge ends up serving the named project."),
        (Ops.Disconnect, null, typeof(EmptyResult),
            "Pause the bridge: refuse sync until the next connect, tear nothing down. Answers even while a push " +
            "is running, and that push runs to completion."),
        (Ops.Refs, typeof(RefsRequest), typeof(RefsResponse),
            "The version map without any content: the path → version map and `projectVersion`. This is what a client " +
            "compares against to decide what to fetch."),
        (Ops.Fetch, typeof(FetchRequest), typeof(FetchResponse),
            "Item CONTENT. `knownItems` narrows the answer to what changed; `onlyItems` restricts it to a named subset. " +
            "Naming a `.library` returns its manifest and every signature of that library, in the folder and with the " +
            "bytes a full fetch writes; `libraryManifestOnly` answers the manifest alone. Graphical bodies arrive as " +
            "network text."),
        (Ops.Push, typeof(PushRequest), typeof(PushResponse),
            "Apply ops to the IDE. Every text-decidable refusal runs in a pre-flight before the first write. " +
            "`expectedProjectVersion` is the lease; per-item `ifVersion` is the optimistic guard."),
        (Ops.Build, typeof(BuildRequest), typeof(BuildResponse),
            "Compile the bound project and return the IDE's own diagnostics."),
        (Ops.Grep, typeof(GrepRequest), typeof(GrepResponse),
            "Search the text `fetch` ships for each item, line by line, and answer the matching LINES — path, " +
            "1-based line, the line as fetched — with each matched item's `refs` version, never whole sources. A " +
            "regular expression or `literal` text, ignoring case unless `caseSensitive`; `paths` globs limit what is " +
            "searched. What could not be searched is in `notSearched`."),
    };

    /// <summary>The three facets of <see cref="Volt.Engine.Seam.IVendorDriver"/>, in the order the driver page presents them.</summary>
    private static readonly (string Name, Type Type, string Role)[] Facets =
    {
        ("IVendorSession", typeof(Volt.Engine.Seam.IVendorSession), "Is there an IDE, which project, the threading rule and what the host declares."),
        ("IVendorTree", typeof(Volt.Engine.Seam.IVendorTree), "Navigate and mutate structure. No source text."),
        ("IVendorStore", typeof(Volt.Engine.Seam.IVendorStore), "Content in and out, in Volt's own vocabulary."),
    };

    private static string DocsDir()
    {
        var dir = RepoPaths.RepoDir();
        return Path.Combine(dir!.FullName, "packages", "volt-cli", "docs");
    }

    private static bool Writing => Environment.GetEnvironmentVariable("VOLT_WRITE_DOCS") == "1";

    private const string Regenerate = "Regenerate with VOLT_WRITE_DOCS=1 dotnet test test/Volt.Engine.Tests";

    // ── the shipped hosts' declarations ─────────────────────────────────────────────────────────────

    /// <summary>One shipped host's declaration, as its own source states it: the vendor row (<c>VendorRow Row = new(id,
    /// name)</c>), the languages it declares shown and hidden, and that its kinds are the IEC table.
    ///
    /// <para>READ FROM THE HOSTS' SOURCE, not referenced: the CODESYS host is net48 and the TwinCAT host net10-windows,
    /// neither loadable here. Every <c>*.Seam.cs</c> under a <c>Volt.Ide.*</c> project is a host, so a third host is in
    /// the document the day its declaration is written, and a host whose declaration this cannot read fails the
    /// generation by name rather than dropping out of it.</para></summary>
    private sealed record HostDeclaration(string File, string Vendor, string Display, string[] Shown, string[] Hidden);

    private static IReadOnlyList<HostDeclaration> HostDeclarations()
    {
        var src = Path.Combine(RepoPaths.RepoDir()!.FullName, "packages", "volt-cli", "src");
        var hosts = Directory.EnumerateDirectories(src, "Volt.Ide.*")
            .SelectMany(d => Directory.EnumerateFiles(d, "*.Seam.cs", SearchOption.AllDirectories))
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}")
                     && !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}"))
            .OrderBy(f => f, StringComparer.Ordinal)
            .Select(f =>
            {
                var text = File.ReadAllText(f);
                var row = System.Text.RegularExpressions.Regex.Match(text, @"VendorRow Row = new\(""([a-z]+)"", ""([^""]+)""\)");
                if (!row.Success) throw new InvalidOperationException($"{f} declares no `VendorRow Row = new(\"<id>\", \"<name>\")`");
                if (!text.Contains("IecFormat.KindRows", StringComparison.Ordinal))
                    throw new InvalidOperationException($"{f} declares kinds other than IecFormat.KindRows; teach the generator its rows");
                string[] Langs(string how) => System.Text.RegularExpressions.Regex
                    .Matches(text, @"LanguageRow\." + how + @"\(Languages\.(\w+)")
                    .Select(m => (string)typeof(Volt.Engine.Format.Body.Languages).GetField(m.Groups[1].Value)!.GetRawConstantValue()!)
                    .ToArray();
                return new HostDeclaration(Path.GetFileName(f), row.Groups[1].Value, row.Groups[2].Value, Langs("Shown"), Langs("Hidden"));
            })
            .ToList();
        if (hosts.Count == 0) throw new InvalidOperationException($"no host declaration (*.Seam.cs) under {src}\\Volt.Ide.*");
        return hosts;
    }

    private static string[] Vendors() => HostDeclarations().Select(h => h.Vendor).Distinct().OrderBy(v => v, StringComparer.Ordinal).ToArray();
    private static string[] ShownLanguages() => HostDeclarations().SelectMany(h => h.Shown).Distinct().OrderBy(l => l, StringComparer.Ordinal).ToArray();
    private static string[] DeclaredLanguages() =>
        HostDeclarations().SelectMany(h => h.Shown.Concat(h.Hidden)).Distinct().OrderBy(l => l, StringComparer.Ordinal).ToArray();
    private static string[] KindExtensions() =>
        Volt.Engine.Format.St.IecFormat.KindRows.Where(r => r.Extension is not null).Select(r => r.Extension!)
            .Distinct().OrderBy(e => e, StringComparer.Ordinal).ToArray();

    /// <summary>A row's status: the three words a <c>ProjectEntry.status</c> carries.</summary>
    private static readonly string[] RowStatuses = { HealthStatus.Idle, HealthStatus.Healthy, HealthStatus.Degraded };

    /// <summary>Every error-frame code: the bridge's vocabulary plus the one gate code a walk stops on.</summary>
    private static string[] FrameCodeVocabulary() => Consts(typeof(BridgeErrorCodes)).Concat(GateCodesAsFrames).ToArray();

    /// <summary>Every code a conflict carries: the gate's, the bridge's the push catches, NOT_ATTEMPTED and the
    /// network-text ones.</summary>
    private static string[] ConflictCodeVocabulary() =>
        ConflictCodes.Gate.Concat(ConflictCodes.FromBridge).Append(ConflictCodes.NotAttempted).Concat(ConflictCodes.Network).ToArray();

    /// <summary>The codes an <c>unreadable</c>, <c>unreadableNodes</c> or <c>notSearched</c> entry carries: the object the IDE
    /// did not give (<c>UNREADABLE</c>), the one Volt's text has no spelling for, or that sits where Volt does not read
    /// (<c>UNSUPPORTED</c>), and the one whose read calls an API this IDE's version lacks (<c>IDE_UNSUPPORTED</c> — CODESYS
    /// 3.5.18.30's Project Settings). A read that failed with a code of its own keeps that code.</summary>
    private static readonly string[] UnreadableCodes = { BridgeErrorCodes.Unreadable, BridgeErrorCodes.Unsupported, BridgeErrorCodes.IdeUnsupported };

    /// <summary>Which channel(s) each code arrives on: an error <c>frame</c> (some op declares it), a push
    /// <c>conflict</c>, an <c>unreadable</c> entry.</summary>
    private static JsonArray BuildCodeChannels()
    {
        var frames = Ops_().ToDictionary(o => o, o => FrameCodesOf(o).ToHashSet(StringComparer.Ordinal));
        var conflicts = ConflictCodeVocabulary().ToHashSet(StringComparer.Ordinal);
        return new JsonArray(FrameCodeVocabulary().Concat(ConflictCodeVocabulary()).Distinct()
            .Select(code =>
            {
                var channels = new List<string>();
                var ops = frames.Where(f => f.Value.Contains(code)).Select(f => f.Key).ToList();
                if (ops.Count > 0) channels.Add("frame");
                if (conflicts.Contains(code)) channels.Add("conflict");
                if (UnreadableCodes.Contains(code)) channels.Add("unreadable");
                return (JsonNode?)new JsonObject
                {
                    ["code"] = code,
                    ["channels"] = new JsonArray(channels.Select(c => (JsonNode?)c).ToArray()),
                    ["frameOn"] = new JsonArray(ops.Select(o => (JsonNode?)o).ToArray()),
                };
            }).ToArray());
    }

    private static IEnumerable<string> Ops_() => Methods.Select(m => m.Op);

    // ── the OpenRPC document ────────────────────────────────────────────────────────────────────────

    /// <summary>The frame, stated once (design B5) and generated into <c>info.description</c>.</summary>
    private const string FramingDescription =
        "The wire a Volt bridge serves over a Windows NAMED PIPE — `volt.bridge.<vendor>.<pid>`, one per live IDE; a "
        + "client discovers the pipes by prefix. ONE REQUEST PER CONNECTION: the client writes one request and reads the "
        + "answer; the bridge closes the connection after the terminal frame. Concurrent requests use separate connections.\n\n"
        + "ENCODING: UTF-8 without a BOM. Every frame is one JSON object on one line ending in `\\n`. A request may end in "
        + "`\\r\\n`; a request that starts with a BOM is BAD_REQUEST; a request with no `\\n` is answered once the client "
        + "closes its side. A request is at most 64 MiB, the newline excluded.\n\n"
        + "REQUEST: `{ \"op\": \"<method>\", \"protocol\": 1, \"body\": { ... } }` (schema `Request`). `protocol` is a JSON "
        + "integer; a request that states none or another is refused PROTOCOL_MISMATCH before its body is read. `body` "
        + "absent is `{}`; a `null` body, a member the method does not have, or an unknown envelope member is "
        + "BAD_REQUEST.\n\n"
        + "ANSWER: zero or more `{\"progress\": ProgressFrame}`, then exactly one `{\"result\": <the method's result>}` or "
        + "`{\"error\": {\"code\", \"message\", \"data\"?}}` (schema `ErrorFrame`). A value a bridge does not list in its "
        + "`health` catalog (`ops`, `languages`, `kinds`) is one it never sends.\n\n"
        + "GENERATED from the C# contract types and the hosts' declarations by `DocDataTests`; edit those, not this file.";

    private static JsonObject BuildSpec()
    {
        Directions.Clear();
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
                // OPTIONAL: an absent body is `{}` (design section 1).
                ["params"] = param is null
                    ? new JsonArray()
                    : new JsonArray(new JsonObject
                    {
                        ["name"] = "body",
                        ["required"] = false,
                        ["schema"] = Reference(param, schemas, isRequest: true),
                    }),
            };
            // A specification EXTENSION (`x-`), not OpenRPC's own `errors` field: that one wants JSON-RPC
            // INTEGER codes and these are strings. Inventing numbers to fit the shape would put a value in the
            // artefact that no part of this wire ever sends.
            m["x-errorCodes"] = new JsonArray(FrameCodesOf(op).Select(e => (JsonNode?)e).ToArray());
            m["x-outcomes"] = new JsonArray(Outcomes[op].Outcomes.Select(o => (JsonNode?)o).ToArray());
            m["result"] = new JsonObject { ["name"] = "result", ["schema"] = Reference(result, schemas, isRequest: false) };
            methods.Add(m);
        }

        // The frame around every method: the request envelope, the progress and the error frame, and the code vocabularies.
        schemas["Request"] = new JsonObject
        {
            ["type"] = "object",
            ["description"] = "The request envelope: one per connection.",
            ["properties"] = new JsonObject
            {
                ["op"] = new JsonObject { ["type"] = "string", ["enum"] = Strings(Ops_()) },
                ["protocol"] = new JsonObject { ["type"] = "integer", ["const"] = WireProtocol.Version },
                ["body"] = new JsonObject { ["type"] = "object", ["description"] = "The method's params; absent is `{}`." },
            },
            ["required"] = new JsonArray("op", "protocol"),
            ["additionalProperties"] = false,
        };
        Reference(typeof(ProgressFrame), schemas, isRequest: false);
        schemas["BridgeErrorCode"] = new JsonObject
        {
            ["type"] = "string",
            ["description"] = "A Volt code: why an op was refused (error frame), why an op of a push did not land (conflict), "
                + "or why an object was not read (unreadable). The channels each arrives on are in the code table.",
            ["enum"] = Strings(FrameCodeVocabulary()),
        };
        schemas["ConflictCode"] = new JsonObject
        {
            ["type"] = "string",
            ["description"] = "The code of a push conflict: the gate's, a bridge refusal of the op, NOT_ATTEMPTED, or a "
                + "network-text refusal of the body (every NETWORK_ code, and only one, comes with the conflict's `line`).",
            ["enum"] = Strings(ConflictCodeVocabulary()),
        };
        schemas["ErrorFrame"] = new JsonObject
        {
            ["type"] = "object",
            ["description"] = "The terminal frame of a refused op. `data` is present for the codes that carry facts: "
                + "PROTOCOL_MISMATCH (`ProtocolMismatchData`) and STALE_PROJECT_VERSION (`StaleProjectVersionData`).",
            ["properties"] = new JsonObject
            {
                ["error"] = new JsonObject
                {
                    ["type"] = "object",
                    ["properties"] = new JsonObject
                    {
                        ["code"] = Ref("BridgeErrorCode"),
                        ["message"] = new JsonObject { ["type"] = "string" },
                        ["data"] = new JsonObject
                        {
                            ["oneOf"] = new JsonArray(Reference(typeof(ProtocolMismatchData), schemas, isRequest: false),
                                                      Reference(typeof(StaleProjectVersionData), schemas, isRequest: false)),
                        },
                    },
                    ["required"] = new JsonArray("code", "message"),
                },
            },
            ["required"] = new JsonArray("error"),
        };

        var vendors = Vendors();
        return new JsonObject
        {
            ["openrpc"] = "1.2.6",
            ["info"] = new JsonObject
            {
                ["title"] = "Volt bridge",
                // The wire protocol the document describes; every request states it.
                ["version"] = WireProtocol.Version.ToString(System.Globalization.CultureInfo.InvariantCulture),
                ["description"] = FramingDescription,
            },
            ["servers"] = new JsonArray(new JsonObject
            {
                ["name"] = "named-pipe",
                ["url"] = "npipe://./pipe/volt.bridge.{vendor}.{pid}",
                ["summary"] = "One pipe per live IDE. Discover by PREFIX — the pid suffix changes when the IDE restarts.",
                ["variables"] = new JsonObject
                {
                    ["vendor"] = new JsonObject { ["default"] = vendors[0], ["enum"] = Strings(vendors) },
                    ["pid"] = new JsonObject { ["default"] = "0", ["description"] = "The IDE process id the bridge is attached to." },
                },
            }),
            ["methods"] = methods,
            ["components"] = new JsonObject { ["schemas"] = Sorted(schemas) },
        };
    }

    private static JsonArray Strings(IEnumerable<string> values) => new(values.Select(v => (JsonNode?)v).ToArray());
    private static JsonObject Ref(string schema) => new() { ["$ref"] = "#/components/schemas/" + schema };

    /// <summary>The schemas in name order, so the document does not depend on the order they were first reached in.</summary>
    private static JsonObject Sorted(JsonObject schemas)
    {
        var sorted = new JsonObject();
        foreach (var name in schemas.Select(kv => kv.Key).OrderBy(k => k, StringComparer.Ordinal).ToList())
        {
            var node = schemas[name];
            schemas.Remove(name);
            sorted[name] = node;
        }
        return sorted;
    }

    /// <summary>The members whose values are a closed vocabulary or a fact a C# type cannot state: the vocabulary from
    /// its declaration (principle B), or the meaning of a member a bridge never sends.</summary>
    private static JsonNode? Override(Type declaring, string property) => (declaring.Name, property) switch
    {
        (nameof(ProjectEntry), nameof(ProjectEntry.Vendor)) => EnumOf(Vendors()),
        (nameof(ProjectEntry), nameof(ProjectEntry.Status)) => EnumOf(RowStatuses),
        (nameof(BoundRequest), nameof(BoundRequest.ExpectedPlatform)) => EnumOf(Vendors()),
        (nameof(ReadResponse), nameof(ReadResponse.Platform)) => EnumOf(Vendors()),
        (nameof(HealthResponse), nameof(HealthResponse.Languages)) => new JsonObject { ["type"] = "array", ["items"] = EnumOf(ShownLanguages()) },
        (nameof(HealthKind), nameof(HealthKind.Extension)) => EnumOf(KindExtensions()),
        (nameof(UnsupportedBody), nameof(UnsupportedBody.Language)) => EnumOf(DeclaredLanguages()),
        (nameof(BridgeDiagnostic), nameof(BridgeDiagnostic.Severity)) => EnumOf(Consts(typeof(Severity))),
        (nameof(ProgressFrame), nameof(ProgressFrame.Operation)) => EnumOf(Ops_()),
        (nameof(ProgressFrame), nameof(ProgressFrame.Phase)) => EnumOf(ProgressFrame.Phases),
        (nameof(ProgressFrame), nameof(ProgressFrame.PhaseIndex)) or (nameof(ProgressFrame), nameof(ProgressFrame.PhaseCount)) =>
            new JsonObject { ["type"] = "integer", ["description"] = "Never sent by a bridge: the `volt` CLI sets it on the frames it re-emits to its own clients." },
        (nameof(PushConflict), nameof(PushConflict.Code)) => Ref("ConflictCode"),
        (nameof(UnreadableItem), nameof(UnreadableItem.Code)) or (nameof(UnreadableNode), nameof(UnreadableNode.Code))
            or (nameof(NotSearchedItem), nameof(NotSearchedItem.Code)) => Ref("BridgeErrorCode"),
        _ => null,
    };

    private static JsonObject EnumOf(IEnumerable<string> values) => new() { ["type"] = "string", ["enum"] = Strings(values) };

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

    /// <summary>Which direction each emitted schema was reached from, for the duration of ONE generation.
    ///
    /// <para>Cleared at the top of <see cref="BuildSpec"/>, which several facts call. It used to say "reset per
    /// generation" and never was — surviving only because <c>schemas</c> is fresh each time, so the first
    /// encounter always overwrote the entry. That is an implicit invariant nothing defends: reorder the
    /// traversal, add a second entry point, or run two of these in parallel, and the gate throws spuriously.</para></summary>
    private static readonly Dictionary<string, bool> Directions = new(StringComparer.Ordinal);

    /// <summary>JSON Schema for one contract type, from its properties and their <c>JsonPropertyName</c>s.</summary>
    private static JsonObject SchemaOf(Type t, JsonObject schemas, bool isRequest)
    {
        var props = new JsonObject();
        var required = new JsonArray();

        foreach (var p in t.GetProperties(BindingFlags.Public | BindingFlags.Instance)
                           // Only a property NEVER on the wire is left out. A conditional ignore (`WhenWritingNull`: absent
                           // when it does not apply, e.g. `PushConflict.partiallyApplied`) IS a wire field, and dropping it
                           // here published a schema that did not name it.
                           .Where(p => p.GetCustomAttribute<JsonIgnoreAttribute>() is not { Condition: JsonIgnoreCondition.Always }))
        {
            var wireName = p.GetCustomAttribute<JsonPropertyNameAttribute>()?.Name
                           ?? JsonNamingPolicy.CamelCase.ConvertName(p.Name);
            props[wireName] = Override(p.DeclaringType!, p.Name) ?? TypeSchema(p.PropertyType, schemas, isRequest);
            if (!IsOptional(p, isRequest) || SchemaRequired.Contains((t, p.Name))) required.Add(wireName);
        }

        // A union member names its own discriminator value, so its schema can close over every member it has.
        if (t.BaseType?.GetCustomAttribute<JsonPolymorphicAttribute>() is { } basePoly)
        {
            var value = t.BaseType.GetCustomAttributes<JsonDerivedTypeAttribute>().Single(d => d.DerivedType == t).TypeDiscriminator;
            props[basePoly.TypeDiscriminatorPropertyName ?? "$type"] = new JsonObject { ["type"] = "string", ["const"] = value?.ToString() };
        }

        var schema = new JsonObject { ["type"] = "object", ["properties"] = props };
        if (required.Count > 0) schema["required"] = required;
        // A request body is read strictly (WireJson.Request): a member the type does not define is BAD_REQUEST. A
        // union's base leaves it to its members, each of which closes over its own members.
        if (isRequest && t.GetCustomAttribute<JsonPolymorphicAttribute>() is null) schema["additionalProperties"] = false;

        // A DISCRIMINATED UNION IS EMITTED, not described in prose.
        //
        // This used to write a sentence saying `op` selects `set` or `deleteItem` and emit neither — no
        // discriminator, no `oneOf`, and no `SetItemOp`/`DeleteItemOp` schema at all. So the document called
        // "the artefact to hand to another project" described `push`, the only MUTATING op, as taking
        // `{name, ifVersion}`: no `sourceText`, no `to`. A generated client could read but
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

    /// <summary>Members the wire requires whose C# type is nullable for a reason of the READER: the schema requires them.
    /// <c>health.protocol</c> and <c>health.ops</c> are nullable only so the connector can still read a bridge from before them; a write's
    /// identity is nullable so the bridge can tell an absent member from a sent one.</summary>
    private static readonly HashSet<(Type, string)> SchemaRequired = new()
    {
        (typeof(HealthResponse), nameof(HealthResponse.Protocol)), (typeof(HealthResponse), nameof(HealthResponse.Ops)),
        // A write names its project (openspec push-requires-project-identity). Nullable in C# so the bridge can name a
        // missing member in its BAD_REQUEST rather than read an empty default; optional on the reads.
        (typeof(PushRequest), nameof(BoundRequest.ExpectedPlatform)),
        (typeof(PushRequest), nameof(BoundRequest.ExpectedProjectName)),
        (typeof(BuildRequest), nameof(BoundRequest.ExpectedPlatform)),
        (typeof(BuildRequest), nameof(BoundRequest.ExpectedProjectName)),
    };

    /// <summary>Whether a client may OMIT this field — which is not the same question in both directions.
    ///
    /// <para>NULLABLE is the signal on both sides: an absent field means "unchanged"/"not asked", and that
    /// distinction is load-bearing (`to` absent keeps the item where it is).</para>
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
    /// <summary>Each kind that materializes as its own workspace file, with its extensions — the two extension
    /// tables, which are the only definition of "has an extension" there is. A LIST per kind, though every kind has
    /// exactly one today (the DUT had five until openspec push-without-header-check 5.P made every DUT `.dut`).</summary>
    private static readonly Dictionary<string, string[]> FileKinds =
        ItemKind.SourceKindExtensions.Concat(ItemKind.ReferenceKindExtensions)
            .GroupBy(x => x.Kind, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.Select(x => x.Ext).ToArray(), StringComparer.Ordinal);

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
                row["exts"] = FileKinds.TryGetValue(kind, out var exts)
                    ? new JsonArray(exts.Select(e => (JsonNode?)e).ToArray())
                    : null;
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

    // ── the %-lines (object properties) ─────────────────────────────────────────────────────────────

    /// <summary>What each <c>%</c>-line key means, in one sentence — the one hand-written part of the table, guarded by
    /// <see cref="Every_object_property_key_is_on_the_items_page_in_the_writers_spelling"/> (a key with no row fails).
    /// The vendor member each one reads is named, so the page answers "what in the IDE is this?".</summary>
    private static readonly Dictionary<string, string> PropertyMeanings = new(StringComparer.Ordinal)
    {
        ["CLASS"] = "The vendor class the text cannot tell: CHECK <check> (a CODESYS implicit-check function, "
            + "POUObjectCheckFunction), PERSISTENT (a persistent variable list), TEXTLIST_ENUM (a text-list-backed "
            + "enumeration), NVL (a receiving network variable list). Made at the create, never changed in place.",
        ["FOLDER"] = "A MEMBER's folder inside its POU (an item's folder is its path in the workspace).",
        ["EXCLUDE_FROM_BUILD"] = "The object is excluded from the build — BuildProperty.ExcludeFromBuild.",
        ["LINK_ALWAYS"] = "The object is linked even when nothing calls it — BuildProperty.LinkAlways.",
        ["EXTERNAL"] = "The object is implemented externally — BuildProperty.External.",
        ["ENABLE_SYSTEM_CALL"] = "BuildProperty.EnableSystemCall.",
        ["ONLINE_CHANGE_RESERVE"] = "The memory reserved for online change — BuildProperty.MemoryReserveForOnlineChange.",
        ["COMPILER_DEFINES"] = "The object's compiler defines, as an ST string — BuildProperty.CompilerDefines.",
        ["UNDEFINE"] = "One undefine per line, in the vendor's order — BuildProperty.Undefines.",
        ["COMMENT"] = "The object comment, as an ST string — DocumentationProperty.Documentation.",
        ["PARAMETER_LIST"] = "A GVL that is a parameter list — GVLObject.ParameterList.",
        ["NETVAR"] = "One network-variable member per line, its value as the vendor renders it: on a GVL (or a %CLASS "
            + "PERSISTENT list) the sender's NetVarProperties; under %CLASS NVL the receiver's own members, then the sender "
            + "settings it imported, each as ImportNetVarProperties.<member>.",
        ["FILE_LINK"] = "A GVL linked to an external file: the link type, then the path as an ST string — FileLink.",
    };

    /// <summary>One object a <c>%</c>-line can be read from: what it is (<paramref name="On"/>), its properties and — for a
    /// member — its folder. The examples are objects a vendor read can produce (<see cref="ReadableCombination"/>), never
    /// one record carrying every key: a check function holds no network variables, and an example that says otherwise
    /// teaches a combination no pull ever writes (gate review of step 4a, finding 3).</summary>
    private sealed record PropertyExample(string On, ObjectProperties Props, string? Folder = null);

    private static readonly PropertyExample[] PropertyExamples =
    {
        new("a check function", ObjectProperties.None with
        {
            Class = new ObjectClass(ObjectClass.Check, "CheckBounds"), ExcludeFromBuild = true, LinkAlways = true,
            External = true, EnableSystemCall = true, OnlineChangeReserve = 200, CompilerDefines = "SIMULATION",
            Undefines = new[] { "DEBUG", "TRACE" }, Comment = "Bounds check for every array access",
        }),
        new("a method in a folder", ObjectProperties.None, Folder: "Helpers"),
        new("a parameter list", ObjectProperties.None with { ParameterList = true }),
        new("a sending GVL", ObjectProperties.None with
        {
            NetVar = new[] { new NetVarSetting("ListIdentifier", "1"), new NetVarSetting("Interval", "T#50ms") },
        }),
        new("a receiving NVL", ObjectProperties.None with
        {
            Class = new ObjectClass(ObjectClass.Nvl, null),
            NetVar = new[] { new NetVarSetting("SenderGVLName", "GVL_Send"), new NetVarSetting("ImportNetVarProperties.ListIdentifier", "1") },
        }),
        new("a GVL linked to a file", ObjectProperties.None with { FileLink = new FileLink("ExportBeforeCompile", @"C:\io\gvl.txt") }),
    };

    /// <summary>Whether a vendor read can produce <paramref name="p"/> — the class rule of the CODESYS driver's
    /// <c>ReadClass</c>: network-variable settings and a file link belong to a variable list (no class, <c>PERSISTENT</c>,
    /// <c>NVL</c>), the parameter-list flag to a plain GVL only; a check function, a text-list enumeration and an abstract
    /// method hold none of them.</summary>
    private static bool ReadableCombination(ObjectProperties p)
    {
        var word = p.Class?.Word;
        var variableList = word is null or ObjectClass.Persistent or ObjectClass.Nvl;
        if (!variableList && (p.NetVar.Count > 0 || p.FileLink is not null || p.ParameterList)) return false;
        if (p.ParameterList && word is not null) return false;
        return true;
    }

    /// <summary>Every <c>%</c>-line key, in canonical order, with the line(s) the WRITER emits for each example object
    /// that carries it — so the page's example is the writer's spelling, never a hand-typed second one.</summary>
    private static JsonArray BuildObjectProperties() =>
        new(Volt.Engine.Format.St.PropertyLines.Keys.Select(key => (JsonNode?)new JsonObject
        {
            ["key"] = key,
            ["examples"] = new JsonArray(PropertyExamples
                .Select(e => (e.On, Lines: Volt.Engine.Format.St.PropertyLines.Write(e.Props, e.Folder)
                                                .Where(l => Volt.Engine.Format.St.PropertyLines.KeyOf(l) == key).ToList()))
                .Where(e => e.Lines.Count > 0)
                .Select(e => (JsonNode?)new JsonObject
                {
                    ["on"] = e.On,
                    ["lines"] = new JsonArray(e.Lines.Select(l => (JsonNode?)l).ToArray()),
                }).ToArray()),
            ["means"] = PropertyMeanings.TryGetValue(key, out var m) ? m : null,
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
            ["apply"] = new JsonArray(ConflictCodes.NotAttempted),
        },
        // The ids the shipped hosts declare (`VendorRow Row`), read from their declarations.
        ["vendors"] = Strings(Vendors()),
        ["statuses"] = Strings(RowStatuses),
        ["severities"] = Strings(Consts(typeof(Severity))),
        ["languages"] = Strings(DeclaredLanguages()),
        ["shownLanguages"] = Strings(ShownLanguages()),
        ["phases"] = Strings(ProgressFrame.Phases),
        // Each code with the channel(s) it arrives on and the ops that answer it as a frame (design section 7).
        ["codes"] = BuildCodeChannels(),
        ["commonFrameCodes"] = Strings(CommonFrameCodes),
        ["kinds"] = BuildKinds(),
        ["extensions"] = BuildExtensions(),
        ["objectProperties"] = BuildObjectProperties(),
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

    /// <summary>THE WIRE'S SHAPE IS PINNED BESIDE ITS PROTOCOL NUMBER (openspec <c>relay-protocol-tracks-wire-breaks</c>).
    /// The generated document is a complete fingerprint of the wire's SHAPE, so any contract edit turns this red until
    /// its author re-pins it — and decides, by the bump rule, whether <see cref="WireProtocol.Version"/> moves. Five
    /// breaking wire commits shipped under protocol 1 while a prose rule asked for a bump; this is the check that rule
    /// never had. A change of MEANING with the same shape passes it: that is the author's call, by the same rule.</summary>
    [Fact]
    public void The_wire_shape_is_pinned_beside_its_protocol_number()
    {
        var hash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(
            Encoding.UTF8.GetBytes(RenderJson(BuildSpec()).ReplaceLineEndings("\n")))).ToLowerInvariant();

        Assert.True(WireProtocol.Version == PinnedProtocol && hash == PinnedWireShape,
            $"The wire's shape changed: volt-bridge.openrpc.json hashes to {hash}, pinned {PinnedWireShape} for protocol "
            + $"{PinnedProtocol} (WireProtocol.Version is {WireProtocol.Version}). "
            + "Decide by the bump rule: the protocol changes when an old peer would read the new wire without refusing it and "
            + "take a different meaning. A removed, renamed or re-meant response member needs a bump; a new request member "
            + "does not (request bodies are read strictly, so an old bridge refuses it), nor does a new response member an "
            + "old client can ignore. Bump WireProtocol.Version if it does, then re-pin here: "
            + $"PinnedProtocol = {WireProtocol.Version}, PinnedWireShape = \"{hash}\".");
    }

    /// <summary>The protocol number and the hash of the generated <c>volt-bridge.openrpc.json</c> it was decided for.</summary>
    private const int PinnedProtocol = 1;
    private const string PinnedWireShape = "3d6beb32f772370bb701140ef99ceb8bbf57a25267e88289ba8ddc3288aad591";

    /// <summary>The document names the protocol it describes, and <c>health</c> states it: every bridge writes
    /// <c>protocol</c>, so the schema requires it (C# reads it as <c>int?</c> only so the connector can still read a bridge
    /// from before it).</summary>
    [Fact]
    public void The_document_is_versioned_by_the_protocol_and_health_requires_it()
    {
        var spec = BuildSpec();
        Assert.Equal(WireProtocol.Version.ToString(System.Globalization.CultureInfo.InvariantCulture),
                     spec["info"]!["version"]!.GetValue<string>());
        var required = spec["components"]!["schemas"]!["HealthResponse"]!["required"]!.AsArray().Select(r => r!.GetValue<string>());
        Assert.Contains("protocol", required);
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
        var known = new HashSet<string>(Consts(typeof(BridgeErrorCodes)).Concat(GateCodesAsFrames), StringComparer.Ordinal);
        foreach (var (op, row) in Outcomes)
            foreach (var code in row.Errors)
                Assert.True(known.Contains(code),
                    $"op '{op}' names '{code}', which is not a BridgeErrorCodes value (nor the one gate code a walk " +
                    "answers as a frame, ITEM_UNVERIFIED).");
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
        var asFrame = Ops_().SelectMany(FrameCodesOf).ToHashSet(StringComparer.Ordinal);
        var asConflict = ConflictCodes.FromBridge.ToHashSet(StringComparer.Ordinal);

        foreach (var code in Consts(typeof(BridgeErrorCodes)))
            Assert.True(asFrame.Contains(code) || asConflict.Contains(code),
                $"'{code}' is in BridgeErrorCodes and no op declares it as an error frame, and it is not listed "
                + "as a conflict code either — so nothing tells a client it exists. Declare it on the op that "
                + "raises it, add it to ConflictCodes.FromBridge, or delete it.");
    }

    /// <summary>EVERY NETWORK_* THE ENGINE RAISES IS A PUBLISHED CONST. The check runs over the source: every
    /// <c>ConflictCodes.Network…</c> the Engine names must be in <see cref="ConflictCodes.Network"/>, and no
    /// <c>"NETWORK_…"</c> literal may stand in for one — a loose literal is how a phantom code
    /// (`NETWORK_NESTED_EXPR`, cited in a DTO comment and existing nowhere) got documented. The v1 reader raised
    /// literals; network text v2 raises the constants only, so the literal count is pinned at zero.</summary>
    [Fact]
    public void Every_network_conflict_code_is_published()
    {
        var root = RepoPaths.RepoDir();
        var engine = Path.Combine(root!.FullName, "packages", "volt-cli", "src", "Volt.Engine");

        var published = ConflictCodes.Network.ToHashSet(StringComparer.Ordinal);
        var sources = Directory.EnumerateFiles(engine, "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}")
                     && !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}"))
            .Select(f => (File: Path.GetFileName(f), Text: File.ReadAllText(f)))
            .ToList();

        var literals = sources
            .SelectMany(f => System.Text.RegularExpressions.Regex.Matches(f.Text, "\"(NETWORK_[A-Z_]+)\"")
                .Select(m => $"{f.File}: {m.Groups[1].Value}"))
            .ToList();
        Assert.True(literals.Count == 0,
            "a NETWORK_* code spelled as a literal instead of its ConflictCodes const:\n" + string.Join("\n", literals));

        var raised = sources
            .SelectMany(f => System.Text.RegularExpressions.Regex.Matches(f.Text, @"ConflictCodes\.(Network[A-Za-z]+)\b")
                .Select(m => (f.File, Const: m.Groups[1].Value)))
            .Where(x => x.Const != nameof(ConflictCodes.Network))
            .ToList();

        Assert.NotEmpty(raised);   // the regex must see the Engine, or this proves nothing
        foreach (var (file, name) in raised)
        {
            var field = typeof(ConflictCodes).GetField(name);
            Assert.True(field is not null && field.GetValue(null) is string code && published.Contains(code),
                $"{file} raises ConflictCodes.{name}, which is not in ConflictCodes.Network — clients observe these on "
                + "PushConflict.code, so an unpublished one is a code nobody can look up.");
        }
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
        var root = RepoPaths.RepoDir();
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
        var root = RepoPaths.RepoDir();
        var page = File.ReadAllText(Path.Combine(root!.FullName, "packages", "volt-cli", "docs", "wire.html"));

        foreach (var code in Consts(typeof(BridgeErrorCodes)).Concat(ConflictCodes.Gate).Append(ConflictCodes.NotAttempted))
            Assert.True(page.Contains($"class=\"name\">{code}<", StringComparison.Ordinal),
                $"'{code}' has no row in docs/wire.html — a code a client can observe and cannot look up.");
        // The channel each code arrives on is the generated table's, not a sentence's.
        Assert.Contains("data-render=\"codes\"", page, StringComparison.Ordinal);
    }

    /// <summary>THE CONTRACT CARRIES CURRENT BEHAVIOUR ONLY (design principle F, F34/F36): no history, no internal names
    /// a client cannot see, no prose count of a closed list (the tables are the count) — on the page and in the generated
    /// document alike.</summary>
    [Fact]
    public void The_contract_states_current_behaviour_only()
    {
        var page = File.ReadAllText(Path.Combine(DocsDir(), "wire.html"));
        var spec = RenderJson(BuildSpec());
        var stale = new System.Text.RegularExpressions.Regex(
            @"\(It was |Until 20\d\d|used to |PipeServer|ConflictFor|WireProtocol\.Version|DIALECT|accepted:|`accepted`|"
            + @"BRIDGE_PROTOCOL|unavailable|Only on an accepted push|MUST check|retired|"
            + @"(Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten) (ops|of these|more|bridge codes|gate codes)|These (four|five|six|seven)");
        foreach (var (where, text) in new[] { ("docs/wire.html", page), ("volt-bridge.openrpc.json", spec) })
        {
            var found = stale.Matches(text).Select(m => m.Value).Distinct().ToList();
            Assert.True(found.Count == 0, $"{where} still says: {string.Join(" | ", found)}");
        }
    }

    /// <summary>THE VOCABULARIES COME FROM THE HOSTS' DECLARATIONS (design principle B, W2): the vendors and languages
    /// from each shipped host's own declaration, the kinds from the IEC table both declare — not from a list here.</summary>
    [Fact]
    public void The_vocabularies_come_from_the_hosts_declarations()
    {
        var hosts = HostDeclarations();
        Assert.Equal(new[] { "BeckhoffDriver.Seam.cs", "CodesysDriver.Seam.cs" }, hosts.Select(h => h.File).OrderBy(f => f, StringComparer.Ordinal));
        Assert.All(hosts, h => Assert.NotEmpty(h.Shown));

        var schemas = BuildSpec()["components"]!["schemas"]!;
        string[] EnumAt(JsonNode? n) => n!["enum"]!.AsArray().Select(v => v!.GetValue<string>()).ToArray();
        Assert.Equal(hosts.Select(h => h.Vendor).OrderBy(v => v, StringComparer.Ordinal), EnumAt(schemas["ProjectEntry"]!["properties"]!["vendor"]));
        Assert.Equal(ShownLanguages(), EnumAt(schemas["HealthResponse"]!["properties"]!["languages"]!["items"]));
        Assert.Equal(KindExtensions(), EnumAt(schemas["HealthKind"]!["properties"]!["extension"]));
        Assert.Equal(ProgressFrame.Phases, EnumAt(schemas["ProgressFrame"]!["properties"]!["phase"]));
    }

    /// <summary>THE FRAME IS IN THE DOCUMENT (design section 1, 7): the request envelope, the progress and error frames,
    /// the code vocabularies, and every op's error set opens with the common set.</summary>
    [Fact]
    public void The_frame_and_the_code_vocabularies_are_in_the_document()
    {
        var spec = BuildSpec();
        var schemas = spec["components"]!["schemas"]!.AsObject();
        foreach (var name in new[] { "Request", "ProgressFrame", "ErrorFrame", "BridgeErrorCode", "ConflictCode" })
            Assert.True(schemas.ContainsKey(name), $"no {name} schema");
        Assert.Equal("#/components/schemas/ConflictCode", schemas["PushConflict"]!["properties"]!["code"]!["$ref"]!.GetValue<string>());
        Assert.Equal("#/components/schemas/BridgeErrorCode", schemas["UnreadableItem"]!["properties"]!["code"]!["$ref"]!.GetValue<string>());
        foreach (var m in spec["methods"]!.AsArray())
        {
            var codes = m!["x-errorCodes"]!.AsArray().Select(c => c!.GetValue<string>()).ToList();
            var common = CommonFrameCodes.Where(c => !(m["name"]!.GetValue<string>() == Ops.Health && c == BridgeErrorCodes.IdeUnsupported));
            Assert.Equal(common, codes.Take(common.Count()));
            Assert.False(m["params"]!.AsArray().Any(p => p!["required"]!.GetValue<bool>()), "a body is optional: absent is {}");
        }
    }

    /// <summary>EVERY PHASE A BRIDGE STATES IS DECLARED: the Engine names a phase only by its <see cref="ProgressFrame"/>
    /// constant, so the schema's enum is every phase there is.</summary>
    [Fact]
    public void Every_progress_phase_is_a_declared_constant()
    {
        var engine = Path.Combine(RepoPaths.RepoDir()!.FullName, "packages", "volt-cli", "src", "Volt.Engine");
        var literals = Directory.EnumerateFiles(engine, "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}"))
            .SelectMany(f => File.ReadAllLines(f).Where(l => !l.TrimStart().StartsWith("//", StringComparison.Ordinal))
                .SelectMany(l => System.Text.RegularExpressions.Regex.Matches(l, @"(Phase = |phase: )""[^""]*""").Select(m => m.Value))
                .Select(v => $"{Path.GetFileName(f)}: {v}"))
            .ToList();
        Assert.True(literals.Count == 0, "a progress phase spelled as a literal:\n" + string.Join("\n", literals));
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
    [InlineData("index.html")]
    public void The_op_count_on_the_page_is_the_op_count_on_the_wire(string page)
    {
        var root = RepoPaths.RepoDir();
        var html = File.ReadAllText(Path.Combine(root!.FullName, "packages", "volt-cli", "docs", page));
        var n = OpNames().Count();

        Assert.True(html.Contains($"{Spell(n)} ops", StringComparison.Ordinal)
                 || html.Contains($"{n} ops", StringComparison.Ordinal),
            $"docs/{page} does not say there are {n} ops, and the wire has {n}.");
    }

    /// <summary>NO DOC NAMES A DUT BY A SPLIT SUBTYPE NAME (openspec <c>push-without-header-check</c> 5.P). Every DUT
    /// is <c>X.dut</c>; the pages and comments a reader or a host config is built from are what a generated table
    /// cannot correct, so they are held here: none spells <c>X.struct</c> / <c>.enum</c> / <c>.union</c> /
    /// <c>.alias</c> as a name, none keeps the retired <c>#dut-subtype</c> push rule or the <c>#dut-migration</c> note.
    ///
    /// <para><b>Premise changed by the owner (5.P, 2026-10-02).</b> This held the opposite — a DUT is named by the
    /// subtype its vendor states and <c>X.dut</c> only when it states none — and required the upgrade note. DIALECT.md
    /// left the list: it keeps the vendor facts and their history (5.F.2's repo gate owns the source-wide rule).</para>
    ///
    /// <para>The split name is matched where it follows an identifier character or stands alone as an extension
    /// (<c>X.enum</c>, <c>`.struct`</c>, <c>".union"</c>) — not prose like "an enum".</para></summary>
    [Theory]
    [InlineData("packages/volt-cli/docs/items.html")]
    [InlineData("packages/volt-cli/docs/wire.html")]
    [InlineData("packages/volt-cli/src/Volt.Contracts/Wire/RefsFetch.cs")]
    [InlineData("packages/volt-control/src/state/files.ts")]
    [InlineData("packages/volt-lsp-iec/src/workspace/source-extensions.ts")]
    [InlineData("packages/volt-web/app/docs/agents.mdx")]
    public void No_doc_names_a_dut_by_a_split_subtype_name(string relative)
    {
        var root = RepoPaths.RepoDir();
        var text = File.ReadAllText(Path.Combine(root!.FullName, relative));
        // The two places that name the retired spellings AS retired: items.html's history sentence, and wire.html's
        // list of names a push refuses.
        var asRetired = relative.EndsWith("items.html", StringComparison.Ordinal) ? new[] { "X.struct" }
            : relative.EndsWith("wire.html", StringComparison.Ordinal) ? new[] { "X.struct", "X.enum", "X.union", "X.alias" }
            : Array.Empty<string>();
        var split = new System.Text.RegularExpressions.Regex(@"(?<![\w-])\w*\.(struct|enum|union|alias)\b");
        var found = split.Matches(text).Select(m => m.Value).Where(v => !asRetired.Contains(v)).ToList();
        Assert.True(found.Count == 0,
            $"{relative} still names a DUT by a split subtype name: {string.Join(", ", found)} — every DUT is X.dut.");
        Assert.DoesNotContain("dut-subtype", text, StringComparison.Ordinal);
        Assert.DoesNotContain("dut-migration", text, StringComparison.Ordinal);
    }

    /// <summary>THE WIRE NAME'S CONTRACT COMMENT NAMES EVERY PLACE A WIRE NAME IS MINTED. <c>FetchedItem.Name</c> is
    /// where a client reader learns where a name comes from. It named
    /// <c>Materializer.FullWireName</c> as "the one place", while library items are named in <c>LibraryFetch</c>
    /// from <c>LibSignatureRenderer</c>'s extension — a reader who trusted it missed the library path. Every source
    /// file that constructs a <c>FetchedItem</c> must be named by the comment.</summary>
    [Fact]
    public void The_fetched_item_name_comment_names_every_minting_site()
    {
        var root = RepoPaths.RepoDir();
        var src = Path.Combine(root!.FullName, "packages", "volt-cli", "src");
        var contract = File.ReadAllText(Path.Combine(src, "Volt.Contracts", "Wire", "RefsFetch.cs"));
        var comment = System.Text.RegularExpressions.Regex.Match(contract,
            @"((?:[ \t]*///.*\r?\n)+)(?:[ \t]*\[[^\]]*\]\s*)*public string Name",
            System.Text.RegularExpressions.RegexOptions.None).Groups[1].Value;
        Assert.False(string.IsNullOrEmpty(comment), "RefsFetch.cs: FetchedItem.Name has no doc comment.");

        var minters = Directory.EnumerateFiles(src, "*.cs", SearchOption.AllDirectories)
            .Where(f => File.ReadAllText(f).Contains("new FetchedItem", StringComparison.Ordinal))
            .Select(Path.GetFileNameWithoutExtension)
            .ToList();
        Assert.NotEmpty(minters);
        // FetchService builds its items from Materializer's name; the comment names the NAMER, not the builder.
        var named = minters.Select(m => m == "FetchService" ? "Materializer" : m!).ToList();
        var missing = named.Where(m => !comment.Contains(m, StringComparison.Ordinal)).ToList();
        Assert.True(missing.Count == 0,
            $"FetchedItem.Name's comment does not name {string.Join(", ", missing)}, which mint wire names too.");
    }

    /// <summary>THE LSP'S SOURCE-EXTENSION LIST NAMES THE TABLE IT MIRRORS. <c>scripts/check-wiring.ts</c> gates it
    /// against <c>ItemKind.SourceKindExtensions</c>, the table itself — not a lookup over it like
    /// <c>ItemKind.ExtFor</c>, which a reader cannot see the list through.</summary>
    [Fact]
    public void The_lsp_source_extension_list_names_the_table_it_mirrors()
    {
        var root = RepoPaths.RepoDir();
        var text = File.ReadAllText(Path.Combine(root!.FullName, "packages", "volt-lsp-iec", "src", "workspace", "source-extensions.ts"));
        Assert.Contains("ItemKind.SourceKindExtensions", text, StringComparison.Ordinal);
        Assert.DoesNotContain("ItemKind.ExtFor", text, StringComparison.Ordinal);
    }

    /// <summary>THE CHANGE'S OWN ARTIFACTS DO NOT PROMISE THE FILES STAY PUT. The recovery pull renames a DUT the
    /// previous reader misread, yet the proposal said "Workspace FILES do not change" and the
    /// ticked release-note task "files on disk unchanged" — the record archiving files. Found wherever the change
    /// lives, in flight or archived.</summary>
    [Fact]
    public void The_dut_subtype_change_does_not_promise_unchanged_files()
    {
        var root = RepoPaths.RepoDir();
        var changes = Path.Combine(root!.FullName, "openspec", "changes");
        var dirs = Directory.EnumerateDirectories(changes, "*dut-subtype-on-the-wire", SearchOption.AllDirectories).ToList();
        Assert.NotEmpty(dirs);
        foreach (var file in dirs.SelectMany(d => new[] { "proposal.md", "tasks.md" }.Select(f => Path.Combine(d, f))))
        {
            var text = File.ReadAllText(file);
            Assert.DoesNotContain("FILES do not change", text, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("files on disk unchanged", text, StringComparison.OrdinalIgnoreCase);
        }
    }

    /// <summary>EVERY DRIVER MEMBER IS LISTED. <see cref="Volt.Engine.Seam.IVendorDriver"/> is the layer another project reuses, so
    /// a facet it does not inherit from would be a whole surface missing from the page with nothing to notice
    /// it — the reason to assert the composition rather than just walk the three types.</summary>
    [Fact]
    public void The_driver_page_covers_every_facet_of_IVendorDriver()
    {
        Assert.Equal(typeof(Volt.Engine.Seam.IVendorDriver).GetInterfaces().OrderBy(t => t.Name).Select(t => t.Name).ToList(),
                     Facets.Select(f => f.Name).OrderBy(n => n).ToList());
    }

    /// <summary>EVERY <c>%</c>-LINE KEY IS ON THE ITEMS PAGE, spelled by the writer itself (openspec
    /// <c>bridge-one-to-one</c> 4.1). The keys are a closed list (<see cref="Volt.Engine.Format.St.PropertyLines.Keys"/>)
    /// that the C# reader/writer and the LSP's format layer share; a key the page does not carry is a text form an
    /// engineer meets in a pulled file and cannot look up — and an example line typed by hand is a second spelling.</summary>
    [Fact]
    public void Every_object_property_key_is_on_the_items_page_in_the_writers_spelling()
    {
        var rows = BuildObjectProperties();
        Assert.Equal(Volt.Engine.Format.St.PropertyLines.Keys.ToList(),
                     rows.Select(r => (string)r!["key"]!).ToList());
        foreach (var r in rows)
        {
            Assert.False(string.IsNullOrWhiteSpace((string?)r!["means"]), $"%{r["key"]} has no description");
            // Every key shows at least one line (gate review of step 4a, finding 4): a key the writer stopped emitting
            // would otherwise render an empty example cell with the test green.
            Assert.True(r["examples"]!.AsArray().Count > 0, $"%{r["key"]} has no example line");
            foreach (var e in r["examples"]!.AsArray())
            {
                Assert.NotEmpty(e!["lines"]!.AsArray());
                foreach (var line in e["lines"]!.AsArray())
                    Assert.Equal((string)r["key"]!, Volt.Engine.Format.St.PropertyLines.KeyOf((string)line!));
            }
        }
        // Every example is an object a vendor read can produce (gate review of step 4a, finding 3).
        foreach (var e in PropertyExamples)
            Assert.True(ReadableCombination(e.Props), $"the example '{e.On}' is no object a pull can read: {e.Props}");
        var page = File.ReadAllText(Path.Combine(DocsDir(), "items.html"));
        Assert.Contains("data-render=\"object-properties\"", page);
    }

    /// <summary>THE ITEMS PAGE SAYS WHICH <c>%</c>-LINE CHANGES A CODESYS PUSH REFUSES (gate review of step 4a, finding 1).
    /// The CODESYS write refuses, before anything lands, a change to every key it has no measured write for
    /// (<c>RefuseUnwritablePropertyChange</c> → <c>RefuseUnmeasuredChange(what, "%KEY", …)</c>); the page once said CODESYS
    /// "reads and writes every key", telling an engineer an edit would be pushed when the push refuses it. The keys are
    /// read from the driver's source (the driver is net48 and not referenced here), so a key added to or dropped from the
    /// refusal moves the test.</summary>
    [Fact]
    public void The_items_page_names_every_property_change_the_codesys_push_refuses()
    {
        var docs = DocsDir();
        var driver = File.ReadAllText(Path.Combine(docs, "..", "src", "Volt.Ide.Codesys", "Ide", "CodesysObjectModel.Properties.cs"));
        var refused = System.Text.RegularExpressions.Regex.Matches(driver, @"RefuseUnmeasuredChange\(what, ""%([A-Z_]+)""")
            .Select(m => m.Groups[1].Value).ToList();
        Assert.NotEmpty(refused);
        var page = File.ReadAllText(Path.Combine(docs, "items.html"));
        var li = System.Text.RegularExpressions.Regex.Match(page, @"<li id=""properties-vendors"">(.*?)</li>",
            System.Text.RegularExpressions.RegexOptions.Singleline);
        Assert.True(li.Success, "items.html has no <li id=\"properties-vendors\"> (what each vendor reads and writes)");
        Assert.DoesNotMatch(@"(?i)writes every key", li.Groups[1].Value);
        foreach (var key in refused)
            Assert.Contains($"<code>%{key}</code>", li.Groups[1].Value);
    }
}
