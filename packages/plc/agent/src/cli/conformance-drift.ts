#!/usr/bin/env node
/**
 * Engineer-drift conformance — the workflows a real PLC engineer
 * triggers between AI sessions, and how `plc pull` handles them.
 *
 * Where `conformance.ts` exercises AI/CLI-side actions (the AI edits
 * files and runs export), THIS suite exercises ENGINEER-side actions
 * (the engineer touched things in the IDE between two AI sessions).
 * Engineer actions are simulated by talking to the bridge directly —
 * the exact path TwinCAT XAE's UI follows under the hood.
 *
 * Workflow per scenario:
 *   1. Setup: clean baseline (init + import on an empty workspace +
 *      a known seed of test FBs).
 *   2. Engineer mutation: direct /push to the bridge.
 *   3. AI action: `plc pull` (workspace is clean, should always succeed).
 *   4. Assert: workspace files reflect the new IDE state.
 *
 * Scenarios (12):
 *   D01 — Engineer creates a new POU              → import writes the file
 *   D02 — Engineer deletes a POU                  → import removes the file
 *   D03 — Engineer renames a POU                  → import deletes old, writes new
 *   D04 — Engineer moves a POU between folders    → import shifts path
 *   D05 — Engineer edits a POU declaration        → import updates content
 *   D06 — Engineer edits a POU implementation     → import updates content
 *   D07 — Engineer adds a child method            → import writes child file
 *   D08 — Engineer deletes a child method         → import removes child file
 *   D09 — Engineer edits a child method body      → import updates child file
 *   D10 — Engineer makes multiple changes at once → all reflected on import
 *   D11 — Engineer deletes every test POU         → workspace cleaned
 *   D12 — Full round-trip: AI export → engineer edit → AI import → AI export
 *
 * Requires: bridge on 127.0.0.1:8555, IDE open with any project.
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
import type { PushOp } from "../bridge/types.js";

const BRIDGE_PORT = Number.parseInt(process.env.PLCASSIST_BRIDGE_PORT ?? "8555", 10);
const TEST_PREFIX = "FB_DRIFT_";
const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(THIS_DIR, "bin.js");

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

// ─── CLI / workspace helpers ──────────────────────────────────────────

interface CliResult { stdout: string; stderr: string; code: number; }

function plc(workspace: string, ...args: string[]): CliResult {
	const r = spawnSync(
		"node",
		[CLI_PATH, ...args, "--workspace", workspace, "--port", String(BRIDGE_PORT)],
		{ encoding: "utf-8", env: { ...process.env, PLCASSIST_BRIDGE_PORT: String(BRIDGE_PORT) } },
	);
	return { stdout: r.stdout, stderr: r.stderr, code: r.status ?? -1 };
}

function workspaceFileExists(ws: string, relPath: string): boolean {
	return existsSync(join(ws, relPath));
}

function workspaceFileContains(ws: string, relPath: string, needle: string): boolean {
	const abs = join(ws, relPath);
	if (!existsSync(abs)) return false;
	return readFileSync(abs, "utf-8").includes(needle);
}

// ─── Engineer-simulation helpers (direct /push to the bridge) ─────────
// Each one represents an action a TwinCAT XAE user would perform in
// the IDE — they go through the same /push endpoint the IDE-side COM
// glue ultimately calls. This is the closest we can get to "what really
// happens between AI sessions" without driving the GUI.

async function engCreatePou(name: string, folder: string, decl: string, impl?: string): Promise<void> {
	const op: PushOp = {
		op: "createPou",
		name,
		folder,
		kind: "function_block",
		declaration: decl,
		...(impl !== undefined && { implementation: impl }),
		ifVersion: null,
	};
	await bridge.pushBatch({ ops: [op] });
}

async function engDeletePou(name: string): Promise<void> {
	const refs = await bridge.getRefs();
	const ifVersion = refs.items[name];
	if (ifVersion === undefined) throw new Error(`engDeletePou: ${name} not on bridge`);
	await bridge.pushBatch({ ops: [{ op: "deletePou", name, ifVersion }] });
}

async function engRenamePou(name: string, newName: string): Promise<void> {
	const refs = await bridge.getRefs();
	const ifVersion = refs.items[name];
	if (ifVersion === undefined) throw new Error(`engRenamePou: ${name} not on bridge`);
	await bridge.pushBatch({ ops: [{ op: "renamePou", name, newName, ifVersion }] });
}

async function engMovePou(name: string, newFolder: string): Promise<void> {
	const refs = await bridge.getRefs();
	const ifVersion = refs.items[name];
	if (ifVersion === undefined) throw new Error(`engMovePou: ${name} not on bridge`);
	await bridge.pushBatch({ ops: [{ op: "movePou", name, newFolder, ifVersion }] });
}

/**
 * Update a POU exactly the way TwinCAT XAE would: both declaration AND
 * implementation are always sent together (they're paired COM
 * properties — saving one writes the other). Caller passes whichever
 * field changed; we fetch the other to keep it intact.
 */
