using System.Text.Json;

namespace Volt.Cli.Sync;

/// <summary>The optimistic-concurrency baseline — what the IDE last had (full name → version, and → folder) —
/// persisted at <c>.git/volt/ide-refs.json</c>. camelCase JSON.
///</summary>
public sealed class IdeRefs
{
    public string ProjectVersion { get; set; } = "";
    public Dictionary<string, string> Items { get; set; } = new();
    public Dictionary<string, string> Folders { get; set; } = new();
}

public static class Sidecar
{
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
    };

    public static IdeRefs? LoadIdeRefs(string root)
    {
        var p = Config.Paths(root).IdeRefsPath;
        if (!File.Exists(p)) return null; // no baseline yet — expected before the first pull
        // A corrupt sidecar throws loudly (JsonException on unparseable, or the guard below on missing fields).
        var raw = JsonSerializer.Deserialize<IdeRefs>(File.ReadAllText(p), Json);
        if (raw is null || raw.ProjectVersion is null || raw.Items is null || raw.Folders is null)
            throw new InvalidOperationException(".git/volt/ide-refs.json is malformed — delete it and run `volt pull` to rebuild the baseline");
        RefuseUnknownNames(raw, ".git/volt/ide-refs.json");
        return raw;
    }

    /// <summary>A BASELINE KEY THAT IS NO WIRE NAME IS REFUSED BY NAME, NEVER TRANSLATED. The baseline is keyed by
    /// the names the IDE publishes, and a workspace from an older Volt holds names it no longer does — its DUTs
    /// as `X.dut`, from before the wire carried the subtype. Every `ifVersion` such a key quotes names no item and
    /// every comparison against it is wrong, so the baseline is refused exactly as a malformed one is: the file to
    /// delete, and `volt pull`, which rebuilds it from what the wire says now. A translator would have to re-derive
    /// a subtype the old key never held, and would be item-kind knowledge in the CLI. "No wire name" is asked of the
    /// one extension table (`Extensions`), so no retired spelling is listed here.</summary>
    private static void RefuseUnknownNames(IdeRefs refs, string file)
    {
        var stale = refs.Items.Keys.Concat(refs.Folders.Keys)
            .FirstOrDefault(k => Extensions.DefFromName(k) is null);
        if (stale is not null)
            throw new InvalidOperationException(
                $"{file} holds \"{stale}\", which is not a name the IDE publishes (a baseline from an older Volt) — " +
                "delete .git/volt/ide-refs.json and run `volt pull` to rebuild the baseline");
    }

    public static void SaveIdeRefs(string root, IdeRefs refs)
    {
        var paths = Config.Paths(root);
        Directory.CreateDirectory(paths.StateDir);
        File.WriteAllText(paths.IdeRefsPath, JsonSerializer.Serialize(refs, Json) + "\n");
    }

    // ── pending baseline: the IDE refs a CONFLICTED pull would have adopted, stashed beside MERGE_HEAD so
    //    `volt merge --continue` can advance the live baseline once the git merge is resolved (no "pull again"). ──
    private static string PendingPath(string root) => System.IO.Path.Combine(Config.Paths(root).StateDir, "pending-ide-refs.json");

    public static void SavePendingIdeRefs(string root, IdeRefs refs)
    {
        var dir = Config.Paths(root).StateDir;
        Directory.CreateDirectory(dir);
        File.WriteAllText(PendingPath(root), JsonSerializer.Serialize(refs, Json) + "\n");
    }

    public static IdeRefs? LoadPendingIdeRefs(string root)
    {
        var p = PendingPath(root);
        if (!File.Exists(p)) return null;
        var raw = JsonSerializer.Deserialize<IdeRefs>(File.ReadAllText(p), Json);
        // A corrupt/partial stash is treated as "no stash" — never promoted into the real sidecar (which would
        // then fail LoadIdeRefs's guard). Re-running `volt pull` rebuilds a good baseline.
        if (raw is null || raw.ProjectVersion is null || raw.Items is null || raw.Folders is null) return null;
        // A stash keyed by a name the IDE no longer publishes is REFUSED here too, not only in `LoadIdeRefs`:
        // `volt merge --continue` promotes this file straight into the live sidecar, so a check only on the live
        // load would let the old key back in through the merge.
        RefuseUnknownNames(raw, ".git/volt/pending-ide-refs.json");
        return raw;
    }

    public static void ClearPendingIdeRefs(string root)
    {
        var p = PendingPath(root);
        if (File.Exists(p)) File.Delete(p);
    }
}
