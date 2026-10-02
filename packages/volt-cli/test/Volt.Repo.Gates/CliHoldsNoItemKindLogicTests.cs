using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Volt.Repo.Gates;

/// <summary>
/// THE CLI HOLDS NO ITEM-KIND LOGIC (openspec `dut-subtype-on-the-wire`, task 4.6). The engine names every item on
/// the wire, a workspace file's name IS its wire name, and a question about what a name can hold is asked of the
/// engine by that name. So `Volt.Cli` neither spells a DUT subtype nor resolves a kind itself.
///
/// <para><b>This was a manual grep, and it regressed unnoticed.</b> The task recorded the grep's allowed hits; two
/// review rounds later three new comments spelt `X.struct`/`X.enum` and "a DUT mid-retype" into `Commands.cs` and
/// `Program.cs`, and the record went stale for the third time. A comment is not a kind decision, but a CLI whose
/// comments reason in DUT subtypes is one edit from code that does — and nothing but a test keeps a grep honest.</para>
///
/// <para><b>The first version of this gate was too narrow to be that test</b> (section 6 review): it matched a
/// subtype only as an extension and a lookup only as `ItemKind.KindFor…`, so a subtype list of string literals, an
/// unqualified `KindForWireName` after `using static`, and a hard-coded kind extension (`rel.EndsWith(".library")`,
/// which the CLI really held) all passed. The shapes it must catch are pinned below, each as its own case.</para>
/// </summary>
public class CliHoldsNoItemKindLogicTests
{
    /// <summary>A DUT or a DUT subtype spelt as a wire extension OR as a quoted word. Case-insensitive: the uppercase
    /// `DUT` in prose is what a case-sensitive grep missed. English words (`enumerate`, `structural`) and the C#
    /// keyword `enum` do not match — a subtype is matched as an EXTENSION or a string LITERAL, the two shapes a subtype
    /// table takes in code (`new[] { "struct", "enum", … }` is the list this change removed from the CLI).</summary>
    private static readonly Regex DutSpelling =
        new(@"\bdut|\.(struct|enum|union|alias)\b|\bDUTs?\b|""(struct|enum|union|alias)""",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    /// <summary>A kind decision that never spells `dut` is still one: resolving a name's kind, asking a kind-keyed
    /// rule, or naming a kind constant is the engine's job. Matched unqualified too — after `using static` a kind
    /// lookup never says `ItemKind.`, so the import itself is refused.</summary>
    private static readonly Regex KindDecision =
        new(@"\bKindFor(WireName)?\b|IsSourceKind|ImplementationMarker|\bKinds\.\w|using\s+static\s+Volt\.Engine\.Item\.ItemKind\b",
            RegexOptions.CultureInvariant);

    /// <summary>A kind's extension hard-coded in CODE — `rel.EndsWith(".library")`, `"task"` — is a second copy of
    /// the engine's table: when the engine's spelling changes, the CLI silently stops recognising the kind. The
    /// extensions are read from that ONE table (<c>ItemKind.SourceKindExtensions</c> / <c>ReferenceKindExtensions</c>)
    /// so the gate keeps no third copy. Comments are exempt here: a doc example (`"POUs/FB_Motor.fb"`) names a
    /// file, it decides nothing.</summary>
    private static readonly Lazy<Regex> KindExtensionLiteral = new(() =>
    {
        var itemKind = File.ReadAllText(Path.Combine(RepoRoot(), "packages", "volt-cli", "src", "Volt.Engine", "Item",
            "ItemKind.cs"));
        var exts = Regex.Matches(itemKind, @"\(Kinds\.\w+,\s*""([a-z_]+)""\)").Select(m => m.Groups[1].Value)
            .Distinct(StringComparer.Ordinal).ToList();
        // A table that parsed to nothing would pass every file for the wrong reason.
        Assert.True(exts.Count >= 20 && exts.Contains("library") && exts.Contains("fb") && exts.Contains("struct"),
            $"read {exts.Count} extension(s) from ItemKind.cs — the gate no longer understands the engine's table.");
        var alt = string.Join("|", exts.Select(Regex.Escape));
        // Case-blind: `.LIBRARY` under OrdinalIgnoreCase is the same kind check `.library` is — and case-folded
        // extension matching is a bug this CLI already had (`Extensions.ByExt`, `FB_New.FB`).
        return new Regex($@"""[^""\n]*\.({alt})""|""({alt})""", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    });

    /// <summary>The line without its comment: a whole-line comment is nothing, a trailing ` // …` is cut.</summary>
    private static string CodeOf(string line)
    {
        var t = line.TrimStart();
        if (t.StartsWith("//", StringComparison.Ordinal) || t.StartsWith("*", StringComparison.Ordinal)) return "";
        var c = line.IndexOf(" //", StringComparison.Ordinal);
        return c < 0 ? line : line.Substring(0, c);
    }

    private static bool DecidesKind(string line, bool dutSpellingAllowed = false) =>
        (!dutSpellingAllowed && DutSpelling.IsMatch(line)) || KindDecision.IsMatch(line)
        || KindExtensionLiteral.Value.IsMatch(CodeOf(line));

    /// <summary>The one place the CLI NAMES an `X.dut` key: the sidecar's doc, which says why a key from an older Volt is
    /// no longer refused (openspec push-without-header-check 5.B: `.dut` is a wire name again). It refuses by the generic
    /// unknown-extension rule; only its doc spells the name.</summary>
    private static readonly string[] Allowed = { "Sidecar.cs" };

    [Fact]
    public void Volt_Cli_spells_no_dut_subtype_and_decides_no_kind()
    {
        var cli = Path.Combine(RepoRoot(), "packages", "volt-cli", "src", "Volt.Cli");
        var files = Directory.EnumerateFiles(cli, "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}")
                        && !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}"))
            .ToList();
        // A guard that scanned nothing passes for the wrong reason.
        Assert.True(files.Count >= 10, $"only {files.Count} file(s) under {cli} — the guard is not looking at the CLI.");

        var offenders = new List<string>();
        foreach (var f in files)
        {
            var allowed = Allowed.Contains(Path.GetFileName(f), StringComparer.Ordinal);
            var n = 0;
            foreach (var line in File.ReadLines(f))
            {
                n++;
                if (DecidesKind(line, allowed))
                    offenders.Add($"{Path.GetRelativePath(cli, f)}:{n}: {line.Trim()}");
            }
        }

        Assert.True(offenders.Count == 0,
            "Volt.Cli spells a DUT subtype or makes a kind decision. The engine names items and answers what a name " +
            "can hold (ask it by the wire name); a comment needs a kind-neutral example.\n  " +
            string.Join("\n  ", offenders));
    }

    /// <summary>The engine's kind namespace is imported only where the CLI reads the kind TABLE as a table — the
    /// extension list it files and scaffolds by. Anywhere else the import is at best dead (`Commands.cs` kept one after
    /// its one kind lookup moved to the engine) and at worst the door an unqualified `ItemKind.X` walks back through
    /// with nothing new to review. An engine question asked elsewhere is spelt fully qualified, as `IdeTree` does.</summary>
    private static readonly string[] MayImportKinds = { "Extensions.cs", "Scaffold.cs" };

    [Fact]
    public void Volt_Cli_imports_the_kind_namespace_only_where_it_reads_the_extension_table()
    {
        var cli = Path.Combine(RepoRoot(), "packages", "volt-cli", "src", "Volt.Cli");
        var import = new Regex(@"^\s*(global\s+)?using\s+Volt\.Engine\.Item\s*;", RegexOptions.CultureInvariant);
        var importers = Directory.EnumerateFiles(cli, "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}"))
            .Where(f => File.ReadLines(f).Any(l => import.IsMatch(l)))
            .Select(f => Path.GetFileName(f))
            .ToList();
        // The allow-list must stay true: an entry that no longer imports is stale, not a pass.
        foreach (var f in MayImportKinds) Assert.Contains(f, importers);
        var offenders = importers.Where(f => !MayImportKinds.Contains(f, StringComparer.Ordinal)).ToList();
        Assert.True(offenders.Count == 0,
            "Volt.Cli imports Volt.Engine.Item outside the extension-table readers: " + string.Join(", ", offenders));
    }

