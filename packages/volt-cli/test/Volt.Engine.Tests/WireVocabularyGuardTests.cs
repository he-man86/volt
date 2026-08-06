using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

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
/// separate vocabulary: CLI verbs (<c>Program.cs</c>/<c>Git.cs</c> — "init"/"push"/"build"), the PLCopen-XML and VG
/// sublanguages (<c>PlcOpenPouParser</c>/<c>VgParser</c> — "program"/"function"/"method"), and the
/// TwinCAT menu-name match (<c>TcObjectModel</c> — Contains("TwinCAT")).
/// </summary>
public class WireVocabularyGuardTests
{
    // (vocabulary label, the literal values, files allowed to contain them for a different reason).
    private static readonly (string Label, string[] Values, HashSet<string> Allow)[] Vocabularies =
    {
        ("error codes (BridgeErrorCodes)",
            new[] { "PLC_DISCONNECTED", "WRONG_PROJECT", "NO_SIDECAR", "NOT_FOUND", "BAD_REQUEST", "UNSUPPORTED",
                    "DUPLICATE_CHILD", "INVALID_CODE_HEADER", "INVALID_ST", "INTERNAL_ERROR" },
            new HashSet<string> { "BridgeErrorCodes.cs" }),

        ("op codes (Ops)",
            new[] { "health", "connect", "disconnect", "refs", "fetch", "init", "push", "build" },
            // Program.cs/Git.cs use the same words as CLI verbs / git subcommands; TcObjectModel uses these as human
            // LOG TAGS in the COM driver; ControlServer's HTTP routes (POST /connect, /disconnect) deliberately match
            // the wire verbs but are a distinct vocabulary (control-plane URLs, not the pipe op) — all separate.
            new HashSet<string> { "Ops.cs", "Program.cs", "Git.cs", "TcObjectModel.cs", "ControlServer.cs" }),

        ("vendor ids (Vendors)",
            new[] { "codesys", "twincat", "CODESYS", "TwinCAT" },
            // TcObjectModel matches a TwinCAT menu-name substring, not the vendor id.
            new HashSet<string> { "Vendors.cs", "TcObjectModel.cs" }),

        ("health status (HealthStatus)",
            new[] { "healthy", "degraded", "unavailable" },
            new HashSet<string> { "HealthStatus.cs" }),

        ("item kinds (ItemKind.Kinds)",
            new[] { "program", "function_block", "function", "dut", "gvl", "interface", "action", "method",
                    "property", "library", "device", "task", "folder", "transition", "library_manager",
                    "visualization", "visualization_manager", "text_list", "image_pool", "parameter_list",
                    "class_diagram", "recipe_manager", "task_call_reference", "external_types", "tmc_file",
                    "property_get", "property_set", "interface_method", "interface_property",
                    "interface_property_get", "interface_property_set", "project_info", "trace", "recipe",
                    "symbol_config" },
            // The PLCopen-XML parser and the VG sublanguage share these words as their OWN vocabularies.
            new HashSet<string> { "ItemKind.cs", "PlcOpenPouParser.cs", "VgParser.cs" }),
    };

    [Fact]
    public void No_centralized_vocabulary_literal_is_respelled_outside_its_home()
    {
        var src = FindSrcDir();
        var offenders = new List<string>();

        foreach (var (label, values, allow) in Vocabularies)
        {
            var rx = new Regex("\"(" + string.Join("|", values.Select(Regex.Escape)) + ")\"");
            foreach (var file in EnumerateCs(src))
            {
                if (allow.Contains(Path.GetFileName(file))) continue;
                var lineNo = 0;
                foreach (var raw in File.ReadLines(file))
                {
                    lineNo++;
                    var slash = raw.IndexOf("//", StringComparison.Ordinal);
                    var code = slash >= 0 ? raw.Substring(0, slash) : raw;
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

    private static IEnumerable<string> EnumerateCs(string dir) =>
        Directory.EnumerateFiles(dir, "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}") &&
                        !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}"));

    private static string FindSrcDir()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "Volt.Cli.sln"))) dir = dir.Parent;
        Assert.True(dir != null, "could not locate Volt.Cli.sln above the test assembly");
        var src = Path.Combine(dir!.FullName, "src");
        Assert.True(Directory.Exists(src), $"src not found at {src}");
        return src;
    }
}
