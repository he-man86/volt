using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Repo.Gates;

/// <summary>
/// NO SHIPPED PATH NEEDS A DEVELOPER TOOL (openspec <c>environment-dependency-audit</c> 1.2, requirement "Volt runs on a
/// plain vendor machine"). The field bug that opened the change: the TwinCAT worker read XAE's hierarchy through a COM
/// proxy only Visual Studio registers, so it failed on every plain TwinCAT install — and every test passed, because the
/// dev machine has Visual Studio. A plain machine has Windows and the vendor IDE; whatever else Volt needs, it ships.
///
/// <para>What the text can name is gated here: a process a shipped path starts by NAME (a PATH lookup — the machine's
/// tool, not Volt's), and an assembly of Visual Studio a shipped project references (loaded from a GAC only Visual Studio
/// fills). The COM proxy itself is not a reference anyone writes — it is reached only through the IDE's own manifest
/// (<c>TcSolutionExplorer</c>, DIALECT C2t), which <see cref="The_hierarchy_proxy_is_the_IDEs_own"/> holds.</para>
/// </summary>
public class NoDeveloperToolComponentTests
{
    private static string Src => Path.Combine(NoCodeCheckLeftTests.RepoRoot(), "packages", "volt-cli", "src");

    /// <summary>The processes Windows itself carries; a shipped path may start these by name — but a shell that RUNS a
    /// command (<c>cmd.exe /c x</c>) looks <c>x</c> up on PATH, so that start is reported as <c>cmd.exe /c</c>.</summary>
    private static readonly HashSet<string> WindowsOwn = new(StringComparer.OrdinalIgnoreCase) { "cmd.exe" };

    /// <summary>The by-name starts a shipped path makes ON PURPOSE, each with why the machine's tool is not a dependency.
    /// Keyed as <see cref="StartsByName"/> reports them.</summary>
    private static readonly Dictionary<string, string> Deliberate = new(StringComparer.Ordinal)
    {
        ["src/Volt.Connector/StatusWindow.cs: cmd.exe /c"] =
            "the status window asks each installed editor (code / cursor / windsurf — .cmd shims on PATH) for the volt-vscode "
            + "version it carries; an editor that is absent answers nothing and its row reads empty — nothing depends on it",
    };

    /// <summary>Where a process is started: the first argument of <c>new ProcessStartInfo(…)</c> or <c>Process.Start(…)</c>,
    /// or a <c>FileName = …</c> (not a <c>const string FileName</c>).</summary>
    private static readonly Regex StartSite = new(
        @"(new\s+ProcessStartInfo\s*\(\s*|\bProcess\.Start\s*\(\s*|(?<!const\s+string\s+)\bFileName\s*=\s*)(?<arg>""[^""]*""|[A-Za-z_][A-Za-z0-9_]*)(?<rest>[^\r\n]*)",
        RegexOptions.CultureInvariant);

    /// <summary>A bare name (no directory): what Windows resolves through PATH.</summary>
    private static readonly Regex BareName = new(@"^[A-Za-z0-9_.-]+$", RegexOptions.CultureInvariant);

