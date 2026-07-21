using System.Text.Json;
using System.Text.RegularExpressions;

namespace Volt.Cli.Sync;

public sealed record ScaffoldReport(List<string> Created, List<string> Skipped);

/// <summary>Workspace scaffold — turns a Volt-bound directory into a standard Cargo (Rust) project under `rust/`
/// plus a README and VS Code settings. Idempotent: existing files are kept unless force. C# port of
/// the original TypeScript implementation</summary>
public static class Scaffold
{
    private const string Fallback = "plc_workspace";

    private static string ToCrateName(string projectName)
    {
        var s = Regex.Replace(projectName.ToLowerInvariant(), "[^a-z0-9-]+", "-");
        s = Regex.Replace(s, "^-+|-+$", "");
        if (Regex.IsMatch(s, "^[0-9]")) s = "plc-" + s; // a Cargo lib name can't start with a digit
        return s.Length > 0 ? s : Fallback;
    }

    public static ScaffoldReport WriteWorkspaceScaffold(string root, string projectName, bool force = false)
    {
        var name = ToCrateName(projectName);
        var files = new (string Path, string Content)[]
        {
            (".vscode/settings.json", VscodeSettings()),
            ("README.md", Readme(projectName)),
            ("rust/Cargo.toml", CargoToml(name)),
            ("rust/src/lib.rs", LibRs(projectName)),
            ("rust/tests/smoke.rs", SmokeTest()),
        };
        var created = new List<string>();
        var skipped = new List<string>();
        foreach (var (path, content) in files)
        {
            var abs = System.IO.Path.Combine(root, path);
            if (!force && File.Exists(abs)) { skipped.Add(path); continue; }
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(abs)!);
            File.WriteAllText(abs, content);
            created.Add(path);
        }
        return new ScaffoldReport(created, skipped);
    }

    private static string CargoToml(string name) => string.Join("\n", new[]
    {
        "[package]", $"name = \"{name}\"", "version = \"0.1.0\"", "edition = \"2021\"", "",
        "# Add crates that help your project here, then `cargo build`.", "[dependencies]", "",
    });

    private static string LibRs(string projectName) => string.Join("\n", new[]
    {
        $"//! Rust for the \"{projectName}\" PLC project.", "//!",
        "//! The Volt language server transpiles this project's Structured Text into Rust modules here.",
        "//! Add your own code and pull in crates via `Cargo.toml`, then run `cargo test`.", "",
    });

    private static string SmokeTest() => string.Join("\n", new[]
    {
        "// Proves the Rust project is wired up. Run: `cargo test` (from the `rust/` folder).",
        "#[test]", "fn wired_up() {", "    assert_eq!(2 + 2, 4);", "}", "",
    });

    private static string VscodeSettings()
    {
        var associations = new Dictionary<string, string>
        {
            ["*.fb"] = "structured-text", ["*.prg"] = "structured-text", ["*.fun"] = "structured-text",
            ["*.itf"] = "structured-text", ["*.dut"] = "structured-text", ["*.gvl"] = "structured-text",
        };
        var settings = new Dictionary<string, object>
        {
            ["files.associations"] = associations,
            ["rust-analyzer.linkedProjects"] = new[] { "rust/Cargo.toml" },
            ["files.watcherExclude"] = new Dictionary<string, bool> { ["**/rust/target/**"] = true },
            ["search.exclude"] = new Dictionary<string, bool> { ["**/rust/target"] = true },
        };
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
        "FBD/LD graphical bodies ride in those files too, editable as VG text. `.cfc`/`.sfc` are read-only",
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
        "## Rust",
        "The Volt language server transpiles your Structured Text into Rust under **`rust/`** — a normal Cargo",
        "project. Install [rustup](https://rustup.rs) once, then from the `rust/` folder:", "",
        "```sh", "cargo test      # run the Rust tests", "cargo build     # compile", "```", "",
        "Add crates that help your project to `rust/Cargo.toml` under `[dependencies]`.", "",
        "## What lives where",
        "- `.git/`    a normal git repo — Volt keeps its binding + IDE baseline in `.git/volt/`",
        "- `.claude/` AI language reference for ST (committed)",
        "- `src/`     synced from the IDE (leave to Volt — don't put Rust here)",
        "- `rust/`    your Rust: the transpiled code, your crates, and `cargo test`", "",
    });
}
