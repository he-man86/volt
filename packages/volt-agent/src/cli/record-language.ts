#!/usr/bin/env node
/**
 * `bun run record:language` — populate `expected-tc.json` ground truth
 * for the language-conformance test catalog (`src/conformance/pragma-tests.ts`).
 *
 * Workflow per test:
 *   1. Write the source to a temp workspace at `<pouName>.<ext>`
 *   2. `volt push` into the live (empty) TwinCAT project
 *   3. `bridge.build()` — capture compiler diagnostics
 *   4. `bridge.pushBatch({ deletePou })` — clean up
 *
 * Output: `src/conformance/expected-tc.json` (overwritten). Commit
 * the result; replay tests in `language.test.ts` then run anywhere
 * without a bridge.
 *
 * Requires:
 *   - Bridge on 127.0.0.1:8555 (or VOLT_BRIDGE_PORT)
 *   - IDE open with an EMPTY PLC project (or one that contains only
 *     LANG_* POUs from a previous interrupted run)
 *
 * Exit code:
 *   0  — recording successful, expected-tc.json written
 *   1  — bridge unreachable, project not empty, or unrecoverable push/build error
 */
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BridgeClient } from "../bridge/client.js";
import type { BridgeDiagnostic } from "../bridge/types.js";
import { PRAGMA_TESTS, type PragmaTest } from "../conformance/pragma-tests.js";

const BRIDGE_PORT = Number.parseInt(process.env.VOLT_BRIDGE_PORT ?? "8555", 10);
const LANG_PREFIX_RE = /^(FB|GVL|DUT|ITF)_LANG_/;
const THIS_DIR = dirname(fileURLToPath(import.meta.url));
// Compiled `volt` bin lives alongside this script at dist/cli/bin.js.
const CLI_PATH = resolve(THIS_DIR, "bin.js");
// expected-tc.json lives next to the catalog under src/, NOT dist/ —
// it's source-controlled data, not a build artifact.
const OUTPUT_PATH = resolve(THIS_DIR, "..", "..", "src", "conformance", "expected-tc.json");

const KIND_EXT: Record<PragmaTest["kind"], string> = {
	function_block: "st",
	function: "st",
	program: "st",
	gvl: "gvl",
	structure: "dut",
	interface: "itf",
};

interface RecordedEntry {
	buildSuccess: boolean;
	durationMs: number;
	diagnostics: BridgeDiagnostic[];
}

interface ExpectedTc {
	recorded: { at: string; bridgeVersion: string; testCount: number };
	tests: Record<string, RecordedEntry>;
}

