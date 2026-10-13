using System;
using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;
using Volt.Cli.Sync;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>
/// THE CLI RUNS ITS OWN GIT (openspec environment-dependency-audit 2.1). MinGit is bundled beside volt.exe
/// (<c>git\cmd\git.exe</c>, <c>src/Volt.Cli/MinGit.targets</c>) and <see cref="Git"/> runs that copy by path — the test
/// output carries it the same way (through the project reference), so every git a test runs is the one a user runs.
/// </summary>
public class BundledGitTests
{
    private static string Targets([System.Runtime.CompilerServices.CallerFilePath] string here = "") =>
        Path.GetFullPath(Path.Combine(Path.GetDirectoryName(here)!, "..", "..", "..", "src", "Volt.Cli", "MinGit.targets"));

    private static string Pinned(string property)
    {
        var m = Regex.Match(File.ReadAllText(Targets()), $"<{property}>([^<]+)</{property}>", RegexOptions.CultureInvariant);
        Assert.True(m.Success, $"MinGit.targets states no <{property}>");
        return m.Groups[1].Value;
    }

    [Fact]
    public void The_git_beside_the_executable_is_the_pinned_MinGit()
    {
        var exe = Path.Combine(AppContext.BaseDirectory, "git", "cmd", "git.exe");
        Assert.True(File.Exists(exe), $"no bundled git at {exe}");
        var psi = new ProcessStartInfo(exe, "--version") { RedirectStandardOutput = true, UseShellExecute = false };
        using var p = Process.Start(psi)!;
        var said = p.StandardOutput.ReadToEnd().Trim();
        Assert.True(p.WaitForExit(30_000), "git --version did not exit");
        // MinGit 2.56.0.2 reports "git version 2.56.0.windows.2" — the tag without its leading v.
        Assert.Equal("git version " + Pinned("MinGitTag").TrimStart('v'), said);
    }

    [Fact]
    public void The_bundle_carries_its_licence_and_source_pointer()
    {
        var dir = Path.Combine(AppContext.BaseDirectory, "git");
        Assert.True(File.Exists(Path.Combine(dir, "LICENSE.txt")), "MinGit's LICENSE.txt (GPLv2) is not beside the bundled git");
        var source = File.ReadAllText(Path.Combine(dir, "VOLT-SOURCE.txt"));
        Assert.Contains("https://github.com/git-for-windows/git/tree/" + Pinned("MinGitTag"), source);
        Assert.Contains(Pinned("MinGitSha256"), source);
    }

    /// <summary>A worktree op answers from the workspace's OWN <c>.git</c> or fails — never from a repo above it. Measured
    /// 2026-10-13 while choosing the per-call <c>safe.directory</c>: with <c>*</c>, a broken <c>&lt;root&gt;/.git</c> sent
    /// git's discovery up to a <c>C:\.git</c> on the dev machine and git answered from THAT repo (so a bound workspace
    /// read as "not a Volt workspace" — and one under a bound ancestor would have read the ancestor's binding).</summary>
    [Fact]
    public void A_broken_workspace_repo_never_resolves_to_the_repo_above_it()
    {
        var outer = TestUtil.NewRepo();
        try
        {
            var inner = Path.Combine(outer, "project");
            Directory.CreateDirectory(inner);
            Git.GitInit(inner);
            File.WriteAllText(Path.Combine(inner, ".git", "HEAD"), "garbage\n");
            var e = Assert.Throws<GitError>(() => Git.ResolveGitDir(inner));
            Assert.Contains("not a git repository", e.StdErr);
        }
        finally { TestUtil.ForceDelete(outer); }
    }
}