async function engUpdatePou(name: string, fields: { declaration?: string; implementation?: string }): Promise<void> {
	const refs = await bridge.getRefs();
	const ifVersion = refs.items[name];
	if (ifVersion === undefined) throw new Error(`engUpdatePou: ${name} not on bridge`);
	const { changed } = await bridge.fetchChanges({ knownItems: {} });
	const current = changed.find((c) => c.name === name);
	if (current === undefined) throw new Error(`engUpdatePou: ${name} missing from /fetch`);
	await bridge.pushBatch({
		ops: [{
			op: "updatePou",
			name,
			declaration: fields.declaration ?? current.declaration ?? "",
			implementation: fields.implementation ?? current.implementation ?? "",
			ifVersion,
		}],
	});
}

async function engCreateChild(parent: string, name: string, decl: string, impl?: string): Promise<void> {
	await bridge.pushBatch({
		ops: [{
			op: "createChild",
			parent,
			name,
			kind: "method",
			declaration: decl,
			...(impl !== undefined && { implementation: impl }),
			ifVersion: null,
		}],
	});
}

async function engDeleteChild(parent: string, name: string): Promise<void> {
	const refs = await bridge.getRefs();
	const ifVersion = refs.items[parent];
	if (ifVersion === undefined) throw new Error(`engDeleteChild: ${parent} not on bridge`);
	await bridge.pushBatch({ ops: [{ op: "deleteChild", parent, name, ifVersion }] });
}

/** Update a child — same "always send both" contract as engUpdatePou. */
async function engUpdateChild(
	parent: string,
	name: string,
	fields: { declaration?: string; implementation?: string },
): Promise<void> {
	const refs = await bridge.getRefs();
	const ifVersion = refs.items[parent];
	if (ifVersion === undefined) throw new Error(`engUpdateChild: ${parent} not on bridge`);
	const { changed } = await bridge.fetchChanges({ knownItems: {} });
	const currentParent = changed.find((c) => c.name === parent);
	const currentChild = currentParent?.children?.find((c) => c.name === name);
	if (currentChild === undefined) throw new Error(`engUpdateChild: ${parent}.${name} missing from /fetch`);
	await bridge.pushBatch({
		ops: [{
			op: "updateChild",
			parent,
			name,
			declaration: fields.declaration ?? currentChild.declaration ?? "",
			implementation: fields.implementation ?? currentChild.implementation ?? "",
			ifVersion,
		}],
	});
}

// ─── Bridge cleanup ───────────────────────────────────────────────────

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

// ─── Seed used by every scenario ──────────────────────────────────────
// Each scenario starts from this baseline so assertions can name
// specific files without setup noise.

const SEED_FB_DECL = `FUNCTION_BLOCK ${TEST_PREFIX}TARGET\nVAR_INPUT\n    x : INT;\nEND_VAR\nVAR\nEND_VAR\n`;
const SEED_FB_IMPL = "x := x + 1;\n";
const SEED_FB_FOLDER = "POUs";

async function seedBaseline(workspace: string): Promise<void> {
	await cleanupAllTestPous();
	await engCreatePou(`${TEST_PREFIX}TARGET`, SEED_FB_FOLDER, SEED_FB_DECL, SEED_FB_IMPL);

	// Reset the workspace (delete + re-init + import) so we begin from
	// a known clean state.
	rmSync(workspace, { recursive: true, force: true });
	mkdirSync(workspace, { recursive: true });
	const initR = plc(workspace, "init");
	if (initR.code !== 0) throw new Error(`seed init failed: ${initR.stderr}`);
	const importR = plc(workspace, "pull");
	if (importR.code !== 0) throw new Error(`seed import failed: ${importR.stderr}`);
}

const SEED_PATH = `${SEED_FB_FOLDER}/${TEST_PREFIX}TARGET.st`;

// ─── Scenarios ────────────────────────────────────────────────────────

