using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Xunit;

namespace Volt.Repo.Gates;

/// <summary>
/// EACH DRIVER REFUSES EXACTLY THE NAMES ITS IDE WAS MEASURED TO REFUSE (openspec <c>push-keeps-what-landed</c> 3.1).
///
/// <para>The push pre-flight asks the driver whether its IDE refuses a POU or member name (<c>ICodeStore.RefusedName</c>),
/// and each driver answers from a word list. The lists are not a rule: a rule fitted to the measured words reproduces
/// them, but outside them it is a guess, and a pre-flight that guesses refuses a push the IDE would take. So the lists
/// are the measurements themselves — every word a live IDE refused in the probe logs
/// (<c>scripts/probe-member-name-refusal.ts</c> → <c>scripts/member-name-refusal*.log</c>), upper-cased (the refusal is
/// case-insensitive, measured), per vendor — and this gate holds the source to them.</para>
///
/// <para>Regenerate after a new probe run: <c>VOLT_WRITE_REFUSED_NAMES=1 dotnet test test/Volt.Repo.Gates</c>.</para>
/// </summary>
public class RefusedNamesMatchTheLogsTests
{
    private static readonly string[] Kinds = { "METHOD", "ACTION", "PROPERTY", "TOPLEVEL" };

    public static IEnumerable<object[]> Vendors() => new[]
    {
        new object[] { "", "Volt.Ide.Codesys", "CodesysRefusedNames", "CODESYS SP21" },
        new object[] { "-tc", "Volt.Ide.Twincat", "TcRefusedNames", "TcXaeShell (TwinCAT 3.1.4024)" },
    };

    [Theory]
    [MemberData(nameof(Vendors))]
    public void The_drivers_word_list_is_the_logged_refusals(string suffix, string project, string cls, string ide)
    {
        var path = Path.Combine(RepoRoot(), "packages", "volt-cli", "src", project, "Driver", cls + ".cs");
        HoldsExactly(path, cls, Refused(suffix), words => Render(project, cls, ide, suffix, words));
    }

    /// <summary>THE WORDS BOTH VENDORS REFUSE, for what above the seam needs the fact with no driver to ask: the CLI's
    /// post-push comparison (<c>PushedText.SameBody</c> — the CLI links no driver) and the engine tests' scopes
    /// (<c>Scopes.RefusedPouName</c>). A word both IDEs refuse as a POU name is no FB type on either (openspec
    /// <c>bridge-refusal-review</c> D4; review of step 4a: the CLI read every elementary type as an instance, and the
    /// corpus oracle ran on a 25-word stand-in that lacked <c>DATE_AND_TIME</c>, <c>__XWORD</c>, <c>BIT</c>, …).</summary>
    [Fact]
    public void The_engines_word_list_is_what_both_vendors_refused()
    {
        var path = Path.Combine(RepoRoot(), "packages", "volt-cli", "src", "Volt.Engine", "Ide", "BothVendorsRefusedNames.cs");
        var both = Refused("").Intersect(Refused("-tc"), StringComparer.Ordinal).OrderBy(w => w, StringComparer.Ordinal).ToList();
        HoldsExactly(path, "BothVendorsRefusedNames", both, RenderBoth);
    }

    private static void HoldsExactly(string path, string cls, List<string> expected, Func<List<string>, string> render)
    {
        if (Environment.GetEnvironmentVariable("VOLT_WRITE_REFUSED_NAMES") == "1")
            File.WriteAllText(path, render(expected), new UTF8Encoding(false));

        Assert.True(File.Exists(path), $"{path} is missing — VOLT_WRITE_REFUSED_NAMES=1 writes it from the logs");
        var actual = Regex.Matches(File.ReadAllText(path), "\"([^\"]+)\",").Cast<Match>().Select(m => m.Groups[1].Value).ToList();
        Assert.Equal(actual.Count, actual.Distinct(StringComparer.Ordinal).Count());
        var missing = expected.Except(actual).ToList();
        var extra = actual.Except(expected).ToList();
        Assert.True(missing.Count == 0 && extra.Count == 0,
            $"{cls}.cs drifted from the logs — not listed: {string.Join(" ", missing.Take(20))}; never logged as refused: " +
            $"{string.Join(" ", extra.Take(20))}. VOLT_WRITE_REFUSED_NAMES=1 rewrites it.");
    }

