namespace Volt.Cli.Sync;

/// <summary>The bridge-side inputs a status computation needs. `volt status` fetches these live; pull/push pass
/// the data they ALREADY fetched, so they build the post-action status with no extra bridge call.</summary>
public sealed class BridgeSnapshot
{
    public bool Online { get; set; }
    public string Detail { get; set; } = "offline";
    public ProjectMismatch? ProjectMismatch { get; set; }
    public Dictionary<string, string> Items { get; set; } = new();

    /// <summary>Folders the bridge could not enumerate. Non-empty means <see cref="Items"/> is a PARTIAL view
    /// of the project, so nothing may be concluded from a name's absence.</summary>
    public List<string> UnwalkedFolders { get; set; } = new();
    public Dictionary<string, string> Folders { get; set; } = new();
    public string ProjectVersion { get; set; } = "";
}

/// <summary>The drift/status model — compute the incoming changeset and the full StatusData from a bridge
/// snapshot + local git state, with NO bridge calls.</summary>
public static class StatusModel
{
    /// <summary>The IDE-side changeset: the bridge's item→version map diffed against the baseline.</summary>
    /// <param name="complete">False when the bridge could not enumerate part of the project. A deletion is
    /// derived from ABSENCE, so a partial view cannot produce one: every item under a folder that failed to
    /// read is missing from <paramref name="bridge"/>, present in the baseline, and would be rendered as
    /// incoming-REMOVED. Status would tell the user the engineer deleted their POUs.</param>
    public static ChangeSet ComputeIncoming(
        IReadOnlyDictionary<string, string> bridge, IReadOnlyDictionary<string, string> baseMap, bool complete = true)
    {
        var added = new List<string>();
        var modified = new List<string>();
        var removed = new List<string>();
        foreach (var kv in bridge)
        {
            if (!baseMap.ContainsKey(kv.Key)) added.Add(kv.Key);
            else if (baseMap[kv.Key] != kv.Value) modified.Add(kv.Key);
        }
        // ONLY A COMPLETE VIEW MAY REPORT A DELETION. See the parameter's doc: with a folder unread, every
        // item beneath it is absent from `bridge` and present in the baseline, which reads identically to the
        // engineer having deleted them.
        if (complete)
            foreach (var name in baseMap.Keys)
                if (!bridge.ContainsKey(name)) removed.Add(name);
        added.Sort(StringComparer.Ordinal);
        modified.Sort(StringComparer.Ordinal);
        removed.Sort(StringComparer.Ordinal);
        return new ChangeSet { Added = added, Modified = modified, Removed = removed };
    }

    public static StatusData BuildStatusData(string root, BridgeSnapshot snap)
    {
        var gitDir = Git.ResolveGitDir(root);
        var initialized = Config.ConfigExists(root);

        var sidecar = Sidecar.LoadIdeRefs(root);
        var incoming = snap.Online && snap.ProjectMismatch is null
            ? ComputeIncoming(snap.Items, sidecar?.Items ?? new Dictionary<string, string>(),
                              complete: snap.UnwalkedFolders.Count == 0)
            : ChangeSet.Empty();

        var pathByName = new Dictionary<string, string>();
        var outgoing = ChangeSet.Empty();
        if (IdeTree.VoltIdeHead(gitDir) is not null)
        {
            void Place(string path, List<string> bucket)
            {
                var name = Extensions.FullNameFromPath(path) ?? path;
                pathByName[name] = path;
                bucket.Add(name);
            }
            foreach (var row in Git.DiffWorktree(root, IdeTree.Range, "src"))
            {
                if (row.Kind == DiffKinds.Rename) { Place(Files.StripSrcPrefix(row.OldPath), outgoing.Removed); Place(Files.StripSrcPrefix(row.NewPath), outgoing.Added); }
                else if (row.Kind == DiffKinds.Add) Place(Files.StripSrcPrefix(row.Path), outgoing.Added);
                else if (row.Kind == DiffKinds.Delete) Place(Files.StripSrcPrefix(row.Path), outgoing.Removed);
                else Place(Files.StripSrcPrefix(row.Path), outgoing.Modified);
            }
        }
        foreach (var name in incoming.Added.Concat(incoming.Modified).Concat(incoming.Removed))
            if (!pathByName.ContainsKey(name))
            {
                var folder = snap.Folders.TryGetValue(name, out var fo) ? fo : "";
                pathByName[name] = folder.Length > 0 ? $"{folder}/{name}" : name;
            }

        Merging? merging = Git.IsMerging(root)
            ? new Merging
            {
                ProjectVersion = snap.ProjectVersion,
                Conflicts = Git.UnmergedPaths(root).Select(p => new Conflict(Files.StripSrcPrefix(p), "text", "both-modified")).ToList(),
            }
            : null;

        string? recommend = null;
        if (merging is not null) recommend = "resolve the conflict, then `volt merge --continue`";
        else if (snap.Online && incoming.Count > 0) recommend = "volt pull";
        else if (outgoing.Count > 0) recommend = "volt push";

        var summary = !initialized ? "not initialized"
            : snap.ProjectMismatch is not null ? "project mismatch — open the bound project in the IDE"
            : merging is not null ? $"merging — {merging.Conflicts.Count} conflict(s)"
            : CountSummary(incoming, outgoing);

        return new StatusData
        {
            Initialized = initialized,
            Merging = merging,
            Incoming = incoming,
            Outgoing = outgoing,
            PathByName = pathByName,
            ProjectMismatch = snap.ProjectMismatch,
            Summary = summary,
            Online = snap.Online,
            Detail = snap.Detail,
            Recommend = recommend,
        };
    }

    private static string CountSummary(ChangeSet incoming, ChangeSet outgoing)
    {
        var i = incoming.Count;
        var o = outgoing.Count;
        if (i == 0 && o == 0) return "in sync with the IDE";
        var parts = new List<string>();
        if (i > 0) parts.Add($"{i} incoming");
        if (o > 0) parts.Add($"{o} outgoing");
        return string.Join(", ", parts);
    }
}
