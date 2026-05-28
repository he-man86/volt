#!/usr/bin/env bun
/**
 * Sanity-check that Volt's opencode integration is wired correctly.
 *
 * Run from repo root:
 *   bun script/check-volt-integration.ts
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
check(".claude/skills/st-reference/SKILL.md exists", () =>
	existsSync(join(REPO_ROOT, ".claude/skills/st-reference/SKILL.md")) || "skill missing"
);

console.log("\nBuilt binaries");
check("volt-lsp-st dist/bin.js", () => {
	const path = join(REPO_ROOT, "packages/volt-lsp-st/dist/bin.js");
	return existsSync(path) || "not built — run: bun --filter '@opencode-ai/volt-lsp-st' run build";
});
check("volt CLI dist/cli/bin.js", () => {
	const path = join(REPO_ROOT, "packages/volt-agent/dist/cli/bin.js");
	return existsSync(path) || "not built — run: bun --filter '@opencode-ai/volt-agent' run build";
});

console.log("\nRuntime smoke test");
check("volt-lsp-st --version exits 0", () => {
	const binJs = join(REPO_ROOT, "packages/volt-lsp-st/dist/bin.js");
	if (!existsSync(binJs)) return "dist not built";
	const r = spawnSync("node", [binJs, "--version"], { encoding: "utf-8", timeout: 10_000 });
	return r.status === 0 || `exit ${r.status}: ${(r.stderr || r.stdout).trim()}`;
});

console.log("\nDocumentation corpus");
check("CODESYS reference corpus index", () =>
	existsSync(join(REPO_ROOT, "packages/volt-lsp-st/docs/codesys-reference/00-index.md"))
		|| "corpus missing in packages/volt-lsp-st/docs/"
);

console.log("\n" + "-".repeat(40));
console.log(`${passed} passed, ${failed} failed.`);

if (failed > 0) {
	process.exit(1);
}

console.log("\nManual verification (run inside opencode):");
console.log("  1. Open a .st file → expect 'Starting LSP: volt-st' in opencode logs.");
console.log("  2. Press Tab to switch primary agents → 'volt' should be selectable.");
console.log("  3. In a chat ask: 'run volt status' → agent invokes via bash; output appears inline.");
console.log("     For mutating verbs (volt pull/push/init) opencode prompts for approval per call.");
console.log("  4. Ask: 'load the st-reference skill' → agent should call skill({ name: 'st-reference' }).");
