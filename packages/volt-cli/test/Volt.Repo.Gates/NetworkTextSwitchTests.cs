using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Xunit;

namespace Volt.Repo.Gates;

/// <summary>
/// ONE SWITCH PER RUNTIME, AND ONLY DEVELOPMENT TURNS IT ON (openspec <c>implementation-keyword</c> 3c).
///
/// <para>LD and FBD network text is off unless the process environment says <c>VOLT_GRAPHICAL=1</c>. The rule has two
/// halves, and each fails silently if it drifts:</para>
/// <list type="bullet">
/// <item><b>One reader</b> — <c>NetworkTextSwitch</c> in the C# engine, which runs in the bridge. A second place that
/// reads the variable is a second switch that can disagree with it about whether a body is network text. The LSP had
/// one, and did: it runs in the EDITOR's process, which the dev loop never gives the variable, so it called a body a
/// dev bridge had just pulled as network text one "the push refuses", and read nothing under it. The LSP reads what
/// the file states instead — a bridge with LD and FBD off already pulls them as their UNSUPPORTED line
/// (<c>network-text-follows-the-file.test.ts</c>).</item>
/// <item><b>Only development sets it</b> — <c>ide.ps1</c> (both vendors: CODESYS reads it in its own process, the TwinCAT
/// worker in its), the test suites and the scripts that drive a live IDE. The shipped build — <c>build-cli.ps1</c>, the
/// payload, the installer — must not, or every customer gets the feature this switch exists to keep back.</item>
/// </list>
/// </summary>
public class NetworkTextSwitchTests
{
    private const string Variable = "VOLT_GRAPHICAL";

    [Fact]
    public void Exactly_one_file_reads_the_variable_and_it_is_the_bridge_s()
    {
        var root = RepoRoot();
        Assert.Equal(new[] { "packages/volt-cli/src/Volt.Engine/Format/Network/NetworkTextSwitch.cs" },
                     Mentioning(root, Path.Combine("packages", "volt-cli", "src"), "*.cs"));
        Assert.Empty(Mentioning(root, Path.Combine("packages", "volt-lsp-iec", "src"), "*.ts")
                         .Where(f => !f.EndsWith(".test.ts", StringComparison.Ordinal)));
        foreach (var other in new[] { "volt-vscode", "volt-control", "volt-desktop" })
            Assert.Empty(Mentioning(root, Path.Combine("packages", other, "src"), "*.ts"));
    }

    [Theory]
    [InlineData("packages/volt-cli/scripts/ide.ps1", "$env:VOLT_GRAPHICAL = \"1\"")]
    [InlineData("packages/volt-cli/test/test.runsettings", "<VOLT_GRAPHICAL>1</VOLT_GRAPHICAL>")]
    [InlineData("packages/volt-cli/test/Directory.Build.props", "test.runsettings")]
    [InlineData("packages/volt-cli/bunfig.toml", "preload")]
    [InlineData("packages/volt-cli/package.json", "VOLT_GRAPHICAL=1 VOLT_VENDOR=codesys bun test test/e2e")]
    [InlineData("packages/volt-cli/package.json", "VOLT_GRAPHICAL=1 VOLT_VENDOR=twincat bun test test/e2e")]
    [InlineData("packages/volt-lsp-iec/package.json", "VOLT_GRAPHICAL=1 bun run scripts/record-language.ts")]
    [InlineData("packages/volt-lsp-iec/package.json", "VOLT_GRAPHICAL=1 bun run scripts/refresh-corpus.ts")]
    public void Development_turns_it_on(string file, string setting) =>
        Assert.Contains(setting, File.ReadAllText(Path.Combine(RepoRoot(), file)));

    [Theory]
    [InlineData("packages/volt-cli/scripts/build-cli.ps1")]
    [InlineData("scripts/build-payload.ts")]
    [InlineData("scripts/build-installer.ts")]
    [InlineData("installer/Volt.iss")]
    public void The_shipped_build_does_not(string file) =>
        Assert.DoesNotContain(Variable, File.ReadAllText(Path.Combine(RepoRoot(), file)));

    /// <summary>Every file under <paramref name="dir"/> matching <paramref name="pattern"/> that names the variable,
    /// repo-relative with forward slashes, build output skipped.</summary>
    private static IEnumerable<string> Mentioning(string root, string dir, string pattern)
    {
        var full = Path.Combine(root, dir);
        Assert.True(Directory.Exists(full), $"no directory {full} — the gate is not looking at the runtime");
        return Directory.EnumerateFiles(full, pattern, SearchOption.AllDirectories)
            .Where(f => !f.Split(Path.DirectorySeparatorChar).Any(p => p is "bin" or "obj" or "node_modules" or "dist"))
            .Where(f => File.ReadAllText(f).Contains(Variable))
            .Select(f => Path.GetRelativePath(root, f).Replace(Path.DirectorySeparatorChar, '/'))
            .OrderBy(f => f, StringComparer.Ordinal)
            .ToList();
    }

    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "CLAUDE.md"))) dir = dir.Parent;
        Assert.True(dir is not null, "could not locate the repo root from the test output folder");
        return dir!.FullName;
    }
}
