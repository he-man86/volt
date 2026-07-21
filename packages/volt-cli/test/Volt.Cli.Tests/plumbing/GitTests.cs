using System;
using System.IO;
using System.Linq;
using System.Text;
using Volt.Cli.Sync;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>Exercises the ported git plumbing (<see cref="Git"/>) against a real throwaway repo — the C# port of
/// what volt-git's git.ts tests covered. Object-store roundtrip, worktree diff, auto-commit, and byte show.</summary>
public class GitTests
{
    /// <summary>Recursively delete a repo — clearing the read-only attribute git sets on loose objects on Windows,
    /// which plain <see cref="Directory.Delete(string, bool)"/> can't remove (UnauthorizedAccessException).</summary>
    private static void ForceDelete(string dir)
    {
        if (!Directory.Exists(dir)) return;
        foreach (var f in Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories))
            try { File.SetAttributes(f, FileAttributes.Normal); } catch { /* best effort */ }
        try { Directory.Delete(dir, true); } catch { /* best effort */ }
    }

    private static string TempRepo()
    {
        // Give child git processes a definite identity so commits work regardless of the machine's git config.
        Environment.SetEnvironmentVariable("GIT_AUTHOR_NAME", "t");
        Environment.SetEnvironmentVariable("GIT_AUTHOR_EMAIL", "t@t");
        Environment.SetEnvironmentVariable("GIT_COMMITTER_NAME", "t");
        Environment.SetEnvironmentVariable("GIT_COMMITTER_EMAIL", "t@t");
        var dir = Directory.CreateTempSubdirectory("volt-git-test-").FullName;
        Git.GitInit(dir);
        return dir;
    }

    [Fact]
    public void Object_store_roundtrip_blob_tree_commit_ref()
    {
        var root = TempRepo();
        try
        {
            var gitDir = Git.ResolveGitDir(root);
            var sha = Git.WriteBlob(gitDir, "PROGRAM P\nVAR\nEND_VAR\n");
            Assert.Matches("^[0-9a-f]{40}$", sha);

            var tree = Git.BuildTree(gitDir, new[] { new IndexEntry("100644", sha, "src/P.prg") });
            var commit = Git.CommitTree(gitDir, tree, Array.Empty<string>(), "volt: test");
            Assert.Matches("^[0-9a-f]{40}$", commit);

            Git.UpdateRef(gitDir, "refs/remotes/volt/ide", commit);
            Assert.Equal(commit, Git.ResolveRef(gitDir, "refs/remotes/volt/ide"));

            Assert.Contains(Git.ListTree(gitDir, tree), e => e.Path == "src/P.prg" && e.Sha == sha);

            // Deterministic: identical content hashes to the same blob, and (with the fixed IDE identity/epoch) the
            // same commit SHA — the property the no-churn skip relies on.
            Assert.Equal(sha, Git.WriteBlob(gitDir, "PROGRAM P\nVAR\nEND_VAR\n"));
            Assert.Equal(commit, Git.CommitTree(gitDir, tree, Array.Empty<string>(), "volt: test"));
        }
        finally { ForceDelete(root); }
    }

    /// <summary>The batched blob write (one git process for N files, the fast path a large init uses) MUST produce
    /// the byte-identical objects the per-file <see cref="Git.WriteBlob"/> does — same SHAs, same order — or the
    /// volt/ide baseline would silently diverge.</summary>
    [Fact]
    public void WriteBlobs_batch_matches_per_file_WriteBlob()
    {
        var root = TempRepo();
        try
        {
            var gitDir = Git.ResolveGitDir(root);
            var contents = new[]
            {
                "FUNCTION_BLOCK FB_A\nVAR x : INT; END_VAR\n",
                "",                                   // empty item (a cleared body)
                "PROGRAM P\r\nVAR\r\nEND_VAR\r\n",    // pre-existing CRLF must NOT be filtered/normalized
                "// ünïcödé comment\nVAR y : REAL; END_VAR\n",
            };
            var expected = contents.Select(c => Git.WriteBlob(gitDir, c)).ToList();
            var batched = Git.WriteBlobs(gitDir, contents);
            Assert.Equal(expected, batched);
            Assert.Empty(Git.WriteBlobs(gitDir, Array.Empty<string>()));
        }
        finally { ForceDelete(root); }
    }

    [Fact]
    public void Worktree_diff_sees_an_added_src_file_vs_a_ref()
    {
        var root = TempRepo();
        try
        {
            var gitDir = Git.ResolveGitDir(root);
            var baseCommit = Git.CommitTree(gitDir, Git.BuildTree(gitDir, Array.Empty<IndexEntry>()), Array.Empty<string>(), "base");
            Git.UpdateRef(gitDir, "refs/remotes/volt/ide", baseCommit);

            Directory.CreateDirectory(Path.Combine(root, "src"));
            File.WriteAllText(Path.Combine(root, "src", "FB_Motor.fb"), "FUNCTION_BLOCK FB_Motor\n");

            Assert.Contains(Git.DiffWorktree(root, "refs/remotes/volt/ide", "src"),
                r => r.Kind == "add" && r.Path == "src/FB_Motor.fb");
        }
        finally { ForceDelete(root); }
    }

    [Fact]
    public void AutoCommit_and_show_bytes_roundtrip()
    {
        var root = TempRepo();
        try
        {
            Directory.CreateDirectory(Path.Combine(root, "src"));
            File.WriteAllText(Path.Combine(root, "src", "P.prg"), "PROGRAM P\n");

            Assert.Equal(1, Git.AutoCommitSrc(root));
            Assert.NotNull(Git.HeadCommit(root));

            var bytes = Git.GitShowBytes(root, "HEAD", "src/P.prg");
            Assert.NotNull(bytes);
            Assert.Equal("PROGRAM P\n", Encoding.UTF8.GetString(bytes!));

            Assert.Equal(0, Git.AutoCommitSrc(root)); // clean tree → nothing committed
        }
        finally { ForceDelete(root); }
    }
}