async function main(): Promise<void> {
	const bridge = new BridgeClient({ port: BRIDGE_PORT });

	console.log(`recording language conformance against http://127.0.0.1:${BRIDGE_PORT}\n`);

	// ─── Pre-flight ────────────────────────────────────────────────────
	let health;
	try {
		health = await bridge.getHealth();
	} catch (err) {
		console.error(`pre-flight: bridge unreachable: ${err instanceof Error ? err.message : err}`);
		process.exit(1);
	}
	if (health.connected !== true || health.projectName === undefined) {
		console.error("pre-flight: no project loaded in the IDE — open one first");
		process.exit(1);
	}
	console.log(`  bridge: ${health.version}  IDE: ${health.ideName}/${health.ideVersion}`);
	console.log(`  project: ${health.projectName}/${health.plcProjectName}\n`);

	// Pre-flight cleanup: sweep all LANG_* leftovers (from previous
	// interrupted runs or the debug-push-one helper). We own the
	// LANG_* namespace; any item with that prefix is ours to remove.
	const refs = await bridge.getRefs();
	const nonTestItems = Object.keys(refs.items).filter((n) => !LANG_PREFIX_RE.test(n));
	if (nonTestItems.length > 0) {
		console.log(`  (project has ${nonTestItems.length} pre-existing POU(s) — ignored: ${nonTestItems.join(", ")})`);
	}
	const leftovers = Object.keys(refs.items).filter((n) => LANG_PREFIX_RE.test(n));
	if (leftovers.length > 0) {
		console.log(`  (cleaning ${leftovers.length} LANG_* leftover(s) before recording)`);
		await cleanupItems(bridge, leftovers);
	}
	// Collision check on any NON-LANG_* POU that matches a test name —
	// shouldn't happen given the FB_LANG_* prefix convention, but a
	// safety net.
	const refsAfter = await bridge.getRefs();
	const collisions = PRAGMA_TESTS.filter((t) => refsAfter.items[t.pouName] !== undefined).map((t) => t.pouName);
	if (collisions.length > 0) {
		console.error(`pre-flight: name collision with non-LANG_* POU(s): ${collisions.join(", ")}`);
		console.error("Rename the test POU in pragma-tests.ts to avoid the conflict.");
		process.exit(1);
	}

	// ─── Workspace setup ───────────────────────────────────────────────
	const rootTmp = mkdtempSync(join(tmpdir(), "volt-record-lang-"));
	const workspace = join(rootTmp, "ws");
	mkdirSync(workspace, { recursive: true });

	console.log(`  workspace: ${workspace}\n`);

	const initRes = volt(workspace, "init");
	if (initRes.code !== 0) {
		console.error(`volt init failed:\n${initRes.stderr}`);
		process.exit(1);
	}
	// Seed the snapshot — `volt push` refuses to run against a workspace
	// that's never been pulled. The pull is fast (project is otherwise
	// empty or near-empty).
	const pullRes = volt(workspace, "pull");
	if (pullRes.code !== 0) {
		console.error(`volt pull failed:\n${pullRes.stderr}`);
		process.exit(1);
	}

	// ─── Record each test ──────────────────────────────────────────────
	const recorded: Record<string, RecordedEntry> = {};
	let failures = 0;

	try {
		for (const test of PRAGMA_TESTS) {
			process.stdout.write(`  • ${test.name} (${test.kind}) … `);
			try {
				const entry = await recordOne(bridge, workspace, test);
				recorded[test.name] = entry;
				const okMark = entry.buildSuccess ? "✓" : "✗";
				process.stdout.write(
					`${okMark} build=${entry.buildSuccess} ` +
						`errors=${entry.diagnostics.filter((d) => d.severity === "error").length} ` +
						`warnings=${entry.diagnostics.filter((d) => d.severity === "warning").length}\n`,
				);
			} catch (err) {
				failures += 1;
				process.stdout.write(`!! ${err instanceof Error ? err.message : String(err)}\n`);
			}
		}
	} finally {
		// Best-effort cleanup of anything left behind.
		const finalRefs = await bridge.getRefs();
		const stillThere = Object.keys(finalRefs.items).filter((n) => LANG_PREFIX_RE.test(n));
		if (stillThere.length > 0) {
			console.log(`\n  teardown: removing ${stillThere.length} leftover LANG_* POU(s)`);
			await cleanupItems(bridge, stillThere);
		}
		try { rmSync(rootTmp, { recursive: true, force: true }); } catch { /* ignore */ }
	}

	// ─── Write expected-tc.json ────────────────────────────────────────
	const output: ExpectedTc & { $schema: string; _doc: string } = {
		$schema: "./expected-tc.schema.json",
		_doc:
			"Auto-generated by `bun run record:language`. " +
			"Do not edit by hand — re-record after editing pragma-tests.ts.",
		recorded: {
			at: new Date().toISOString(),
			bridgeVersion: health.version,
			testCount: Object.keys(recorded).length,
		},
		tests: recorded,
	};
	writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf-8");
	console.log(`\n  wrote ${OUTPUT_PATH}`);
	console.log(`  recorded ${Object.keys(recorded).length}/${PRAGMA_TESTS.length} tests, ${failures} failures`);

	process.exit(failures > 0 ? 1 : 0);
}

// ─── Per-test recording ──────────────────────────────────────────────

