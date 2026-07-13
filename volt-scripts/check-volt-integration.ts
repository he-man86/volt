#!/usr/bin/env bun
/**
 * Sanity-check that Volt's opencode integration is wired correctly.
 *
 * Run from repo root:
 *   bun volt-scripts/check-volt-integration.ts
 *
 * Verifies:
 *   - Config layer (volt-config/opencode.json) exists, parses, and registers the LSP (bare-name)
 *   - Agent persona (volt-config/agent/volt.md) + volt custom tool (volt-config/tool/volt.ts) present
 *   - LSP + CLI binaries are built (dist/ output present)
 *   - volt-lsp-iec binary actually starts (runs --version)
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

// Volt is opencode-independent: the whole agent-facing layer ships as ONE dir (volt-config/), handed to the
// user's installed opencode via OPENCODE_CONFIG_DIR. There is no per-repo .opencode/ anymore — volt-config IS
// the config (dev runs `OPENCODE_CONFIG_DIR=$PWD/volt-config opencode`).
console.log("\nAgent config layer (volt-config/ → OPENCODE_CONFIG_DIR)");
check("volt-config/opencode.json exists + registers volt-lsp-iec (bare-name)", () => {
	const cfg = join(REPO_ROOT, "volt-config/opencode.json");
	if (!existsSync(cfg)) return "missing — Volt's LSP + permission config lives here";
	const lsp = JSON.parse(readFileSync(cfg, "utf-8")).lsp?.["volt-lsp-iec"];
	if (!lsp) return "no lsp.volt-lsp-iec entry";
	return lsp.command?.[0] === "volt-lsp-iec" || "LSP command is not the bare name (must resolve off PATH)";
});
check("volt-config/agent/volt.md exists (agent persona)", () =>
	existsSync(join(REPO_ROOT, "volt-config/agent/volt.md")) || "agent persona missing"
);
check("volt-config/tool/volt.ts exists (volt CLI custom tool)", () =>
	existsSync(join(REPO_ROOT, "volt-config/tool/volt.ts")) || "missing — volt CLI not exposed as a tool"
);
// The st-reference skill is GENERATED into a consumer project by `volt init`
// (see packages/volt-lsp-iec/src/init.ts) — it is not committed in this repo, so
// assert the installer that produces it is built rather than a committed file.
check("volt-lsp-iec skill installer built (dist/src/init.js)", () =>
	existsSync(join(REPO_ROOT, "packages/volt-lsp-iec/dist/src/init.js"))
		|| "not built — run: bun run --cwd packages/volt-lsp-iec build"
);

console.log("\nBuilt binaries");
check("volt-lsp-iec dist/src/bin.js", () => {
	const path = join(REPO_ROOT, "packages/volt-lsp-iec/dist/src/bin.js");
	return existsSync(path) || "not built — run: bun run --cwd packages/volt-lsp-iec build";
});
check("volt CLI dist/bin.js", () => {
	const path = join(REPO_ROOT, "packages/volt-git/dist/bin.js");
	return existsSync(path) || "not built — run: bun run --cwd packages/volt-git build";
});

console.log("\nRuntime smoke test");
check("volt-lsp-iec --version exits 0", () => {
	const binJs = join(REPO_ROOT, "packages/volt-lsp-iec/dist/src/bin.js");
	if (!existsSync(binJs)) return "dist not built";
	const r = spawnSync("node", [binJs, "--version"], { encoding: "utf-8", timeout: 10_000 });
	return r.status === 0 || `exit ${r.status}: ${(r.stderr || r.stdout).trim()}`;
});
check("volt CLI wrapper runs (packages/volt-git/scripts/volt[.cmd])", () => {
	const wrapper = process.platform === "win32"
		? join(REPO_ROOT, "packages/volt-git/scripts/volt.cmd")
		: join(REPO_ROOT, "packages/volt-git/scripts/volt");
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
	existsSync(join(REPO_ROOT, "packages/volt-lsp-iec/docs/codesys-reference/00-index.md"))
		|| "corpus missing in packages/volt-lsp-iec/docs/"
);

console.log("\nWire-protocol version parity");
// The bridge (C#) and the client (TS) each carry a wire-version constant; they MUST be bumped together on an
// incompatible wire change. If they drift, a client would refuse a freshly-built bridge (or vice versa).
check("bridge WireProtocol.Version (C#) == client WIRE_VERSION (TS)", () => {
	const csPath = join(REPO_ROOT, "packages/volt-bridge/src/Volt.Bridge.Core/Wire/HealthResponse.cs");
	const tsPath = join(REPO_ROOT, "packages/volt-git/src/bridge/types.ts");
	if (!existsSync(csPath)) return "HealthResponse.cs missing";
	if (!existsSync(tsPath)) return "types.ts missing";
	const cs = readFileSync(csPath, "utf-8").match(/public const int Version\s*=\s*(\d+)/);
	const ts = readFileSync(tsPath, "utf-8").match(/WIRE_VERSION\s*=\s*(\d+)/);
	if (!cs) return "C# WireProtocol.Version constant not found";
	if (!ts) return "TS WIRE_VERSION constant not found";
	return cs[1] === ts[1] || `mismatch: C#=${cs[1]} TS=${ts[1]} — bump BOTH together on an incompatible wire change`;
});

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
	console.log(`    $env:Path = "${join(REPO_ROOT, "packages/volt-git/scripts")};$env:Path"`);
	console.log("  PowerShell (permanent, current user):");
	console.log(`    [Environment]::SetEnvironmentVariable("Path", "${join(REPO_ROOT, "packages/volt-git/scripts")};" + [Environment]::GetEnvironmentVariable("Path", "User"), "User")`);
} else {
	console.log("  Bash / zsh (this session only):");
	console.log(`    export PATH="${join(REPO_ROOT, "packages/volt-git/scripts")}:$PATH"`);
	console.log(`  Bash / zsh (permanent — add to ~/.bashrc or ~/.zshrc):`);
	console.log(`    export PATH="${join(REPO_ROOT, "packages/volt-git/scripts")}:$PATH"`);
}

console.log("\nVerify loading (automated): bun volt-scripts/verify-lsp.ts  &&  bun volt-scripts/verify-volt-tool.ts");
console.log("\nManual verification — opencode (this repo):");
console.log("  1. From repo root: bun dev   # OPENCODE_CONFIG_DIR=$PWD/volt-config opencode (Volt-aware)");
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
