using System.Text.Json;
using Volt.Engine.Wire;

namespace Volt.Cli.Sync;

public sealed record WorkspacePaths(string Root, string StateDir, string ConfigPath, string IdeRefsPath);

public sealed class WorkspaceConfig
{
    public BridgeCfg Bridge { get; set; } = new();
    public ProjectCfg Project { get; set; } = new();
    public string LinkedAt { get; set; } = "";

    public sealed class BridgeCfg { public string Vendor { get; set; } = ""; }
    public sealed class ProjectCfg { public string Platform { get; set; } = ""; public string ProjectName { get; set; } = ""; }
}

/// <summary>
/// Workspace config + binding — the bridge binding (which bridge + IDE project this workspace is linked to),
/// stored INSIDE the repo at <c>.git/volt/</c> (camelCase JSON).
///
/// </summary>
public static class Config
{
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
    };

    /// <summary>Volt's state paths under the repo's git dir. Throws if <paramref name="root"/> isn't a git repo
    /// yet — only <see cref="ConfigExists"/> runs before <c>git init</c>, and it guards for that.</summary>
    public static WorkspacePaths Paths(string root)
    {
        var stateDir = System.IO.Path.Combine(Git.ResolveGitDir(root), "volt");
        return new WorkspacePaths(System.IO.Path.GetFullPath(root), stateDir,
            System.IO.Path.Combine(stateDir, "config.json"), System.IO.Path.Combine(stateDir, "ide-refs.json"));
    }

    public static bool ConfigExists(string root)
    {
        // Folder-local: root must be its OWN repo root, else an ancestor repo's .git/volt would count (the
        // "already initialized" footgun in an empty subfolder). Paths() then resolves to <root>/.git.
        if (!Git.IsRepoRoot(root)) return false;
        try { return File.Exists(Paths(root).ConfigPath); }
        catch { return false; } // not a git repo yet → not an initialized Volt workspace
    }

    public static WorkspaceConfig LoadConfig(string root)
    {
        var cfg = JsonSerializer.Deserialize<WorkspaceConfig>(File.ReadAllText(Paths(root).ConfigPath), Json);
        if (cfg is null || string.IsNullOrEmpty(cfg.Bridge.Vendor) || string.IsNullOrEmpty(cfg.Project.Platform) || string.IsNullOrEmpty(cfg.Project.ProjectName))
            throw new InvalidOperationException(".git/volt/config.json is malformed — re-run `volt init`");
        return cfg;
    }

    public static void SaveConfig(string root, WorkspaceConfig cfg)
    {
        var p = Paths(root);
        Directory.CreateDirectory(p.StateDir);
        File.WriteAllText(p.ConfigPath, JsonSerializer.Serialize(cfg, Json) + "\n");
    }

    /// <summary>Structured platform/projectName mismatch between the binding and the bridge's loaded project.</summary>
    public static ProjectMismatch? ProjectMismatch(WorkspaceConfig cfg, HealthResponse health)
    {
        var bridge = new ProjectId(health.Platform, health.ProjectName ?? "");
        var configured = new ProjectId(cfg.Project.Platform, cfg.Project.ProjectName);
        var diff = new List<string>();
        if (configured.Platform != bridge.Platform) diff.Add("platform");
        if (configured.ProjectName != bridge.ProjectName) diff.Add("projectName");
        return diff.Count > 0 ? new ProjectMismatch(configured, bridge, diff) : null;
    }

    /// <summary>Null when the identity a fetch echoed matches the binding; else a refuse string. A current bridge
    /// also enforces this server-side (WRONG_PROJECT before it returns), so this is a cheap pre-merge confirmation.</summary>
    public static string? VerifyFetchedIdentity(WorkspaceConfig cfg, string? platform, string? projectName)
    {
        if (cfg.Project.Platform == platform && cfg.Project.ProjectName == projectName) return null;
        return $"bridge is on {platform}/{projectName}, but this workspace is bound to " +
               $"{cfg.Project.Platform}/{cfg.Project.ProjectName} — open the bound project in the IDE";
    }

    public static string? ConfiguredVendor(string root)
    {
        try { return LoadConfig(root).Bridge.Vendor; }
        catch { return null; }
    }
}
