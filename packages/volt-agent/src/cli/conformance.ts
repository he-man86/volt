#!/usr/bin/env node
/**
 * Bridge conformance suite — THE CONTRACT EVERY BRIDGE MUST PASS.
 *
 * Drives the full stack — `volt` CLI + bridge + live IDE — through
 * every realistic scenario the CLI is built to handle. By passing
 * this suite, a bridge implementation (Beckhoff today, CODESYS /
 * TIA Portal next) proves it correctly speaks every endpoint of the
 * HTTP wire protocol AND that its behavior matches the assumptions
 * the CLI / any other client makes.
 *
 * Self-contained: creates every test FB from scratch, cleans up at
 * end, so it always runs against an empty (or any) project without
 * depending on pre-existing content.
 *
 * Vendor-neutral: assertions reference only protocol behavior, never
 * vendor-specific defaults. Point this script at any bridge port +
 * any IDE with any project open; it works.
 *
 * Scenarios (16):
 *   Workspace lifecycle:
 *     S01 — `volt init` binds workspace to the IDE project (GET /health)
 *     S02 — `volt pull` populates the workspace                (POST /fetch)
 *     S03 — AI creates a top-level FB at root and exports        (POST /push: createPou)
 *     S04 — AI creates a top-level FB inside a new folder        (POST /push: createPou + auto-folder)
 *     S05 — AI updates an FB's declaration                       (POST /push: updatePou)
 *     S06 — AI updates an FB's implementation                    (POST /push: updatePou)
 *     S07 — AI adds a child method                               (POST /push: createChild)
 *     S08 — AI adds a child action                               (POST /push: createChild)
 *     S09 — AI deletes a child method                            (POST /push: deleteChild)
 *     S10 — AI deletes a top-level FB                            (POST /push: deletePou)
 *     S11 — AI renames a top-level FB                            (POST /push: deletePou + createPou + createChild)
 *     S12 — AI moves an FB between folders                       (POST /push: movePou)
 *
 *   Drift + status (GET /refs + atomic ifVersion):
 *     S13 — Engineer drift: `volt status` reports IDE drift
 *     S14 — Engineer drift: `volt push` refused, `volt pull` recovers
 *     S15 — `volt push --force` overrides drift
 *     S16 — Multi-POU export in one batch (atomic, all-or-nothing)
 *
 * Property scenarios intentionally OUT — separate known issue.
 *
 * Requires:
 *   - Bridge on 127.0.0.1:8555 (VOLT_BRIDGE_PORT)
 *   - IDE open with any PLC project (empty or populated)
 *
 * Exit code: 0 if every scenario passes, 1 otherwise.
 */
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BridgeClient } from "../bridge/client.js";
import type { AIGetResult } from "../bridge/types.js";

const BRIDGE_PORT = Number.parseInt(process.env.VOLT_BRIDGE_PORT ?? "8555", 10);
const TEST_PREFIX = "FB_E2E_";

const bridge = new BridgeClient({ port: BRIDGE_PORT });

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
// Compiled `volt` bin lives alongside this script at dist/cli/bin.js.
const CLI_PATH = resolve(THIS_DIR, "bin.js");

let pass = 0;
let fail = 0;
const failures: string[] = [];

function section(label: string): void {
	const line = "─".repeat(72);
	console.log(`\n${line}\n  ${label}\n${line}`);
}
function ok(msg: string): void {
	console.log(`  ✓ ${msg}`);
	pass += 1;
}
function bad(msg: string, err?: string): void {
	console.log(`  ✗ ${msg}`);
	if (err !== undefined && err.length > 0) console.log(`      ${err}`);
	failures.push(msg);
	fail += 1;
}
function assert(cond: boolean, msg: string, err?: string): void {
	if (cond) ok(msg);
	else bad(msg, err);
}

// ─── CLI helpers ──────────────────────────────────────────────────────

interface CliResult { stdout: string; stderr: string; code: number; }

function volt(workspace: string, ...args: string[]): CliResult {
	const r = spawnSync("node", [CLI_PATH, ...args, "--workspace", workspace, "--port", String(BRIDGE_PORT)], {
		encoding: "utf-8",
		env: { ...process.env, VOLT_BRIDGE_PORT: String(BRIDGE_PORT) },
	});
	return { stdout: r.stdout, stderr: r.stderr, code: r.status ?? -1 };
}

