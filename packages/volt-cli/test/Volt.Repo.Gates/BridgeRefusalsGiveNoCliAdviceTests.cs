using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Volt.Repo.Gates;

/// <summary>
/// A BRIDGE REFUSAL NAMES NO CLI STEP (openspec <c>bridge-errors-without-cli-advice</c>). A refusal served over the
/// bridge pipe reaches whoever drives the bridge — often not the Volt CLI, and with no workspace to pull into. Its text
/// says what is wrong with the text and what to change in it, or what to do in the IDE; a <c>volt …</c> command or a
/// "pull" step is the CLI's advice, added where the CLI prints the error (<c>Volt.Cli</c>), never in the bridge.
/// Every string literal line under <c>src/</c> outside <c>Volt.Cli</c> is checked; each finding names <c>file:line</c>.
/// </summary>
public class BridgeRefusalsGiveNoCliAdviceTests
{
    private static readonly Regex Advice = new(
        @"\bvolt (pull|push|init|build|merge|status|show|grep|rebind|open)\b" +
        @"|\band pull\b|\bpull again\b|\bPull,|\bPull the\b|\brun `volt",
        RegexOptions.CultureInvariant);

    [Fact]
    public void No_bridge_string_tells_the_reader_to_run_a_cli_step()
    {
        var src = Path.Combine(NoCodeCheckLeftTests.RepoRoot(), "packages", "volt-cli", "src");
        var cli = Path.Combine(src, "Volt.Cli") + Path.DirectorySeparatorChar;
        var findings = Directory.EnumerateFiles(src, "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.StartsWith(cli, System.StringComparison.OrdinalIgnoreCase)
                        && !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}")
                        && !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}"))
            .SelectMany(f => File.ReadLines(f).Select((line, i) => (f, line, i)))
            .Where(x => !x.line.TrimStart().StartsWith("//") && x.line.Contains('"')
                        && Regex.Matches(x.line, "\"(?:[^\"\\\\]|\\\\.)*\"").Any(m => Advice.IsMatch(m.Value)))
            .Select(x => $"{Path.GetRelativePath(src, x.f)}:{x.i + 1}: {x.line.Trim()}")
            .ToList();
        Assert.True(findings.Count == 0, "bridge strings that advise a CLI step:\n" + string.Join("\n", findings));
    }
}
