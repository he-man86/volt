using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Format.Network;
using Volt.Engine.Library;
using Volt.Engine.Format.Body;

namespace Volt.Engine.Tests;

/// <summary>
/// The rot-guard for the single-source-wire-vocabularies refactor. Each closed wire/domain vocabulary is defined
/// ONCE (item kinds in <c>ItemKind.Kinds</c>, op codes in <c>Ops</c>, vendor ids in <c>Vendors</c>, health words in
/// <c>HealthStatus</c>, error codes in <c>BridgeErrorCodes</c>). This test fails the build if one of those literal
/// VALUES is re-spelled in <c>src</c> code outside the small set of files that legitimately hold it for a DIFFERENT
/// reason (its own definition, or a genuinely distinct vocabulary that shares the word) — so the cleanup can't
/// silently regress the way <c>BridgeErrorCodes</c> once did (three leaked "PLC_DISCONNECTED" literals).
///
/// Comments are exempt (they explain the shared transform). <c>[JsonPropertyName("…")]</c> lines are exempt: a wire
/// FIELD name that happens to equal a vocabulary word (e.g. the <c>degraded</c> bool, the <c>init</c> flag) is a
/// different thing from the vocabulary VALUE. The per-vocabulary allowlist names the files where the same word is a
/// separate vocabulary: CLI verbs (<c>Program.cs</c>/<c>Git.cs</c> — "init"/"push"/"build"), the PLCopen-XML and network text
/// sublanguages (<c>PouReader</c>/<c>NetworkTextReader</c> — "program"/"function"/"method"), and the
/// TwinCAT menu-name match (<c>TcObjectModel</c> — Contains("TwinCAT")).
/// </summary>
public class WireVocabularyGuardTests
{
    // (vocabulary label, the literal values, files allowed to contain them for a different reason).
    private static readonly (string Label, string[] Values, HashSet<string> Allow)[] Vocabularies =
    {
        ("error codes (BridgeErrorCodes)",
            new[] { "PLC_DISCONNECTED", "WRONG_PROJECT", "NO_SIDECAR", "NOT_FOUND", "BAD_REQUEST", "UNSUPPORTED", "IDE_UNSUPPORTED",
                    "DUPLICATE_CHILD", "INVALID_ST", "INTERNAL_ERROR" },
            // ImplementationMarker.cs spells the workspace keyword `IMPLEMENTATION LD UNSUPPORTED` — a word of the file
            // format that shares its spelling with the error code, not the error code.
            new HashSet<string> { "BridgeErrorCodes.cs", "ImplementationMarker.cs" }),

        // A body written into the wrong XML namespace is not a compile error — it is a document the vendor's
        // importer quietly declines to understand. These were spelled at NINE sites across five files before
        // `Namespaces` existed; nine independent spellings of one fact drift, and nothing catches the drift.
        // The TC6 namespace is deliberately absent: it is never written from a literal at all, because a write
        // takes it from the element it writes into (a document declares its own version).
        ("xml namespaces (Namespaces)",
            new[] { "http://www.w3.org/1999/xhtml", "http://www.3s-software.com/plcopenxml/" },
            new HashSet<string> { "Namespaces.cs" }),

        ("op codes (Ops)",
            new[] { "health", "connect", "disconnect", "refs", "fetch", "push", "build" },
            // Program.cs/Git.cs use the same words as CLI verbs / git subcommands; TcObjectModel uses these as human
            // LOG TAGS in the COM driver; ControlServer's HTTP routes (POST /connect, /disconnect) deliberately match
            // the wire verbs but are a distinct vocabulary (control-plane URLs, not the pipe op); ConsoleServer's
            // set is the CLI's MUTATING VERBS, which it runs by spawning the binary with that argv — `push` there
            // is a command a user types, and the overlap exists only because the CLI was named after what it does.
            new HashSet<string> { "Ops.cs", "Program.cs", "Git.cs", "TcObjectModel.cs", "ControlServer.cs", "ConsoleServer.cs" }),

        ("vendor ids (Vendors)",
            new[] { "codesys", "twincat", "CODESYS", "TwinCAT" },
            // TcObjectModel matches a TwinCAT menu-name substring, not the vendor id. CodesysPlatform compares the IDE's
            // OEM product name (IEngine3.OEMCustomization.ProductName), which plain CODESYS answers as "CODESYS".
            new HashSet<string> { "Vendors.cs", "TcObjectModel.cs", "CodesysPlatform.cs" }),

        ("health status (HealthStatus)",
            // `idle` was absent — the DEFAULT row state and the pivot of the whole serving rule (`status != idle`),
            // so the one word most likely to be re-spelled was the one word unguarded. LogWindow's dropdown is a
            // LOG-level list that shares "degraded"/"healthy" with nothing but reads alike; it is its own vocabulary.
            new[] { "healthy", "degraded", "unavailable", "idle" },
            new HashSet<string> { "HealthStatus.cs", "LogWindow.cs" }),

        ("build severity (Severity)",
            // Zero symbolic uses and six literal spellings before this entry existed — because Severity is the one
            // wire vocabulary declared ABOVE Volt.Wire, so this guard structurally could not reach it.
            // Allowlisted for a DIFFERENT vocabulary that shares the word: `ResultKinds.Error` is the CLI's result
            // discriminator (ok/error/refused/rejected/conflict/clean), not a diagnostic severity; LogWindow lists
            // LOG levels ("warn", not "warning"); and the pipe frame has an `error` FIELD, which is not a value.
            new[] { "error", "warning", "info" },
            new HashSet<string> { "BuildModels.cs", "Types.cs", "LogWindow.cs", "PipeClient.cs", "PipeMessages.cs" }),

        ("item kinds (ItemKind.Kinds)",
            new[] { "program", "function_block", "function", "dut", "gvl", "interface", "action", "method",
                    "property", "library", "device", "task", "folder", "transition", "library_manager",
                    "visualization", "visualization_manager", "text_list", "image_pool", "parameter_list",
                    "class_diagram", "recipe_manager", "task_call_reference", "external_types", "tmc_file",
                    "property_get", "property_set", "interface_method", "interface_property",
                    "interface_property_get", "interface_property_set", "project_info", "trace", "recipe",
                    "symbol_config" },
            // The network text sublanguage and PLCopen share these words as their OWN vocabularies, spelt like
            // item kinds but not them.
            //
            // `PlcOpenDocument.cs`, `PouReader.cs`, `PouSplice.cs` and `ProjectStructure.cs` were listed here and
            // are DELETED with the PLCopen transport - four exemptions guarding nothing. Removed rather than left,
            // because a stale allowlist entry silently pre-authorizes any future file that takes the same name.
            //
            // Two TwinCAT files replace them, for a narrower reason: PLCopen's own enumerations COINCIDE with
            // Volt's item kinds on some spellings while differing on others. `BeckhoffDriver` maps a Volt kind to
            // a TC6 `pouType`, where `program`/`function` are shared but TC6 says `functionBlock` where Volt says
            // `function_block`; `TcPlcOpenWriter` spells `interface` as a TC6 ELEMENT name and `function` as a
            // `CallType` value. Two vocabularies that happen to overlap, so the literals cannot be replaced by
            // the constants - that would assert an identity which does not hold.
            //
            // Listed by the PARTIAL-CLASS key (`BeckhoffDriver.cs`, not `BeckhoffDriver.Content.cs`) because
            // `AllowKey` strips the suffix - see its own summary for why.
            new HashSet<string> { "ItemKind.cs", "NetworkTextReader.cs", "BeckhoffDriver.cs",
                                  "TcPlcOpenWriter.cs" }),
    };

