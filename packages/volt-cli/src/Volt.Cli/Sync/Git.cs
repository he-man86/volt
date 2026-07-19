using System.Diagnostics;
using System.Text;

namespace Volt.Cli.Sync;

/// <summary>Raised when a git subprocess exits non-zero (and the caller didn't opt into <c>allowFail</c>).</summary>
public sealed class GitError : Exception
{
    public string Cmd { get; }
    public int Code { get; }
    public string StdErr { get; }
    public GitError(string cmd, int code, string stderr) : base($"git {cmd} failed (exit {code}): {stderr.Trim()}")
    {
        Cmd = cmd; Code = code; StdErr = stderr;
    }
}

public sealed record TreeEntry(string Mode, string Type, string Sha, string Path);
public sealed record IndexEntry(string Mode, string Sha, string Path);

/// <summary>A rename-aware name-status row. <c>Kind</c> ∈ add|modify|delete|rename. For a rename, Old/New/Identical
/// are set; otherwise <c>Path</c> is set.</summary>
public sealed record DiffRow(string Kind, string Path = "", string OldPath = "", string NewPath = "", bool Identical = false);


public sealed record MergeOutcome(string Kind, IReadOnlyList<string> Paths);

/// <summary>
/// git plumbing — the only place we shell out to <c>git</c>. Two families: object-store ops take the absolute
/// git dir (build the refs/remotes/volt/ide tree in the object DB); worktree ops take the project root
/// (status/merge/diff need the working tree). IDE commits use a FIXED author/committer + epoch so the same IDE
/// state yields the same SHA. C# port of the original TypeScript implementation
/// </summary>
public static class Git
{
    private const string EmptyTree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

    private static readonly Dictionary<string, string> DetEnv = new()
    {
        ["GIT_AUTHOR_NAME"] = "ide",
        ["GIT_AUTHOR_EMAIL"] = "ide@volt.local",
        ["GIT_AUTHOR_DATE"] = "1970-01-01T00:00:00Z",
        ["GIT_COMMITTER_NAME"] = "ide",
        ["GIT_COMMITTER_EMAIL"] = "ide@volt.local",
        ["GIT_COMMITTER_DATE"] = "1970-01-01T00:00:00Z",
    };

    private sealed record Result(string StdOut, int Code, string StdErr);

    private static Result Run(string[] args, byte[]? input = null, IDictionary<string, string>? env = null, bool allowFail = false)
    {
        var psi = new ProcessStartInfo("git")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = input != null,
            UseShellExecute = false,
            StandardOutputEncoding = new UTF8Encoding(false),
            StandardErrorEncoding = new UTF8Encoding(false),
        };
        foreach (var a in args) psi.ArgumentList.Add(a);
        if (env != null) foreach (var kv in env) psi.Environment[kv.Key] = kv.Value;