function writeFileEnsuringDir(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content, "utf-8");
}

/**
 * Assemble a function block's full workspace file using standard
 * IEC-61131 nested syntax. The single-file workspace layout expects
 * methods, actions, and properties INSIDE the FB's .st file — there
 * are no separate child files. Each scenario rewrites the FB file
 * with the cumulative state at that step.
 */
interface FbSpec {
	name: string;
	varInputs?: string;
	vars?: string;
	impl?: string;
	methods?: { name: string; ret?: string; body: string }[];
	actions?: { name: string; body: string }[];
}
function buildFb(fb: FbSpec): string {
	// LSP-compatible layout: outer POU block ends with END_FUNCTION_BLOCK,
	// then children (methods, actions, properties) are top-level siblings.
	const parts: string[] = [`FUNCTION_BLOCK ${fb.name}`];
	parts.push("VAR_INPUT");
	if (fb.varInputs !== undefined && fb.varInputs.length > 0) parts.push(fb.varInputs);
	parts.push("END_VAR");
	parts.push("VAR");
	if (fb.vars !== undefined && fb.vars.length > 0) parts.push(fb.vars);
	parts.push("END_VAR");
	if (fb.impl !== undefined && fb.impl.length > 0) {
		parts.push("");
		parts.push(fb.impl);
	}
	parts.push("");
	parts.push("END_FUNCTION_BLOCK");

	for (const m of fb.methods ?? []) {
		parts.push("");
		parts.push(`METHOD ${m.name}${m.ret !== undefined ? ` : ${m.ret}` : ""}`);
		parts.push("VAR_INPUT");
		parts.push("END_VAR");
		parts.push("VAR");
		parts.push("END_VAR");
		if (m.body.length > 0) parts.push(m.body);
		parts.push("END_METHOD");
	}
	for (const a of fb.actions ?? []) {
		parts.push("");
		parts.push(`ACTION ${a.name}`);
		if (a.body.length > 0) parts.push(a.body);
		parts.push("END_ACTION");
	}
	parts.push("");
	return parts.join("\n");
}

// ─── bridge helpers (engineer-drift simulation + verification) ─────────

async function bridgeFetch(): Promise<AIGetResult[]> {
	const r = await bridge.fetchChanges({ knownItems: {} });
	return r.changed;
}
async function bridgeHasPou(name: string): Promise<boolean> {
	return (await bridgeFetch()).some((i) => i.name === name);
}
async function bridgeReadPou(name: string): Promise<AIGetResult | undefined> {
	return (await bridgeFetch()).find((i) => i.name === name);
}
async function listTestPous(): Promise<string[]> {
	return (await bridgeFetch()).filter((i) => i.name.startsWith(TEST_PREFIX)).map((i) => i.name);
}

/** Recursively walk a directory and return every POU file's relative path
 *  (any of .st/.gvl/.dut/.itf/.fbd/.ld/.sfc/.cfc — single source of truth
 *  is pou-files.ts/POU_EXTENSIONS). */
async function listWorkspacePouFiles(workspaceRoot: string): Promise<string[]> {
	const { readdirSync, statSync } = await import("node:fs");
	const { resolve, relative, sep } = await import("node:path");
	const { isPouPath } = await import("../engine/pou-files.js");
	const rootAbs = resolve(workspaceRoot);
	const out: string[] = [];
	function walk(dir: string): void {
		for (const name of readdirSync(dir, { withFileTypes: false }) as string[]) {
			if (name === ".volt" || name === ".git") continue;
			const abs = join(dir, name);
			const st = statSync(abs);
			if (st.isDirectory()) walk(abs);
			else if (st.isFile() && isPouPath(name)) {
				out.push(relative(rootAbs, abs).split(sep).join("/"));
			}
		}
	}
	walk(rootAbs);
	return out;
}

