/**
 * Workspace scaffold — turns a Volt-bound directory into a standard Cargo (Rust) project under `rust/`
 * (Cargo.toml, src/lib.rs, an example test) plus a README and VS Code settings, so the Rust the LSP
 * transpiles from Structured Text has a place to compile and the engineer can `cargo test` + add crates.
 * Deliberately simple for the user: one plain crate in `rust/`, no workspace — the PLC `src/` (the IDE
 * mirror) is left untouched because Cargo only ever looks under `rust/`. Idempotent: existing files are
 * kept unless `force`.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const FALLBACK = "plc_workspace";
function toCrateName(plcProjectName: string): string {
	let s = plcProjectName.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
	// A Cargo library name can't start with a digit (it becomes a Rust identifier); prefix if so.
	if (/^[0-9]/.test(s)) s = `plc-${s}`;
	return s.length > 0 ? s : FALLBACK;
}

export interface ScaffoldReport {
	created: string[];
	skipped: string[];
}

export function writeWorkspaceScaffold(root: string, plcProjectName: string, force = false): ScaffoldReport {
	const name = toCrateName(plcProjectName);
	const files: Array<{ path: string; content: string }> = [
		{ path: ".vscode/settings.json", content: vscodeSettings() },
		{ path: "README.md", content: readme(plcProjectName) },
		{ path: "rust/Cargo.toml", content: cargoToml(name) },
		{ path: "rust/src/lib.rs", content: libRs(plcProjectName) },
		{ path: "rust/tests/smoke.rs", content: smokeTest() },
	];
	const created: string[] = [];
	const skipped: string[] = [];
	for (const f of files) {
		const abs = join(root, f.path);
		if (!force && existsSync(abs)) {
			skipped.push(f.path);
			continue;
		}
		mkdirSync(dirname(abs), { recursive: true });
		writeFileSync(abs, f.content, "utf-8");
		created.push(f.path);
	}
	return { created, skipped };
}

function cargoToml(name: string): string {
	return [
		"[package]",
		`name = "${name}"`,
		'version = "0.1.0"',
		'edition = "2021"',
		"",
		"# Add crates that help your project here, then `cargo build`.",
		"[dependencies]",
		"",
	].join("\n");
}

function libRs(plcProjectName: string): string {
	return [
		`//! Rust for the "${plcProjectName}" PLC project.`,
		"//!",
		"//! The Volt language server transpiles this project's Structured Text into Rust modules here.",
		"//! Add your own code and pull in crates via `Cargo.toml`, then run `cargo test`.",
		"",
	].join("\n");
}

function smokeTest(): string {
	return [
		"// Proves the Rust project is wired up. Run: `cargo test` (from the `rust/` folder).",
		"#[test]",
		"fn wired_up() {",
		"    assert_eq!(2 + 2, 4);",
		"}",
		"",
	].join("\n");
}

function vscodeSettings(): string {
	return (
		JSON.stringify(
			{
				// Pin the PLC source extensions to Structured Text. `.prg` especially is a widely-claimed
				// extension (Visual FoxPro, Clipper/xBase, KUKA robot programs, …); without this an unrelated
				// installed extension can win the association and the Volt language features never engage.
				"files.associations": {
					"*.fb": "structured-text",
					"*.prg": "structured-text",
					"*.fun": "structured-text",
					"*.itf": "structured-text",
					"*.struct": "structured-text",
					"*.enum": "structured-text",
					"*.union": "structured-text",
					"*.alias": "structured-text",
					"*.gvl": "structured-text",
				},
				// Let rust-analyzer find the crate when the repo root is opened (it lives under rust/).
				"rust-analyzer.linkedProjects": ["rust/Cargo.toml"],
				"files.watcherExclude": { "**/rust/target/**": true },
				"search.exclude": { "**/rust/target": true },
			},
			null,
			2,
		) + "\n"
	);
}

function readme(plcProjectName: string): string {
	return [
		`# ${plcProjectName} (Volt workspace)`,
		"",
		"Bound to a running PLC IDE — Volt keeps its binding + IDE baseline in `.git/volt/` (managed for you).",
		"",
		"## Two axes",
		"- **`volt pull` / `volt push`** sync `src/` with the live IDE (the machine).",
		"- **`git commit` / `git push`** version the text + share with the team. Commit before pulling.",
		"",
		"`src/` mirrors the IDE — edit the kind-named source files locally; `volt push` writes them back.",
		"FBD/LD graphical bodies ride in those files too, editable as VG text. `.cfc`/`.sfc` are read-only",
		"views of graphical bodies (don't hand-edit).",
		"",
		"## File extensions — name every item by its KIND",
		"",
		"An item's extension IS its kind. A DUT is **not** one `.dut` file — it's split by kind. There is no",
		"`.dut` extension in Volt; using one means the item never syncs to the IDE.",
		"",
		"| Kind | Extension | | Kind | Extension |",
		"|---|---|---|---|---|",
		"| Program | `.prg` | | Struct | `.struct` |",
		"| Function | `.fun` | | Enum | `.enum` |",
		"| Function block | `.fb` | | Union | `.union` |",
		"| Interface | `.itf` | | Alias | `.alias` |",
		"| Global var list | `.gvl` | | | |",
		"",
		"## Rust",
		"The Volt language server transpiles your Structured Text into Rust under **`rust/`** — a normal Cargo",
		"project. Install [rustup](https://rustup.rs) once, then from the `rust/` folder:",
		"",
		"```sh",
		"cargo test      # run the Rust tests",
		"cargo build     # compile",
		"```",
		"",
		"Add crates that help your project to `rust/Cargo.toml` under `[dependencies]`.",
		"",
		"## What lives where",
		"- `.git/`    a normal git repo — Volt keeps its binding + IDE baseline in `.git/volt/`",
		"- `.claude/` AI language reference for ST (committed)",
		"- `src/`     synced from the IDE (leave to Volt — don't put Rust here)",
		"- `rust/`    your Rust: the transpiled code, your crates, and `cargo test`",
		"",
	].join("\n");
}
