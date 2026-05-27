#!/usr/bin/env node
/**
 * Negative-path conformance — the failure modes the CLI promises to
 * handle gracefully. Exercises:
 *
 *   1. Ordering mistakes (export before init, etc.) → friendly errors
 *   2. Bridge offline / unreachable                  → "bridge unreachable" hint, exit 1
 *   3. Workspace binding mismatch                    → refuse, suggest --force
 *   4. Reconcile case (drift + dirty workspace)      → nextAction=reconcile
 *   5. No-op (export with nothing changed)           → status reports it
 *
 * Each scenario uses a fresh temp workspace so failures in one don't
 * pollute the next. Test POUs (FB_NEG_*) are cleaned up at the end.
 *
 * Scenarios (9):
 *   N01 — plc push before any `plc init`
 *   N02 — plc push after init but before import
 *   N03 — plc pull before init
 *   N04 — plc status before init (graceful, exit 0)
 *   N05 — bridge unreachable (every verb fails with friendly message)
 *   N06 — plc init on workspace bound to a different project
 *         (refused without --force; succeeds with --force)
 *   N07 — drift + workspace dirty: status flags reconcile
 *   N08 — plc push with nothing changed: nothing_to_push
 *   N09 — `.gitignore` auto-write: new file on bare init, appended
 *         to existing file without clobbering user entries
 *
 * Requires bridge on 127.0.0.1:8555 with the IDE open.
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
import type { PushOp } from "../bridge/types.js";

const BRIDGE_PORT = Number.parseInt(process.env.PLCASSIST_BRIDGE_PORT ?? "8555", 10);
const TEST_PREFIX = "FB_NEG_";
const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(THIS_DIR, "bin.js");

// A port nothing should be listening on. Picked deliberately above the
// common dev range so we don't fight with whatever the user has running.
const UNREACHABLE_PORT = 51_823;

const bridge = new BridgeClient({ port: BRIDGE_PORT });

let pass = 0;
let fail = 0;
const failures: string[] = [];

function section(label: string): void {
	const line = "─".repeat(72);
	console.log(`\n${line}\n  ${label}\n${line}`);
}
function ok(msg: string): void { console.log(`  ✓ ${msg}`); pass += 1; }
function bad(msg: string, err?: string): void {
	console.log(`  ✗ ${msg}`);
	if (err !== undefined && err.length > 0) console.log(`      ${err}`);
	failures.push(msg);
	fail += 1;
}
function assert(cond: boolean, msg: string, err?: string): void {
	if (cond) ok(msg); else bad(msg, err);
}

// ─── Helpers ──────────────────────────────────────────────────────────

interface CliResult { stdout: string; stderr: string; code: number; }

function plc(workspace: string, ...args: string[]): CliResult {
	return plcAt(BRIDGE_PORT, workspace, ...args);
}

function plcAt(port: number, workspace: string, ...args: string[]): CliResult {
	const r = spawnSync(
		"node",
		[CLI_PATH, ...args, "--workspace", workspace, "--port", String(port)],
		{ encoding: "utf-8", env: { ...process.env, PLCASSIST_BRIDGE_PORT: String(port) } },
	);
	return { stdout: r.stdout, stderr: r.stderr, code: r.status ?? -1 };
}

function freshWorkspace(rootTmp: string, label: string): string {
	const ws = join(rootTmp, label);
	mkdirSync(ws, { recursive: true });
	return ws;
}


// ─── Engineer-simulation (direct bridge calls) ────────────────────────

async function engCreatePou(name: string, folder: string, decl: string): Promise<void> {
	const op: PushOp = {
		op: "createPou",
		name,
		folder,
		kind: "function_block",
		declaration: decl,
		ifVersion: null,
	};
	await bridge.pushBatch({ ops: [op] });
}

async function cleanupAllTestPous(): Promise<void> {
	let safety = 10;
	while (safety-- > 0) {
		const { changed } = await bridge.fetchChanges({ knownItems: {} });
		const test = changed.filter((c) => c.name.startsWith(TEST_PREFIX));
		if (test.length === 0) return;
		const refs = await bridge.getRefs();
		for (const item of test) {
			const ifVersion = refs.items[item.name];
			if (ifVersion === undefined) continue;
			try { await bridge.pushBatch({ ops: [{ op: "deletePou", name: item.name, ifVersion }] }); }
			catch { /* keep trying others */ }
		}
	}
}

// ─── Scenarios ────────────────────────────────────────────────────────