    [Fact]
    public void No_centralized_vocabulary_literal_is_respelled_outside_its_home()
    {
        var src = FindSrcDir();
        var offenders = new List<string>();

        // A guard that scanned NOTHING passes. FindSrcDir proves the folder exists; this proves it still holds
        // the code. A restructure that moves projects out from under `src/` would otherwise leave the repo's two
        // structural gates green while looking at an empty tree.
        var scanned = EnumerateCs(src).Count();
        Assert.True(scanned >= 60,
            $"wire-vocabulary guard found only {scanned} .cs file(s) under {src} — it is not looking at the " +
            "toolchain. Did the projects move? A guard that scans nothing passes for the wrong reason.");

        foreach (var (label, values, allow) in Vocabularies)
        {
            var rx = new Regex("\"(" + string.Join("|", values.Select(Regex.Escape)) + ")\"");
            foreach (var file in EnumerateCs(src))
            {
                if (allow.Contains(AllowKey(file))) continue;
                var lineNo = 0;
                foreach (var raw in File.ReadLines(file))
                {
                    lineNo++;
                    var code = StripComment(raw);
                    // A wire FIELD name that equals a vocabulary word is a different concept from the VALUE.
                    if (code.Contains("JsonPropertyName")) continue;
                    if (rx.IsMatch(code))
                        offenders.Add($"[{label}] {Path.GetFileName(file)}:{lineNo}: {raw.Trim()}");
                }
            }
        }

        Assert.True(offenders.Count == 0,
            "A closed wire/domain vocabulary is defined once and referenced everywhere else. A raw literal below " +
            "re-spells one instead of using its constant (ItemKind.Kinds / Ops / Vendors / HealthStatus / " +
            "BridgeErrorCodes). Use the constant, or — if it is genuinely a different vocabulary — add the file to " +
            "that vocabulary's allowlist in this test:\n  " + string.Join("\n  ", offenders));
    }