    /// <summary>THE TS CLIENT TOO. `@volt/control` reads the same wire and renders the same view-model; the section 6
    /// review rewrote the held-item explanation kind-neutral in `Volt.Cli` (`Program.WarnIfPartial`) while its twin in
    /// `view/types.ts` still reasoned in "a DUT caught mid-retype" — this gate scanned C# only. Its one allowed file is
    /// the writable-source extension table (`state/files.ts`, `isPouFile`), a copy `bun run check` holds to the
    /// engine's; tests may describe DUT scenarios.</summary>
    [Fact]
    public void Volt_control_spells_no_dut_subtype_outside_its_extension_table()
    {
        var src = Path.Combine(RepoRoot(), "packages", "volt-control", "src");
        var files = Directory.EnumerateFiles(src, "*.ts", SearchOption.AllDirectories)
            .Where(f => !f.EndsWith(".test.ts", StringComparison.Ordinal))
            .ToList();
        Assert.True(files.Count >= 10, $"only {files.Count} file(s) under {src} — the guard is not looking at the client.");
        var table = Path.Combine(src, "state", "files.ts");
        Assert.True(File.Exists(table), $"{table} moved — the allow-list names a file that is gone.");

        var offenders = new List<string>();
        foreach (var f in files.Where(f => !string.Equals(f, table, StringComparison.OrdinalIgnoreCase)))
        {
            var n = 0;
            foreach (var line in File.ReadLines(f))
            {
                n++;
                if (DutSpelling.IsMatch(line)) offenders.Add($"{Path.GetRelativePath(src, f)}:{n}: {line.Trim()}");
            }
        }
        Assert.True(offenders.Count == 0,
            "@volt/control spells a DUT subtype outside its extension table; a comment needs a kind-neutral example.\n  " +
            string.Join("\n  ", offenders));
    }

