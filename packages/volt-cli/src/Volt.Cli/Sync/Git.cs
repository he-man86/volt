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
/// state yields the same SHA.
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

    /// <summary>Build a tree via ONE <c>git fast-import</c> stream — git's own bulk importer, replacing the
    /// temp-file + <c>hash-object</c> + <c>update-index</c> + <c>write-tree</c> dance. Changed items go INLINE
    /// (raw UTF-8 bytes straight into the object via <c>data &lt;n&gt;</c> — no temp file, no filters, so
    /// byte-identical to a raw <c>hash-object --no-filters</c>); unchanged/scaffold entries reference
    /// their existing objects by SHA (no re-hash). Returns the tree SHA (via a throwaway commit — fast-import's
    /// unit is a commit — whose identity is irrelevant since only its tree is read). <paramref name="onProgress"/>
    /// ticks per inline item. Byte-identical tree to <see cref="BuildTree"/> for the same entries.</summary>
    public static string WriteTreeViaFastImport(
        string gitDir,
        IReadOnlyList<(string Mode, string Path, string Content)> inline,
        IReadOnlyList<IndexEntry> byRef,
        Action<int, int>? onProgress = null)
    {
        if (inline.Count == 0 && byRef.Count == 0) return EmptyTree;
        const string tmpRef = "refs/volt/fast-import-tmp";
        var buf = new MemoryStream();
        void W(string ascii) { var b = Encoding.UTF8.GetBytes(ascii); buf.Write(b, 0, b.Length); }

        W($"commit {tmpRef}\n");
        W("committer ide <ide@volt.local> 0 +0000\n"); // throwaway commit — only its tree is used
        W("data 0\n");                                  // empty message
        for (var i = 0; i < inline.Count; i++)
        {
            var (mode, path, content) = inline[i];
            var bytes = Encoding.UTF8.GetBytes(content);
            W($"M {mode} inline {StreamPath(path)}\n");
            W($"data {bytes.Length}\n");
            buf.Write(bytes, 0, bytes.Length);
            W("\n");
            if (onProgress != null && ((i + 1) % 25 == 0 || i + 1 == inline.Count)) onProgress(i + 1, inline.Count);
        }
        foreach (var e in byRef) W($"M {e.Mode} {e.Sha} {StreamPath(e.Path)}\n");
        W("done\n");

        Run(new[] { "--git-dir", gitDir, "fast-import", "--quiet", "--done" }, buf.ToArray());
        try { return Run(new[] { "--git-dir", gitDir, "rev-parse", $"{tmpRef}^{{tree}}" }).StdOut.Trim(); }
        finally { Run(new[] { "--git-dir", gitDir, "update-ref", "-d", tmpRef }, allowFail: true); }
    }

    /// <summary>A fast-import path token. Normal paths (incl. spaces + UTF-8) go verbatim — fast-import reads an
    /// unquoted path as the rest of the line, byte-for-byte. Only a leading <c>"</c> or an embedded newline
    /// forces C-style quoting (never seen in real PLC paths, but correct if it happens).</summary>
    private static string StreamPath(string path) =>
        path.Length > 0 && path[0] != '"' && !path.Contains('\n')
            ? path
            : "\"" + path.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n") + "\"";

    /// <summary>Recursive blob listing of a tree/commit (no subtree rows).
    /// <para><c>-z</c> is load-bearing, not tidiness. Without it <c>core.quotepath</c> — ON by default — hands
    /// back a non-ASCII path as a DOUBLE-QUOTED, octal-escaped token: <c>"src/W\\303\\244rme/FB_X.fb"</c>.
    /// That token then travels as if it WERE the path, so the item is not carried forward into the new
    /// <c>volt/ide</c> tree — the merge deletes it — and it is re-added under a path containing a literal
    /// quote, which Windows refuses to check out: the pull dies with <c>invalid path</c> and the workspace can
    /// never sync again. One German folder name is enough, and folder names are free text.
    /// <para>With <c>-z</c> records are NUL-terminated and paths are emitted RAW. The mode/type/object header
    /// keeps its TAB separator, so only the record terminator changes.</para></para></summary>
    public static List<TreeEntry> ListTree(string gitDir, string treeish)
    {
        var outp = Run(new[] { "--git-dir", gitDir, "ls-tree", "-r", "-z", "--full-tree", treeish }).StdOut;
        var entries = new List<TreeEntry>();
        foreach (var rec in outp.Split('\0'))
        {
            if (rec.Length == 0) continue;
            var tab = rec.IndexOf('\t');
            if (tab < 0) continue;
            var meta = rec.Substring(0, tab).Split(' ');
            entries.Add(new TreeEntry(meta[0], meta[1], meta[2], rec.Substring(tab + 1)));
        }
        return entries;
    }

    /// <summary>Build a tree from a flat entry list (handles nested paths via a throwaway index).</summary>
    // ponytail: no production caller BY DESIGN — IdeTree writes trees via WriteTreeViaFastImport. BuildTree survives as
    // the differential ORACLE that GitTests.FastImport_tree_matches_hash_object_plus_BuildTree checks the fast-import
    // writer against. It is not a second live answer to "how do we build a tree"; deleting it deletes the golden gate.
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

    /// <summary>True only when <paramref name="root"/> is ITSELF a repo root (<c>.git</c> lives directly in it) —
    /// NOT when it merely sits under an ancestor repo. Volt state lives at <c>&lt;root&gt;/.git/volt</c>, so init must
    /// never attach to a parent's <c>.git</c> (that made every folder under an ancestor repo read "already
    /// initialized"). <c>.git</c> is a dir for a normal repo, a file for a worktree/submodule.</summary>
    public static bool IsRepoRoot(string root)
    {
        var dotGit = Path.Combine(root, ".git");
        return Directory.Exists(dotGit) || File.Exists(dotGit);
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

    /// <summary>Porcelain status lines for <c>src/</c> only. Internal — read by <see cref="AutoCommitSrc"/> (how many
    /// changes it committed) and <see cref="DiscardSrc"/> (how many it discarded); both report that count to the user.</summary>
    private static List<string> DirtySrc(string root) =>
        Run(new[] { "-C", root, "status", "--porcelain", "--", "src" }).StdOut
            .Split('\n').Select(l => l.TrimEnd()).Where(l => l.Length > 0).ToList();

    /// <summary>Auto-commit any uncommitted <c>src/</c> changes so push/pull operate on a clean HEAD. Uses the
    /// user's git identity (the edits are theirs). Returns the number of changes committed (0 = nothing).</summary>
    public static int AutoCommitSrc(string root)
    {
        // A commit made while MERGE_HEAD exists is not an ordinary commit — git treats it as the CONCLUSION of
        // the merge. So this would stage the conflicted files, markers and all, conclude the merge on the
        // engineer's behalf, and leave them with no `volt merge --abort` to run. Refusing here rather than only
        // in the caller keeps the property with the primitive: any future caller gets it too.
        if (IsMerging(root))
            throw new InvalidOperationException(
                "refusing to auto-commit during a merge — that would conclude it. " +
                "Resolve it with `volt merge --continue`, or `volt merge --abort` to discard it.");
        var dirty = DirtySrc(root);
        if (dirty.Count == 0) return 0;
        Run(new[] { "-C", root, "add", "-A", "--", "src" });
        Run(new[] { "-C", root, "commit", "-q", "-m", $"volt: {dirty.Count} working change(s)" });
        return dirty.Count;
    }

    /// <summary>Throw away every uncommitted change under <c>src/</c> — modifications, staged edits, and untracked
    /// files alike — so the tree matches HEAD. This is the discard half of <c>volt pull --force</c> ("overwrite my
    /// workspace with the IDE's state"), and it is scoped to <c>src/</c> on purpose: the rest of the workspace
    /// (README, .vscode, anything the engineer keeps beside the code) is NOT Volt's to destroy.
    /// <para>Returns how many paths were discarded, for the result message — a force that silently did nothing is
    /// exactly the failure this command was added to fix.</para></summary>
    public static int DiscardSrc(string root)
    {
        var dirty = DirtySrc(root);
        if (dirty.Count == 0) return 0;
        Run(new[] { "-C", root, "reset", "-q", "--", "src" });          // unstage anything already added
        Run(new[] { "-C", root, "checkout", "--", "src" }, allowFail: true); // restore tracked files to HEAD
        Run(new[] { "-C", root, "clean", "-qfd", "--", "src" });        // and drop files that were never tracked
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
        var srcDir = Path.Combine(root, "src");
        var hits = new List<string>();
        if (!Directory.Exists(srcDir)) return hits;
        foreach (var f in Directory.EnumerateFiles(srcDir, "*", SearchOption.AllDirectories))
        {
            try
            {
                foreach (var line in File.ReadLines(f))
                    if (line.StartsWith("<<<<<<< ", StringComparison.Ordinal) || line.StartsWith(">>>>>>> ", StringComparison.Ordinal))
                    { hits.Add(Path.GetRelativePath(root, f).Replace('\\', '/')); break; }
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
        var r = Run(new[] { "-C", root, "rev-parse", "--verify", "--quiet", "MERGE_HEAD" }, allowFail: true);
        return r.Code == 0 && r.StdOut.Trim().Length > 0 ? r.StdOut.Trim() : null;
    }

    /// <summary>Parse <c>--name-status -z</c> output: NUL-separated FIELDS, not lines.
    /// <para>The record shape genuinely differs from the plain form. Without <c>-z</c> a rename is ONE
    /// tab-joined line; with it, a status field is followed by one path — or, for a rename, by TWO. So this
    /// walks a cursor rather than splitting into records, and a truncated tail is dropped rather than
    /// half-applied: a rename missing its second path would otherwise become a rename to nowhere.</para>
    /// <para><c>-z</c> is also what lets a non-ASCII path survive — see <see cref="ListTree"/> for what
    /// <c>core.quotepath</c> does to one otherwise.</para></summary>
    private static List<DiffRow> ParseDiffRows(string outp)
    {
        var rows = new List<DiffRow>();
        var f = outp.Split('\0');
        for (var i = 0; i < f.Length; i++)
        {
            var status = f[i];
            if (status.Length == 0) continue;
            if (status.StartsWith("R", StringComparison.Ordinal))
            {
                if (i + 2 >= f.Length) break;
                rows.Add(new DiffRow(DiffKinds.Rename, OldPath: f[i + 1], NewPath: f[i + 2],
                    Identical: int.TryParse(status.Substring(1), out var pct) && pct >= 100));
                i += 2;
                continue;
            }
            if (i + 1 >= f.Length) break;
            var path = f[i + 1];
            i += 1;
            if (status.StartsWith("A", StringComparison.Ordinal)) rows.Add(new DiffRow(DiffKinds.Add, Path: path));
            else if (status.StartsWith("D", StringComparison.Ordinal)) rows.Add(new DiffRow(DiffKinds.Delete, Path: path));
            else rows.Add(new DiffRow(DiffKinds.Modify, Path: path));
        }
        return rows;
    }

    /// <summary>Rename-aware name-status diff between two committed refs (-M). Both sides are commits.</summary>
    public static List<DiffRow> DiffRefs(string root, string fromRef, string toRef, string pathspec) =>
        ParseDiffRows(Run(new[] { "-C", root, "diff", "-M", "--name-status", "-z", fromRef, toRef, "--", pathspec }).StdOut);

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
            return ParseDiffRows(Run(new[] { "-C", root, "diff", "-M", "--cached", "--name-status", "-z", @ref, "--", pathspec }, env: env).StdOut);
        }
        finally { Directory.Delete(idxDir, true); }
    }

    /// <summary>Raw bytes of <c>&lt;ref&gt;:&lt;repoPath&gt;</c> (show a file at HEAD / MERGE_HEAD / a merge-base).</summary>
    public static byte[]? GitShowBytes(string root, string @ref, string repoPath)
    {
        var psi = new ProcessStartInfo("git") { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        var args = new[] { "-C", root, "show", $"{@ref}:{repoPath}" };
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi) ?? throw new GitError(string.Join(" ", args), -1, "could not start git");
        using var ms = new MemoryStream();
        var errTask = p.StandardError.BaseStream.CopyToAsync(Stream.Null);
        p.StandardOutput.BaseStream.CopyTo(ms);
        p.WaitForExit();
        errTask.GetAwaiter().GetResult();
        return p.ExitCode != 0 ? null : ms.ToArray();
    }

    /// <summary>Read many blobs in ONE <c>git cat-file --batch</c> — the batch mirror of <see cref="GitShowBytes"/>.
    /// Feed <c>&lt;ref&gt;:&lt;repoPath&gt;</c> specs on stdin; each blob comes back size-prefixed (binary-exact,
    /// spaces-in-path safe). Returns spec → raw bytes for the blobs that exist (a <c>missing</c> spec is omitted).
    /// Push uses this to read every changed file at once instead of a <c>git show</c> spawn per file.</summary>
    public static IReadOnlyDictionary<string, byte[]> ReadBlobsBatch(string root, IReadOnlyList<string> specs)
    {
        var result = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        if (specs.Count == 0) return result;

        var psi = new ProcessStartInfo("git")
        { RedirectStandardOutput = true, RedirectStandardError = true, RedirectStandardInput = true, UseShellExecute = false };
        var args = new[] { "-C", root, "cat-file", "--batch" };
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi) ?? throw new GitError(string.Join(" ", args), -1, "could not start git");
        using var outMs = new MemoryStream();
        using var errMs = new MemoryStream();
        var copyTask = p.StandardOutput.BaseStream.CopyToAsync(outMs);
        var errTask = p.StandardError.BaseStream.CopyToAsync(errMs); // kept, so a failure reports WHY (not an empty colon)
        var stdin = Encoding.UTF8.GetBytes(string.Join("\n", specs) + "\n");
        p.StandardInput.BaseStream.Write(stdin, 0, stdin.Length);
        p.StandardInput.BaseStream.Flush();
        p.StandardInput.Close();
        p.WaitForExit();
        copyTask.GetAwaiter().GetResult();
        errTask.GetAwaiter().GetResult();
        if (p.ExitCode != 0) throw new GitError("cat-file --batch", p.ExitCode, Encoding.UTF8.GetString(errMs.GetBuffer(), 0, (int)errMs.Length));

        var buf = outMs.GetBuffer();
        var len = (int)outMs.Length;
        var pos = 0;
        foreach (var spec in specs)
        {
            // Header line per object, in input order: "<sha> <type> <size>", or "<input> missing".
            var nl = Array.IndexOf(buf, (byte)'\n', pos, len - pos);
            if (nl < 0) break;
            var header = Encoding.UTF8.GetString(buf, pos, nl - pos);
            pos = nl + 1;
            if (header.EndsWith(" missing", StringComparison.Ordinal)) continue;
            var size = int.Parse(header.Substring(header.LastIndexOf(' ') + 1));
            var content = new byte[size];
            Array.Copy(buf, pos, content, 0, size);
            pos += size + 1; // content + its trailing '\n'
            result[spec] = content;
        }
        return result;
    }

    public static string? MergeBase(string root, string a, string b)
    {
        var r = Run(new[] { "-C", root, "merge-base", a, b }, allowFail: true);
        return r.Code == 0 ? r.StdOut.Trim() : null;
    }

    public static void MergeAbort(string root) => Run(new[] { "-C", root, "merge", "--abort" });

    /// <summary>Finalize a resolved merge (caller must have checked there are no unmerged paths).</summary>
    public static void MergeContinue(string root) => Run(new[] { "-C", root, "commit", "--no-edit" }, env: DetEnv);

    /// <summary>Resolve one conflicted path by taking a whole side, then stage it.
    /// <para>A side may not EXIST. In a modify/delete conflict the index holds only one of stages 2 (ours) and 3
    /// (theirs), and `git checkout --theirs` on the missing one fails with "path … does not have their version".
    /// That is precisely the conflict `volt merge --continue` sends the engineer here to resolve — it refuses
    /// structural conflicts by name and recommends this command — so the recommended command died on the case it
    /// was recommended for.</para>
    /// <para>Taking a side that deleted the file MEANS deleting it. Expressed as `git rm`, because checkout has
    /// no way to say it.</para></summary>
    public static void CheckoutSide(string root, string repoPath, string side)
    {
        var stage = side == "ours" ? "2" : "3";
        if (UnmergedStages(root, repoPath).Contains(stage))
        {
            Run(new[] { "-C", root, "checkout", $"--{side}", "--", repoPath });
            Run(new[] { "-C", root, "add", "--", repoPath });
            return;
        }
        // That side has no stage: it deleted the file. Resolving TO it removes the file and clears the conflict.
        Run(new[] { "-C", root, "rm", "-q", "-f", "--", repoPath });
    }

    /// <summary>The unmerged stage numbers present for a path — "1" base, "2" ours, "3" theirs. Empty when the
    /// path is not conflicted.</summary>
    private static HashSet<string> UnmergedStages(string root, string repoPath)
    {
        var outp = Run(new[] { "-C", root, "ls-files", "-u", "-z", "--", repoPath }).StdOut;
        var stages = new HashSet<string>(StringComparer.Ordinal);
        foreach (var rec in outp.Split('\0'))
        {
            if (rec.Length == 0) continue;
            // <mode> SP <sha> SP <stage> TAB <path>
            var tab = rec.IndexOf('\t');
            if (tab < 0) continue;
            var meta = rec.Substring(0, tab).Split(' ');
            if (meta.Length >= 3) stages.Add(meta[2]);
        }
        return stages;
    }

    /// <summary><c>git merge &lt;ref&gt;</c> into the current branch (deterministic identity). Requires a clean tree.</summary>
    public static MergeOutcome GitMerge(string root, string @ref, string message)
    {
        var r = Run(new[] { "-C", root, "merge", "--no-edit", "-m", message, @ref }, env: DetEnv, allowFail: true);
        if (r.Code == 0) return new MergeOutcome(ResultKinds.Clean, Array.Empty<string>());
        var conflicts = UnmergedPaths(root);
        if (conflicts.Count > 0) return new MergeOutcome(ResultKinds.Conflict, conflicts);
        throw new GitError($"merge {@ref}", r.Code, r.StdErr);
    }
}
