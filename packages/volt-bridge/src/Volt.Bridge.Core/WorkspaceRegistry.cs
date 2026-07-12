using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace Volt.Bridge.Core;

/// <summary>Reads the reverse workspace registry that <c>volt-git</c> maintains at
/// <c>%LOCALAPPDATA%\Volt\workspaces.json</c> (workspace root ← bridge port/project). The per-repo binding
/// (<c>.git/volt/config.json</c>) records workspace→bridge and isn't reverse-resolvable; the connector owns the
/// IDE-changes panel but only knows its live IDE, so it uses this index to answer "for the project on port N,
/// which git workspace?" and then shells <c>volt-git</c> there. Mirrors <c>volt-git/src/config/registry.ts</c>;
/// the two must agree on the JSON shape + location.</summary>
public static class WorkspaceRegistry
{
    private sealed class Entry
    {
        public string root { get; set; } = "";
        public int port { get; set; }
        public string platform { get; set; } = "";
        public string projectName { get; set; } = "";
        public string lastSeen { get; set; } = "";
    }

    /// <summary>The registry file. <c>VOLT_REGISTRY_DIR</c> overrides the containing dir (tests) — same override
    /// the TS side honours.</summary>
    public static string FilePath()
    {
        var dir = Environment.GetEnvironmentVariable("VOLT_REGISTRY_DIR");
        if (!string.IsNullOrEmpty(dir)) return Path.Combine(dir, "workspaces.json");
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        return Path.Combine(local, "Volt", "workspaces.json");
    }

    private static List<Entry> Read()
    {
        try
        {
            return JsonSerializer.Deserialize<List<Entry>>(File.ReadAllText(FilePath())) ?? new List<Entry>();
        }
        catch
        {
            return new List<Entry>(); // missing/malformed → no known workspaces (never throws into the caller)
        }
    }

    /// <summary>The workspace bound to the live bridge on <paramref name="port"/> (optionally requiring a matching
    /// <paramref name="projectName"/>): the most-recently-seen entry whose root still exists, or null.</summary>
    public static string? Resolve(int port, string? projectName = null) =>
        Read()
            .Where(e => e.port == port && Directory.Exists(e.root)
                        && (projectName == null || string.Equals(e.projectName, projectName, StringComparison.OrdinalIgnoreCase)))
            .OrderByDescending(e => e.lastSeen, StringComparer.Ordinal)
            .FirstOrDefault()?.root;

    /// <summary>Every known workspace whose root still exists.</summary>
    public static IReadOnlyList<string> Known() =>
        Read().Where(e => Directory.Exists(e.root)).Select(e => e.root).Distinct().ToList();
}
