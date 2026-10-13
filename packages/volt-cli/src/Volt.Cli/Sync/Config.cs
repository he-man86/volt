using System.Text.Json;
using Volt.Contracts;

namespace Volt.Cli.Sync;

public sealed record WorkspacePaths(string StateDir, string ConfigPath, string IdeRefsPath);

public sealed class WorkspaceConfig
{
    public BridgeCfg Bridge { get; set; } = new();
    public ProjectCfg Project { get; set; } = new();
    public string LinkedAt { get; set; } = "";

    /// <summary>Which TEXT FORMAT the workspace files were last pulled in (openspec <c>bridge-one-to-one</c> §1.2
    /// "Migration"): <see cref="Config.CurrentTextFormat"/> once a pull has written them; 0 — absent from the JSON — for a
    /// workspace a Volt from before format 2 wrote. A push from an older format is refused by name: its files lack the
    /// <c>%</c>-lines and the verbatim trailing newlines, and would push "not excluded" over an excluded object.</summary>
    public int TextFormat { get; set; }

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
    /// <summary>The workspace text format this Volt writes and pushes: 2 — object properties spelled as <c>%</c>-lines and
    /// every text verbatim, trailing newlines included (openspec <c>bridge-one-to-one</c> §1.2). Format 1 (no
    /// <see cref="WorkspaceConfig.TextFormat"/> in the binding) is every workspace before it.</summary>
    public const int CurrentTextFormat = 2;

    /// <summary>Record that the workspace's files are now in the current text format — after a pull wrote them.</summary>
    public static void MarkCurrentTextFormat(string root, WorkspaceConfig cfg)
    {
        if (cfg.TextFormat == CurrentTextFormat) return;
        cfg.TextFormat = CurrentTextFormat;
        SaveConfig(root, cfg);
    }

    /// <summary>The refusal of a push from a workspace an older Volt wrote, or null when its text is current.</summary>
    public static string? OlderTextFormat(WorkspaceConfig cfg) =>
        cfg.TextFormat >= CurrentTextFormat ? null
            : "re-pull: the text predates object properties — this workspace was written by a Volt before text format " +
              $"{CurrentTextFormat} (object properties as %-lines, every text verbatim), and pushing it would write " +
              "'not excluded', 'no class' and folded newlines over what the IDE holds. Run `volt pull` once, then push.";

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
        return new WorkspacePaths(stateDir,
            System.IO.Path.Combine(stateDir, "config.json"), System.IO.Path.Combine(stateDir, "ide-refs.json"));
    }

    public static bool ConfigExists(string root)
    {
        // Folder-local: root must be its OWN repo root, else an ancestor repo's .git/volt would count (the
        // "already initialized" footgun in an empty subfolder). Paths() then resolves to <root>/.git.
        // Past that check the folder IS a repo, so a failing `rev-parse` is git failing (not installed, a refused repo, a
        // broken .git) — it propagates, named. It was swallowed here as "no binding", which told an engineer with a
        // bound project to run `volt init` (openspec environment-dependency-audit 1.3).
        if (!Git.IsRepoRoot(root)) return false;
        return File.Exists(Paths(root).ConfigPath);
    }

    public static WorkspaceConfig LoadConfig(string root)
    {
        var cfg = JsonSerializer.Deserialize<WorkspaceConfig>(File.ReadAllText(Paths(root).ConfigPath), Json);
        if (cfg is null || string.IsNullOrEmpty(cfg.Bridge.Vendor) || string.IsNullOrEmpty(cfg.Project.Platform) || string.IsNullOrEmpty(cfg.Project.ProjectName))
            throw new InvalidOperationException(".git/volt/config.json is malformed — re-run `volt init`");
        return cfg;
    }

    /// <summary>Writes the binding as a temp file renamed over it: the frontends read it while <c>init</c> or a rebind
    /// writes it and refuse one that is not JSON, so a truncate-then-write showed them a half-written binding.
    /// Windows refuses to replace a file another process holds open (even shared for delete) — a reader holds it for the
    /// length of one read, so the rename is retried for up to 2 s, then fails loud with the temp file removed.</summary>
    public static void SaveConfig(string root, WorkspaceConfig cfg)
    {
        var p = Paths(root);
        Directory.CreateDirectory(p.StateDir);
        var temp = p.ConfigPath + ".tmp";
        File.WriteAllText(temp, JsonSerializer.Serialize(cfg, Json) + "\n");
        var deadline = DateTime.UtcNow.AddSeconds(2);
        while (true)
        {
            try { File.Move(temp, p.ConfigPath, overwrite: true); return; }
            catch (Exception e) when (e is UnauthorizedAccessException or IOException)
            {
                if (DateTime.UtcNow >= deadline) { File.Delete(temp); throw; }
                Thread.Sleep(1);
            }
        }
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
