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
/// </summary>
public class CliHoldsNoItemKindLogicTests
{
    /// <summary>A DUT or a DUT subtype spelt as a wire extension. Case-insensitive: the uppercase `DUT` in prose is
    /// what a case-sensitive grep missed. English words (`enumerate`, `structural`) and the C# keyword `enum` do not
    /// match — a subtype is matched only as an EXTENSION.</summary>
    private static readonly Regex DutSpelling =
        new(@"\bdut|\.(struct|enum|union|alias)\b|\bDUTs?\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    /// <summary>A kind decision that never spells `dut` is still one: resolving a name's kind, or asking a
    /// kind-keyed rule, is the engine's job.</summary>
    private static readonly Regex KindDecision =
        new(@"ItemKind\.KindFor|IsSourceKind|ImplementationMarker", RegexOptions.CultureInvariant);

    /// <summary>The one place the CLI must NAME the retired `X.dut` key: the sidecar refusal that tells an engineer
    /// upgrading from an older Volt what is wrong with their baseline. It refuses by the generic unknown-extension
    /// rule; only its doc says what such a key was.</summary>
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
                if ((!allowed && DutSpelling.IsMatch(line)) || KindDecision.IsMatch(line))
                    offenders.Add($"{Path.GetRelativePath(cli, f)}:{n}: {line.Trim()}");
            }
        }

        Assert.True(offenders.Count == 0,
            "Volt.Cli spells a DUT subtype or makes a kind decision. The engine names items and answers what a name " +
            "can hold (ask it by the wire name); a comment needs a kind-neutral example.\n  " +
            string.Join("\n  ", offenders));
    }

    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "CLAUDE.md"))) dir = dir.Parent;
        Assert.True(dir is not null, "could not locate the repo root from the test output folder");
        return dir!.FullName;
    }
}
