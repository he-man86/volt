using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Volt.Repo.Gates;

/// <summary>
/// CI RUNS EVERY C# SUITE (openspec relay-chunked-results 5, review). The <c>volt-cli</c> job lists its suites by name,
/// so a new test project is silent until someone adds it there: <c>Volt.Relay.Tests</c> (the relay tunnel, its chunking,
/// window and assembly) ran by hand only. Every project under <c>packages/volt-cli/test</c> that references the test SDK
/// must be in that list.
/// </summary>
public class CiRunsEveryTestSuiteTests
{
    [Fact]
    public void Every_volt_cli_test_project_is_in_the_ci_suite_list()
    {
        var root = NoCodeCheckLeftTests.RepoRoot();
        var projects = Directory.GetFiles(Path.Combine(root, "packages", "volt-cli", "test"), "*.csproj", SearchOption.AllDirectories)
            .Where(p => File.ReadAllText(p).Contains("Microsoft.NET.Test.Sdk", System.StringComparison.Ordinal))
            .Select(p => Path.GetFileNameWithoutExtension(p)!)
            .ToList();
        Assert.NotEmpty(projects);

        var ci = File.ReadAllText(Path.Combine(root, ".github", "workflows", "ci.yml"));
        var loop = Regex.Match(ci, @"foreach \(\$p in ([^)]*)\)", RegexOptions.CultureInvariant);
        Assert.True(loop.Success, "ci.yml has no `foreach ($p in ...)` suite loop");
        var listed = Regex.Matches(loop.Groups[1].Value, "'([^']+)'", RegexOptions.CultureInvariant).Select(m => m.Groups[1].Value).ToHashSet();

        var missing = projects.Where(p => !listed.Contains(p)).OrderBy(p => p, System.StringComparer.Ordinal).ToList();
        Assert.True(missing.Count == 0, "test projects CI never runs (add them to ci.yml's volt-cli suite loop): " + string.Join(", ", missing));
    }
}