async function main(): Promise<void> {
	console.log("plc engineer-drift conformance suite\n");
	console.log("  Exercises real-world engineer actions between AI sessions.\n");
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

	const rootTmp = mkdtempSync(join(tmpdir(), "plc-drift-"));
	const workspace = join(rootTmp, "workspace");

	try {
		await runAllScenarios(workspace);
	} finally {
		console.log("\n─── teardown ─────────────────────────────────────────────────────────");
		await cleanupAllTestPous();
		const { changed } = await bridge.fetchChanges({ knownItems: {} });
		const remaining = changed.filter((c) => c.name.startsWith(TEST_PREFIX));
		if (remaining.length === 0) console.log("  ✓ all test POUs cleaned up");
		else console.log(`  ✗ leftover POUs: ${remaining.map((c) => c.name).join(", ")}`);
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
	// ─── D01: engineer creates a new POU ─────────────────────────────
	section("D01 — Engineer creates a new POU; import writes the file");
	{
		await seedBaseline(ws);
		const newName = `${TEST_PREFIX}NEW`;
		await engCreatePou(
			newName,
			"POUs",
			`FUNCTION_BLOCK ${newName}\nVAR_INPUT\nEND_VAR\nVAR\nEND_VAR\n`,
		);
		const r = plc(ws, "pull");
		assert(r.code === 0, "plc pull exit 0", r.stderr.trim());
		assert(workspaceFileExists(ws, `POUs/${newName}.st`), `POUs/${newName}.st landed`);
		assert(
			workspaceFileContains(ws, `POUs/${newName}.st`, `FUNCTION_BLOCK ${newName}`),
			"workspace file has the engineer's content",
		);
	}

	// ─── D02: engineer deletes a POU ─────────────────────────────────
	section("D02 — Engineer deletes a POU; import removes the file");
	{
		await seedBaseline(ws);
		const victim = `${TEST_PREFIX}VICTIM`;
		await engCreatePou(victim, "POUs", `FUNCTION_BLOCK ${victim}\nVAR_INPUT\nEND_VAR\nVAR\nEND_VAR\n`);
		// First import: workspace has the victim.
		assert(plc(ws, "pull").code === 0, "intermediate import succeeds");
		assert(workspaceFileExists(ws, `POUs/${victim}.st`), "victim present pre-delete");

		// Engineer deletes it; AI imports again.
		await engDeletePou(victim);
		const r = plc(ws, "pull");
		assert(r.code === 0, "plc pull exit 0", r.stderr.trim());
		assert(!workspaceFileExists(ws, `POUs/${victim}.st`), "victim removed from workspace");
	}

	// ─── D03: engineer renames a POU ─────────────────────────────────
	section("D03 — Engineer renames a POU; import deletes old, writes new");
	{
		await seedBaseline(ws);
		const newName = `${TEST_PREFIX}RENAMED`;
		await engRenamePou(`${TEST_PREFIX}TARGET`, newName);
		const r = plc(ws, "pull");
		assert(r.code === 0, "plc pull exit 0", r.stderr.trim());
		assert(!workspaceFileExists(ws, SEED_PATH), "old name file is gone");
		assert(workspaceFileExists(ws, `POUs/${newName}.st`), "new name file exists");
	}

	// ─── D04: engineer moves a POU between folders ───────────────────
	section("D04 — Engineer moves a POU between folders; import shifts path");
	{
		await seedBaseline(ws);
		await engMovePou(`${TEST_PREFIX}TARGET`, "Drives");
		const r = plc(ws, "pull");
		assert(r.code === 0, "plc pull exit 0", r.stderr.trim());
		assert(!workspaceFileExists(ws, SEED_PATH), "POUs/...TARGET.st gone");
		assert(
			workspaceFileExists(ws, `Drives/${TEST_PREFIX}TARGET.st`),
			"Drives/...TARGET.st now present",
		);
	}

	// ─── D05: engineer edits a POU declaration ───────────────────────
	section("D05 — Engineer edits a POU declaration; import updates content");
	{
		await seedBaseline(ws);
		const newDecl = `FUNCTION_BLOCK ${TEST_PREFIX}TARGET\nVAR_INPUT\n    x : INT;\n    y : REAL;\nEND_VAR\nVAR\nEND_VAR\n`;
		await engUpdatePou(`${TEST_PREFIX}TARGET`, { declaration: newDecl });
		const r = plc(ws, "pull");
		assert(r.code === 0, "plc pull exit 0", r.stderr.trim());
		assert(workspaceFileContains(ws, SEED_PATH, "y : REAL"), "new VAR_INPUT landed in workspace");
	}

	// ─── D06: engineer edits a POU implementation ────────────────────
	section("D06 — Engineer edits a POU implementation; import updates content");
	{
		await seedBaseline(ws);
		await engUpdatePou(`${TEST_PREFIX}TARGET`, { implementation: "x := x * 2;\n// engineer edited\n" });
		const r = plc(ws, "pull");
		assert(r.code === 0, "plc pull exit 0", r.stderr.trim());
		assert(
			workspaceFileContains(ws, SEED_PATH, "// engineer edited"),
			"engineer's impl edit landed",
		);
	}

	// ─── D07: engineer adds a child method (inline in parent file) ───
	section("D07 — Engineer adds a child method; import inlines it in the FB file");
	{
		await seedBaseline(ws);
		await engCreateChild(
			`${TEST_PREFIX}TARGET`,
			"Run",
			"METHOD PUBLIC Run : BOOL\nVAR_INPUT\nEND_VAR\nVAR\nEND_VAR\n",
			"Run := TRUE;\n",
		);
		const r = plc(ws, "pull");
		assert(r.code === 0, "plc pull exit 0", r.stderr.trim());
		// Single-file layout: the method lives in the FB's own file as
		// a top-level sibling declaration, NOT in a separate child file.
		assert(
			workspaceFileContains(ws, SEED_PATH, "METHOD"),
			"FB file contains the METHOD block",
		);
		assert(
			workspaceFileContains(ws, SEED_PATH, "Run"),
			"FB file references the new method by name",
		);
		assert(
			workspaceFileContains(ws, SEED_PATH, "Run := TRUE"),
			"FB file has engineer's method body",
		);
	}

	// ─── D08: engineer deletes a child method ────────────────────────
	section("D08 — Engineer deletes a child method; FB file loses the inline block");
	{
		await seedBaseline(ws);
		await engCreateChild(
			`${TEST_PREFIX}TARGET`,
			"Reset",
			"METHOD PUBLIC Reset : BOOL\nVAR_INPUT\nEND_VAR\nVAR\nEND_VAR\n",
			"Reset := TRUE;\n",
		);
		assert(plc(ws, "pull").code === 0, "intermediate import succeeds");
		assert(workspaceFileContains(ws, SEED_PATH, "Reset := TRUE"), "child present pre-delete");

		await engDeleteChild(`${TEST_PREFIX}TARGET`, "Reset");
		const r = plc(ws, "pull");
		assert(r.code === 0, "plc pull exit 0", r.stderr.trim());
		assert(
			!workspaceFileContains(ws, SEED_PATH, "Reset := TRUE"),
			"child body gone from FB file",
		);
	}

	// ─── D09: engineer edits a child method body ─────────────────────
	section("D09 — Engineer edits a child method body; FB file reflects the update");
	{
		await seedBaseline(ws);
		await engCreateChild(
			`${TEST_PREFIX}TARGET`,
			"Step",
			"METHOD PUBLIC Step : BOOL\nVAR_INPUT\nEND_VAR\nVAR\nEND_VAR\n",
			"Step := FALSE;\n",
		);
		assert(plc(ws, "pull").code === 0, "intermediate import succeeds");
		assert(
			workspaceFileContains(ws, SEED_PATH, "Step := FALSE"),
			"original child body present",
		);

		await engUpdateChild(
			`${TEST_PREFIX}TARGET`,
			"Step",
			{ implementation: "Step := TRUE;\n// engineer changed mind\n" },
		);
		const r = plc(ws, "pull");
		assert(r.code === 0, "plc pull exit 0", r.stderr.trim());
		assert(
			workspaceFileContains(ws, SEED_PATH, "engineer changed mind"),
			"engineer's child edit landed in FB file",
		);
	}

	// ─── D10: engineer makes multiple changes at once ────────────────
	section("D10 — Engineer makes multiple changes; import reflects all of them");
	{
		await seedBaseline(ws);
		// Engineer adds two FBs and edits the existing target — three
		// separate /push calls (not one atomic batch — this mirrors a
		// real session where the engineer clicks save several times).
		const newA = `${TEST_PREFIX}MULTI_A`;
		const newB = `${TEST_PREFIX}MULTI_B`;
		await engCreatePou(newA, "POUs", `FUNCTION_BLOCK ${newA}\nVAR_INPUT\nEND_VAR\nVAR\nEND_VAR\n`);
		await engCreatePou(newB, "Drives", `FUNCTION_BLOCK ${newB}\nVAR_INPUT\nEND_VAR\nVAR\nEND_VAR\n`);
		await engUpdatePou(`${TEST_PREFIX}TARGET`, { implementation: "// touched in D10\n" });

		const r = plc(ws, "pull");
		assert(r.code === 0, "plc pull exit 0", r.stderr.trim());
		assert(workspaceFileExists(ws, `POUs/${newA}.st`), `${newA} landed`);
		assert(workspaceFileExists(ws, `Drives/${newB}.st`), `${newB} landed in Drives/`);
		assert(workspaceFileContains(ws, SEED_PATH, "// touched in D10"), "TARGET edit landed");
	}

	// ─── D11: engineer deletes every test POU ────────────────────────
	section("D11 — Engineer deletes every test POU; workspace cleaned");
	{
		await seedBaseline(ws);
		// Add a couple extras, import, then engineer wipes them all.
		await engCreatePou(`${TEST_PREFIX}X1`, "POUs", `FUNCTION_BLOCK ${TEST_PREFIX}X1\nVAR_INPUT\nEND_VAR\nVAR\nEND_VAR\n`);
		await engCreatePou(`${TEST_PREFIX}X2`, "POUs", `FUNCTION_BLOCK ${TEST_PREFIX}X2\nVAR_INPUT\nEND_VAR\nVAR\nEND_VAR\n`);
		assert(plc(ws, "pull").code === 0, "intermediate import succeeds");
		assert(workspaceFileExists(ws, `POUs/${TEST_PREFIX}X1.st`), "X1 present mid-test");
		assert(workspaceFileExists(ws, `POUs/${TEST_PREFIX}X2.st`), "X2 present mid-test");

		await cleanupAllTestPous();
		const r = plc(ws, "pull");
		assert(r.code === 0, "plc pull exit 0", r.stderr.trim());
		assert(!workspaceFileExists(ws, `POUs/${TEST_PREFIX}X1.st`), "X1 removed");
		assert(!workspaceFileExists(ws, `POUs/${TEST_PREFIX}X2.st`), "X2 removed");
		assert(!workspaceFileExists(ws, SEED_PATH), "seed TARGET removed");
	}

	// ─── D13: force-export reconcile preserves engineer's other items ─
	section(
		"D13 — Force-export over drift: engineer's UNRELATED items survive AND end up in the workspace",
	);
	{
		// This is the scenario that bit the user in production:
		// engineer adds a brand-new POU; AI edits something else and
		// force-exports without importing first. With a broken force
		// semantic, the workspace silently lacks the engineer's POU
		// AND `plc status` falsely claims "in sync." The fix is the
		// post-push reconcile inside runPush — assert it works.
		await seedBaseline(ws);

		// Engineer adds a POU the workspace knows nothing about.
		const engineerOnly = `${TEST_PREFIX}SHOULDSTAY`;
		await engCreatePou(
			engineerOnly,
			"POUs",
			`FUNCTION_BLOCK ${engineerOnly}\nVAR_INPUT\nEND_VAR\nVAR\nEND_VAR\n`,
		);

		// AI edits FB_DRIFT_TARGET (a totally different POU) without
		// importing — workspace has no idea SHOULDSTAY exists.
		writeFileSync(
			join(ws, SEED_PATH),
			`FUNCTION_BLOCK ${TEST_PREFIX}TARGET\nVAR_INPUT\n    x : INT;\nEND_VAR\nVAR\nEND_VAR\n\nx := x + 100;\n\nEND_FUNCTION_BLOCK\n`,
			"utf-8",
		);

		// Plain export → drift_detected (engineer's drift).
		const exp1 = plc(ws, "push");
		assert(exp1.code === 2, "plain export refused (engineer drifted)");

		// Force-export. The reconcile must pull SHOULDSTAY into the
		// workspace AND keep it on the bridge.
		const expForced = plc(ws, "push", "--force");
		assert(expForced.code === 0, "force-export exit 0", expForced.stderr.trim());
		assert(
			expForced.stderr.includes(engineerOnly),
			"force-export stderr surfaces the adopted-from-bridge item by name",
			expForced.stderr.trim(),
		);

		// Per-item push receipt (modeled on `git push --porcelain`):
		// the OK output must list TARGET as the modified item AND must
		// NOT list SHOULDSTAY. This nails the exact "AI confidently
		// claimed shouldstay got overwritten" bug — the per-item
		// receipt makes that hallucination impossible because the
		// caller has structured proof.
		assert(
			expForced.stdout.includes(`${TEST_PREFIX}TARGET`),
			"force-export stdout reports pushed TARGET by name",
			expForced.stdout.trim(),
		);
		assert(
			!expForced.stdout.includes(`pushed to bridge`) ||
				!expForced.stdout.split("pushed to bridge:")[1]!.split("exported.")[0]!.includes(engineerOnly),
			`force-export stdout does NOT list ${engineerOnly} under "pushed to bridge" — it was adopted, not pushed`,
			expForced.stdout.trim(),
		);

		// HARDEST assertion: the workspace now has the engineer's POU
		// file. Pre-fix this was silently absent.
		assert(
			workspaceFileExists(ws, `POUs/${engineerOnly}.st`),
			`workspace has POUs/${engineerOnly}.st after force-export reconcile`,
		);

		// Bridge still has SHOULDSTAY (force did NOT delete it).
		const refs = await bridge.getRefs();
		assert(
			refs.items[engineerOnly] !== undefined,
			`bridge still has ${engineerOnly} after force-export (NOT overwritten)`,
		);

		// Bridge also has AI's edits to TARGET.
		const { changed } = await bridge.fetchChanges({ knownItems: {} });
		const target = changed.find((c) => c.name === `${TEST_PREFIX}TARGET`);
		assert(target?.implementation?.includes("x + 100") === true, "bridge has AI's TARGET edit");

		// And NOW `plc status` should honestly report in-sync — not the
		// false "in sync" pre-fix that hid the missing workspace file.
		const st = plc(ws, "status");
		assert(st.code === 0, "post-reconcile status exit 0");
		assert(
			st.stdout.includes("All in sync") || st.stdout.toLowerCase().includes("nothing to do"),
			"post-reconcile status reports in-sync HONESTLY (workspace, snapshot, bridge all agree)",
			st.stdout.trim(),
		);

		// Status preview symmetry: edit TARGET again (no engineer-side
		// change this round) and assert status now previews the upcoming
		// export per-item. This is the "what would export do?" diagnostic
		// — same shape as incoming, modeled on `git status --porcelain`.
		writeFileSync(
			join(ws, SEED_PATH),
			`FUNCTION_BLOCK ${TEST_PREFIX}TARGET\nVAR_INPUT\n    x : INT;\nEND_VAR\nVAR\nEND_VAR\n\nx := x + 200;\n\nEND_FUNCTION_BLOCK\n`,
			"utf-8",
		);
		const stPreview = plc(ws, "status");
		assert(stPreview.code === 0, "status with pending export exit 0");
		assert(
			stPreview.stdout.includes("outgoing"),
			"status header announces outgoing preview (git/hg vocabulary)",
			stPreview.stdout.trim(),
		);
		assert(
			stPreview.stdout.includes(`[WS]  M ${TEST_PREFIX}TARGET`),
			`status previews TARGET as the modified item the next plc push would push`,
			stPreview.stdout.trim(),
		);
	}

	// ─── D12: full round-trip ────────────────────────────────────────
	section("D12 — Round-trip: AI export → engineer edit → AI import → AI export");
	{
		await seedBaseline(ws);

		// 1. AI edits + exports. Workspace file uses LSP-compatible single-
		//    file layout: FB block wrapped with END_FUNCTION_BLOCK.
		const aiEditedDecl = `FUNCTION_BLOCK ${TEST_PREFIX}TARGET\nVAR_INPUT\n    x : INT;\n    aiAdded : BOOL;\nEND_VAR\nVAR\nEND_VAR\n`;
		writeFileSync(join(ws, SEED_PATH), `${aiEditedDecl}\nx := x + 1;\n\nEND_FUNCTION_BLOCK\n`, "utf-8");
		const exp1 = plc(ws, "push");
		assert(exp1.code === 0, "AI export 1 succeeds", exp1.stderr.trim());

		// 2. Engineer touches the same FB (different field). Engineer-side
		//    declarations don't need the wrapper — bridge stores just the
		//    inner declaration text.
		const engEditedDecl = `FUNCTION_BLOCK ${TEST_PREFIX}TARGET\nVAR_INPUT\n    x : INT;\n    aiAdded : BOOL;\n    engAdded : REAL;\nEND_VAR\nVAR\nEND_VAR\n`;
		await engUpdatePou(`${TEST_PREFIX}TARGET`, { declaration: engEditedDecl });

		// 3. AI's next export should refuse (drift).
		writeFileSync(
			join(ws, SEED_PATH),
			`${aiEditedDecl}\nx := x + 2; // AI second edit\n\nEND_FUNCTION_BLOCK\n`,
			"utf-8",
		);
		const exp2 = plc(ws, "push");
		assert(exp2.code === 2, "AI export refused on drift", exp2.stderr.trim());

		// 4. AI imports (refuses because workspace dirty), then --force.
		const imp = plc(ws, "pull");
		assert(imp.code !== 0, "plc pull refuses while workspace dirty");
		const impForced = plc(ws, "pull", "--force");
		assert(impForced.code === 0, "plc pull --force succeeds", impForced.stderr.trim());
		assert(workspaceFileContains(ws, SEED_PATH, "engAdded"), "post-import workspace has engineer's field");

		// 5. AI re-applies its edit on top. Add a new var by injecting
		//    before END_VAR (resilient to whatever the materializer's exact
		//    formatting is).
		const current = readFileSync(join(ws, SEED_PATH), "utf-8");
		const final = current.replace(
			/VAR_INPUT([\s\S]*?)END_VAR/,
			(_match, contents: string) => `VAR_INPUT${contents}    aiPostMerge : INT;\nEND_VAR`,
		);
		writeFileSync(join(ws, SEED_PATH), final, "utf-8");
		const exp3 = plc(ws, "push");
		assert(exp3.code === 0, "AI export 2 succeeds after merge", exp3.stderr.trim());

		// Verify the bridge has the merged state.
		const { changed } = await bridge.fetchChanges({ knownItems: {} });
		const fb = changed.find((c) => c.name === `${TEST_PREFIX}TARGET`);
		assert(fb !== undefined, "FB still on bridge after round-trip");
		assert(
			fb?.declaration?.includes("engAdded") === true,
			"final bridge decl has engineer's field",
		);
		assert(
			fb?.declaration?.includes("aiPostMerge") === true,
			"final bridge decl has AI's post-merge field",
		);
	}

	// ─── D14: git-inspired flags ─────────────────────────────────────
	section("D14 — git-inspired flags: --dry-run (push/pull), --porcelain, --force-with-lease");
	{
		await seedBaseline(ws);

		// 14a. push --dry-run on a clean workspace: nothing to push, exit 0,
		// no bridge mutation. Then make an edit and dry-run again: preview
		// the outgoing item without sending it.
		{
			const dryClean = plc(ws, "push", "--dry-run");
			assert(dryClean.code === 0, "push --dry-run on clean workspace exit 0", dryClean.stderr.trim());
			assert(
				dryClean.stdout.toLowerCase().includes("nothing to push"),
				"push --dry-run on clean workspace reports nothing to push",
				dryClean.stdout.trim(),
			);

			writeFileSync(
				join(ws, SEED_PATH),
				`FUNCTION_BLOCK ${TEST_PREFIX}TARGET\nVAR_INPUT\n    x : INT;\nEND_VAR\nVAR\nEND_VAR\n\nx := x + 999;\n\nEND_FUNCTION_BLOCK\n`,
				"utf-8",
			);
			const dryEdit = plc(ws, "push", "-n"); // short-flag form
			assert(dryEdit.code === 0, "push -n (short) exit 0", dryEdit.stderr.trim());
			assert(
				dryEdit.stdout.includes("would push to bridge (dry-run)"),
				"push --dry-run preamble identifies it as a dry-run",
				dryEdit.stdout.trim(),
			);
			assert(
				dryEdit.stdout.includes(`[WS]  M ${TEST_PREFIX}TARGET`),
				`push --dry-run lists TARGET as outgoing modification`,
				dryEdit.stdout.trim(),
			);
			// Critical: bridge MUST NOT have x+999 yet — dry-run is read-only.
			const { changed: c1 } = await bridge.fetchChanges({ knownItems: {} });
			const fb1 = c1.find((c) => c.name === `${TEST_PREFIX}TARGET`);
			assert(
				fb1?.implementation?.includes("x + 999") !== true,
				"dry-run did NOT mutate the bridge",
			);

			// Real push now actually lands it.
			const real = plc(ws, "push");
			assert(real.code === 0, "real push after dry-run succeeds", real.stderr.trim());
			const { changed: c2 } = await bridge.fetchChanges({ knownItems: {} });
			const fb2 = c2.find((c) => c.name === `${TEST_PREFIX}TARGET`);
			assert(
				fb2?.implementation?.includes("x + 999") === true,
				"real push DID mutate the bridge",
			);
		}

		// 14b. status --porcelain output: stable one-line-per-item format,
		// empty stdout when clean, prefix codes iA/iM/iD/oA/oM/oD.
		{
			const cleanP = plc(ws, "status", "--porcelain");
			assert(cleanP.code === 0, "status --porcelain on clean exit 0");
			assert(
				cleanP.stdout === "" || cleanP.stdout === "\n",
				"status --porcelain on clean has empty stdout",
				JSON.stringify(cleanP.stdout),
			);

			// Engineer adds something so we have incoming.
			const portcheck = `${TEST_PREFIX}PORCELAIN`;
			await engCreatePou(
				portcheck,
				"POUs",
				`FUNCTION_BLOCK ${portcheck}\nVAR_INPUT\nEND_VAR\nVAR\nEND_VAR\n`,
			);
			// AI dirties the workspace so we also have outgoing.
			writeFileSync(
				join(ws, SEED_PATH),
				`FUNCTION_BLOCK ${TEST_PREFIX}TARGET\nVAR_INPUT\n    x : INT;\nEND_VAR\nVAR\nEND_VAR\n\nx := x + 1234;\n\nEND_FUNCTION_BLOCK\n`,
				"utf-8",
			);
			const both = plc(ws, "status", "--porcelain");
			assert(both.code === 0, "status --porcelain with both sides exit 0");
			assert(
				both.stdout.includes(`iA ${portcheck}\n`),
				`status --porcelain shows engineer's add as 'iA ${portcheck}'`,
				both.stdout.trim(),
			);
			assert(
				both.stdout.includes(`oM ${TEST_PREFIX}TARGET\n`),
				`status --porcelain shows workspace edit as 'oM ${TEST_PREFIX}TARGET'`,
				both.stdout.trim(),
			);
			// Strictly stable format: no preamble, no summary footer.
			assert(
				!both.stdout.includes("All in sync") &&
					!both.stdout.includes("projectVersion") &&
					!both.stdout.includes("incoming —") &&
					!both.stdout.includes("outgoing —"),
				"status --porcelain has no human-prose preamble",
				both.stdout.trim(),
			);

			// 14c. pull --dry-run: shows engineer's add as incoming,
			// doesn't actually write the file to the workspace.
			// First need a clean workspace (revert our dirty edit).
			writeFileSync(
				join(ws, SEED_PATH),
				`FUNCTION_BLOCK ${TEST_PREFIX}TARGET\nVAR_INPUT\n    x : INT;\nEND_VAR\nVAR\nEND_VAR\n\nx := x + 999;\n\nEND_FUNCTION_BLOCK\n`,
				"utf-8",
			);
			const dpull = plc(ws, "pull", "--dry-run");
			assert(dpull.code === 0, "pull --dry-run exit 0", dpull.stderr.trim());
			assert(
				dpull.stdout.includes("would pull from bridge (dry-run)"),
				"pull --dry-run preamble identifies it as a dry-run",
				dpull.stdout.trim(),
			);
			assert(
				dpull.stdout.includes(`[IDE] + ${portcheck}`),
				`pull --dry-run lists ${portcheck} as incoming addition`,
				dpull.stdout.trim(),
			);
			assert(
				!workspaceFileExists(ws, `POUs/${portcheck}.st`),
				`pull --dry-run did NOT write ${portcheck}.st to the workspace`,
			);
		}

		// 14d. capability lease (sudo-style) — AI's force is gated on a
		// `push-force` lease the human grants via `plc grant`. We exercise
		// the CLI grant verb directly (the MCP path is covered separately
		// in the MCP conformance suite).
		{
			// Make sure no lease is hanging around from another scenario.
			plc(ws, "revoke", "push-force");

			// status with no leases: availableCapabilities empty, no
			// [AUTH] block in the human-readable output.
			const noLease = plc(ws, "status");
			assert(noLease.code === 0, "status exit 0 with no lease");
			assert(
				!noLease.stdout.includes("[AUTH]"),
				"status omits [AUTH] block when no leases are active",
				noLease.stdout.trim(),
			);

			// grant push-force: lease file exists, status surfaces it.
			const g = plc(ws, "grant", "push-force", "--ttl", "1m", "--once");
			assert(g.code === 0, "plc grant push-force exit 0", g.stderr.trim());
			assert(
				g.stdout.includes("granted: push-force"),
				"grant stdout confirms the capability",
				g.stdout.trim(),
			);
			const leaseFile = join(ws, ".plcassist/auth/push-force.lease");
			assert(existsSync(leaseFile), "lease file written to .plcassist/auth/");

			const withLease = plc(ws, "status");
			assert(
				withLease.stdout.includes("[AUTH] push-force") &&
					withLease.stdout.includes("(one-shot)"),
				"status surfaces active push-force lease (with one-shot tag)",
				withLease.stdout.trim(),
			);

			// revoke kills it; status drops the [AUTH] line.
			const rv = plc(ws, "revoke", "push-force");
			assert(rv.code === 0, "plc revoke exit 0");
			assert(rv.stdout.includes("revoked: push-force"), "revoke confirms");
			assert(!existsSync(leaseFile), "lease file gone after revoke");

			const cleanAgain = plc(ws, "status");
			assert(
				!cleanAgain.stdout.includes("[AUTH]"),
				"status omits [AUTH] block after revoke",
				cleanAgain.stdout.trim(),
			);

			// Unknown capability is rejected with a helpful list.
			const bad = plc(ws, "grant", "make-coffee");
			assert(bad.code === 1, "grant unknown capability exits 1");
			assert(
				bad.stderr.includes("unknown capability") &&
					bad.stderr.includes("push-force"),
				"unknown capability error lists known caps",
				bad.stderr.trim(),
			);

			// Malformed --ttl is rejected.
			const badTtl = plc(ws, "grant", "push-force", "--ttl", "notaduration");
			assert(badTtl.code === 1, "grant with bad --ttl exits 1");
			assert(
				badTtl.stderr.includes("unrecognized duration"),
				"bad ttl error explains the format",
				badTtl.stderr.trim(),
			);
		}

		// 14e. --force-with-lease: holds when current bridge version matches,
		// refuses (status=lease_stale, exit 2) when the bridge moved further.
		{
			// Read current bridge version. The bridge already moved from
			// our seedBaseline state because engCreatePou ran, so we have
			// drift. We'll pass the CURRENT projectVersion as the lease —
			// it should hold.
			const refs = await bridge.getRefs();
			const goodLease = refs.projectVersion;

			// AI dirties the workspace.
			writeFileSync(
				join(ws, SEED_PATH),
				`FUNCTION_BLOCK ${TEST_PREFIX}TARGET\nVAR_INPUT\n    x : INT;\nEND_VAR\nVAR\nEND_VAR\n\nx := x + 5555;\n\nEND_FUNCTION_BLOCK\n`,
				"utf-8",
			);

			// Stale lease (random hex that's NOT the current version):
			// should be refused.
			const stale = plc(ws, "push", `--force-with-lease=deadbeefdeadbeef`);
			assert(stale.code === 2, "--force-with-lease with stale value exits 2", stale.stderr.trim());
			assert(
				stale.stderr.includes("--force-with-lease refused"),
				"stale lease error explains why it was refused",
				stale.stderr.trim(),
			);
			assert(
				stale.stderr.includes("deadbeefdeadbeef") &&
					stale.stderr.includes(goodLease),
				"stale lease error shows both expected and current versions",
				stale.stderr.trim(),
			);

			// Holding lease (current bridge version): should succeed.
			const ok = plc(ws, "push", `--force-with-lease=${goodLease}`);
			assert(ok.code === 0, "--force-with-lease with current version succeeds", ok.stderr.trim());
			assert(
				ok.stdout.includes(`[WS]  M ${TEST_PREFIX}TARGET`),
				"force-with-lease push lists pushed item",
				ok.stdout.trim(),
			);
		}
	}
}

void main().catch((err) => {
	console.error("\nFATAL:", err instanceof Error ? err.message : err);
	process.exit(1);
});
