namespace Volt.Cli.Sync;

/// <summary>
/// refs/remotes/volt/ide — the live IDE modelled as a git remote-tracking branch. Each commit's tree is the
/// user's branch tree with ONLY <c>src/</c> swapped for the IDE's state, so the merge never touches the scaffold.
/// The correctness-critical merge engine.
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
        IReadOnlyList<string> removedNames,
        Action<int, int>? onBlobs = null)
    {
        var seen = new HashSet<string>();
        var inline = new List<(string Mode, string Path, string Content)>(); // changed items → raw bytes, no temp
        var byRef = new List<IndexEntry>();                                   // unchanged/scaffold → existing SHA
        void AddInline(string path, string content) { if (seen.Add(path)) inline.Add(("100644", path, content)); }
        void AddRef(IndexEntry e) { if (seen.Add(e.Path)) byRef.Add(e); }

        string? SrcRel(string path) => path.StartsWith(Files.SrcDir + "/", StringComparison.Ordinal) ? path.Substring(Files.SrcDir.Length + 1) : null;
        var replaced = new HashSet<string>(ideFiles.Select(f => f.Path));
        var removed = new HashSet<string>(removedNames);

        // Changed IDE items — fresh content from the fetch, streamed INLINE into git objects (no temp file, no
        // per-file hash-object). Added first so they win the `seen` de-dup over any same-path parent/scaffold entry.
        foreach (var f in ideFiles) AddInline($"{Files.SrcDir}/{f.Path}", f.Content);

        // Unchanged IDE items — from the previous volt/ide tree (the IDE's last-known content, NOT the user's HEAD),
        // referenced by their existing SHA (no re-hash).
        if (parentIde is not null)
            foreach (var e in Git.ListTree(gitDir, parentIde))
            {
                var rel = SrcRel(e.Path);
                if (rel is not null && Extensions.IsTrackedPath(rel) && !replaced.Contains(rel) && !removed.Contains(rel))
                    AddRef(new IndexEntry(e.Mode, e.Sha, e.Path));
            }

        // Scaffold + non-tracked src/ files — from HEAD (the user's side; the merge leaves these untouched).
        if (headCommit is not null)
            foreach (var e in Git.ListTree(gitDir, headCommit))
            {
                var rel = SrcRel(e.Path);
                if (rel is null || !Extensions.IsTrackedPath(rel))
                    AddRef(new IndexEntry(e.Mode, e.Sha, e.Path));
            }

        // ONE fast-import stream builds blobs + tree together — no temp files, no separate hash-object /
        // update-index / write-tree passes, byte-identical to the old path (proven by the golden test).
        return Git.WriteTreeViaFastImport(gitDir, inline, byRef, onBlobs);
    }

    public static string CommitVoltIde(string gitDir, string treeSha, string? parent, string message) =>
        Git.CommitTree(gitDir, treeSha, parent is not null ? new[] { parent } : Array.Empty<string>(), message);
}
