namespace Volt.Cli.Sync;

/// <summary>
/// refs/remotes/volt/ide — the live IDE modelled as a git remote-tracking branch. Each commit's tree is the
/// user's branch tree with ONLY <c>src/</c> swapped for the IDE's state, so the merge never touches the scaffold.
/// C# port of packages/volt-git/src/domain/ide-tree.ts — the correctness-critical merge engine.
/// </summary>
public static class IdeTree
{
    public const string Range = "refs/remotes/volt/ide";

    public static string? VoltIdeHead(string gitDir) => Git.ResolveRef(gitDir, Range);

    /// <summary>
    /// Build the volt/ide tree = the IDE's current state under <c>src/</c>, plus the user's scaffold from HEAD.
    /// Tracked src/ files: changed items → the fetched content; unchanged items → carried from the PARENT volt/ide
    /// tree (the IDE's last-known content, NOT HEAD — HEAD holds the user's un-pushed edits, and sourcing an
    /// unchanged item from HEAD would fold that edit into the IDE baseline and strand it forever); removed items →
    /// dropped. Everything else (non-src scaffold, non-tracked src files) is carried from HEAD (the user's side),
    /// so the merge only ever touches the IDE axis. On init parentIde is null and ideFiles is the whole IDE.
    /// </summary>
    public static string BuildVoltIdeTree(
        string gitDir,
        string? headCommit,
        string? parentIde,
        IReadOnlyList<MaterializedFile> ideFiles,
        IReadOnlyList<string> removedNames)
    {
        var entries = new List<IndexEntry>();
        var seen = new HashSet<string>();
        void Add(IndexEntry e) { if (seen.Add(e.Path)) entries.Add(e); }

        string? SrcRel(string path) => path.StartsWith(Files.SrcDir + "/", StringComparison.Ordinal) ? path.Substring(Files.SrcDir.Length + 1) : null;
        var replaced = new HashSet<string>(ideFiles.Select(f => f.Path));
        var removed = new HashSet<string>(removedNames);

        // Changed IDE items — fresh content from the fetch.
        foreach (var f in ideFiles)
            Add(new IndexEntry("100644", Git.WriteBlob(gitDir, f.Content), $"{Files.SrcDir}/{f.Path}"));

        // Unchanged IDE items — from the previous volt/ide tree (the IDE's last-known content, NOT the user's HEAD).
        if (parentIde is not null)
            foreach (var e in Git.ListTree(gitDir, parentIde))
            {
                var rel = SrcRel(e.Path);
                if (rel is not null && Extensions.IsTrackedPath(rel) && !replaced.Contains(rel) && !removed.Contains(rel))
                    Add(new IndexEntry(e.Mode, e.Sha, e.Path));
            }

        // Scaffold + non-tracked src/ files — from HEAD (the user's side; the merge leaves these untouched).
        if (headCommit is not null)
            foreach (var e in Git.ListTree(gitDir, headCommit))
            {
                var rel = SrcRel(e.Path);
                if (rel is null || !Extensions.IsTrackedPath(rel))
                    Add(new IndexEntry(e.Mode, e.Sha, e.Path));
            }

        return Git.BuildTree(gitDir, entries);
    }

    public static string CommitVoltIde(string gitDir, string treeSha, string? parent, string message) =>
        Git.CommitTree(gitDir, treeSha, parent is not null ? new[] { parent } : Array.Empty<string>(), message);
}
