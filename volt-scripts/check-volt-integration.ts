#!/usr/bin/env bun
/**
 * Sanity-check that Volt's opencode integration is wired correctly.
 *
 * Run from repo root:
 *   bun volt-scripts/check-volt-integration.ts
 *
 * Verifies:
 *   - Config layer (.opencode/opencode.json) exists, parses, and registers the LSP
 *   - Agent persona (.opencode/agent/volt.md) + volt custom tool (.opencode/tool/volt.ts) present
 *   - LSP + CLI binaries are built (dist/ output present)
 *   - volt-lsp-codesys binary actually starts (runs --version)
 *   - CODESYS reference corpus is present in the LSP package
 *
 * For end-to-end LOAD checks (LSP attaches, tool registers in opencode), run the
 * dedicated verifiers: verify-lsp.ts and verify-volt-tool.ts.
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

console.log("\nConfig files");
check(".opencode/opencode.json exists (Volt config merge-layer)", () =>
	existsSync(join(REPO_ROOT, ".opencode/opencode.json")) || "missing — Volt's LSP + permission config lives here"
);
check(".opencode/opencode.json parses + registers volt-lsp-codesys", () => {
	const cfg = JSON.parse(readFileSync(join(REPO_ROOT, ".opencode/opencode.json"), "utf-8"));
	return Boolean(cfg?.lsp?.["volt-lsp-codesys"]) || "no lsp.volt-lsp-codesys entry";
});
check(".opencode/agent/volt.md exists", () =>
	existsSync(join(REPO_ROOT, ".opencode/agent/volt.md")) || "agent persona missing"
);
check(".opencode/tool/volt.ts exists (volt CLI custom tool)", () =>
	existsSync(join(REPO_ROOT, ".opencode/tool/volt.ts")) || "missing — volt CLI not exposed as a tool"
);
// The st-reference skill is GENERATED into a consumer project by `volt init`
// (see packages/volt-lsp-codesys/src/init.ts) — it is not committed in this repo, so
// assert the installer that produces it is built rather than a committed file.
check("volt-lsp-codesys skill installer built (dist/init.js)", () =>
	existsSync(join(REPO_ROOT, "packages/volt-lsp-codesys/dist/init.js"))
		|| "not built — run: bun run --cwd packages/volt-lsp-codesys build"
);

console.log("\nBuilt binaries");
check("volt-lsp-codesys dist/bin.js", () => {
	const path = join(REPO_ROOT, "packages/volt-lsp-codesys/dist/bin.js");
	return existsSync(path) || "not built — run: bun run --cwd packages/volt-lsp-codesys build";
});
check("volt CLI dist/bin.js", () => {
	const path = join(REPO_ROOT, "packages/volt-git/dist/bin.js");
	return existsSync(path) || "not built — run: bun run --cwd packages/volt-git build";
});

console.log("\nUpstream-sync guards (a release-tag merge can silently regress these)");
// The desktop GUI's stable-vs-V2 layout is gated on import.meta.env.VITE_OPENCODE_CHANNEL, which packages/app's
// vite plugin DEFINES from the build channel. If an upstream merge drops that define (as opencode PR #28612 did),
// the GUI silently defaults to the unreleased V2 layout regardless of OPENCODE_CHANNEL=prod.
check("packages/app/vite.js still defines VITE_OPENCODE_CHANNEL", () => {
	const f = join(REPO_ROOT, "packages/app/vite.js");
	return (existsSync(f) && readFileSync(f, "utf-8").includes("VITE_OPENCODE_CHANNEL"))
		|| "channel define dropped — the GUI would revert to V2 (cf. opencode PR #28612)";
});
// The terminal TUI runs its server in a Bun Worker, and Bun snapshots a worker's env at PROCESS START — so
// the volt binary's runtime OPENCODE_CONFIG_DIR/PATH only reach it because tui.ts passes { env } explicitly
// (a seam). A merge that reverts it to `new Worker(file)` silently strips the LSP + `volt` tool + agent from
// the terminal TUI while every main-process check (debug lsp/agent) still passes — the exact blind spot that
// hid this once. This source guard is the only cheap catch: the dev verify-* scripts can't reproduce it
// (they use .opencode auto-discovery, not runtime OPENCODE_CONFIG_DIR). Upstreamed as anomalyco/opencode#34759.
check("tui.ts passes live env to the TUI worker (worker-env seam)", () => {
	const f = join(REPO_ROOT, "packages/opencode/src/cli/cmd/tui.ts");
	if (!existsSync(f)) return "packages/opencode/src/cli/cmd/tui.ts missing";
	return /new Worker\(\s*file\s*,\s*\{\s*env\b/.test(readFileSync(f, "utf-8"))
		|| "worker-env seam dropped — `new Worker(file, { env })` reverted to `new Worker(file)`; the terminal TUI would lose the LSP/tool/agent (OPENCODE_CONFIG_DIR/PATH never reach the worker)";
});
// The agent toolchain ships as one OPENCODE_CONFIG_DIR dir (packages/volt-git/volt-config/), handed to opencode
// by the desktop + the `volt` binary; @opencode-ai/plugin is vendored into it at dist time (no npm pin). Confirm
// the dir is present + structurally intact (bare-name LSP) so the unify layer ships.
check("volt-config dir is present (bare-name LSP + volt tool)", () => {
	const dir = join(REPO_ROOT, "packages/volt-git/volt-config");
	const cfg = join(dir, "opencode.json");
	if (!existsSync(cfg)) return "packages/volt-git/volt-config/opencode.json missing";
	if (!existsSync(join(dir, "tool", "volt.ts"))) return "volt-config/tool/volt.ts missing";
	const lsp = JSON.parse(readFileSync(cfg, "utf-8")).lsp?.["volt-lsp-codesys"];
	if (!lsp || lsp.command?.[0] !== "volt-lsp-codesys") return "volt-config LSP entry missing or not bare-name";
	return true;
});

// The dev `.opencode/` and shipped `volt-config/` share a few files verbatim (they only differ in the LSP
// command + the dev-only smoke plugin). Until they're generated from one template, guard that the shared
// ones don't drift — an edit to one must land in the other. Compare normalized for line-ending (autocrlf).
check("shared .opencode/ ↔ volt-config/ files are in sync (no drift)", () => {
	const shared = ["agent/volt.md", "themes/volt.json", "plugins/volt.tsx"];
	const norm = (p: string) => readFileSync(p, "utf-8").replace(/\r\n/g, "\n");
	for (const rel of shared) {
		const dev = join(REPO_ROOT, ".opencode", rel);
		const shipped = join(REPO_ROOT, "packages/volt-git/volt-config", rel);
		if (!existsSync(dev) || !existsSync(shipped)) return `${rel} missing in one location`;
		if (norm(dev) !== norm(shipped)) return `${rel} drifted — sync .opencode/ and volt-config/`;
	}
	return true;
});

console.log("\nRuntime smoke test");
check("volt-lsp-codesys --version exits 0", () => {
	const binJs = join(REPO_ROOT, "packages/volt-lsp-codesys/dist/bin.js");
	if (!existsSync(binJs)) return "dist not built";
	const r = spawnSync("node", [binJs, "--version"], { encoding: "utf-8", timeout: 10_000 });
	return r.status === 0 || `exit ${r.status}: ${(r.stderr || r.stdout).trim()}`;
});
check("volt CLI wrapper runs (volt-scripts/volt[.cmd])", () => {
	const wrapper = process.platform === "win32"
		? join(REPO_ROOT, "volt-scripts/volt.cmd")
		: join(REPO_ROOT, "volt-scripts/volt");
	if (!existsSync(wrapper)) return "wrapper missing";
	const r = spawnSync(wrapper, ["help"], {
		encoding: "utf-8",
		timeout: 15_000,
		shell: process.platform === "win32",
	});
	if (r.status !== 0) return `exit ${r.status}: ${(r.stderr || r.stdout).trim().slice(0, 200)}`;
	if (!r.stdout.includes("volt <command>")) return "unexpected output (HELP signature missing)";
	return true;
});

console.log("\nDocumentation corpus");
check("CODESYS reference corpus index", () =>
	existsSync(join(REPO_ROOT, "packages/volt-lsp-codesys/docs/codesys-reference/00-index.md"))
		|| "corpus missing in packages/volt-lsp-codesys/docs/"
);

console.log("\nVS Code extension");
check("volt-vscode extension entry compiled", () =>
	existsSync(join(REPO_ROOT, "packages/volt-vscode/dist/extension.js"))
		|| "not built — run: bun run --cwd packages/volt-vscode build"
);
check("volt-vscode CLI integration compiled", () =>
	existsSync(join(REPO_ROOT, "packages/volt-vscode/dist/cli.js"))
		|| "cli.ts not built — run the extension's build"
);

console.log("\n" + "-".repeat(40));
console.log(`${passed} passed, ${failed} failed.`);

if (failed > 0) {
	process.exit(1);
}

console.log("\nOne-time PATH setup (so bare `volt` works in shells / opencode bash / VS Code terminal):");
if (process.platform === "win32") {
	console.log("  PowerShell (this session only):");
	console.log(`    $env:Path = "${join(REPO_ROOT, "volt-scripts")};$env:Path"`);
	console.log("  PowerShell (permanent, current user):");
	console.log(`    [Environment]::SetEnvironmentVariable("Path", "${join(REPO_ROOT, "volt-scripts")};" + [Environment]::GetEnvironmentVariable("Path", "User"), "User")`);
} else {
	console.log("  Bash / zsh (this session only):");
	console.log(`    export PATH="${join(REPO_ROOT, "volt-scripts")}:$PATH"`);
	console.log(`  Bash / zsh (permanent — add to ~/.bashrc or ~/.zshrc):`);
	console.log(`    export PATH="${join(REPO_ROOT, "volt-scripts")}:$PATH"`);
}

console.log("\nVerify loading (automated): bun volt-scripts/verify-lsp.ts  &&  bun volt-scripts/verify-volt-tool.ts");
console.log("\nManual verification — opencode (this repo):");
console.log("  1. From repo root: bun volt-scripts/dev.ts   # opencode TUI with the volt LSP loaded");
console.log("  2. Open a .st file with a syntax error → expect red 'volt-lsp-codesys' diagnostics.");
console.log("     ('volt-lsp-codesys' in the 'enabled LSP servers' log means registered, NOT running — spawn is lazy.)");
console.log("  3. Press Tab to switch primary agents → 'volt' should be selectable.");
console.log("  4. Ask: 'run volt status' → agent calls the `volt` tool (or bash); output appears inline.");
console.log("     For mutating verbs (volt pull/push/init/merge) opencode prompts for approval per call.");
console.log("  5. Ask: 'load the st-reference skill' → agent should call skill({ name: 'st-reference' }).");
console.log("\nManual verification — VS Code (with `volt-vscode` extension loaded):");
console.log("  1. code --extensionDevelopmentPath=packages/volt-vscode <your-workspace>");
console.log("  2. Open a .st file → expect 'Volt: Status' + 'Volt: Push' status bar buttons (right).");
console.log("  3. Cmd/Ctrl+Shift+P → 'Volt: Build' → JSON appears in 'Volt' terminal, diagnostics in Problems panel.");
console.log("  4. Cmd/Ctrl+Shift+P → 'Volt: Push' → quick-pick (normal vs force); force opens modal warning.");
