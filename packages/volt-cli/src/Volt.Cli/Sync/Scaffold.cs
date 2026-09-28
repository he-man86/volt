using System.Text.Json;
using Volt.Engine.Item;

namespace Volt.Cli.Sync;

public sealed record ScaffoldReport(List<string> Created);

/// <summary>Workspace scaffold — seeds a Volt-bound directory with a README describing the sync workflow and
/// VS Code file associations for the ST kinds. Never overwrites: an existing file is kept. (`volt init` refuses a
/// non-empty root, so that belt-and-braces check never actually fires — hence no "skipped" report.)</summary>
public static class Scaffold
{
    public static ScaffoldReport WriteWorkspaceScaffold(string root, string projectName)
    {
        var files = new (string Path, string Content)[]
        {
            (".vscode/settings.json", VscodeSettings()),
            ("README.md", Readme(projectName)),
        };
        var created = new List<string>();
        foreach (var (path, content) in files)
        {
            var abs = System.IO.Path.Combine(root, path);
            if (File.Exists(abs)) continue;
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(abs)!);
            File.WriteAllText(abs, content);
            created.Add(path);
        }
        return new ScaffoldReport(created);
    }

    private static string VscodeSettings()
    {
        // Derived from the one canonical kind table (like Extensions.cs) — a new source kind's extension is added in
        // ItemKind.FileExtensions and a freshly-`volt init`-ed workspace colours it as structured-text automatically.
        var associations = new Dictionary<string, string>();
        foreach (var x in ItemKind.FileExtensions)
            if (x.IsSource) associations["*." + x.Ext] = "structured-text";
        var settings = new Dictionary<string, object> { ["files.associations"] = associations };
        return JsonSerializer.Serialize(settings, new JsonSerializerOptions { WriteIndented = true }) + "\n";
    }

    private static string Readme(string projectName) => string.Join("\n", new[]
    {
        $"# {projectName} (Volt workspace)", "",
        "Bound to a running PLC IDE — Volt keeps its binding + IDE baseline in `.git/volt/` (managed for you).", "",
        "## Two axes",
        "- **`volt pull` / `volt push`** sync `src/` with the live IDE (the machine).",
        "- **`git commit` / `git push`** version the text + share with the team. Commit before pulling.", "",
        "`src/` mirrors the IDE — edit the kind-named source files locally; `volt push` writes them back.",
        "Every body opens with a line stating its language: `IMPLEMENTATION ST`, or `IMPLEMENTATION LD` /",
        "`IMPLEMENTATION FBD` over network text. A body Volt does not show (CFC, SFC, IL, an LD/FBD body network",
        "text cannot spell yet) is `IMPLEMENTATION <LANG> UNSUPPORTED` with nothing under it: its declaration stays",
        "editable, and `volt push` never writes that body.", "",
        "## File extensions", "",
        "A file's name is its item's name in the IDE, and the extension names what the item is.", "",
        // Rendered from the one extension table (as VscodeSettings is), never typed out: a hand-kept kind table
        // here was item-kind knowledge in the CLI, and had drifted from what Volt actually writes.
        "- Pushed back by `volt push`: " + Listed(Extensions.PushableExtensions),
        "- Read-only (the IDE owns them — don't hand-edit): " + Listed(Extensions.ReadOnlyExtensions), "",
        "## What lives where",
        "- `.git/`    a normal git repo — Volt keeps its binding + IDE baseline in `.git/volt/`",
        "- `.claude/` AI language reference for ST (committed)",
        "- `src/`     synced from the IDE (leave to Volt)", "",
    });

    private static string Listed(IEnumerable<string> extensions) =>
        string.Join(" ", extensions.Select(e => "`." + e + "`"));
}
