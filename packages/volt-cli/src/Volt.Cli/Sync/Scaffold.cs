using System.Text.Json;
using Volt.Engine.Format.Body;
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
        "FBD/LD graphical bodies ride in those files too, editable as network text. `.cfc`/`.sfc` are read-only",
        "views of graphical bodies (don't hand-edit).", "",
        "## File extensions — name every item by its KIND", "",
        "An item's extension IS its kind. Every DUT (struct, enum, union, alias) is a single `.dut` file —",
        "the same as CODESYS and TwinCAT, which model a DUT as one object type; the struct/enum/union/alias",
        "distinction lives in the declaration body.", "",
        "| Kind | Extension | | Kind | Extension |",
        "|---|---|---|---|---|",
        "| Program | `.prg` | | Interface | `.itf` |",
        "| Function | `.fun` | | DUT (struct/enum/union/alias) | `.dut` |",
        "| Function block | `.fb` | | Global var list | `.gvl` |", "",
        "## What lives where",
        "- `.git/`    a normal git repo — Volt keeps its binding + IDE baseline in `.git/volt/`",
        "- `.claude/` AI language reference for ST (committed)",
        "- `src/`     synced from the IDE (leave to Volt)", "",
    });
}