async function recordOne(
	bridge: BridgeClient,
	workspace: string,
	test: PragmaTest,
): Promise<RecordedEntry> {
	const ext = KIND_EXT[test.kind];
	const testFilePath = join(workspace, `${test.pouName}.${ext}`);
	writeFileSync(testFilePath, test.source, "utf-8");

	// Wire the test POU into PLC_PRG so TwinCAT actually compiles
	// it — TC only analyzes code reachable from the program entry
	// point. CRITICAL: must overwrite PLC_PRG at its EXISTING
	// workspace path (typically POUs/PLC_PRG.st). Writing a fresh
	// file at root creates a ghost POU that volt push silently no-ops
	// on (name collides with existing POU at a different path), and
	// TC's real PLC_PRG stays empty — meaning the test FB is dead
	// code and the compiler emits no diagnostics for it.
	const plcPrgPath = findExistingFile(workspace, "PLC_PRG.st") ?? join(workspace, "PLC_PRG.st");
	writeFileSync(plcPrgPath, buildPlcPrg(test), "utf-8");

	// --force: bypass drift detection. The recorder calls bridge.pushBatch
	// deletePou directly between tests (it owns the bridge state), so
	// each cycle the workspace snapshot is "behind" the bridge by one
	// deletion. --force reconciles instead of refusing.
	const pushRes = volt(workspace, "push", "--force");
	if (pushRes.code !== 0) {
		try { rmSync(testFilePath); } catch { /* ignore */ }
		try { rmSync(plcPrgPath); } catch { /* ignore */ }
		throw new Error(`volt push failed: ${pushRes.stderr.trim() || pushRes.stdout.trim()}`);
	}

	const buildRes = await bridge.build({ buildType: "full" });

	// Filter diagnostics to those scoped to this POU (or unscoped) —
	// exclude PLC_PRG and unrelated POUs. Object names take the form
	// "FB_LANG_x", "FB_LANG_x.AfterInit", "FB_LANG_x.AfterInit.impl".
	const scoped = buildRes.diagnostics.filter(
		(d) => d.object === null || d.object === test.pouName || d.object.startsWith(`${test.pouName}.`),
	);

	// Clean up: restore PLC_PRG to its empty default (don't delete —
	// TC always has one) and delete the test POU from the bridge so
	// the next test starts with a clean slate.
	writeFileSync(plcPrgPath, BARE_PLC_PRG, "utf-8");
	const restoreRes = volt(workspace, "push", "--force");
	if (restoreRes.code !== 0) {
		console.log(`    (warn) failed to restore PLC_PRG: ${restoreRes.stderr.trim()}`);
	}
	try { rmSync(testFilePath); } catch { /* ignore */ }

	const refs = await bridge.getRefs();
	const ifVersion = refs.items[test.pouName];
	if (ifVersion !== undefined) {
		await bridge.pushBatch({ ops: [{ op: "deletePou", name: test.pouName, ifVersion }] });
	}

	const scopedHasError = scoped.some((d) => d.severity === "error");

	return {
		buildSuccess: !scopedHasError,
		durationMs: buildRes.duration,
		diagnostics: scoped,
	};
}

const BARE_PLC_PRG = `PROGRAM PLC_PRG
VAR
END_VAR

END_PROGRAM
`;

/** Walk the workspace for a file with the given basename. Skip .volt/. */
function findExistingFile(root: string, basename: string): string | undefined {
	let found: string | undefined;
	function walk(dir: string): void {
		if (found !== undefined) return;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.name === ".volt" || entry.name === ".git") continue;
			const full = join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.isFile() && entry.name === basename) {
				found = full;
				return;
			}
		}
	}
	walk(root);
	return found;
}

function buildPlcPrg(test: PragmaTest): string {
	const varBlock = test.plcPrgVar !== undefined ? `\t${test.plcPrgVar}` : "";
	const body = test.plcPrgBody ?? "";
	return `PROGRAM PLC_PRG
VAR
${varBlock}
END_VAR
${body}
END_PROGRAM
`;
}

// ─── Helpers ──────────────────────────────────────────────────────────

async function cleanupItems(bridge: BridgeClient, names: string[]): Promise<void> {
	let safety = 10;
	while (safety-- > 0) {
		const refs = await bridge.getRefs();
		const remaining = names.filter((n) => refs.items[n] !== undefined);
		if (remaining.length === 0) return;
		for (const name of remaining) {
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

interface CliResult { stdout: string; stderr: string; code: number; }

function volt(workspace: string, ...args: string[]): CliResult {
	const r = spawnSync(
		"node",
		[CLI_PATH, ...args, "--workspace", workspace, "--port", String(BRIDGE_PORT)],
		{
			encoding: "utf-8",
			env: { ...process.env, VOLT_BRIDGE_PORT: String(BRIDGE_PORT) },
		},
	);
	return { stdout: r.stdout, stderr: r.stderr, code: r.status ?? -1 };
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