    /// <summary>THE `.dut` WIRE NAME IS SPELT IN THE KIND TABLE ALONE.
    ///
    /// <para><b>Premise changed by the owner twice (openspec <c>push-without-header-check</c> 5.B, then 5.P,
    /// 2026-10-02).</b> 5.B made <c>dut</c> the "no vendor answer" row beside four subtype rows; 5.P made it the DUT's
    /// only extension. So <c>ExtFor(Kinds.Dut)</c> is now the ordinary way to ask the table for it (this guard used
    /// to forbid that call) — what it still forbids is a SECOND spelling: any other literal <c>.dut</c> /
    /// <c>"dut"</c> in <c>src</c>, or the old translator helpers (<c>WireExtFor</c>, <c>IsDutFileExtension</c>,
    /// <c>DutFileExtensions</c>), named anywhere.</para></summary>
    [Fact]
    public void The_dut_wire_name_is_spelt_only_in_the_kind_table()
    {
        var mint = new Regex(@"\b(WireExtFor|IsDutFileExtension|DutFileExtensions)\b");
        // A bare `"dut"` literal is the DUT EXTENSION spelt out, except where it defines the internal kind.
        var bareDut = new Regex(@"^""dut""$", RegexOptions.IgnoreCase);
        var kindConstant = new Regex(@"const\s+string\s+Dut\s*=");
        // Each string LITERAL on the line, whole and with its escapes honoured — so the text BETWEEN two
        // literals (`"itf"), (Kinds.Dut, "`) is never read as one.
        var literal = new Regex(@"""(?:[^""\\]|\\.)*""");
        var dutName = new Regex(@"\.dut\b", RegexOptions.IgnoreCase);
        bool SpellsDut(string code) =>
            literal.Matches(code).Cast<Match>().Any(m => dutName.IsMatch(m.Value)
                                                        || (bareDut.IsMatch(m.Value) && !kindConstant.IsMatch(code)));
        // A guard that cannot go red passes for the wrong reason (see `StripComment`): prove every arm fires, and
        // that the one legitimate spelling does not.
        Assert.True(SpellsDut("var n = $\"{bare}.dut\";") && !SpellsDut("(Kinds.Interface, \"itf\"), (Kinds.Dut, \"x\")"));
        Assert.True(SpellsDut("(Kinds.Interface, \"itf\"), (Kinds.Dut, \"dut\"), (Kinds.Gvl, \"gvl\"),"));
        Assert.False(SpellsDut("public const string Dut = \"dut\";"));
        Assert.Matches(mint, "return ItemKind.IsDutFileExtension(ext) ? a : b;");
        Assert.Matches(mint, "var w = ItemKind.WireExtFor(ext);");
        Assert.DoesNotMatch(mint, "var e = ItemKind.ExtFor(ItemKind.Kinds.Dut);");
        var allowLiteral = new HashSet<string> { "ItemKind.cs" };
        var offenders = new List<string>();

        foreach (var file in EnumerateCs(FindSrcDir()))
        {
            var lineNo = 0;
            foreach (var raw in File.ReadLines(file))
            {
                lineNo++;
                var code = StripComment(raw);
                if (mint.IsMatch(code)
                    || (!allowLiteral.Contains(AllowKey(file)) && SpellsDut(code)))
                    offenders.Add($"{Path.GetFileName(file)}:{lineNo}: {raw.Trim()}");
            }
        }

        Assert.True(offenders.Count == 0,
            "The `.dut` wire name is spelt once, in ItemKind's extension table (ask it through ItemKind.ExtFor). " +
            "These lines spell it a second time:\n  " + string.Join("\n  ", offenders));
    }