    /// <summary>The gate catches the shapes kind logic takes when it comes back — the first four slipped past the
    /// first version of this gate, the fifth is what the CLI actually held, the last two are a kind constant and a
    /// hand kind table in a note that should ask the engine.</summary>
    [Theory]
    [InlineData("var subs = new[] { \"struct\", \"enum\", \"union\", \"alias\" };")]
    [InlineData("using static Volt.Engine.Item.ItemKind;")]
    [InlineData("if (KindForWireName(n) is null) continue;")]
    [InlineData("if (rel.EndsWith(\"union\")) x();")]
    [InlineData("private static bool IsLibraryStub(string rel) => rel.EndsWith(\".library\", StringComparison.Ordinal);")]
    [InlineData("if (kind == Kinds.Dut) return;")]
    [InlineData("if (!name.EndsWith(\".prg\", StringComparison.Ordinal)) continue;")]
    [InlineData("if (rel.EndsWith(\".LIBRARY\", StringComparison.OrdinalIgnoreCase)) x();")]
    [InlineData("if (name.EndsWith(\".Fb\")) x();")]
    public void The_gate_catches_a_kind_decision_in_any_spelling(string line) =>
        Assert.True(DecidesKind(line), $"the gate let a kind decision through: {line}");

    /// <summary>…and it does not flag what decides nothing: English, the C# keyword, a doc example, the extension
    /// table used as a table, an engine question asked by the wire name.</summary>
    [Theory]
    [InlineData("foreach (var x in ItemKind.FileExtensions) { } // enumerate the table")]
    [InlineData("    /// <summary>The full filename from a workspace path (\"POUs/FB_Motor.fb\" → \"FB_Motor.fb\").</summary>")]
    [InlineData("if (!Volt.Engine.Format.Network.NetworkText.CanHold(name)) continue;")]
    [InlineData("private enum Mode { A, B }")]
    public void The_gate_passes_what_decides_no_kind(string line) =>
        Assert.False(DecidesKind(line), $"the gate flags a line that decides no kind: {line}");

    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "CLAUDE.md"))) dir = dir.Parent;
        Assert.True(dir is not null, "could not locate the repo root from the test output folder");
        return dir!.FullName;
    }
}
