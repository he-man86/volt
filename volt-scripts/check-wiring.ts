#!/usr/bin/env bun
/**
 * Sanity-check that Volt's opencode integration is wired correctly.
 *
 * Run from repo root:
 *   bun volt-scripts/check-wiring.ts
 *
 * Verifies:
 *   - Config layer (opencode-config/opencode.json) exists, parses, and registers the LSP (bare-name)
 *   - Agent persona (opencode-config/agent/volt.md) + volt custom tool (opencode-config/tool/volt.ts) present
 *   - LSP + CLI binaries are built (dist/ output present)
 *   - volt-lsp-iec binary actually starts (runs --version)
 *   - CODESYS reference corpus is present in the LSP package
 *
 * For end-to-end LOAD checks (LSP attaches, tool registers in opencode), run the
 * dedicated verifier: verify-opencode.ts.
 */
import { resolve, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const REPO_ROOT = resolve(import.meta.dirname, "..");

let passed = 0;
let failed = 0;

function check(name: string, fn: () => boolean | string): void {
	let result: boolean | string;
	try {
		result = fn();
	} catch (err) {
		result = err instanceof Error ? err.message : String(err);
	}
	if (result === true) {
		console.log(`  ✓ ${name}`);
		passed++;
		return;
	}
	console.log(`  ✗ ${name}${typeof result === "string" ? ` — ${result}` : ""}`);
	failed++;
}

console.log("Volt opencode-integration check");
console.log("=".repeat(40));

// Volt is opencode-independent: the whole agent-facing layer ships as ONE dir (opencode-config/), handed to the
// user's installed opencode via OPENCODE_CONFIG_DIR. There is no per-repo .opencode/ anymore — opencode-config IS
// the config (dev runs `OPENCODE_CONFIG_DIR=$PWD/opencode-config opencode`).
console.log("\nAgent config layer (opencode-config/ → OPENCODE_CONFIG_DIR)");
check("opencode-config/opencode.json exists + registers volt-lsp-iec (bare-name)", () => {
	const cfg = join(REPO_ROOT, "opencode-config/opencode.json");
	if (!existsSync(cfg)) return "missing — Volt's LSP + permission config lives here";
	const lsp = JSON.parse(readFileSync(cfg, "utf-8")).lsp?.["volt-lsp-iec"];
	if (!lsp) return "no lsp.volt-lsp-iec entry";
	return lsp.command?.[0] === "volt-lsp-iec" || "LSP command is not the bare name (must resolve off PATH)";
});
check("opencode-config/agent/volt.md exists (agent persona)", () =>
	existsSync(join(REPO_ROOT, "opencode-config/agent/volt.md")) || "agent persona missing"
);
check("opencode-config/tool/volt.ts exists (volt CLI custom tool)", () =>
	existsSync(join(REPO_ROOT, "opencode-config/tool/volt.ts")) || "missing — volt CLI not exposed as a tool"
);
// The st-reference skill is GENERATED into a consumer project by `volt init`
// (see packages/volt-lsp-iec/src/init.ts) — it is not committed in this repo, so
// assert the installer that produces it is built rather than a committed file.
check("volt-lsp-iec skill installer built (dist/src/init.js)", () =>
	existsSync(join(REPO_ROOT, "packages/volt-lsp-iec/dist/src/init.js"))
		|| "not built — run: bun run --cwd packages/volt-lsp-iec build"
);

console.log("\nBuilt binaries");
// The `volt` PLC CLI is now the .NET binary (packages/volt-cli) — built + tested by the `volt-cli` CI job on
// Windows (dotnet), not here. This key-free Linux check covers the LSP + the agent-config layer only.
check("volt-lsp-iec dist/src/bin.js", () => {
	const path = join(REPO_ROOT, "packages/volt-lsp-iec/dist/src/bin.js");
	return existsSync(path) || "not built — run: bun run --cwd packages/volt-lsp-iec build";
});

console.log("\nRuntime smoke test");
check("volt-lsp-iec --version exits 0", () => {
	const binJs = join(REPO_ROOT, "packages/volt-lsp-iec/dist/src/bin.js");
	if (!existsSync(binJs)) return "dist not built";
	const r = spawnSync("node", [binJs, "--version"], { encoding: "utf-8", timeout: 10_000 });
	return r.status === 0 || `exit ${r.status}: ${(r.stderr || r.stdout).trim()}`;
});

console.log("\nDocumentation corpus");
check("CODESYS reference corpus index", () =>
	existsSync(join(REPO_ROOT, "packages/volt-lsp-iec/docs/codesys-reference/00-index.md"))
		|| "corpus missing in packages/volt-lsp-iec/docs/"
);

// Wire-protocol version parity is gone with the HTTP wire: the toolchain is one C# codebase over the named pipe,
// so there is no separate client/server to keep in lockstep — the pipe host and client compile against one Core.

console.log("\nProduct version parity");
// Volt ships ONE version. volt-desktop is the source of truth (it names the release tag + version.txt, which the
// connector's auto-updater compares); the .vsix the installer sideloads must carry the same number. They're
// separate package.json files because the extension also self-publishes to the Marketplace. release.ts and
// release.yml both refuse a mismatch — but those only run at release, by which point a half-bump is already on
// dev. This runs on every push/PR, so the drift fails in the PR that introduces it.
// NOTE: packages/console/* is deliberately excluded — its version tracks the vendored opencode, not Volt.
check("volt-desktop version == volt-vscode version", () => {
	const read = (p: string): string | undefined => {
		const f = join(REPO_ROOT, p, "package.json");
		if (!existsSync(f)) return undefined;
		return JSON.parse(readFileSync(f, "utf-8")).version;
	};
	const desktop = read("packages/volt-desktop");
	const ext = read("packages/volt-vscode");
	if (!desktop) return "packages/volt-desktop/package.json has no version";
	if (!ext) return "packages/volt-vscode/package.json has no version";
	return desktop === ext || `mismatch: volt-desktop=${desktop} volt-vscode=${ext} — Volt ships one version, bump BOTH`;
});

console.log("\nVS Code extension");
check("volt-vscode extension entry compiled", () =>
	existsSync(join(REPO_ROOT, "packages/volt-vscode/dist/extension.js"))
		|| "not built — run: bun run --cwd packages/volt-vscode build"
);
// The extension no longer bundles a CLI — the C# `volt` comes from the Volt install on PATH (a native per-platform
// exe is too heavy for a Marketplace .vsix). It still bundles the LSP server, which runs via the editor's node.
check("volt-vscode LSP server bundled", () =>
	existsSync(join(REPO_ROOT, "packages/volt-vscode/dist/lsp-server.js"))
		|| "not built — run: bun run --cwd packages/volt-vscode build"
);

// ── Source-extension parity (one list, many runtimes) ──────────────────────────────────────────────
// The writable-source extension set is, by necessity, declared in several runtimes that cannot share a
// module: C# (the bridge/CLI source of truth), TypeScript (LSP + control), and static JSON manifests read
// by external tools (opencode, VS Code). This guard reads every copy and asserts they agree, so a new
// source kind can never be added to one place and silently missed in another. The C# canonical table
// (ItemKind.SourceKindExtensions) is the reference; every other copy must match it (the workspaceContains
// glob is a superset — it also lists read-only kinds — so it is checked for containment, not equality).
console.log("\nSource-extension parity (one list, many runtimes)");

const bare = (e: string): string => e.replace(/^\./, "").toLowerCase();
const normExts = (exts: Iterable<string>): string[] => [...new Set([...exts].map(bare))].sort();
const readRepo = (rel: string): string => readFileSync(join(REPO_ROOT, rel), "utf-8");
const quotedStrings = (s: string): string[] => [...s.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

/** Extract a `[ "…", … ]` / `new Set([ "…" ])` string-array literal assigned to `name`. */
function literalArray(src: string, name: string): string[] {
	const m = new RegExp(`${name}[^=]*=\\s*(?:new Set\\()?\\[([^\\]]*)\\]`).exec(src);
	if (!m) throw new Error(`could not find the ${name} literal`);
	return quotedStrings(m[1]);
}

// Canonical: the C# ItemKind.SourceKindExtensions table — ("kind", "ext") pairs; take each ext (2nd string).
const itemKindSrc = readRepo("packages/volt-cli/src/Volt.Cli.Core/Workspace/ItemKind.cs");
const canonBlock = /SourceKindExtensions = new \(string, string\)\[\]\s*\{([\s\S]*?)\};/.exec(itemKindSrc);
if (!canonBlock) throw new Error("check-wiring: could not find ItemKind.SourceKindExtensions");
const CANON = normExts([...canonBlock[1].matchAll(/\(\s*"[^"]+"\s*,\s*"([^"]+)"\s*\)/g)].map((m) => m[1]));

const jsonAt = (rel: string, pick: (o: any) => unknown): string[] => {
	const v = pick(JSON.parse(readRepo(rel)));
	if (!Array.isArray(v)) throw new Error(`${rel}: expected an array of extensions`);
	return normExts(v as string[]);
};

// The `{a,b,c}` extension alternation inside the VS Code workspaceContains activation glob.
function workspaceContainsExts(pkg: any): string[] {
	const wc = (pkg.activationEvents as string[]).find((e) => e.startsWith("workspaceContains:"));
	const m = wc && /\{([^}]*)\}/.exec(wc);
	if (!m) throw new Error("no workspaceContains {…} glob in volt-vscode activationEvents");
	return normExts(m[1].split(","));
}

const copies: Array<{ name: string; get: () => string[]; superset?: boolean }> = [
	{ name: "lsp-iec src/source-extensions.ts", get: () => normExts(literalArray(readRepo("packages/volt-lsp-iec/src/source-extensions.ts"), "SOURCE_EXTENSIONS")) },
	{ name: "volt-control src/state/files.ts", get: () => normExts(literalArray(readRepo("packages/volt-control/src/state/files.ts"), "SOURCE_EXTENSIONS")) },
	{ name: "opencode-config/opencode.json", get: () => jsonAt("opencode-config/opencode.json", (o) => o.lsp?.["volt-lsp-iec"]?.extensions) },
	{ name: "volt-vscode language extensions", get: () => jsonAt("packages/volt-vscode/package.json", (o) => o.contributes?.languages?.find((l: any) => l.id === "structured-text")?.extensions) },
	{ name: "volt-vscode tmLanguage fileTypes", get: () => jsonAt("packages/volt-vscode/languages/structured-text/syntax.tmLanguage.json", (o) => o.fileTypes) },
	{ name: "volt-vscode icon fileExtensions", get: () => normExts(Object.keys(JSON.parse(readRepo("packages/volt-vscode/icons/volt-icons.json")).fileExtensions ?? {})) },
	{ name: "volt-vscode workspaceContains glob", get: () => workspaceContainsExts(JSON.parse(readRepo("packages/volt-vscode/package.json"))), superset: true },
];

for (const { name, get, superset } of copies) {
	check(`${name} matches canonical [${CANON.join(", ")}]`, () => {
		const got = get();
		if (superset) {
			const missing = CANON.filter((e) => !got.includes(e));
			return missing.length === 0 || `glob is missing source ext(s): ${missing.join(", ")}`;
		}
		const same = got.length === CANON.length && got.every((e, i) => e === CANON[i]);
		return same || `has [${got.join(", ")}]`;
	});
}

console.log("\n" + "-".repeat(40));
console.log(`${passed} passed, ${failed} failed.`);

if (failed > 0) {
	process.exit(1);
}

console.log("\nOne-time PATH setup (so bare `volt` works in shells / opencode bash / VS Code terminal):");
if (process.platform === "win32") {
	console.log("  PowerShell (this session only):");
	console.log(`    $env:Path = "${join(REPO_ROOT, "packages/volt-cli/dist/Cli")};$env:Path"`);
	console.log("  PowerShell (permanent, current user):");
	console.log(`    [Environment]::SetEnvironmentVariable("Path", "${join(REPO_ROOT, "packages/volt-cli/dist/Cli")};" + [Environment]::GetEnvironmentVariable("Path", "User"), "User")`);
} else {
	console.log("  Bash / zsh (this session only):");
	console.log(`    export PATH="${join(REPO_ROOT, "packages/volt-cli/dist/Cli")}:$PATH"`);
	console.log(`  Bash / zsh (permanent — add to ~/.bashrc or ~/.zshrc):`);
	console.log(`    export PATH="${join(REPO_ROOT, "packages/volt-cli/dist/Cli")}:$PATH"`);
}

console.log("\nVerify loading (automated): bun volt-scripts/verify-opencode.ts");
console.log("\nManual verification — opencode (this repo):");
console.log("  1. From repo root: bun dev   # OPENCODE_CONFIG_DIR=$PWD/opencode-config opencode (Volt-aware)");
console.log("  2. Open a .fb (or other kind) file with a syntax error → expect red 'volt-lsp-iec' diagnostics.");
console.log("     ('volt-lsp-iec' in the 'enabled LSP servers' log means registered, NOT running — spawn is lazy.)");
console.log("  3. Press Tab to switch primary agents → 'volt' should be selectable.");
console.log("  4. Ask: 'run volt status' → agent calls the `volt` tool (or bash); output appears inline.");
console.log("     For mutating verbs (volt pull/push/init/merge) opencode prompts for approval per call.");
console.log("  5. Ask: 'load the st-reference skill' → agent should call skill({ name: 'st-reference' }).");
console.log("\nManual verification — VS Code (with `volt-vscode` extension loaded):");
console.log("  1. code --extensionDevelopmentPath=packages/volt-vscode <your-workspace>");
console.log("  2. Open a .fb (or other kind) file → expect 'Volt: Status' + 'Volt: Push' status bar buttons (right).");
console.log("  3. Cmd/Ctrl+Shift+P → 'Volt: Build' → JSON appears in 'Volt' terminal, diagnostics in Problems panel.");
console.log("  4. Cmd/Ctrl+Shift+P → 'Volt: Push' → quick-pick (normal vs force); force opens modal warning.");