    /// <summary>NO DUT SUBTYPE IS NAMED ANYWHERE IN <c>src</c> (openspec <c>push-without-header-check</c> 5.P).
    ///
    /// <para><b>Premise changed by the owner.</b> This allowed one classifier (<c>CodeHelper.DutSubtype</c>) and the
    /// kind table's four subtype rows, and refused a second classifier. Every DUT is <c>X.dut</c> now and nothing in
    /// Volt names a subtype, so a lower-case <c>"struct"</c> / <c>".enum"</c> / <c>"union"</c> / <c>"alias"</c>
    /// literal anywhere in <c>src</c> is the split name coming back. No allow-list.</para>
    ///
    /// <para>Lower-case only, and the whole literal: the vendor's own flags (<c>"Enum"</c>, <c>"Union"</c>) and
    /// the ST keywords (<c>"STRUCT"</c>) are what a renderer reads and writes, not names it mints.</para></summary>
    [Fact]
    public void No_dut_subtype_is_named_in_src()
    {
        var literal = new Regex(@"""(?:[^""\\]|\\.)*""");
        var subtype = new Regex(@"^""\.?(struct|enum|union|alias)""$");
        bool Names(string code) => literal.Matches(code).Cast<Match>().Any(m => subtype.IsMatch(m.Value));
        Assert.True(Names("return (\".enum\", text);") && Names("return union ? \".union\" : \"x\";"));
        Assert.False(Names("if (s.Flags.Contains(\"Enum\"))") || Names("(\"STRUCT\", \"END_STRUCT\")"));
        var offenders = new List<string>();

        foreach (var file in EnumerateCs(FindSrcDir()))
        {
            var lineNo = 0;
            foreach (var raw in File.ReadLines(file))
            {
                lineNo++;
                if (Names(StripComment(raw))) offenders.Add($"{Path.GetFileName(file)}:{lineNo}: {raw.Trim()}");
            }
        }

        Assert.True(offenders.Count == 0,
            "Every DUT is X.dut — nothing in src names a DUT subtype. These lines do:\n  " + string.Join("\n  ", offenders));
    }

