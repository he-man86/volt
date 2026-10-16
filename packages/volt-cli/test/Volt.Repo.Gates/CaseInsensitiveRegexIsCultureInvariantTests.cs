using System.Collections.Generic;
using System.IO;
using System.Linq;
using Xunit;
using Volt.Tests.Shared;

namespace Volt.Repo.Gates;

/// <summary>
/// EVERY CASE-INSENSITIVE REGEX IN src/ IS CULTURE-INVARIANT (environment audit, 2026-10-13). <c>RegexOptions.IgnoreCase</c>
/// folds case with the CURRENT culture: under tr-TR <c>I</c> folds to dotless <c>ı</c>, so <c>VAR_INPUT</c>,
/// <c>VAR_IN_OUT</c> and <c>VAR_INST</c> stop matching <c>VAR(_[A-Z]+)?</c> — in the in-process CODESYS bridge
/// (.NET Framework, which folds the input at match time) on any Turkish Windows. ST keywords are ASCII; the folding they
/// need is the invariant one. <c>StReader</c> already recorded the trap once (its <c>ImplementationMarker</c>,
/// <c>StDeclaration</c> regexes carry the flag); the rest of the IgnoreCase sites did not, which is why this is a gate
/// and not a review note. The flag must be on the same line as <c>IgnoreCase</c>, so the check stays a line scan.
/// </summary>
public class CaseInsensitiveRegexIsCultureInvariantTests
{
    private static string SrcRoot()
    {
        var dir = RepoPaths.PackageDir();
        return Path.Combine(dir!.FullName, "src");
    }

    [Fact]
    public void Every_IgnoreCase_regex_also_says_CultureInvariant()
    {
        var root = SrcRoot();
        var offenders = new List<string>();
        var scanned = 0;
        foreach (var file in Directory.EnumerateFiles(root, "*.cs", SearchOption.AllDirectories)
                     .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}")
                              && !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}")))
        {
            var lines = File.ReadAllLines(file);
            for (var i = 0; i < lines.Length; i++)
            {
                var code = lines[i].TrimStart();
                if (code.StartsWith("//") || !code.Contains("RegexOptions.IgnoreCase")) continue;
                scanned++;
                if (!code.Contains("RegexOptions.CultureInvariant"))
                    offenders.Add($"{Path.GetRelativePath(root, file)}:{i + 1}");
            }
        }
        Assert.True(scanned > 0, "no RegexOptions.IgnoreCase found in src/ - the gate is not reading the sources");
        Assert.True(offenders.Count == 0,
            "RegexOptions.IgnoreCase without RegexOptions.CultureInvariant (on the same line) folds case by the current " +
            "culture - under tr-TR `VAR_INPUT` stops matching:\n  " + string.Join("\n  ", offenders));
    }
}
