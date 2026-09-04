using Volt.Engine.Library;

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
        bool librariesRefreshed,
        Action<int, int>? onBlobs = null)
    {
        var seen = new HashSet<string>();
        var inline = new List<(string Mode, string Path, string Content)>(); // changed items → raw bytes, no temp
        var byRef = new List<IndexEntry>();                                   // unchanged/scaffold → existing SHA
        void AddInline(string path, string content) { if (seen.Add(path)) inline.Add(("100644", path, content)); }
        void AddRef(IndexEntry e) { if (seen.Add(e.Path)) byRef.Add(e); }

        string? SrcRel(string path) => path.StartsWith(Files.SrcDir + "/", StringComparison.Ordinal) ? path.Substring(Files.SrcDir.Length + 1) : null;
        var replaced = new HashSet<string>(ideFiles.Select(f => f.Path));
        // BARE WIRE NAMES ("Foo.fb"), not paths — the fetch reports what the IDE deleted, and an item's identity
        // is its name (the whole wire is keyed that way). `replaced` above IS a path set, which is why only this
        // one needed the distinction spelt out: comparing names against src-relative paths silently matched
        // nothing for any item in a folder, so a deletion in the IDE never reached the workspace unless the item
        // sat in the project root.
        var removedNamesSet = new HashSet<string>(removedNames);
        static string NameOf(string rel) { var i = rel.LastIndexOf('/'); return i < 0 ? rel : rel.Substring(i + 1); }

        // A referenced LIBRARY's rendered element signatures are not IDE items and have no identity on the wire:
        // they are content the bridge re-renders per library version, and they carry ordinary SOURCE extensions
        // (.fb/.fun/.itf/.struct/.gvl). So a bare-name sweep hits them by accident — deleting the project's own
        // `ERROR.struct` also deleted `Library Manager/CAA/ERROR.struct`, which nothing regenerates until that library's
        // version changes. Removal is keyed by NAME (identity is the item name) and these files have no item, so
        // they are exempt by LOCATION. A library root is any directory holding a `.library` stub.
        var libraryRoots = parentIde is null
            ? new HashSet<string>(StringComparer.Ordinal)
            : LibraryRoots(Git.ListTree(gitDir, parentIde).Select(e => e.Path));
        bool UnderLibrary(string rel) => IsUnderLibraryRoot(rel, libraryRoots);

        // When the fetch RE-RENDERED the signatures, `ideFiles` carries the COMPLETE set for every library
        // folder, so a signature the client still holds and this response does not carry is an element that no
        // longer exists — the library was upgraded, or its reference removed. Dropping it is the only removal
        // signal these files have: they are PATH-identified, not name-identified (two libraries may export the
        // same short name), so they never appear in `Items` and `Removed` can never name one. Without this they
        // were immortal and kept resolving in the LSP long after the element was gone.
        // When the fetch SKIPPED the precompile there are no signatures in the response at all, so the folders
        // are carried forward untouched — replacing them then would delete every one of them.
        bool DroppedLibraryFile(string rel) => librariesRefreshed && UnderLibrary(rel) && !replaced.Contains(rel);

        // Changed IDE items — fresh content from the fetch, streamed INLINE into git objects (no temp file, no
        // per-file hash-object). Added first so they win the `seen` de-dup over any same-path parent/scaffold entry.
        foreach (var f in ideFiles) AddInline($"{Files.SrcDir}/{f.Path}", f.Content);

        // Unchanged IDE items — from the previous volt/ide tree (the IDE's last-known content, NOT the user's HEAD),
        // referenced by their existing SHA (no re-hash).
        if (parentIde is not null)
            foreach (var e in Git.ListTree(gitDir, parentIde))
            {
                var rel = SrcRel(e.Path);
                if (rel is not null && Extensions.IsTrackedPath(rel) && !replaced.Contains(rel)
                    && !(removedNamesSet.Contains(NameOf(rel)) && !UnderLibrary(rel))
                    && !DroppedLibraryFile(rel))
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

    /// <summary>The workspace folders that hold a REFERENCED LIBRARY's rendered files — any directory containing
    /// a <c>.library</c> stub, taken from a tree listing of <c>src/</c> paths.
    /// <para>Library files are read-only and identity-less by LOCATION, not by extension: the element signatures
    /// the bridge renders beside each stub carry ordinary SOURCE extensions (.fb/.fun/.itf/.struct/.gvl), so the
    /// extension-keyed classifier calls them writable and a bare-name sweep matches them by accident. Two
    /// separate places need that answer — the pull's removal sweep and the push's read-only guard — so it is
    /// defined ONCE here; two spellings of it would drift and each drift is a data-loss bug.</para></summary>
    public static HashSet<string> LibraryRoots(IEnumerable<string> treePaths)
    {
        var roots = new HashSet<string>(StringComparer.Ordinal);
        foreach (var path in treePaths)
        {
            var rel = path.StartsWith(Files.SrcDir + "/", StringComparison.Ordinal)
                ? path.Substring(Files.SrcDir.Length + 1) : path;
            // A `(unresolved)/<lib>/` tree is a library root too, even though it has no `.library` stub -
            // it is the one tree `LibraryFetch` writes without one. Keying protection purely on stub presence
            // left every signature under it an ordinary WRITABLE project item, so a bare-name collision with a
            // real POU let a declaration-only signature overwrite the engineer's code in the live PLC, and a
            // stale signature there was immortal. Recognised by the marker the engine names, not by a
            // fabricated vendor file.
            var marker = "/" + LibraryLayout.UnresolvedFolder + "/";
            var u = rel.IndexOf(marker, StringComparison.Ordinal);
            if (u > 0)
            {
                var after = rel.Substring(u + marker.Length);
                var slash = after.IndexOf('/');
                if (slash > 0) roots.Add(rel.Substring(0, u + marker.Length + slash));
                continue;
            }

            if (!rel.EndsWith(".library", StringComparison.Ordinal)) continue;
            var i = rel.LastIndexOf('/');
            if (i > 0) roots.Add(rel.Substring(0, i));
        }
        return roots;
    }

    /// <summary>Is this src-relative path inside one of <paramref name="roots"/>? A directory boundary is
    /// required, so `Library Manager/CAA2/x` is not inside `Library Manager/CAA`.</summary>
    public static bool IsUnderLibraryRoot(string rel, HashSet<string> roots) =>
        roots.Any(r => rel.Length > r.Length + 1 && rel[r.Length] == '/' &&
                       rel.StartsWith(r, StringComparison.Ordinal));

    public static string CommitVoltIde(string gitDir, string treeSha, string? parent, string message) =>
        Git.CommitTree(gitDir, treeSha, parent is not null ? new[] { parent } : Array.Empty<string>(), message);
}
