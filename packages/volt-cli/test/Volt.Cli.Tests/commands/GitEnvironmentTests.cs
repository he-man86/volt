using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using Volt.Cli.Sync;
using Volt.Contracts;
using Volt.Engine.Host;
using Volt.Tests.Shared;
using Xunit;
using static Volt.Cli.Tests.CommandHarness;

namespace Volt.Cli.Tests;

/// <summary>
/// THE CLI'S GIT ON A PLAIN MACHINE (openspec <c>environment-dependency-audit</c> 1.3). The `volt` binary is spawned the
/// way a user's shell or an agent runs it, over a live pipe host, under three conditions the dev machine never has:
/// <list type="bullet">
/// <item>no git on PATH — a CODESYS- or TwinCAT-only PC. Measured at 1.3: every verb answered "not a Volt workspace — run
///   `volt init` first" (<c>Config.ConfigExists</c> swallowed the failed start — fixed at gate 1, see
///   <see cref="A_git_failure_is_named_not_reported_as_an_unbound_workspace"/>); then it named the failed start of
///   <c>git</c>. Since 2.1 the CLI runs ITS copy (MinGit, <c>git\cmd\git.exe</c> beside volt.exe), by path, and never
///   looks at PATH.</item>
/// <item>a repo owned by another principal — git ≥2.35.2 refuses it ("dubious ownership"): a project on a share, or one
///   an elevated tool created under Administrators. The CLI passes <c>safe.directory</c> per call. Simulated with git's own
///   <c>GIT_TEST_ASSUME_DIFFERENT_OWNER=1</c> (a different owner needs SeRestorePrivilege to fake). Measured 2026-10-13: the
///   dev machine's git 2.37.1 does NOT honour <c>-c safe.directory=…</c> on the command line (nor
///   <c>GIT_CONFIG_COUNT</c>) — only system/global config; the bundled MinGit 2.56.0.2 does.</item>
/// <item>a project path past MAX_PATH — a deep <c>Library Manager/…</c> under OneDrive. Git for Windows refuses paths over
///   260 characters unless <c>core.longpaths</c> is set; the CLI sets it per call.</item>
/// </list>
/// Each spawn reads no global or system git config (<c>GIT_CONFIG_GLOBAL</c> an empty file, <c>GIT_CONFIG_NOSYSTEM</c>), so
/// the developer's own <c>safe.directory=*</c> or <c>core.longpaths</c> cannot make a test pass. Red at 1.3 — for the
/// reasons git gave: <c>start process 'git'</c>, <c>dubious ownership</c>, <c>Filename too long</c> — green since 2.1.
/// </summary>
public class GitEnvironmentTests
{
    [Fact]
    public void Pull_works_with_no_git_on_PATH()
    {
        var (root, host, pipe) = Boot(TestUtil.NewRepo());
        try
        {
            var path = string.Join(Path.PathSeparator.ToString(),
                (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator)
                    .Where(d => d.Length > 0 && !File.Exists(Path.Combine(d, "git.exe")) && !File.Exists(Path.Combine(d, "git.cmd"))));
            var r = RunVolt(root, pipe, new() { ["PATH"] = path }, "pull", "--json");
            Pulled(root, r);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Pull_works_in_a_repo_owned_by_another_principal()
    {
        var (root, host, pipe) = Boot(TestUtil.NewRepo());
        try
        {
            var r = RunVolt(root, pipe, new() { ["GIT_TEST_ASSUME_DIFFERENT_OWNER"] = "1" }, "pull", "--json");
            Pulled(root, r);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Pull_works_in_a_project_past_MAX_PATH()
    {
        // A 200-character project directory (git itself still creates it: `init` refuses a directory past ~248) and an
        // item with a 64-character name, as IEC allows: its src/ file is past 260 characters.
        var baseDir = Directory.CreateTempSubdirectory("volt-long-").FullName;
        var root = baseDir;
        while (root.Length < 200) root = Path.Combine(root, "Library Manager");
        Directory.CreateDirectory(root);
        Git.GitInit(root);
        var name = "FB_" + new string('A', 61);
        var (_, host, pipe) = Boot(root, name);
        try
        {
            Assert.True(Path.Combine(root, "src", name + ".pou").Length > 260);
            var r = RunVolt(root, pipe, new(), "pull", "--json");
            Pulled(root, r, name);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(baseDir); }
    }

    /// <summary>A git that fails is NAMED — never read as "this folder is not bound". Measured at 1.3: a missing git and a
    /// refused repo both came back as "not a Volt workspace — run `volt init` first", because <c>Config.ConfigExists</c>
    /// swallowed every exception of the <c>rev-parse</c> it runs and answered "no binding"; an engineer told to re-init a
    /// bound project. Driven here by a broken <c>.git</c> (its HEAD overwritten): git refuses the repo whatever git it is,
    /// so this holds after 2.1 too, for every git failure 2.1 does not prevent.</summary>
    [Fact]
    public void A_git_failure_is_named_not_reported_as_an_unbound_workspace()
    {
        var (root, host, pipe) = Boot(TestUtil.NewRepo());
        try
        {
            File.WriteAllText(Path.Combine(root, ".git", "HEAD"), "garbage\n");
            var r = RunVolt(root, pipe, new(), "pull", "--json");
            var said = r.Err + r.Out;
            Assert.True(r.Code != 0, "pull of a broken repo exited 0");
            Assert.DoesNotContain("not a Volt workspace", said);
            Assert.Matches(@"git .* failed \(exit \d+\)", said);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>The CLI runs ITS git and no other: a volt.exe whose <c>git\</c> is gone does not fall back to a git on PATH
    /// (the dev machine has one) — it names the missing bundle, and says to reinstall (openspec environment-dependency-audit
    /// 2.1). Driven by a copy of the build output without its <c>git\</c> folder.</summary>
    [Fact]
    public void A_volt_without_its_bundled_git_names_it_and_never_uses_PATH()
    {
        var (root, host, pipe) = Boot(TestUtil.NewRepo());
        var copy = Directory.CreateTempSubdirectory("volt-nogit-").FullName;
        try
        {
            var built = Path.GetDirectoryName(VoltExe())!;
            foreach (var f in Directory.EnumerateFiles(built, "*", SearchOption.AllDirectories))
            {
                var rel = Path.GetRelativePath(built, f);
                if (rel.StartsWith("git" + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) continue;
                Directory.CreateDirectory(Path.GetDirectoryName(Path.Combine(copy, rel))!);
                File.Copy(f, Path.Combine(copy, rel));
            }
            var r = RunVoltAt(Path.Combine(copy, "volt.exe"), root, pipe, new(), "pull", "--json");
            var said = r.Err + r.Out;
            Assert.True(r.Code != 0, "pull without the bundled git exited 0 — it ran some other git");
            Assert.Contains("bundled git is missing", said);
            Assert.Contains("reinstall Volt", said);
            Assert.DoesNotContain("not a Volt workspace", said);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); TestUtil.ForceDelete(copy); }
    }

    /// <summary>The control: the same spawn, with git on PATH, an owned repo and a short path, pulls — so each red above
    /// is the condition it names and not the harness (no global config, the empty one it points at).</summary>
    [Fact]
    public void Pull_works_through_this_harness_on_this_machine()
    {
        var (root, host, pipe) = Boot(TestUtil.NewRepo());
        try { Pulled(root, RunVolt(root, pipe, new(), "pull", "--json")); }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    // ── harness ──────────────────────────────────────────────────────────────────────────────────────────────────

    private static void Pulled(string root, (int Code, string Out, string Err) r, string item = "PLC_PRG")
    {
        Assert.True(r.Code == 0, $"volt pull exit {r.Code}: {r.Err.Trim()} {r.Out.Trim()}");
        Assert.True(File.Exists(Path.Combine(root, "src", item + ".pou")), $"pull exited 0 but wrote no src/{item}.pou");
    }

    // Gate 2b: the bundled git reads NO system config. MinGit's own etc/gitconfig includes C:/Program Files/Git/etc/gitconfig
    // (and the x86 one), so an installed Git for Windows would steer the pinned git; the tests above spawn with
    // GIT_CONFIG_NOSYSTEM, so they never saw what ships. Here the system config is a file git cannot parse: read, it fails.
    [Fact]
    public void Pull_reads_no_system_git_config()
    {
        var (root, host, pipe) = Boot(TestUtil.NewRepo());
        var dir = Directory.CreateTempSubdirectory("volt-gitsys-").FullName;
        try
        {
            var system = Path.Combine(dir, "gitconfig");
            File.WriteAllText(system, "[[[ not a git config\n");
            var r = RunVolt(root, pipe, new() { ["GIT_CONFIG_NOSYSTEM"] = "0", ["GIT_CONFIG_SYSTEM"] = system }, "pull", "--json");
            Pulled(root, r);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); TestUtil.ForceDelete(dir); }
    }

    // Gate 2b: MinGit ships no git-lfs. A workspace path under `filter=lfs` is refused by git, by name, on EVERY machine —
    // not stored raw where no lfs is configured and as a pointer where a git-lfs happens to be on PATH.
    [Fact]
    public void A_path_under_an_lfs_filter_is_refused_by_name()
    {
        var (root, host, pipe) = Boot(TestUtil.NewRepo());
        try
        {
            File.WriteAllText(Path.Combine(root, ".gitattributes"), "* text=auto eol=lf\n*.pou filter=lfs\n");
            var r = RunVolt(root, pipe, new(), "pull", "--json");
            Assert.NotEqual(0, r.Code);
            Assert.True(System.Text.RegularExpressions.Regex.IsMatch(r.Out + r.Err, "(clean|smudge) filter '?lfs'? failed"), $"exit {r.Code}: {r.Out}{r.Err}");
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    private static (string root, BridgePipeHost host, string pipe) Boot(string root, string item = "PLC_PRG")
    {
        var pipe = Pipe();
        var host = new BridgePipeHost(ConnectedIde(FakeIde.Item.TextualPou(item, $"PROGRAM {item}\nVAR\nEND_VAR", "x := 1;")), pipe);
        host.Start();
        Config.SaveConfig(root, new WorkspaceConfig { Bridge = new() { Vendor = "codesys" }, Project = new() { Platform = "codesys", ProjectName = "Demo" }, LinkedAt = "t" });
        return (root, host, pipe);
    }

    private static string VoltExe()
    {
        var d = new DirectoryInfo(AppContext.BaseDirectory); // .../test/Volt.Cli.Tests/bin/<cfg>/<tfm>/
        DirectoryInfo? pkg = d;
        while (pkg is not null && !File.Exists(Path.Combine(pkg.FullName, "Volt.sln"))) pkg = pkg.Parent;
        Assert.NotNull(pkg);
        var exe = Path.Combine(pkg!.FullName, "src", "Volt.Cli", "bin", d.Parent!.Name, d.Name, "volt.exe");
        Assert.True(File.Exists(exe), $"volt binary not built at {exe}");
        return exe;
    }

    /// <summary>Spawn `volt` with no global or system git config, plus <paramref name="env"/>.</summary>
    private static (int Code, string Out, string Err) RunVolt(string root, string pipe, Dictionary<string, string> env, params string[] args) =>
        RunVoltAt(VoltExe(), root, pipe, env, args);

    private static (int Code, string Out, string Err) RunVoltAt(string exe, string root, string pipe, Dictionary<string, string> env, params string[] args)
    {
        var emptyConfig = Path.Combine(Directory.CreateTempSubdirectory("volt-gitcfg-").FullName, "gitconfig");
        File.WriteAllText(emptyConfig, "");
        var psi = new ProcessStartInfo(exe) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        foreach (var a in args) psi.ArgumentList.Add(a);
        psi.ArgumentList.Add("--workspace");
        psi.ArgumentList.Add(root);
        psi.Environment["VOLT_PIPE"] = pipe;
        psi.Environment["GIT_CONFIG_GLOBAL"] = emptyConfig;
        psi.Environment["GIT_CONFIG_NOSYSTEM"] = "1";
        foreach (var kv in env) psi.Environment[kv.Key] = kv.Value;
        try
        {
            using var p = Process.Start(psi)!;
            var so = p.StandardOutput.ReadToEndAsync();
            var se = p.StandardError.ReadToEndAsync();
            Assert.True(p.WaitForExit(120_000), "volt did not exit within 120 s");
            return (p.ExitCode, so.GetAwaiter().GetResult(), se.GetAwaiter().GetResult());
        }
        finally { TestUtil.ForceDelete(Path.GetDirectoryName(emptyConfig)!); }
    }
}