async function main(): Promise<void> {
	console.log("plc negative-path conformance suite\n");
	console.log("  Exercises the failure modes the CLI promises to handle gracefully.\n");
	console.log(`  bridge: http://127.0.0.1:${BRIDGE_PORT}`);
	console.log(`  CLI:    ${CLI_PATH}`);

	try { await bridge.getHealth(); }
	catch (err) {
		console.error(`pre-flight: bridge unreachable: ${err instanceof Error ? err.message : err}`);
		process.exit(1);
	}
	if (!existsSync(CLI_PATH)) {
		console.error("pre-flight: CLI not built. Run `npm run build` first.");
		process.exit(1);
	}

	const rootTmp = mkdtempSync(join(tmpdir(), "plc-neg-"));

	try {
		await runAllScenarios(rootTmp);
	} finally {
		console.log("\n─── teardown ─────────────────────────────────────────────────────────");
		await cleanupAllTestPous();
		console.log("  ✓ test POUs cleaned up");
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

async function runAllScenarios(rootTmp: string): Promise<void> {
	// ─── N01: export before init ─────────────────────────────────────
	section("N01 — plc push before any `plc init`: friendly error, exit 1");
	{
		const ws = freshWorkspace(rootTmp, "n01");
		const r = plc(ws, "push");
		assert(r.code === 1, "exit code 1 (not a crash, not 2)");
		assert(
			r.stderr.toLowerCase().includes("no plcassist workspace") ||
				r.stderr.includes("plc init"),
			"stderr explains the missing workspace and points at plc init",
			r.stderr.trim(),
		);
	}

	// ─── N02: export after init but before import ────────────────────
	section("N02 — plc push after init but before import: friendly error");
	{
		const ws = freshWorkspace(rootTmp, "n02");
		assert(plc(ws, "init").code === 0, "intermediate init succeeds");
		const r = plc(ws, "push");
		assert(r.code === 1, "exit code 1");
		assert(
			r.stderr.toLowerCase().includes("no snapshot") ||
				r.stderr.includes("plc pull"),
			"stderr tells the user to import first",
			r.stderr.trim(),
		);
	}

	// ─── N03: import before init ─────────────────────────────────────
	section("N03 — plc pull before init: friendly error");
	{
		const ws = freshWorkspace(rootTmp, "n03");
		const r = plc(ws, "pull");
		assert(r.code === 1, "exit code 1");
		assert(
			r.stderr.toLowerCase().includes("no plcassist workspace") ||
				r.stderr.includes("plc init"),
			"stderr explains the missing workspace",
			r.stderr.trim(),
		);
	}

	// ─── N04: status before init (graceful) ──────────────────────────
	section("N04 — plc status before init: graceful, exit 0");
	{
		const ws = freshWorkspace(rootTmp, "n04");
		const r = plc(ws, "status");
		assert(r.code === 0, "exit 0 (status never throws)");
		assert(
			r.stdout.toLowerCase().includes("not initialized") ||
				r.stdout.includes("plc init"),
			"stdout tells the user to init",
			r.stdout.trim(),
		);
	}

	// ─── N05: bridge unreachable ─────────────────────────────────────
	section("N05 — bridge unreachable: every verb fails with bridge-unreachable hint");
	{
		const ws = freshWorkspace(rootTmp, "n05");
		// Get the workspace past the local prerequisite checks (config +
		// snapshot exist) using the real bridge, so the subsequent calls
		// against UNREACHABLE_PORT actually exercise the network failure
		// path instead of failing earlier on "no snapshot".
		assert(plc(ws, "init").code === 0, "intermediate init via real bridge");
		assert(plc(ws, "pull").code === 0, "intermediate pull via real bridge");

		for (const verb of ["init", "pull", "push", "status", "compile"]) {
			const r = plcAt(UNREACHABLE_PORT, ws, verb);
			assert(r.code === 1, `${verb}: exit 1`);
			assert(
				r.stderr.toLowerCase().includes("bridge unreachable") ||
					r.stderr.toLowerCase().includes("econnrefused") ||
					r.stderr.toLowerCase().includes("connection"),
				`${verb}: stderr mentions unreachable / connection issue`,
				r.stderr.trim().split("\n")[0],
			);
		}
	}

	// ─── N06: init on mismatched binding ─────────────────────────────
	section("N06 — plc init on a workspace bound to a different project");
	{
		const ws = freshWorkspace(rootTmp, "n06");
		// Fake an existing binding to a different project.
		mkdirSync(join(ws, ".plcassist"), { recursive: true });
		writeFileSync(
			join(ws, ".plcassist", "config.json"),
			JSON.stringify({
				schemaVersion: 1,
				bridge: { port: BRIDGE_PORT },
				project: {
					platform: "fake-vendor",
					projectName: "FakeSolution",
					plcProjectName: "FakePlcProject",
				},
				linkedAt: "1970-01-01T00:00:00Z",
			}, null, 2),
			"utf-8",
		);

		const refused = plc(ws, "init");
		assert(refused.code === 1, "refused: exit 1");
		assert(
			refused.stderr.toLowerCase().includes("already bound"),
			"stderr explains the binding mismatch",
			refused.stderr.trim(),
		);
		assert(
			refused.stderr.includes("--force"),
			"stderr suggests --force as the escape hatch",
		);

		// With --force, the repoint succeeds.
		const forced = plc(ws, "init", "--force");
		assert(forced.code === 0, "init --force succeeds at repointing");
	}

	// ─── N07: reconcile case (drift + dirty workspace) ───────────────
	section("N07 — drift + workspace dirty: status flags reconcile case");
	{
		const ws = freshWorkspace(rootTmp, "n07");
		// Seed the bridge with a test FB so the workspace has something
		// to import (and later, something to dirty).
		await cleanupAllTestPous();
		await engCreatePou(
			`${TEST_PREFIX}TARGET`,
			"POUs",
			`FUNCTION_BLOCK ${TEST_PREFIX}TARGET\nVAR_INPUT\nEND_VAR\nVAR\nEND_VAR\n`,
		);

		assert(plc(ws, "init").code === 0, "init");
		assert(plc(ws, "pull").code === 0, "pull");

		// Engineer drifts (adds a new POU).
		await engCreatePou(
			`${TEST_PREFIX}DRIFTER`,
			"POUs",
			`FUNCTION_BLOCK ${TEST_PREFIX}DRIFTER\nVAR_INPUT\nEND_VAR\nVAR\nEND_VAR\n`,
		);
		// AI dirties the workspace (modifies the imported file).
		writeFileSync(
			join(ws, "POUs", `${TEST_PREFIX}TARGET.st`),
			`FUNCTION_BLOCK ${TEST_PREFIX}TARGET\n// AI edited\nVAR_INPUT\nEND_VAR\nVAR\nEND_VAR\n\nEND_FUNCTION_BLOCK\n`,
			"utf-8",
		);

		const r = plc(ws, "status");
		assert(r.code === 0, "status exit 0");
		assert(
			r.stdout.toLowerCase().includes("both sides changed") ||
				r.stdout.toLowerCase().includes("reconcile"),
			"stdout flags the reconcile situation",
			r.stdout.trim().split("\n")[0],
		);
		assert(
			r.stdout.includes(`[IDE] + ${TEST_PREFIX}DRIFTER`),
			"stdout lists engineer's addition under [IDE]",
		);
		assert(
			r.stdout.includes(`[WS]  M ${TEST_PREFIX}TARGET`),
			"stdout lists workspace modification under [WS] (outgoing)",
		);

		await cleanupAllTestPous();
	}

	// ─── N08: nothing to push ──────────────────────────────────────
	section("N08 — plc push with no changes: nothing_to_push, exit 0");
	{
		const ws = freshWorkspace(rootTmp, "n08");
		assert(plc(ws, "init").code === 0, "init");
		assert(plc(ws, "pull").code === 0, "pull");

		const r = plc(ws, "push");
		assert(r.code === 0, "exit 0");
		assert(
			r.stdout.toLowerCase().includes("nothing to push"),
			"stdout says nothing to push",
			r.stdout.trim(),
		);
	}

	// ─── N09: .gitignore auto-write ──────────────────────────────────
	section("N09 — .gitignore: created if absent, appended if present, preserves user entries");
	{
		// Case A: no .gitignore beforehand → plc init creates one with our entry.
		const wsA = freshWorkspace(rootTmp, "n09a");
		assert(plc(wsA, "init").code === 0, "case A: init");
		const gitignoreA = join(wsA, ".gitignore");
		assert(existsSync(gitignoreA), "case A: .gitignore created");
		const contentA = readFileSync(gitignoreA, "utf-8");
		assert(/\.plcassist/.test(contentA), "case A: .gitignore contains the .plcassist/ entry");

		// Case B: user has their own .gitignore → we append, don't clobber.
		const wsB = freshWorkspace(rootTmp, "n09b");
		const userIgnores = "node_modules/\n*.log\nmy-secret.txt\n";
		writeFileSync(join(wsB, ".gitignore"), userIgnores, "utf-8");
		assert(plc(wsB, "init").code === 0, "case B: init on workspace with existing .gitignore");
		const contentB = readFileSync(join(wsB, ".gitignore"), "utf-8");
		assert(contentB.includes("node_modules/"), "case B: user's existing entries preserved");
		assert(contentB.includes("my-secret.txt"), "case B: all user entries preserved");
		assert(/\/?\.plcassist\/?/m.test(contentB), "case B: our .plcassist/ entry was appended");

		// Case C: .gitignore already has our entry → no-op (idempotent).
		const sizeBeforeReInit = contentB.length;
		assert(plc(wsB, "init").code === 0, "case C: re-init");
		const contentC = readFileSync(join(wsB, ".gitignore"), "utf-8");
		assert(
			contentC.length === sizeBeforeReInit,
			"case C: re-init doesn't append a duplicate entry",
			`expected length ${sizeBeforeReInit}, got ${contentC.length}`,
		);

		// Case D: user deleted .gitignore after init → plc pull re-creates it.
		rmSync(gitignoreA);
		assert(!existsSync(gitignoreA), "case D: .gitignore deleted by user");
		assert(plc(wsA, "pull").code === 0, "case D: import");
		assert(existsSync(gitignoreA), "case D: .gitignore restored by plc pull");
	}
}

void main().catch((err) => {
	console.error("\nFATAL:", err instanceof Error ? err.message : err);
	process.exit(1);
});
