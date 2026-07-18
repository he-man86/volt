using System.Text.Json;
using Volt.Bridge.Core.Wire;

namespace Volt.Cli.Sync;

public sealed record WorkspacePaths(string Root, string StateDir, string ConfigPath, string IdeRefsPath);

public sealed class WorkspaceConfig
{
    public BridgeCfg Bridge { get; set; } = new();
    public ProjectCfg Project { get; set; } = new();
    public string LinkedAt { get; set; } = "";

    public sealed class BridgeCfg { public int Port { get; set; } }
    public sealed class ProjectCfg { public string Platform { get; set; } = ""; public string ProjectName { get; set; } = ""; }
}

/// <summary>
/// Workspace config + binding — the bridge binding (which bridge + IDE project this workspace is linked to),
/// stored INSIDE the repo at <c>.git/volt/</c> (camelCase JSON, byte-compatible with the TS backup's config).
/// C# port of packages/volt-git/src/config.ts.
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
        try { return File.Exists(Paths(root).ConfigPath); }
        catch { return false; } // not a git repo yet → not an initialized Volt workspace
    }

    public static WorkspaceConfig LoadConfig(string root)
    {
        var cfg = JsonSerializer.Deserialize<WorkspaceConfig>(File.ReadAllText(Paths(root).ConfigPath), Json);
        if (cfg is null || cfg.Bridge.Port == 0 || string.IsNullOrEmpty(cfg.Project.Platform) || string.IsNullOrEmpty(cfg.Project.ProjectName))
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

    /// <summary>Null when this workspace can safely act on the bridge; else a refuse string. Checks BOTH that an
    /// IDE is attached (connected) and that its project matches the binding.</summary>
    public static string? VerifyBinding(WorkspaceConfig cfg, HealthResponse health)
    {
        if (!health.Connected)
            return "the IDE has no project loaded — open the bound project in the IDE and start its bridge, then retry";
        var mm = ProjectMismatch(cfg, health);
        if (mm is not null)
            return $"bridge is on {mm.BridgeReports.Platform}/{mm.BridgeReports.ProjectName}, but this workspace is bound to " +
                   $"{mm.ConfiguredAs.Platform}/{mm.ConfiguredAs.ProjectName} — open the bound project in the IDE";
        return null;
    }

    public static int? ConfiguredBridgePort(string root)
    {
        try { return LoadConfig(root).Bridge.Port; }
        catch { return null; }
    }
}