    /// <summary>Every word an IDE refused (not Volt's own pre-flight, <c>INVALID_ST</c>), upper-cased, sorted. A row a
    /// later log answers again overrides the earlier one (the verify runs read every accept back), and a word refused
    /// as one kind and accepted as another fails the gate — the list is per word because the verdict was measured to be.</summary>
    private static List<string> Refused(string suffix)
    {
        var verdicts = new Dictionary<(string Kind, string Word), bool>();
        foreach (var log in new[] { "", "-families", "-verify" })
        {
            var file = Path.Combine(RepoRoot(), "packages", "volt-cli", "scripts", $"member-name-refusal{log}{suffix}.log");
            foreach (var line in File.ReadAllLines(file))
            {
                var p = line.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
                if (p.Length < 3 || !Kinds.Contains(p[0]) || p[2].StartsWith("(", StringComparison.Ordinal)) continue;
                if (p[2] is not ("ACCEPTED" or "REFUSED")) throw new InvalidDataException($"{file}: unreadable row '{line}'");
                if (p[2] == "REFUSED" && p.Length > 3 && p[3] == "[INVALID_ST]") continue;   // never reached the IDE
                verdicts[(p[0], p[1].ToUpperInvariant())] = p[2] == "REFUSED";
            }
        }
        var byWord = verdicts.GroupBy(v => v.Key.Word).ToList();
        var split = byWord.Where(g => g.Select(v => v.Value).Distinct().Count() > 1).Select(g => g.Key).ToList();
        Assert.True(split.Count == 0, $"refused as one kind and accepted as another: {string.Join(" ", split)}");
        return byWord.Where(g => g.First().Value).Select(g => g.Key).OrderBy(w => w, StringComparer.Ordinal).ToList();
    }

    private static string Render(string project, string cls, string ide, string suffix, List<string> words)
    {
        var sb = new StringBuilder();
        sb.Append("// GENERATED by test/Volt.Repo.Gates/RefusedNamesMatchTheLogsTests.cs (VOLT_WRITE_REFUSED_NAMES=1) from\n");
        sb.Append($"// scripts/member-name-refusal{{,-families,-verify}}{suffix}.log — do not edit; re-probe and regenerate.\n");
        sb.Append("using System;\nusing System.Collections.Generic;\n\n");
        sb.Append($"namespace {project};\n\n");
        sb.Append($"/// <summary>Every name {ide} REFUSED, live, for a new POU or METHOD / ACTION / PROPERTY ({words.Count} words;\n");
        sb.Append("/// openspec <c>push-keeps-what-landed</c> 3.1). Matched case-insensitively, as the IDE refuses (measured). Only measured\n");
        sb.Append("/// words: a word no probe asked reaches the IDE, whose refusal the push reports from the apply loop.</summary>\n");
        sb.Append($"internal static class {cls}\n{{\n");
        sb.Append("    internal static readonly HashSet<string> Words = new HashSet<string>(StringComparer.OrdinalIgnoreCase)\n    {\n");
        for (var i = 0; i < words.Count; i += 6)
            sb.Append("        ").Append(string.Join(" ", words.Skip(i).Take(6).Select(w => $"\"{w}\","))).Append('\n');
        sb.Append("    };\n}\n");
        return sb.ToString();
    }

    private static string RenderBoth(List<string> words)
    {
        var sb = new StringBuilder();
        sb.Append("// GENERATED by test/Volt.Repo.Gates/RefusedNamesMatchTheLogsTests.cs (VOLT_WRITE_REFUSED_NAMES=1) from\n");
        sb.Append("// scripts/member-name-refusal{,-families,-verify}{,-tc}.log — do not edit; re-probe and regenerate.\n");
        sb.Append("using System;\nusing System.Collections.Generic;\n\n");
        sb.Append("namespace Volt.Engine.Ide;\n\n");
        sb.Append($"/// <summary>Every name BOTH CODESYS SP21 and TcXaeShell (TwinCAT 3.1.4024) REFUSED, live, for a new POU or member\n");
        sb.Append($"/// ({words.Count} words; the intersection of the drivers' lists, openspec <c>push-keeps-what-landed</c> 3.1). A word both IDEs\n");
        sb.Append("/// refuse as a POU name is no FB type a body calls on either (openspec <c>bridge-refusal-review</c> D4). For what\n");
        sb.Append("/// asks with no driver to ask — the CLI's comparison; a driver answers from its own list.</summary>\n");
        sb.Append("public static class BothVendorsRefusedNames\n{\n");
        sb.Append("    public static readonly IReadOnlyCollection<string> Words = new HashSet<string>(StringComparer.OrdinalIgnoreCase)\n    {\n");
        for (var i = 0; i < words.Count; i += 6)
            sb.Append("        ").Append(string.Join(" ", words.Skip(i).Take(6).Select(w => $"\"{w}\","))).Append('\n');
        sb.Append("    };\n");
        sb.Append("\n    /// <summary>Whether both vendors refuse <paramref name=\"word\"/> as a POU name.</summary>\n");
        sb.Append("    public static bool Contains(string word) => ((HashSet<string>)Words).Contains(word);\n}\n");
        return sb.ToString();
    }

    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "CLAUDE.md"))) dir = dir.Parent;
        Assert.True(dir is not null, "could not locate the repo root from the test output folder");
        return dir!.FullName;
    }
}
