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
        return raw;
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
        return raw is null || raw.ProjectVersion is null || raw.Items is null || raw.Folders is null ? null : raw;
    }

    public static void ClearPendingIdeRefs(string root)
    {
        var p = PendingPath(root);
        if (File.Exists(p)) File.Delete(p);
    }
}