    private static IEnumerable<string> SourceFiles(string pattern) =>
        Directory.EnumerateFiles(Src, pattern, SearchOption.AllDirectories)
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.Ordinal)
                     && !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.Ordinal));

    /// <summary>Every process a shipped path starts by a bare name is one Windows carries (or a start named in
    /// <see cref="Deliberate"/>). Today the CLI starts <c>git</c> by name (<c>Git.cs:60,397,418</c>): on a CODESYS- or
    /// TwinCAT-only PC every <c>volt init/pull/push/status</c> fails — red until 2.1 bundles MinGit and the CLI runs that
    /// copy by its path.</summary>
    [Fact]
    public void Every_process_started_by_name_is_one_Windows_carries() =>
        ExpectRed.Until("2.1", "the CLI starts `git` by name, from the machine's PATH",
            () =>
            {
                var byName = ProcessesStartedByName().Where(p => !Deliberate.ContainsKey(p)).ToList();
                Assert.True(byName.Count == 0, "started by name:\n  " + string.Join("\n  ", byName));
            });

    /// <summary>Beside the red above, nothing else: a NEW tool started by name fails now, not when 2.1 closes the red.
    /// Pinned: the three <c>git</c> starts of the 0.1 census, and the starts named in <see cref="Deliberate"/> — each of
    /// which must still exist (a deliberate start nobody makes is a stale exemption).</summary>
    [Fact]
    public void Nothing_but_git_is_started_by_name()
    {
        const string git = "src/Volt.Cli/Sync/Git.cs: git";
        var found = ProcessesStartedByName();
        var other = found.Where(p => p != git && !Deliberate.ContainsKey(p)).ToList();
        Assert.True(other.Count == 0, "a shipped path starts a tool by name, from the machine's PATH:\n  " + string.Join("\n  ", other));
        Assert.True(found.Count(p => p == git) <= 3, "more `git` starts by name than the 0.1 census's three");
        var stale = Deliberate.Keys.Where(k => !found.Contains(k)).ToList();
        Assert.True(stale.Count == 0, "a deliberate by-name start no shipped path makes any more — take it out:\n  " + string.Join("\n  ", stale));
    }

    // ── the scanner fires (every form a PATH lookup is written in) ───────────────────────────────────────────────

    [Theory]
    [InlineData("var psi = new ProcessStartInfo(\"git\") { UseShellExecute = false };", "git")]
    [InlineData("var psi = new ProcessStartInfo { FileName = \"tasklist\" };", "tasklist")]
    [InlineData("Process.Start(\"tasklist\", \"/fo csv\");", "tasklist")]
    [InlineData("var exe = Process.GetCurrentProcess().MainModule?.FileName ?? \"volt\";\nvar psi = new ProcessStartInfo(exe);", "volt")]
    [InlineData("const string Tool = \"where.exe\";\nProcess.Start(Tool);", "where.exe")]
    [InlineData("var exe = elevated ? \"runas\" : path;\nProcess.Start(exe);", "runas")]
    [InlineData("RunAndCapture(new ProcessStartInfo(\"cmd.exe\", \"/c \" + commandline));", "cmd.exe /c")]
    public void A_start_by_name_is_found(string code, string exe) =>
        Assert.Equal(new[] { $"X.cs: {exe}" }, StartsByName("X.cs", code));

    [Theory]
    [InlineData("var psi = new ProcessStartInfo(Path.Combine(dir, \"volt.exe\"));")]
    [InlineData("var exe = Path.Combine(AppContext.BaseDirectory, \"volt.exe\");\nProcess.Start(exe);")]
    [InlineData("Process.Start(psi);")]
    [InlineData("Process.Start(new ProcessStartInfo(server.Url) { UseShellExecute = true });")]
    [InlineData("public const string FileName = \"setup.json\";")]
    [InlineData("var psi = new ProcessStartInfo(\"cmd.exe\", \"/d\");")]
    [InlineData("// Process.Start(\"git\") in a comment")]
    public void A_start_by_path_is_not(string code) =>
        Assert.Empty(StartsByName("X.cs", code));

    private static List<string> ProcessesStartedByName()
    {
        var pkg = Path.GetDirectoryName(Src)!;
        return SourceFiles("*.cs").SelectMany(f => StartsByName(Path.GetRelativePath(pkg, f).Replace('\\', '/'), File.ReadAllText(f))).ToList();
    }

    /// <summary>Every start in <paramref name="text"/> whose executable is a bare name: a literal, or an identifier whose
    /// assignment in the same file yields one (as its whole value, a <c>?? "x"</c> fallback, or a ternary branch).</summary>
    private static List<string> StartsByName(string file, string text)
    {
        var found = new List<string>();
        foreach (var line in text.Split('\n'))
        {
            var code = line.TrimStart();
            if (code.StartsWith("//", StringComparison.Ordinal) || code.StartsWith("*", StringComparison.Ordinal)) continue;
            foreach (Match m in StartSite.Matches(line))
            {
                var arg = m.Groups["arg"].Value;
                var names = arg.StartsWith("\"", StringComparison.Ordinal) ? new[] { arg.Trim('"') } : Assigned(text, arg);
                foreach (var exe in names.Where(n => BareName.IsMatch(n)))
                {
                    if (!WindowsOwn.Contains(exe)) found.Add($"{file}: {exe}");
                    else if (Regex.IsMatch(m.Groups["rest"].Value, @"^\s*,\s*""/[cCkK]\b", RegexOptions.CultureInvariant)) found.Add($"{file}: {exe} /c");
                }
            }
        }
        return found;
    }

    /// <summary>The literals an assignment to <paramref name="ident"/> in <paramref name="text"/> can yield as its whole
    /// value: <c>x = "a"</c>, <c>x = … ?? "a"</c>, <c>x = c ? "a" : …</c>.</summary>
    private static IEnumerable<string> Assigned(string text, string ident)
    {
        if (ident is "new") return Array.Empty<string>();
        var values = new List<string>();
        foreach (Match a in Regex.Matches(text, $@"\b{Regex.Escape(ident)}\s*(=(?![=>])|=>)\s*(?<rhs>[^;]+);", RegexOptions.CultureInvariant))
            foreach (Match lit in Regex.Matches(a.Groups["rhs"].Value.Trim(), @"(^|\?\?|[?:])\s*""(?<v>[^""]*)""\s*($|[:;)])", RegexOptions.CultureInvariant))
                values.Add(lit.Groups["v"].Value);
        return values;
    }

    /// <summary>No shipped project references an assembly of Visual Studio (<c>Microsoft.VisualStudio.*</c>, <c>EnvDTE*</c>,
    /// <c>VSLangProj*</c>, <c>stdole</c>): XAE is driven late-bound over IDispatch, so nothing of Visual Studio's has to be
    /// on the machine for the worker to load.</summary>
    [Fact]
    public void No_shipped_project_references_a_Visual_Studio_assembly()
    {
        var vs = new Regex(@"Include\s*=\s*""(Microsoft\.VisualStudio\.[^""]*|EnvDTE[^""]*|VSLangProj[^""]*|stdole)""", RegexOptions.CultureInvariant);
        var offenders = SourceFiles("*.csproj")
            .SelectMany(f => vs.Matches(File.ReadAllText(f)).Cast<Match>().Select(m => $"{Path.GetFileName(f)}: {m.Groups[1].Value}"))
            .ToList();
        Assert.True(offenders.Count == 0, "a shipped project references a Visual Studio assembly:\n  " + string.Join("\n  ", offenders));
    }

    /// <summary>The hierarchy interfaces' proxy (msenvp.dll) is reached through the IDE's OWN registration-free manifest —
    /// the copy every XAE carries — and never through a registration only Visual Studio writes (DIALECT C2t).</summary>
    [Fact]
    public void The_hierarchy_proxy_is_the_IDEs_own()
    {
        var explorer = File.ReadAllText(Path.Combine(Src, "Volt.Ide.Twincat", "Ide", "TcSolutionExplorer.cs"));
        Assert.Contains("msenvp.dll.manifest", explorer);
        Assert.Contains("CreateActCtxW", explorer);
    }
}
