using System;
using System.Diagnostics;
using System.IO;
using Xunit;
using Xunit.Abstractions;
using Volt.Cli.Sync;

namespace Volt.Cli.Tests;

/// <summary>
/// `volt merge --resolve` is where `--continue` SENDS the engineer, and it fails at both ends.
///
/// <para><c>--continue</c> refuses a structural conflict by name — "a STRUCTURAL conflict (modify/delete,
/// add/add, …) which carries NO markers and must be resolved explicitly via `volt merge --resolve`". So the tool
/// names the command to run next, and that command cannot handle the case it was named for: a modify/delete
/// conflict has only ONE stage in the index, and <c>git checkout --ours|--theirs</c> needs the stage it is asked
/// for. The missing side raises a raw GitError.</para>
///
/// <para>And with no side flag at all, <c>--resolve</c> silently takes OURS —
/// <c>var side = useTheirs ? "theirs" : "ours";</c>, with <c>useOurs</c> never read. An engineer who did not say
/// which side gets one chosen for them, and choosing "ours" discards the IDE's version of a file on a command
/// whose whole job is to ask.</para>
/// </summary>
public class MergeResolveTests
{
    private readonly ITestOutputHelper _out;
    public MergeResolveTests(ITestOutputHelper o) => _out = o;

    private static void Git_(string root, params string[] args)
    {
        var psi = new ProcessStartInfo("git") { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        psi.ArgumentList.Add("-C"); psi.ArgumentList.Add(root);
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi)!;
        p.StandardOutput.ReadToEnd(); p.StandardError.ReadToEnd();
        p.WaitForExit();
    }

    /// <summary>A MODIFY/DELETE conflict: ours edits `src/FB_A.fb`, theirs deletes it.</summary>
    private static string RepoWithModifyDeleteConflict()
    {
        foreach (var (k, v) in new[] { ("GIT_AUTHOR_NAME", "t"), ("GIT_AUTHOR_EMAIL", "t@t"),
                                       ("GIT_COMMITTER_NAME", "t"), ("GIT_COMMITTER_EMAIL", "t@t") })
            Environment.SetEnvironmentVariable(k, v);

        var root = Directory.CreateTempSubdirectory("volt-resolve-").FullName;
        Git.GitInit(root);
        var file = Path.Combine(root, "src", "FB_A.fb");
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        File.WriteAllText(file, "FUNCTION_BLOCK FB_A\nbase\nEND_FUNCTION_BLOCK\n");
        Git.StageSrc(root); Git.CommitAll(root, "base");
        var base_ = Git.HeadCommit(root)!;

        Git_(root, "checkout", "-q", "-b", "theirs");
        File.Delete(file);
        Git_(root, "add", "-A", "--", "src");
        Git.CommitAll(root, "theirs deletes it");

        Git_(root, "checkout", "-q", base_);
        Git_(root, "checkout", "-q", "-B", "ours");
        File.WriteAllText(file, "FUNCTION_BLOCK FB_A\nOURS EDIT\nEND_FUNCTION_BLOCK\n");
        Git.StageSrc(root); Git.CommitAll(root, "ours edits it");

        Git_(root, "merge", "--no-commit", "theirs");
        return root;
    }

    [Fact]
    public void The_fixture_really_is_a_structural_conflict()
    {
        var root = RepoWithModifyDeleteConflict();
        try
        {
            Assert.True(Git.IsMerging(root));
            var structural = Git.StructuralConflictFiles(root);
            _out.WriteLine($"structural conflicts: [{string.Join(", ", structural)}]");
            Assert.NotEmpty(structural);          // carries NO markers — exactly what --continue refuses
        }
        finally { try { Directory.Delete(root, true); } catch { } }
    }

    /// <summary>`--resolve --use-theirs` on the case `--continue` points at must WORK, not crash.
    /// <para>Theirs deleted the file, so resolving to theirs means removing it. `git checkout --theirs` cannot
    /// express that — the stage does not exist — so the command the tool recommends died on the conflict it was
    /// recommended for.</para></summary>
    [Fact]
    public void Resolving_a_modify_delete_to_theirs_removes_the_file()
    {
        var root = RepoWithModifyDeleteConflict();
        try
        {
            var (code, msg) = Commands.Merge(root, resolve: "FB_A.fb", useTheirs: true);
            _out.WriteLine($"code={code} msg={msg}");

            Assert.Equal(0, code);
            Assert.False(File.Exists(Path.Combine(root, "src", "FB_A.fb")),
                "resolving to THEIRS, which deleted the file, must leave it deleted");
            Assert.Empty(Git.StructuralConflictFiles(root));   // and the conflict is actually resolved
        }
        finally { try { Directory.Delete(root, true); } catch { } }
    }

    /// <summary>`--resolve --use-ours` keeps our edit — the other half of the same case.</summary>
    [Fact]
    public void Resolving_a_modify_delete_to_ours_keeps_the_file()
    {
        var root = RepoWithModifyDeleteConflict();
        try
        {
            var (code, _) = Commands.Merge(root, resolve: "FB_A.fb", useOurs: true);

            Assert.Equal(0, code);
            Assert.Contains("OURS EDIT", File.ReadAllText(Path.Combine(root, "src", "FB_A.fb")));
            Assert.Empty(Git.StructuralConflictFiles(root));
        }
        finally { try { Directory.Delete(root, true); } catch { } }
    }

    /// <summary>With NO side flag, `--resolve` must ASK rather than pick.
    /// <para>It silently took "ours". A command whose entire purpose is to choose a side must not choose one for
    /// you — picking "ours" discards the IDE's version of the file, which is the more surprising direction.</para></summary>
    [Fact]
    public void Resolving_without_a_side_refuses_instead_of_choosing()
    {
        var root = RepoWithModifyDeleteConflict();
        try
        {
            var (code, msg) = Commands.Merge(root, resolve: "FB_A.fb");
            _out.WriteLine($"code={code} msg={msg}");

            Assert.NotEqual(0, code);
            Assert.Contains("--use-ours", msg);
            Assert.Contains("--use-theirs", msg);
        }
        finally { try { Directory.Delete(root, true); } catch { } }
    }
}
