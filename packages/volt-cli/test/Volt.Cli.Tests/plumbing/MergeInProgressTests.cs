using System;
using System.Diagnostics;
using System.IO;
using Xunit;
using Volt.Cli.Sync;

namespace Volt.Cli.Tests;

/// <summary>
/// A push must not finalize a merge the engineer has not resolved.
///
/// <para><c>Pull</c> refuses outright while a merge is in progress — "finish it with `volt merge --continue` or
/// `volt merge --abort` first". <c>Push</c> had no such check, and its first act is
/// <c>Git.AutoCommitSrc</c>: <c>git add -A -- src</c> followed by <c>git commit</c>. During a merge that commit
/// is not an ordinary commit, it is the CONCLUSION of the merge — so a conflicted pull is resolved by accident,
/// with <c>&lt;&lt;&lt;&lt;&lt;&lt;&lt; HEAD</c> still in the files, and those markers are then what gets pushed
/// to a live PLC.</para>
///
/// <para>The window is not exotic. <c>volt pull</c> conflicts, the engineer reads the message, and does the one
/// thing that feels safe — pushes their own work back. That is the whole sequence.</para>
/// </summary>
public class MergeInProgressTests
{
    /// <summary>Raw git, because the fixture needs branch/checkout/merge and <c>Git.Run</c> is private — and
    /// should stay private. Building the conflicted state through the product's own helpers would also make the
    /// fixture depend on the code under test.</summary>
    private static void Git_(string root, params string[] args)
    {
        var psi = new ProcessStartInfo("git") { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        psi.ArgumentList.Add("-C"); psi.ArgumentList.Add(root);
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi)!;
        p.StandardOutput.ReadToEnd(); p.StandardError.ReadToEnd();
        p.WaitForExit();
    }

    /// <summary>A repo mid-merge with a genuine conflict, built the ordinary way: two branches editing one file.
    /// Returns the root; the working tree contains conflict markers and <c>MERGE_HEAD</c> exists.</summary>
    private static string RepoWithConflictedMerge()
    {
        foreach (var (k, v) in new[] { ("GIT_AUTHOR_NAME", "t"), ("GIT_AUTHOR_EMAIL", "t@t"),
                                       ("GIT_COMMITTER_NAME", "t"), ("GIT_COMMITTER_EMAIL", "t@t") })
            Environment.SetEnvironmentVariable(k, v);

        var root = Directory.CreateTempSubdirectory("volt-merge-").FullName;
        Git.GitInit(root);
        var file = Path.Combine(root, "src", "FB_A.fb");
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);

        File.WriteAllText(file, "FUNCTION_BLOCK FB_A\nbase\nEND_FUNCTION_BLOCK\n");
        Git.StageSrc(root); Git.CommitAll(root, "base");
        var baseCommit = Git.HeadCommit(root)!;

        // their side
        Git_(root, "checkout", "-q", "-b", "theirs");
        File.WriteAllText(file, "FUNCTION_BLOCK FB_A\nTHEIRS\nEND_FUNCTION_BLOCK\n");
        Git.StageSrc(root); Git.CommitAll(root, "theirs");

        // our side
        Git_(root, "checkout", "-q", baseCommit);
        Git_(root, "checkout", "-q", "-B", "ours");
        File.WriteAllText(file, "FUNCTION_BLOCK FB_A\nOURS\nEND_FUNCTION_BLOCK\n");
        Git.StageSrc(root); Git.CommitAll(root, "ours");

        Git_(root, "merge", "--no-commit", "theirs");
        return root;
    }

    [Fact]
    public void The_fixture_really_is_a_conflicted_merge()
    {
        var root = RepoWithConflictedMerge();
        try
        {
            Assert.True(Git.IsMerging(root), "MERGE_HEAD must exist or the rest of this file proves nothing");
            var body = File.ReadAllText(Path.Combine(root, "src", "FB_A.fb"));
            Assert.Contains("<<<<<<<", body);
            Assert.Contains(">>>>>>>", body);
        }
        finally { try { Directory.Delete(root, true); } catch { } }
    }

    /// <summary>The behaviour under test, at the level it actually goes wrong.
    /// <para><c>AutoCommitSrc</c> is what <c>Push</c> calls first. Run against a conflicted merge it stages the
    /// marker-bearing file and commits, and git treats that commit as the merge's conclusion: MERGE_HEAD is gone,
    /// the merge is "resolved", and the resolution is a file full of markers. Nothing asked the engineer.</para>
    /// <para>Asserted on MERGE_HEAD rather than on a message, because the damage is the state change: once the
    /// merge is concluded there is no <c>volt merge --abort</c> left to run.</para></summary>
    [Fact]
    public void AutoCommitSrc_does_not_conclude_an_unresolved_merge()
    {
        var root = RepoWithConflictedMerge();
        try
        {
            // Refusing is the mechanism; the PROPERTY is that the merge survives. Asserted that way round so
            // the test still holds if the refusal ever moves (to a return code, say) — it pins the outcome an
            // engineer cares about, not the shape of the guard.
            var ex = Record.Exception(() => Git.AutoCommitSrc(root));
            Assert.True(Git.IsMerging(root),
                "the merge was CONCLUDED by an auto-commit the engineer never asked for — `volt merge --abort` " +
                "is no longer available, and the committed content still holds conflict markers");
            Assert.NotNull(ex);
            Assert.Contains("merge", ex!.Message, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("--abort", ex.Message);          // and it says how to get out
        }
        finally { try { Directory.Delete(root, true); } catch { } }
    }

    /// <summary>And the content proof, separate from the state proof: whatever got committed must not contain
    /// markers. A guard that stopped the merge concluding but still committed the markers would pass the test
    /// above and still ship <c>&lt;&lt;&lt;&lt;&lt;&lt;&lt;</c> to a PLC.</summary>
    [Fact]
    public void No_commit_made_during_a_conflicted_merge_contains_markers()
    {
        var root = RepoWithConflictedMerge();
        try
        {
            var before = Git.HeadCommit(root);
            Record.Exception(() => Git.AutoCommitSrc(root));   // may refuse; what matters is what landed
            var after = Git.HeadCommit(root);

            if (before == after) return;                   // nothing was committed — the correct outcome
            var committed = Git.GitShowBytes(root, after!, "src/FB_A.fb");
            Assert.NotNull(committed);
            var text = System.Text.Encoding.UTF8.GetString(committed!);
            Assert.DoesNotContain("<<<<<<<", text);
            Assert.DoesNotContain(">>>>>>>", text);
        }
        finally { try { Directory.Delete(root, true); } catch { } }
    }
}