    /// <summary>THE CLI HOLDS NO ST-FORMAT KNOWLEDGE (openspec <c>dut-subtype-on-the-wire</c>: "the CLI maps file name
    /// == wire name"). Reading a declaration — <c>CodeHelper</c>, the ST reader — is what the CLI's DUT logic was made
    /// of (<c>Materialize.FileNameFor</c> read the subtype to pick an extension). An import of
    /// <c>Volt.Engine.Format.St</c> left behind after that logic went is the open door it comes back through
    /// unnoticed, so no <c>Volt.Cli</c> file imports the namespace. (The one qualified use left, <c>Commands.cs</c>'
    /// <c>ImplementationMarker.AppliesTo</c>, is task 4.9's: that decision moves behind one engine call.)</summary>
    [Fact]
    public void The_cli_imports_no_st_format()
    {
        var stFormat = new Regex(@"^\s*using\s+(\w+\s*=\s*)?Volt\.Engine\.Format\.St\s*;");
        Assert.Matches(stFormat, "using Volt.Engine.Format.St;");
        Assert.Matches(stFormat, "using St = Volt.Engine.Format.St;");
        Assert.DoesNotMatch(stFormat, "using Volt.Engine.Format.Stx;");
        var cli = Path.Combine(FindSrcDir(), "Volt.Cli");
        Assert.True(Directory.Exists(cli), $"Volt.Cli not found at {cli}");
        var offenders = new List<string>();
        foreach (var file in EnumerateCs(cli))
        {
            var lineNo = 0;
            foreach (var raw in File.ReadLines(file))
            {
                lineNo++;
                if (stFormat.IsMatch(StripComment(raw))) offenders.Add($"{Path.GetFileName(file)}:{lineNo}: {raw.Trim()}");
            }
        }
        Assert.True(offenders.Count == 0,
            "Volt.Cli reads no declaration — the wire name IS the file name. These lines import the ST format:\n  " +
            string.Join("\n  ", offenders));
    }

    /// <summary>The line with any trailing <c>//</c> comment removed — where <c>//</c> INSIDE a string literal
    /// is not a comment.
    ///
    /// <para>This used to be <c>raw.IndexOf("//")</c>, which is correct for every vocabulary that existed when it
    /// was written and silently wrong for the first one whose values are URLs: <c>"http://…"</c> contains
    /// <c>//</c>, so every line holding a namespace literal was truncated to <c>"http:</c> before the regex ever
    /// saw it, and the guard could not fail. Measured — the namespace entry was added, a literal was deliberately
    /// re-spelled in <c>BodyCodec.cs</c>, and the guard stayed GREEN.</para>
    ///
    /// <para>A guard that cannot go red is worse than no guard: it reports coverage it does not have. So this
    /// tracks string state rather than scanning for the first <c>//</c>.</para></summary>
    private static string StripComment(string raw)
    {
        var inString = false;
        for (var i = 0; i < raw.Length; i++)
        {
            var c = raw[i];
            if (c == '\\' && inString) { i++; continue; }             // an escaped char inside a string
            if (c == '"') { inString = !inString; continue; }
            if (!inString && c == '/' && i + 1 < raw.Length && raw[i + 1] == '/') return raw.Substring(0, i);
        }
        return raw;
    }

    /// <summary>The allowlist key for a file: its name with any PARTIAL-CLASS suffix removed, so
    /// <c>TcObjectModel.Build.cs</c> and <c>TcObjectModel.Session.cs</c> both key as <c>TcObjectModel.cs</c>.
    /// <para>The allowlist used to be the bare basename, which meant splitting a big gateway into partial files —
    /// exactly what the restructure does — silently moved allowlisted content OUT of its exemption and failed the
    /// guard for no real reason. An exemption belongs to a TYPE, and a partial class is one type.</para></summary>
    private static string AllowKey(string file)
    {
        var name = Path.GetFileName(file);
        var stem = name.Substring(0, name.Length - ".cs".Length);
        var dot = stem.IndexOf('.');
        return (dot < 0 ? stem : stem.Substring(0, dot)) + ".cs";
    }

    private static IEnumerable<string> EnumerateCs(string dir) =>
        Directory.EnumerateFiles(dir, "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}") &&
                        !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}"));

    private static string FindSrcDir()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "Volt.sln"))) dir = dir.Parent;
        Assert.True(dir != null, "could not locate Volt.sln above the test assembly");
        var src = Path.Combine(dir!.FullName, "src");
        Assert.True(Directory.Exists(src), $"src not found at {src}");
        return src;
    }
}