        using var p = Process.Start(psi) ?? throw new GitError(string.Join(" ", args), -1, "could not start git");
        // Read stdout+stderr concurrently while writing stdin, so a large push body can't deadlock on a full pipe.
        var outTask = p.StandardOutput.ReadToEndAsync();
        var errTask = p.StandardError.ReadToEndAsync();
        if (input != null) { p.StandardInput.BaseStream.Write(input, 0, input.Length); p.StandardInput.BaseStream.Flush(); p.StandardInput.Close(); }
        p.WaitForExit();
        var stdout = outTask.GetAwaiter().GetResult();
        var stderr = errTask.GetAwaiter().GetResult();
        var code = p.ExitCode;
        if (!allowFail && code != 0) throw new GitError(string.Join(" ", args), code, stderr);
        return new Result(stdout, code, stderr);
    }

    // ── object-store ops (absolute git dir) ────────────────────────────────────

    public static string WriteBlob(string gitDir, string content) =>
        Run(new[] { "--git-dir", gitDir, "hash-object", "-w", "--stdin" }, Encoding.UTF8.GetBytes(content)).StdOut.Trim();

    /// <summary>Recursive blob listing of a tree/commit (no subtree rows).</summary>
    public static List<TreeEntry> ListTree(string gitDir, string treeish)
    {
        var outp = Run(new[] { "--git-dir", gitDir, "ls-tree", "-r", "--full-tree", treeish }).StdOut;
        var entries = new List<TreeEntry>();
        foreach (var line in outp.Split('\n'))
        {
            if (line.Length == 0) continue;
            var tab = line.IndexOf('\t');
            var meta = line.Substring(0, tab).Split(' ');
            entries.Add(new TreeEntry(meta[0], meta[1], meta[2], line.Substring(tab + 1)));
        }
        return entries;
    }

    /// <summary>Build a tree from a flat entry list (handles nested paths via a throwaway index).</summary>
    public static string BuildTree(string gitDir, IReadOnlyList<IndexEntry> entries)
    {
        if (entries.Count == 0) return EmptyTree;
        var idxDir = Directory.CreateTempSubdirectory("voltg-idx-").FullName;
        var indexFile = Path.Combine(idxDir, "index");
        try
        {
            var env = new Dictionary<string, string> { ["GIT_INDEX_FILE"] = indexFile };
            var stdin = string.Join("\n", entries.Select(e => $"{e.Mode} {e.Sha}\t{e.Path}")) + "\n";
            Run(new[] { "--git-dir", gitDir, "update-index", "--index-info" }, Encoding.UTF8.GetBytes(stdin), env);
            return Run(new[] { "--git-dir", gitDir, "write-tree" }, env: env).StdOut.Trim();
        }
        finally { Directory.Delete(idxDir, true); }
    }

    public static string? ResolveRef(string gitDir, string @ref)
    {
        var r = Run(new[] { "--git-dir", gitDir, "rev-parse", "--verify", "--quiet", @ref }, allowFail: true);
        var sha = r.StdOut.Trim();
        return r.Code == 0 && sha.Length > 0 ? sha : null;
    }

    public static void UpdateRef(string gitDir, string @ref, string sha) =>
        Run(new[] { "--git-dir", gitDir, "update-ref", @ref, sha });

    /// <summary>Deterministic commit (fixed identity + epoch). <paramref name="parents"/> may be empty (root commit).</summary>
    public static string CommitTree(string gitDir, string treeSha, IReadOnlyList<string> parents, string message)
    {
        var args = new List<string> { "--git-dir", gitDir, "commit-tree", treeSha };
        foreach (var p in parents) { args.Add("-p"); args.Add(p); }
        args.Add("-m"); args.Add(message);
        return Run(args.ToArray(), env: DetEnv).StdOut.Trim();
    }

    // ── worktree ops (project root) ────────────────────────────────────────────

    public static string ResolveGitDir(string root) =>
        Run(new[] { "-C", root, "rev-parse", "--absolute-git-dir" }).StdOut.Trim();

    public static bool IsInsideRepo(string root)
    {
        var r = Run(new[] { "-C", root, "rev-parse", "--is-inside-work-tree" }, allowFail: true);
        return r.Code == 0 && r.StdOut.Trim() == "true";
    }

    public static void GitInit(string root) =>
        Run(new[] { "init", "--initial-branch=main", "--quiet", root });

    /// <summary>Load a tree/commit into the index (no worktree change) — used to sync the index after a bootstrap.</summary>
    public static void ReadTreeToIndex(string root, string treeish) =>
        Run(new[] { "-C", root, "read-tree", treeish });

    public static string? CurrentBranch(string root)
    {
        var r = Run(new[] { "-C", root, "symbolic-ref", "--quiet", "--short", "HEAD" }, allowFail: true);
        return r.Code == 0 ? r.StdOut.Trim() : null;
    }

    public static string? HeadCommit(string root)
    {
        var r = Run(new[] { "-C", root, "rev-parse", "--verify", "--quiet", "HEAD" }, allowFail: true);
        var sha = r.StdOut.Trim();
        return r.Code == 0 && sha.Length > 0 ? sha : null;
    }

    public static bool IsMerging(string root) => File.Exists(Path.Combine(ResolveGitDir(root), "MERGE_HEAD"));

    /// <summary>Porcelain status lines for <c>src/</c> only. Internal — only <see cref="AutoCommitSrc"/> reads it.</summary>
    private static List<string> DirtySrc(string root) =>
        Run(new[] { "-C", root, "status", "--porcelain", "--", "src" }).StdOut
            .Split('\n').Select(l => l.TrimEnd()).Where(l => l.Length > 0).ToList();

    /// <summary>Auto-commit any uncommitted <c>src/</c> changes so push/pull operate on a clean HEAD. Uses the
    /// user's git identity (the edits are theirs). Returns the number of changes committed (0 = nothing).</summary>
    public static int AutoCommitSrc(string root)
    {
        var dirty = DirtySrc(root);
        if (dirty.Count == 0) return 0;
        Run(new[] { "-C", root, "add", "-A", "--", "src" });
        Run(new[] { "-C", root, "commit", "-q", "-m", $"volt: {dirty.Count} working change(s)" });
        return dirty.Count;
    }

    /// <summary>Stage and commit the entire working tree — the baseline commit on <c>volt init</c>. Returns false
    /// if there was nothing to commit.</summary>
    public static bool CommitAll(string root, string message)
    {
        Run(new[] { "-C", root, "add", "-A" });
        return Run(new[] { "-C", root, "commit", "-q", "-m", message }, allowFail: true).Code == 0;
    }

    public static List<string> UnmergedPaths(string root) =>
        Run(new[] { "-C", root, "diff", "--name-only", "--diff-filter=U" }).StdOut
            .Split('\n').Select(l => l.Trim()).Where(l => l.Length > 0).ToList();

    /// <summary>Stage all of src/ (mirrors <see cref="AutoCommitSrc"/>'s staging) so an editor-resolved merge
    /// finalises without a manual <c>git add</c>.</summary>
    public static void StageSrc(string root) => Run(new[] { "-C", root, "add", "-A", "--", "src" });

    /// <summary>src/ files that still hold git conflict markers — the REAL "unresolved" gate for merge
    /// finalisation. Staging clears git's unmerged status, so a marker scan (not <see cref="UnmergedPaths"/>) is
    /// what stops a half-resolved file from being committed with its <c>&lt;&lt;&lt;&lt;&lt;&lt;&lt;</c> markers.</summary>
    public static List<string> ConflictMarkerFiles(string root)
    {
        var srcDir = System.IO.Path.Combine(root, "src");
        var hits = new List<string>();
        if (!Directory.Exists(srcDir)) return hits;
        foreach (var f in Directory.EnumerateFiles(srcDir, "*", SearchOption.AllDirectories))
        {
            try
            {
                foreach (var line in File.ReadLines(f))
                    if (line.StartsWith("<<<<<<< ", StringComparison.Ordinal) || line.StartsWith(">>>>>>> ", StringComparison.Ordinal))
                    { hits.Add(System.IO.Path.GetRelativePath(root, f).Replace('\\', '/')); break; }
            }
            catch { /* unreadable/binary — not a text conflict */ }
        }
        return hits;
    }

    // Unmerged states that carry NO conflict markers (modify/delete, delete/delete, add/modify) — a marker scan
    // can't see them, so they MUST be resolved explicitly (volt merge --resolve) rather than auto-staged, or
    // `git add -A` would silently pick a side. UU/AA (both-modified/both-added) DO get markers, so they're handled
    // by ConflictMarkerFiles instead and are intentionally excluded here.
    private static readonly HashSet<string> StructuralConflictCodes = new(StringComparer.Ordinal) { "DD", "AU", "UD", "UA", "DU" };

    /// <summary>src/ paths in a structural (marker-less) conflict — must be resolved explicitly before continue.</summary>
    public static List<string> StructuralConflictFiles(string root)
    {
        var hits = new List<string>();
        foreach (var rec in Run(new[] { "-C", root, "status", "--porcelain", "-z", "--", "src" }).StdOut.Split('\0'))
        {
            if (rec.Length < 4) continue;
            if (StructuralConflictCodes.Contains(rec.Substring(0, 2))) hits.Add(rec.Substring(3));
        }
        return hits;
    }

    /// <summary>The MERGE_HEAD commit of an in-progress merge, or null when none — lets a finaliser confirm the
    /// merge under way is the one `volt pull` started (MERGE_HEAD == volt/ide) before adopting its stashed baseline.</summary>
    public static string? MergeHead(string root)
    {
        var r = Run(new[] { "-C", root, "rev-parse", "--verify", "-q", "MERGE_HEAD" }, allowFail: true);
        return r.Code == 0 && r.StdOut.Trim().Length > 0 ? r.StdOut.Trim() : null;
    }

    private static List<DiffRow> ParseDiffRows(string outp)
    {
        var rows = new List<DiffRow>();
        foreach (var line in outp.Split('\n'))
        {
            if (line.Length == 0) continue;
            var parts = line.Split('\t');
            var status = parts[0];
            if (status.StartsWith("R", StringComparison.Ordinal))
                rows.Add(new DiffRow("rename", OldPath: parts[1], NewPath: parts[2], Identical: int.TryParse(status.Substring(1), out var pct) && pct >= 100));
            else if (status.StartsWith("A", StringComparison.Ordinal)) rows.Add(new DiffRow("add", Path: parts[1]));
            else if (status.StartsWith("D", StringComparison.Ordinal)) rows.Add(new DiffRow("delete", Path: parts[1]));
            else rows.Add(new DiffRow("modify", Path: parts[1]));
        }
        return rows;
    }

    /// <summary>Rename-aware name-status diff between two committed refs (-M). Both sides are commits.</summary>
    public static List<DiffRow> DiffRefs(string root, string fromRef, string toRef, string pathspec) =>
        ParseDiffRows(Run(new[] { "-C", root, "diff", "-M", "--name-status", fromRef, toRef, "--", pathspec }).StdOut);

    /// <summary>Rename-aware diff of the WORKING TREE (incl. untracked) vs a committed ref — the status view.
    /// Stages the worktree into a throwaway index seeded from <paramref name="ref"/>, then diffs --cached.</summary>
    public static List<DiffRow> DiffWorktree(string root, string @ref, string pathspec)
    {
        var idxDir = Directory.CreateTempSubdirectory("voltg-wt-").FullName;
        try
        {
            var env = new Dictionary<string, string> { ["GIT_INDEX_FILE"] = Path.Combine(idxDir, "index") };
            // Guarantee the pathspec target exists so `git add -- src` is a well-defined no-op on an empty project.
            Directory.CreateDirectory(Path.Combine(root, pathspec));
            Run(new[] { "-C", root, "read-tree", @ref }, env: env);
            Run(new[] { "-C", root, "add", "-A", "--", pathspec }, env: env);
            return ParseDiffRows(Run(new[] { "-C", root, "diff", "-M", "--cached", "--name-status", @ref, "--", pathspec }, env: env).StdOut);
        }
        finally { Directory.Delete(idxDir, true); }
    }

    /// <summary>Raw bytes of <c>&lt;ref&gt;:&lt;repoPath&gt;</c> (show a file at HEAD / MERGE_HEAD / a merge-base).</summary>
    public static byte[]? GitShowBytes(string root, string @ref, string repoPath)
    {
        var psi = new ProcessStartInfo("git") { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        foreach (var a in new[] { "-C", root, "show", $"{@ref}:{repoPath}" }) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi)!;
        using var ms = new MemoryStream();
        var errTask = p.StandardError.BaseStream.CopyToAsync(Stream.Null);
        p.StandardOutput.BaseStream.CopyTo(ms);
        p.WaitForExit();
        errTask.GetAwaiter().GetResult();
        return p.ExitCode != 0 ? null : ms.ToArray();
    }

    public static string? MergeBase(string root, string a, string b)
    {
        var r = Run(new[] { "-C", root, "merge-base", a, b }, allowFail: true);
        return r.Code == 0 ? r.StdOut.Trim() : null;
    }

    public static void MergeAbort(string root) => Run(new[] { "-C", root, "merge", "--abort" });

    /// <summary>Finalize a resolved merge (caller must have checked there are no unmerged paths).</summary>
    public static void MergeContinue(string root) => Run(new[] { "-C", root, "commit", "--no-edit" }, env: DetEnv);

    /// <summary>Resolve one conflicted path by taking a whole side, then stage it.</summary>
    public static void CheckoutSide(string root, string repoPath, string side)
    {
        Run(new[] { "-C", root, "checkout", $"--{side}", "--", repoPath });
        Run(new[] { "-C", root, "add", "--", repoPath });
    }

    /// <summary><c>git merge &lt;ref&gt;</c> into the current branch (deterministic identity). Requires a clean tree.</summary>
    public static MergeOutcome GitMerge(string root, string @ref, string message)
    {
        var r = Run(new[] { "-C", root, "merge", "--no-edit", "-m", message, @ref }, env: DetEnv, allowFail: true);
        if (r.Code == 0) return new MergeOutcome("clean", Array.Empty<string>());
        var conflicts = UnmergedPaths(root);
        if (conflicts.Count > 0) return new MergeOutcome("conflict", conflicts);
        throw new GitError($"merge {@ref}", r.Code, r.StdErr);
    }
}
