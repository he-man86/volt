using System.Text.Json;

namespace Volt.Cli.Sync;

/// <summary>The optimistic-concurrency baseline — what the IDE last had (full name → version, and → folder) —
/// persisted at <c>.git/volt/ide-refs.json</c>. camelCase JSON, byte-compatible with the TS backup's sidecar.
/// C# port of packages/volt-git/src/domain/sidecar.ts.</summary>
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
}