async function cleanupAllTestPous(): Promise<void> {
	let safety = 10;
	while (safety-- > 0) {
		const test = await listTestPous();
		if (test.length === 0) return;
		const refs = await bridge.getRefs();
		for (const name of test) {
			const ifVersion = refs.items[name];
			if (ifVersion === undefined) continue;
			try {
				await bridge.pushBatch({ ops: [{ op: "deletePou", name, ifVersion }] });
			} catch (err) {
				console.log(`    (cleanup) deletePou ${name} failed: ${err instanceof Error ? err.message : err}`);
			}
		}
	}
}

// ─── scenarios ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
	console.log("volt bridge conformance suite (no property scenarios)\n");
	console.log("  Any bridge that passes this suite is interchangeable from a client's perspective.\n");
	console.log(`  bridge: http://127.0.0.1:${BRIDGE_PORT}`);
	console.log(`  CLI:    ${CLI_PATH}`);

	try {
		await bridge.getHealth();
	} catch (err) {
		console.error(`pre-flight: bridge unreachable: ${err instanceof Error ? err.message : err}`);
		process.exit(1);
	}
	if (!existsSync(CLI_PATH)) {
		console.error(`pre-flight: CLI not built. Run \`pnpm -C packages/volt-agent build\` first.`);
		process.exit(1);
	}

	const preexisting = await listTestPous();
	if (preexisting.length > 0) {
		console.log(`  (cleaning ${preexisting.length} leftover test POU(s) before starting)`);
		await cleanupAllTestPous();
	}

	const rootTmp = mkdtempSync(join(tmpdir(), "volt-e2e-"));
	const workspace = join(rootTmp, "workspace");
	mkdirSync(workspace, { recursive: true });

	try {
		await runAllScenarios(workspace);
	} finally {
		console.log("\n─── teardown ─────────────────────────────────────────────────────────");
		await cleanupAllTestPous();
		const remaining = await listTestPous();
		if (remaining.length === 0) console.log("  ✓ all test POUs cleaned up");
		else console.log(`  ✗ leftover POUs: ${remaining.join(", ")}`);
		try { rmSync(rootTmp, { recursive: true, force: true }); } catch { /* ignore */ }
	}

	console.log("");
	console.log(`${pass} PASS, ${fail} FAIL`);
	if (fail > 0) {
		console.log("\nFailed expectations:");
		for (const f of failures) console.log(`  - ${f}`);
	}
	process.exit(fail > 0 ? 1 : 0);
}

