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

    /// <summary>GOLDEN GATE for the sync-io optimization: the `git fast-import` tree writer MUST produce the
    /// byte-identical tree SHA that `hash-object` + `BuildTree` do — same inline content (incl. every edge case:
    /// empty, CRLF, UTF-8, no-trailing-newline, spaced path), same unchanged-by-SHA entries — or the volt/ide
    /// baseline silently diverges.</summary>
    [Fact]
    public void FastImport_tree_matches_hash_object_plus_BuildTree()
    {
        var root = TempRepo();
        try
        {
            var gitDir = Git.ResolveGitDir(root);
            var inline = new (string Mode, string Path, string Content)[]
            {
                ("100644", "src/FB_A.fb", "FUNCTION_BLOCK FB_A\nVAR x : INT; END_VAR\n"),
                ("100644", "src/Empty.st", ""),                                      // empty (cleared body)
                ("100644", "src/P.prg", "PROGRAM P\r\nVAR\r\nEND_VAR\r\n"),          // CRLF, not normalized
                ("100644", "src/Uni.st", "// ünïcödé\nVAR y : REAL; END_VAR\n"),      // UTF-8 multibyte
                ("100644", "src/NoNl.st", "END_FUNCTION_BLOCK"),                     // no trailing newline
                ("100644", "src/Plc Logic/010 PC01/pgMain.prg", "PROGRAM pgMain\nEND_PROGRAM\n"), // spaced path
                // A NON-ASCII PATH, not merely non-ASCII content (src/Uni.st above already covers that).
                // `core.quotepath` is ON by default, so any porcelain reader without -z gets this path back as
                // the octal-escaped, DOUBLE-QUOTED token "src/W\\303\\244rme/FB_X.fb".
                // German folder names are ordinary in this market, and folder names are free text.
                ("100644", "src/W\u00e4rme/FB_X.fb", "FUNCTION_BLOCK FB_X\nEND_FUNCTION_BLOCK\n"),
            };
            var existing = Git.WriteBlob(gitDir, "unchanged-object\n");
            var byRef = new[] { new IndexEntry("100644", existing, "src/Kept.fb") };

            // Reference path: hash each blob, build the tree the canonical way.
            var oldTree = Git.BuildTree(gitDir,
                inline.Select(x => new IndexEntry(x.Mode, Git.WriteBlob(gitDir, x.Content), x.Path)).Concat(byRef).ToList());

            // NEW path: one fast-import stream.
            var newTree = Git.WriteTreeViaFastImport(gitDir, inline, byRef);

            Assert.Equal(oldTree, newTree);
            // Empty set → the canonical empty tree, no throwaway ref left behind.
            Assert.Equal("4b825dc642cb6eb9a060e54bf8d69288fbee4904",
                Git.WriteTreeViaFastImport(gitDir, Array.Empty<(string, string, string)>(), Array.Empty<IndexEntry>()));
        }
        finally { ForceDelete(root); }
    }

    /// <summary>GOLDEN GATE for push's batch read: `ReadBlobsBatch` (one `cat-file --batch`) MUST return the same
    /// raw bytes as the per-file `GitShowBytes` for every spec — incl. a CRLF blob (which must come back raw, not
    /// eol-smudged) and a spaced path — with a `missing` spec omitted.</summary>
    [Fact]
    public void ReadBlobsBatch_matches_GitShowBytes_per_file()
    {
        var root = TempRepo();
        try
        {
            var gitDir = Git.ResolveGitDir(root);
            var files = new (string Path, string Content)[]
            {
                ("src/FB_A.fb", "FUNCTION_BLOCK FB_A\nEND_FUNCTION_BLOCK\n"),
                ("src/P.prg", "PROGRAM P\r\nEND_PROGRAM\r\n"),          // CRLF — must return raw
                ("src/Uni.st", "// ünïcödé comment\n"),                  // UTF-8 multibyte
                ("src/Plc Logic/x.prg", "PROGRAM x\nEND_PROGRAM\n"),     // spaced path
            };
            var entries = files.Select(f => new IndexEntry("100644", Git.WriteBlob(gitDir, f.Content), f.Path)).ToArray();
            var commit = Git.CommitTree(gitDir, Git.BuildTree(gitDir, entries), Array.Empty<string>(), "c");

            var specs = files.Select(f => $"{commit}:{f.Path}").ToList();
            specs.Add($"{commit}:src/does-not-exist.fb"); // missing → omitted, not thrown
            var batch = Git.ReadBlobsBatch(root, specs);

            foreach (var f in files)
            {
                var single = Git.GitShowBytes(root, commit, f.Path);
                Assert.True(batch.TryGetValue($"{commit}:{f.Path}", out var batched));
                Assert.Equal(single, batched); // byte-identical
            }
            Assert.False(batch.ContainsKey($"{commit}:src/does-not-exist.fb"));
            Assert.Empty(Git.ReadBlobsBatch(root, Array.Empty<string>())); // empty set → empty
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
