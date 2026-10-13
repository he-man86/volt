using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using Xunit;

namespace Volt.Repo.Gates;

/// <summary>
/// GIT SHIPS WITH THE FULL CLI, AND ONLY THERE (openspec <c>environment-dependency-audit</c> 2.1, owner 2026-10-13: "git
/// should only be bundled for the complete CLI, not for what PLCAssist uses"). The CLI carries MinGit beside volt.exe
/// (<c>src/Volt.Cli/MinGit.targets</c> → <c>{app}\bin\git\</c>) and runs that copy by path. The bridge bundles
/// <c>build-cli.ps1</c> produces besides the CLI — <c>dist\Connector</c> (tray + TwinCAT worker) and <c>dist\Codesys</c>
/// (the in-proc DLL) — are also what PLCAssist distributes bridge-only, and a bridge never runs git.
/// </summary>
public class BundledGitGateTests
{
    private static string Pkg => Path.Combine(NoCodeCheckLeftTests.RepoRoot(), "packages", "volt-cli");
    private static string Src => Path.Combine(Pkg, "src");
    private static string Script => File.ReadAllText(Path.Combine(Pkg, "scripts", "build-cli.ps1"));

    /// <summary>The projects whose build or publish line in <c>build-cli.ps1</c> produces a shipped folder.</summary>
    private static List<string> ShippedProjects() =>
        Regex.Matches(Script, @"^[ \t]*&[ \t]*\$DOTNET[ \t]+(?:build|publish)[ \t]+""\$ROOT\\src\\(?<proj>[^\\""]+)\\", RegexOptions.Multiline | RegexOptions.CultureInvariant)
            .Select(m => m.Groups["proj"].Value).ToList();

    /// <summary>Every project <paramref name="project"/> builds with, itself included (its ProjectReference closure).</summary>
    private static HashSet<string> Closure(string project)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var todo = new Stack<string>();
        todo.Push(Path.Combine(Src, project, project + ".csproj"));
        while (todo.Count > 0)
        {
            var csproj = Path.GetFullPath(todo.Pop());
            if (!seen.Add(csproj)) continue;
            foreach (var r in XDocument.Load(csproj).Descendants("ProjectReference"))
                todo.Push(Path.Combine(Path.GetDirectoryName(csproj)!, r.Attribute("Include")!.Value));
        }
        return seen;
    }

    private static bool BundlesGit(string csproj) =>
        Regex.IsMatch(File.ReadAllText(csproj), @"<Import\s+Project=""[^""]*MinGit\.targets""", RegexOptions.CultureInvariant);

    [Fact]
    public void Only_the_CLI_project_bundles_git()
    {
        var bundling = Directory.EnumerateFiles(Src, "*.csproj", SearchOption.AllDirectories).Where(BundlesGit)
            .Select(f => Path.GetFileName(f)).ToList();
        Assert.Equal(new[] { "Volt.Cli.csproj" }, bundling);
    }

    [Fact]
    public void No_bridge_bundle_builds_with_the_CLI_or_its_git()
    {
        var bridges = ShippedProjects().Where(p => p != "Volt.Cli").ToList();
        Assert.Equal(new[] { "Volt.Connector", "Volt.Ide.Codesys", "Volt.Ide.Twincat" }, bridges.OrderBy(p => p, StringComparer.Ordinal));
        foreach (var b in bridges)
        {
            var git = Closure(b).Where(BundlesGit).Select(Path.GetFileName).ToList();
            Assert.True(git.Count == 0, $"the bridge bundle {b} builds with {string.Join(", ", git)}, which bundles git");
        }
    }

    /// <summary>What the build checks on the folders themselves — each a refusal by name, never a silent copy.</summary>
    [Fact]
    public void The_build_refuses_a_bridge_folder_with_git_and_a_CLI_without_one()
    {
        Assert.Contains("REFUSED: a bridge bundle carries git", Script);
        Assert.Contains(@"git\cmd\git.exe", Script);
        var payload = File.ReadAllText(Path.Combine(NoCodeCheckLeftTests.RepoRoot(), "scripts", "build-payload.ts"));
        Assert.Contains("a bridge bundle carries git", payload);
        Assert.Contains("\"bin/git/cmd/git.exe\"", payload);
        Assert.Contains("\"bin/git/LICENSE.txt\"", payload);
        var install = File.ReadAllText(Path.Combine(NoCodeCheckLeftTests.RepoRoot(), "scripts", "test-install.ts"));
        Assert.Contains("git ships with the full CLI only", install);
        Assert.Contains("MinGit.targets", install);
    }

    /// <summary>Gate 2b: an update never leaves two MinGit trees mixed in <c>{app}\bin\git</c>. Inno's [Files] only adds and
    /// overwrites, so the installer clears the folder first ([InstallDelete], which runs at install time, after setup
    /// waited for a running CLI), and test:install plants a file the old tree had and asserts the update removed it.</summary>
    [Fact]
    public void An_update_clears_the_bundled_git_before_it_installs_the_new_one()
    {
        var iss = File.ReadAllText(Path.Combine(NoCodeCheckLeftTests.RepoRoot(), "installer", "Volt.iss"));
        var section = Regex.Match(iss, @"^\[InstallDelete\][^\n]*\n(?:(?!\[)[^\n]*(?:\n|$))*", RegexOptions.Multiline | RegexOptions.CultureInvariant).Value;
        Assert.Matches(new Regex(@"^Type:\s*filesandordirs;\s*Name:\s*""\{app\}\\bin\\git""", RegexOptions.Multiline | RegexOptions.CultureInvariant), section);
        var install = File.ReadAllText(Path.Combine(NoCodeCheckLeftTests.RepoRoot(), "scripts", "test-install.ts"));
        Assert.Contains("volt-stale-mingit-file.txt", install);
    }

    /// <summary>The fetched zip is verified before it is unpacked, against the pin MinGit.targets states.</summary>
    [Fact]
    public void The_bundled_git_is_pinned_and_verified()
    {
        var targets = File.ReadAllText(Path.Combine(Src, "Volt.Cli", "MinGit.targets"));
        Assert.Matches(new Regex(@"<MinGitSha256>[0-9a-f]{64}</MinGitSha256>", RegexOptions.CultureInvariant), targets);
        Assert.Matches(new Regex(@"<VerifyFileHash [^>]*Hash=""\$\(MinGitSha256\)""", RegexOptions.CultureInvariant), targets);
        Assert.True(targets.IndexOf("<VerifyFileHash", StringComparison.Ordinal) < targets.IndexOf("<Unzip", StringComparison.Ordinal),
            "MinGit.targets unpacks the zip before it verifies it");
    }
}