async function runAllScenarios(ws: string): Promise<void> {
	// ─── S01: init ───────────────────────────────────────────────────
	section("S01 — `volt init` binds workspace to the IDE project");
	{
		const r = volt(ws, "init");
		assert(r.code === 0, "volt init exit 0", r.stderr.trim());
		assert(existsSync(join(ws, ".volt", "config.json")), ".volt/config.json exists");
		assert(existsSync(join(ws, ".volt", "snapshot")), ".volt/snapshot/ exists");
		const cfg = JSON.parse(readFileSync(join(ws, ".volt", "config.json"), "utf-8"));
		assert(cfg.project?.plcProjectName !== undefined, "config has project.plcProjectName");
	}

	// ─── S02: first import populates the workspace ──────────────────
	section("S02 — `volt pull` populates the workspace");
	{
		// Capture what /refs says is on the bridge — vendor-neutral way
		// to know what the import should produce.
		const refsBefore = await bridge.getRefs();
		const expectedItemCount = Object.keys(refsBefore.items).length;

		const r = volt(ws, "pull");
		assert(r.code === 0, "volt pull exit 0", r.stderr.trim());

		// `.gitattributes` is always written (universal — pins every POU
		// extension to LF; see POU_EXTENSIONS).
		assert(existsSync(join(ws, ".gitattributes")), ".gitattributes was written");

		// Every item reported by /refs should have a corresponding POU
		// file SOMEWHERE in the workspace tree. We don't care about the
		// folder layout (vendor-specific) — just that the file exists.
		const wsFiles = await listWorkspacePouFiles(ws);
		assert(
			wsFiles.length >= expectedItemCount,
			`workspace has ≥${expectedItemCount} POU file(s) after import (one per bridge item)`,
			`bridge has ${expectedItemCount} item(s); workspace has ${wsFiles.length} file(s)`,
		);
	}

	// Cumulative FB_E2E_A state — each scenario rewrites the same file
	// with the new state. Single-file workspace layout means methods +
	// actions live INSIDE this file, not as separate files.
	const fbA: FbSpec = { name: `${TEST_PREFIX}A`, varInputs: "    x : INT;" };

	// ─── S03: create top-level FB at root ────────────────────────────
	section("S03 — AI creates top-level FB at root and exports");
	{
		writeFileEnsuringDir(join(ws, `${TEST_PREFIX}A.st`), buildFb(fbA));
		const r = volt(ws, "push");
		assert(r.code === 0, "volt push exit 0", r.stderr.trim());
		assert(await bridgeHasPou(`${TEST_PREFIX}A`), `bridge has ${TEST_PREFIX}A`);
		const fb = await bridgeReadPou(`${TEST_PREFIX}A`);
		assert(fb?.declaration?.includes("FUNCTION_BLOCK FB_E2E_A") === true, "declaration round-tripped");
	}

	// ─── S04: create FB in a new folder ──────────────────────────────
	section("S04 — AI creates a top-level FB inside a new folder (POUs/)");
	{
		writeFileEnsuringDir(
			join(ws, "POUs", `${TEST_PREFIX}B.st`),
			buildFb({ name: `${TEST_PREFIX}B` }),
		);
		const r = volt(ws, "push");
		assert(r.code === 0, "volt push exit 0", r.stderr.trim());
		const fb = await bridgeReadPou(`${TEST_PREFIX}B`);
		assert(fb !== undefined, `bridge has ${TEST_PREFIX}B`);
		assert(fb?.folder === "POUs", `${TEST_PREFIX}B is in POUs/, got ${fb?.folder ?? "<root>"}`);
	}

	// ─── S05: update FB declaration ──────────────────────────────────
	section("S05 — AI updates an FB's declaration");
	{
		fbA.varInputs = "    x : INT;\n    y : INT;";
		writeFileSync(join(ws, `${TEST_PREFIX}A.st`), buildFb(fbA), "utf-8");
		const r = volt(ws, "push");
		assert(r.code === 0, "volt push exit 0", r.stderr.trim());
		const fb = await bridgeReadPou(`${TEST_PREFIX}A`);
		assert(fb?.declaration?.includes("y : INT") === true, "new VAR_INPUT y landed on bridge");
	}

	// ─── S06: update FB implementation ───────────────────────────────
	section("S06 — AI updates an FB's implementation");
	{
		fbA.impl = "x := x + 1;";
		writeFileSync(join(ws, `${TEST_PREFIX}A.st`), buildFb(fbA), "utf-8");
		const r = volt(ws, "push");
		assert(r.code === 0, "volt push exit 0", r.stderr.trim());
		const fb = await bridgeReadPou(`${TEST_PREFIX}A`);
		assert(fb?.implementation?.includes("x := x + 1") === true, "implementation landed");
	}

	// ─── S07: add child method (inline, same file) ───────────────────
	section("S07 — AI adds a child method inline in the FB's file");
	{
		fbA.methods = [{ name: "DoThing", ret: "BOOL", body: "DoThing := TRUE;" }];
		writeFileSync(join(ws, `${TEST_PREFIX}A.st`), buildFb(fbA), "utf-8");
		const r = volt(ws, "push");
		assert(r.code === 0, "volt push exit 0", r.stderr.trim());
		const fb = await bridgeReadPou(`${TEST_PREFIX}A`);
		const m = fb?.children?.find((c) => c.name === "DoThing");
		assert(m !== undefined, "DoThing method exists on bridge");
		assert(m?.implementation?.includes("DoThing := TRUE") === true, "method body landed");
	}

	// ─── S08: add child action (inline) ──────────────────────────────
	section("S08 — AI adds a child action inline in the FB's file");
	{
		fbA.actions = [{ name: "Step", body: "" }];
		writeFileSync(join(ws, `${TEST_PREFIX}A.st`), buildFb(fbA), "utf-8");
		const r = volt(ws, "push");
		assert(r.code === 0, "volt push exit 0", r.stderr.trim());
		const fb = await bridgeReadPou(`${TEST_PREFIX}A`);
		const a = fb?.children?.find((c) => c.name === "Step");
		assert(a !== undefined, "Step action exists on bridge");
	}

	// ─── S09: delete child method (remove from inline) ───────────────
	section("S09 — AI deletes a child method by removing the inline block");
	{
		fbA.methods = [];
		writeFileSync(join(ws, `${TEST_PREFIX}A.st`), buildFb(fbA), "utf-8");
		const r = volt(ws, "push");
		assert(r.code === 0, "volt push exit 0", r.stderr.trim());
		const fb = await bridgeReadPou(`${TEST_PREFIX}A`);
		const m = fb?.children?.find((c) => c.name === "DoThing");
		assert(m === undefined, "DoThing is gone from bridge");
	}

	// ─── S10: delete top-level FB ────────────────────────────────────
	section("S10 — AI deletes a top-level FB");
	{
		rmSync(join(ws, "POUs", `${TEST_PREFIX}B.st`));
		const r = volt(ws, "push");
		assert(r.code === 0, "volt push exit 0", r.stderr.trim());
		assert(!(await bridgeHasPou(`${TEST_PREFIX}B`)), `${TEST_PREFIX}B is gone from bridge`);
	}

	// ─── S11: rename top-level FB (single file move) ─────────────────
	section("S11 — AI renames a top-level FB (FB_E2E_A → FB_E2E_RENAMED)");
	{
		const newName = `${TEST_PREFIX}RENAMED`;
		// Single-file layout: rename is just `mv X.st Y.st`. No children
		// dir to move because methods/actions live inside the file.
		// We also rewrite the file content so the inner FUNCTION_BLOCK
		// keyword matches the new name (which is how the bridge picks
		// up the rename — current diff doesn't rename-detect across path).
		fbA.name = newName;
		writeFileSync(join(ws, `${newName}.st`), buildFb(fbA), "utf-8");
		rmSync(join(ws, `${TEST_PREFIX}A.st`));
		const r = volt(ws, "push");
		assert(r.code === 0, "volt push exit 0", r.stderr.trim());
		assert(await bridgeHasPou(newName), `bridge has ${newName}`);
		assert(!(await bridgeHasPou(`${TEST_PREFIX}A`)), `${TEST_PREFIX}A is gone`);
	}

	// ─── S12: move FB between folders (single file move) ─────────────
	section("S12 — AI moves FB between folders (root → Drives/)");
	{
		const newName = `${TEST_PREFIX}RENAMED`;
		mkdirSync(join(ws, "Drives"), { recursive: true });
		writeFileSync(
			join(ws, "Drives", `${newName}.st`),
			readFileSync(join(ws, `${newName}.st`), "utf-8"),
		);
		rmSync(join(ws, `${newName}.st`));
		const r = volt(ws, "push");
		assert(r.code === 0, "volt push exit 0 (movePou)", r.stderr.trim());
		const fb = await bridgeReadPou(newName);
		assert(fb?.folder === "Drives", `bridge reports folder=Drives, got ${fb?.folder ?? "<root>"}`);
	}

	// ─── S13: engineer drift + volt status ────────────────────────────
	section("S13 — Engineer drift: `volt status` reports IDE drift");
	{
		const newName = `${TEST_PREFIX}RENAMED`;
		const refs = await bridge.getRefs();
		const ifV = refs.items[newName];
		assert(ifV !== undefined, `drift target ${newName} present`);
		if (ifV !== undefined) {
			await bridge.pushBatch({
				ops: [
					{
						op: "updatePou",
						name: newName,
						declaration: `FUNCTION_BLOCK ${newName}\n// engineer drifted\nVAR_INPUT\nEND_VAR\nVAR\nEND_VAR\n`,
						implementation: "",
						ifVersion: ifV,
					},
				],
			});
		}
		const r = volt(ws, "status");
		assert(r.code === 0, "volt status exit 0", r.stderr.trim());
		assert(r.stdout.includes("IDE has") && r.stdout.includes("run volt pull"), "status reports IDE drift");
		assert(r.stdout.includes(`[IDE] M ${newName}`), `status lists ${newName} as IDE-side modified`);
	}

	// ─── S14: export refused on drift; import recovers ───────────────
	section("S14 — Engineer drift: `volt push` refused; `volt pull` recovers");
	{
		// Make a local edit too, so we have something to lose if export
		// were to barrel through.
		const newName = `${TEST_PREFIX}RENAMED`;
		writeFileSync(
			join(ws, "Drives", `${newName}.st`),
			`FUNCTION_BLOCK ${newName}\n// AI's parallel edit\nVAR_INPUT\nEND_VAR\nVAR\nEND_VAR\n\nEND_FUNCTION_BLOCK\n`,
			"utf-8",
		);
		const refused = volt(ws, "push");
		assert(refused.code === 2, "volt push exits 2 on drift");
		assert(
			refused.stderr.includes("drift detected"),
			"stderr explains drift",
			refused.stderr.trim(),
		);

		// `volt pull` should refuse too because we have local edits.
		const importBlocked = volt(ws, "pull");
		assert(
			importBlocked.code !== 0,
			"volt pull refuses while workspace is dirty",
			importBlocked.stdout.trim() || importBlocked.stderr.trim(),
		);

		// Discard local edits with --force, then import succeeds.
		const importForced = volt(ws, "pull", "--force");
		assert(importForced.code === 0, "volt pull --force succeeds", importForced.stderr.trim());

		// Now status should be clean and IDE in sync.
		const st = volt(ws, "status");
		assert(st.code === 0, "post-recovery status exit 0");
		assert(st.stdout.includes("All in sync"), "post-recovery: status reports all in sync");
	}

	// ─── S15: export --force overrides drift ─────────────────────────
	section("S15 — `volt push --force` overrides drift");
	{
		const newName = `${TEST_PREFIX}RENAMED`;
		// Simulate engineer drift again
		const refs = await bridge.getRefs();
		const ifV = refs.items[newName];
		if (ifV !== undefined) {
			await bridge.pushBatch({
				ops: [
					{
						op: "updatePou",
						name: newName,
						declaration: `FUNCTION_BLOCK ${newName}\n// engineer drifted (round 2)\nVAR_INPUT\nEND_VAR\nVAR\nEND_VAR\n`,
						implementation: "",
						ifVersion: ifV,
					},
				],
			});
		}
		// AI insists with --force
		writeFileSync(
			join(ws, "Drives", `${newName}.st`),
			`FUNCTION_BLOCK ${newName}\n// AI wins via --force\nVAR_INPUT\nEND_VAR\nVAR\nEND_VAR\n\nEND_FUNCTION_BLOCK\n`,
			"utf-8",
		);
		const r = volt(ws, "push", "--force");
		assert(r.code === 0, "volt push --force exit 0", r.stderr.trim());
		const fb = await bridgeReadPou(newName);
		assert(
			fb?.declaration?.includes("AI wins via --force") === true,
			"bridge has the forced AI version",
		);
	}

	// ─── S16: multi-POU batch ────────────────────────────────────────
	section("S16 — Multi-POU export in one batch (atomic, all-or-nothing)");
	{
		// Re-sync; --force because S15's local edit may still be in the
		// workspace and we want a clean baseline.
		volt(ws, "pull", "--force");
		for (const n of ["MULTI1", "MULTI2", "MULTI3"]) {
			writeFileEnsuringDir(
				join(ws, `${TEST_PREFIX}${n}.st`),
				`FUNCTION_BLOCK ${TEST_PREFIX}${n}\nVAR_INPUT\nEND_VAR\nVAR\nEND_VAR\n\nEND_FUNCTION_BLOCK\n`,
			);
		}
		const r = volt(ws, "push");
		assert(r.code === 0, "volt push exit 0 for multi-create", r.stderr.trim());
		assert(await bridgeHasPou(`${TEST_PREFIX}MULTI1`), "MULTI1 exists");
		assert(await bridgeHasPou(`${TEST_PREFIX}MULTI2`), "MULTI2 exists");
		assert(await bridgeHasPou(`${TEST_PREFIX}MULTI3`), "MULTI3 exists");
	}
}

void main().catch((err) => {
	console.error("\nFATAL:", err instanceof Error ? err.message : err);
	process.exit(1);
});
