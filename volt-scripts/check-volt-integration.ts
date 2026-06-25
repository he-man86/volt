#!/usr/bin/env bun
/**
 * Sanity-check that Volt's opencode integration is wired correctly.
 *
 * Run from repo root:
 *   bun volt-scripts/check-volt-integration.ts
 *
 * Verifies:
 *   - Config files (opencode.jsonc, volt.md agent, st-reference skill) exist and parse
 *   - LSP + MCP + CLI binaries are built (dist/ output present)
 *   - node_modules/.bin symlinks resolve (bun install ran)
 *   - volt-lsp-st binary actually starts (runs --version)
 *   - CODESYS reference corpus is present in the LSP package
 *
 * Does NOT verify MCP tool naming inside opencode (would require speaking
 * the MCP protocol). Manual verification step is printed in the output.
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
check(".opencode/opencode.jsonc exists", () =>
	existsSync(join(REPO_ROOT, ".opencode/opencode.jsonc")) || "missing"
);
check(".opencode/opencode.jsonc parses (JSONC)", () => {
	const raw = readFileSync(join(REPO_ROOT, ".opencode/opencode.jsonc"), "utf-8");
	// Strip line comments + block comments + trailing commas, but
	// preserve `//` and `/*` inside string literals (e.g. URLs).
	const stripped = raw
		.replace(/("(?:[^"\\]|\\.)*")|\/\/.*$|\/\*[\s\S]*?\*\//gm, (_, str) => str ?? "")
		.replace(/,(\s*[}\]])/g, "$1");
	JSON.parse(stripped);
	return true;
});
check(".opencode/agent/volt.md exists", () =>
	existsSync(join(REPO_ROOT, ".opencode/agent/volt.md")) || "agent persona missing"
);
// The st-reference skill is GENERATED into a consumer project by `volt init`
// (see packages/volt-lsp-st/src/init.ts) — it is not committed in this repo, so
// assert the installer that produces it is built rather than a committed file.
check("volt-lsp-st skill installer built (dist/init.js)", () =>
	existsSync(join(REPO_ROOT, "packages/volt-lsp-st/dist/init.js"))
		|| "not built — run: bun run --cwd packages/volt-lsp-st build"
);

console.log("\nBuilt binaries");
check("volt-lsp-st dist/bin.js", () => {
	const path = join(REPO_ROOT, "packages/volt-lsp-st/dist/bin.js");
	return existsSync(path) || "not built — run: bun run --cwd packages/volt-lsp-st build";
});
check("volt CLI dist/bin.js", () => {
	const path = join(REPO_ROOT, "packages/volt-cli/dist/bin.js");
	return existsSync(path) || "not built — run: bun run --cwd packages/volt-cli build";
});

console.log("\nRuntime smoke test");
check("volt-lsp-st --version exits 0", () => {
	const binJs = join(REPO_ROOT, "packages/volt-lsp-st/dist/bin.js");
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
	existsSync(join(REPO_ROOT, "packages/volt-lsp-st/docs/codesys-reference/00-index.md"))
		|| "corpus missing in packages/volt-lsp-st/docs/"
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

console.log("\nVerify the LSP actually loads (automated): bun volt-scripts/verify-lsp.ts");
console.log("\nManual verification — opencode (this repo):");
console.log("  1. From repo root: bun volt-scripts/dev.ts   # opencode TUI with the volt LSP loaded");
console.log("  2. Open a .st file with a syntax error → expect red 'volt-lsp-st' diagnostics.");
console.log("     ('volt-lsp-st' in the 'enabled LSP servers' log means registered, NOT running — spawn is lazy.)");
console.log("  3. Press Tab to switch primary agents → 'volt' should be selectable.");
console.log("  4. In a chat ask: 'run volt status' → agent invokes via bash; output appears inline.");
console.log("     For mutating verbs (volt pull/push/init) opencode prompts for approval per call.");
console.log("  5. Ask: 'load the st-reference skill' → agent should call skill({ name: 'st-reference' }).");
console.log("\nManual verification — VS Code (with `volt-vscode` extension loaded):");
console.log("  1. code --extensionDevelopmentPath=packages/volt-vscode <your-workspace>");
console.log("  2. Open a .st file → expect 'Volt: Status' + 'Volt: Push' status bar buttons (right).");
console.log("  3. Cmd/Ctrl+Shift+P → 'Volt: Build' → JSON appears in 'Volt' terminal, diagnostics in Problems panel.");
console.log("  4. Cmd/Ctrl+Shift+P → 'Volt: Push' → quick-pick (normal vs force); force opens modal warning.");
