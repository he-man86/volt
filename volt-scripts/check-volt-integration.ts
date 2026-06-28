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
