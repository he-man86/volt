#!/usr/bin/env node
/**
 * `bun run record:language` — populate `expected-tc.json` ground truth
 * for the language-conformance test catalog
 * (`volt-lsp-st/src/conformance/`).
 *
 * **Batch mode.** All test POUs are pushed at once under a single
 * mega-PLC_PRG that instantiates them all, then one TwinCAT build
 * produces all diagnostics in a single pane scan, and we bucket the
 * results per test by the diagnostic's `object` field.
 *
 * Why batch instead of per-test:
 *   - One build instead of N → ~N× faster
 *   - No PLC_PRG-state cascade: each test isn't reset between, so a
 *     parser failure on one test doesn't poison subsequent ones
 *   - Validation upfront (parseSource per test source + per PLC_PRG)
 *     filters out catalog entries with unparseable code BEFORE the
 *     push, so the batch pushes cleanly
 *
 * Output: `volt-lsp-st/src/conformance/expected-tc.json` (overwritten).
 * Commit the result; the replay test (`language.test.ts` in the same
 * package) then runs anywhere without a bridge.
 *
 * Requires:
 *   - Bridge on 127.0.0.1:8555 (or VOLT_BRIDGE_PORT)
 *   - IDE open with a TwinCAT project that's either empty or carries
 *     only LANG_* leftovers (recorder sweeps those before recording).
 *     The project doesn't need to contain PLC_PRG — recorder pushes
 *     one as part of the batch if missing.
 *
 * Exit code:
 *   0  — recording successful, expected-tc.json written
 *   1  — bridge unreachable, push/build error, or every test excluded
 */
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSource } from "@opencode-ai/volt-lsp";
import { ALL_TESTS, CATEGORIES, type LanguageTest } from "@opencode-ai/volt-lsp/conformance";
import { BridgeClient } from "../bridge/client.js";
import type { BridgeDiagnostic } from "../bridge/types.js";
import { findExistingFile } from "./_shared.js";

const BRIDGE_PORT = Number.parseInt(process.env.VOLT_BRIDGE_PORT ?? "8555", 10);
const LANG_PREFIX_RE = /^(FB|GVL|DUT|ITF)_LANG_/;
const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(THIS_DIR, "bin.js");
// The catalog + recorded ground truth now live in volt-lsp-st (the LSP
// is what the recordings verify). From this file's compiled location at
// `packages/volt-agent/dist/cli/`, three `..` segments climb to `packages/`.
const OUTPUT_PATH = resolve(THIS_DIR, "..", "..", "..", "volt-lsp-st", "src", "conformance", "expected-tc.json");

const KIND_EXT: Record<LanguageTest["kind"], string> = {
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

	// Sweep LANG_* leftovers.
	const refs = await bridge.getRefs();
	const leftovers = Object.keys(refs.items).filter((n) => LANG_PREFIX_RE.test(n));
	if (leftovers.length > 0) {
		console.log(`  (cleaning ${leftovers.length} LANG_* leftover(s) before recording)`);
		await cleanupItems(bridge, leftovers);
	}

	// ─── Filter tests by parseability ──────────────────────────────────
	// Validate each test source AND its plcPrg snippet upfront. Any
	// test that can't be parsed by volt-lsp-st would crash the batch
	// push — better to log and exclude it.
	const valid: LanguageTest[] = [];
	const skipped: Array<{ name: string; reason: string }> = [];
	for (const t of ALL_TESTS) {
		const sourceErr = firstParseError(t.source, `test ${t.name} source`);
		if (sourceErr !== undefined) {
			skipped.push({ name: t.name, reason: sourceErr });
			continue;
		}
		valid.push(t);
	}
	const megaPlc = buildMegaPlcPrg(valid);
	const plcErr = firstParseError(megaPlc, "mega-PLC_PRG");
	if (plcErr !== undefined) {
		console.error(`pre-flight: combined PLC_PRG fails to parse: ${plcErr}`);
		console.error("This usually means a test's plcPrgVar/plcPrgBody uses syntax our parser doesn't yet support.");
		console.error("Try bisecting: temporarily remove tests until parse succeeds.");
		process.exit(1);
	}

	if (skipped.length > 0) {
		console.log(`  (skipped ${skipped.length} unparseable test(s):`);
		for (const s of skipped) console.log(`    - ${s.name}: ${s.reason}`);
		console.log(`  )`);
	}
	if (valid.length === 0) {
		console.error("no tests passed validation; nothing to record");
		process.exit(1);
	}

	// ─── Workspace setup ───────────────────────────────────────────────
	const rootTmp = mkdtempSync(join(tmpdir(), "volt-record-lang-"));
	const workspace = join(rootTmp, "ws");
	mkdirSync(workspace, { recursive: true });
	console.log(`\n  workspace: ${workspace}`);

	const initRes = volt(workspace, "init");
	if (initRes.code !== 0) {
		console.error(`volt init failed:\n${initRes.stderr}`);
		process.exit(1);
	}
	const pullRes = volt(workspace, "pull");
	if (pullRes.code !== 0) {
		console.error(`volt pull failed:\n${pullRes.stderr}`);
		process.exit(1);
	}

	// Split into isolated-recording vs batch tests. Isolated tests are
	// those marked recordIsolated:true in the catalog — typically tests
	// that produce PARSE errors (which short-circuit TC's semantic
	// analysis on the whole project, so other tests' errors would
	// silently disappear from the build pane in mega-batch mode).
	const isolated = valid.filter((t) => t.recordIsolated === true);
	const batchTotal = valid.length - isolated.length;
	console.log(`  ${isolated.length} isolated test(s), ${batchTotal} batch test(s) across ${CATEGORIES.length} categor(ies)`);

	const plcPrgPath = findExistingFile(workspace, "PLC_PRG.st") ?? join(workspace, "PLC_PRG.st");
	const recorded: Record<string, RecordedEntry> = {};

	// ─── Isolated recordings: one push+build cycle per test ────────────
	for (const t of isolated) {
		const ext = KIND_EXT[t.kind];
		const testFilePath = join(workspace, `${t.pouName}.${ext}`);
		writeFileSync(testFilePath, t.source, "utf-8");
		writeFileSync(plcPrgPath, buildMegaPlcPrg([t]), "utf-8");

		const pushRes = volt(workspace, "push", "--force", "--no-drift-check");
		if (pushRes.code !== 0) {
			console.log(`  ✗ ${t.name.padEnd(30)} push failed: ${pushRes.stderr.trim() || pushRes.stdout.trim()}`);
			recorded[t.name] = { buildSuccess: false, durationMs: 0, diagnostics: [] };
			// Try cleanup before next iteration.
			try { rmSync(testFilePath); } catch { /* ignore */ }
			writeFileSync(plcPrgPath, BARE_PLC_PRG, "utf-8");
			volt(workspace, "push", "--force", "--no-drift-check"); // best-effort reset
			continue;
		}

		const buildRes = await bridge.build({ buildType: "full" });
		const scoped = buildRes.diagnostics.filter(
			(d) => d.object === t.pouName || (d.object !== null && d.object.startsWith(`${t.pouName}.`)),
		);
		const hasError = scoped.some((d) => d.severity === "error");
		const errCount = scoped.filter((d) => d.severity === "error").length;
		const warnCount = scoped.filter((d) => d.severity === "warning").length;
		const okMark = !hasError ? "✓" : "✗";
		console.log(`  ${okMark} ${t.name.padEnd(30)} (isolated) errors=${errCount} warnings=${warnCount}`);
		recorded[t.name] = {
			buildSuccess: !hasError,
			durationMs: buildRes.duration,
			diagnostics: scoped,
		};

		// Reset for next iteration: clear the file + bare PLC_PRG + push.
		try { rmSync(testFilePath); } catch { /* ignore */ }
		writeFileSync(plcPrgPath, BARE_PLC_PRG, "utf-8");
		const resetRes = volt(workspace, "push", "--force", "--no-drift-check");
		if (resetRes.code !== 0) {
			console.log(`    (warn) isolated reset failed for ${t.name}: ${resetRes.stderr.trim()}`);
			await cleanupItems(bridge, [t.pouName]);
		}
	}

	// ─── Batch recording: PER-CATEGORY push + build + cleanup ─────────
	// History: previously this was one giant batch of all 165+ batch
	// tests with chunked pushes (CHUNK_SIZE=12) and ONE final build.
	// That ran into a cumulative-cost wall: each /push HTTP call
	// invokes BeckhoffConnection.LookupItemByName per pushItem op,
	// which walks the project tree O(N) where N = current item count.
	// At chunks 9+/14 the project already held 96 LANG_* items + their
	// children, pushing per-op cost above the 60s bridge-client timeout.
	// (Verified empirically on 2026-05-29: same chunk-9 content pushed
	// in 10.8s against an empty project vs >60s after 96 prior items.)
	//
	// Fix: record one CATEGORY at a time (pragma, lifecycle, identifier,
	// …). Each category contributes ≤12-ish tests, gets its own push +
	// build + diagnostic-extract, then the category's POUs are deleted
	// before the next category starts. So every push happens against a
	// near-empty project (1 + category_size items). Cost: 17 builds
	// instead of 1, but builds are seconds-level and reliable, whereas
	// the giant-batch path was minutes-level and hit timeouts.
	//
	// Diagnostic scoping stays per-test (object name match), unchanged.
	const validByName = new Set(valid.map((t) => t.name));
	for (const category of CATEGORIES) {
		const categoryBatch = category.tests.filter(
			(t) => t.recordIsolated !== true && validByName.has(t.name),
		);
		if (categoryBatch.length === 0) continue;

		console.log(`\n  ── ${category.name} (${categoryBatch.length} test(s)) ──`);
		await recordCategory(category.name, categoryBatch, bridge, workspace, plcPrgPath, recorded);
	}

	// ─── Teardown ──────────────────────────────────────────────────────
	console.log(`\n  teardown: removing test POUs + resetting PLC_PRG`);
	for (const t of valid) {
		try { rmSync(join(workspace, `${t.pouName}.${KIND_EXT[t.kind]}`)); } catch { /* ignore */ }
	}
	writeFileSync(plcPrgPath, BARE_PLC_PRG, "utf-8");
	const resetRes = volt(workspace, "push", "--force", "--no-drift-check");
	if (resetRes.code !== 0) {
		console.log(`    (warn) teardown push exit ${resetRes.code}; falling back to direct bridge cleanup`);
		await cleanupItems(bridge, valid.map((t) => t.pouName));
	}
	try { rmSync(rootTmp, { recursive: true, force: true }); } catch { /* ignore */ }

	// ─── Write expected-tc.json ────────────────────────────────────────
	const output: ExpectedTc & { $schema: string; _doc: string } = {
		$schema: "./expected-tc.schema.json",
		_doc:
			"Auto-generated by `bun run record:language`. " +
			"Do not edit by hand — re-record after editing the test catalog.",
		recorded: {
			at: new Date().toISOString(),
			bridgeVersion: health.version,
			testCount: Object.keys(recorded).length,
		},
		tests: recorded,
	};
	writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf-8");
	console.log(`\n  wrote ${OUTPUT_PATH}`);
	console.log(`  recorded ${Object.keys(recorded).length}/${ALL_TESTS.length} tests` +
		(skipped.length > 0 ? ` (${skipped.length} skipped at validation)` : ""));

	process.exit(0);
}

// ─── Per-category batch recording ─────────────────────────────────────

/**
 * Record one conformance category: write its tests' files, write a
 * PLC_PRG that instantiates only this category, push, build, extract
 * per-test diagnostics, then clean up so the next category starts
 * against a near-empty project. Writes results into `recorded`.
 *
 * On a failed push, falls back to direct bridge cleanup of any items
 * the category staged and re-throws — caller decides whether to abort.
 */
async function recordCategory(
	categoryName: string,
	tests: readonly LanguageTest[],
	bridge: BridgeClient,
	workspace: string,
	plcPrgPath: string,
	recorded: Record<string, RecordedEntry>,
): Promise<void> {
	// Each /push HTTP call invokes BeckhoffConnection.LookupItemByName
	// per pushItem op (O(N) tree walk). Within a category we push the
	// tests in sub-chunks so any single /push call stays comfortably
	// under the 60s bridge-client timeout, even when a category like
	// `pragma` has 50 tests. Empirically 12 items per push on a
	// near-empty project completes in ~10s; we stick with that.
	const CHUNK_SIZE = 12;

	const fail = async (label: string, msg: string): Promise<never> => {
		console.error(`  [${categoryName}] ${label}: ${msg}`);
		await cleanupItems(bridge, tests.map((t) => t.pouName));
		for (const t of tests) {
			try { rmSync(join(workspace, `${t.pouName}.${KIND_EXT[t.kind]}`)); } catch { /* ignore */ }
		}
		writeFileSync(plcPrgPath, BARE_PLC_PRG, "utf-8");
		throw new Error(`category '${categoryName}' ${label}; aborting`);
	};

	// 1. Push test sources in sub-chunks of CHUNK_SIZE so each /push
	//    call stays bounded. The bare PLC_PRG already exists from pull
	//    or the prior category's reset, so it's not part of the chunk.
	const chunkCount = Math.ceil(tests.length / CHUNK_SIZE);
	for (let i = 0; i < tests.length; i += CHUNK_SIZE) {
		const chunk = tests.slice(i, i + CHUNK_SIZE);
		for (const t of chunk) {
			writeFileSync(join(workspace, `${t.pouName}.${KIND_EXT[t.kind]}`), t.source, "utf-8");
		}
		if (chunkCount > 1) {
			console.log(`    pushing sub-chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${chunkCount} (${chunk.length} POU(s))…`);
		}
		const pushRes = volt(workspace, "push", "--force", "--no-drift-check");
		if (pushRes.code !== 0) {
			await fail("push failed", pushRes.stderr.trim() || pushRes.stdout.trim());
		}
	}

	// 2. Final push: mega PLC_PRG that instantiates this category's
	//    tests. Single file change, cheap COM update.
	writeFileSync(plcPrgPath, buildMegaPlcPrg(tests), "utf-8");
	const plcPushRes = volt(workspace, "push", "--force", "--no-drift-check");
	if (plcPushRes.code !== 0) {
		await fail("PLC_PRG push failed", plcPushRes.stderr.trim() || plcPushRes.stdout.trim());
	}

	// 3. Build + extract per-test diagnostics.
	const buildRes = await bridge.build({ buildType: "full" });
	for (const t of tests) {
		const scoped = buildRes.diagnostics.filter(
			(d) => d.object === t.pouName || (d.object !== null && d.object.startsWith(`${t.pouName}.`)),
		);
		const hasError = scoped.some((d) => d.severity === "error");
		const errCount = scoped.filter((d) => d.severity === "error").length;
		const warnCount = scoped.filter((d) => d.severity === "warning").length;
		const okMark = !hasError ? "✓" : "✗";
		console.log(`    ${okMark} ${t.name.padEnd(40)} errors=${errCount} warnings=${warnCount}`);
		recorded[t.name] = {
			buildSuccess: !hasError,
			durationMs: buildRes.duration,
			diagnostics: scoped,
		};
	}

	// 5. Cleanup: delete this category's test files locally, restore
	//    bare PLC_PRG, push to apply on the bridge. Direct bridge
	//    cleanup is a fallback in case the workspace-side push errors.
	for (const t of tests) {
		try { rmSync(join(workspace, `${t.pouName}.${KIND_EXT[t.kind]}`)); } catch { /* ignore */ }
	}
	writeFileSync(plcPrgPath, BARE_PLC_PRG, "utf-8");
	const cleanupRes = volt(workspace, "push", "--force", "--no-drift-check");
	if (cleanupRes.code !== 0) {
		console.log(`    (warn) [${categoryName}] cleanup push failed; falling back to direct bridge delete`);
		await cleanupItems(bridge, tests.map((t) => t.pouName));
	}
}

// ─── Mega-PLC_PRG builder ────────────────────────────────────────────

const BARE_PLC_PRG = `PROGRAM PLC_PRG
VAR
END_VAR

END_PROGRAM
`;

function buildMegaPlcPrg(tests: readonly LanguageTest[]): string {
	const varLines: string[] = [];
	const bodyLines: string[] = [];
	for (const t of tests) {
		if (t.plcPrgVar !== undefined) varLines.push(`\t${t.plcPrgVar}`);
		if (t.plcPrgBody !== undefined) bodyLines.push(t.plcPrgBody);
	}
	return `PROGRAM PLC_PRG
VAR
${varLines.join("\n")}
END_VAR
${bodyLines.join("\n")}
END_PROGRAM
`;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function firstParseError(source: string, label: string): string | undefined {
	try {
		const r = parseSource(source);
		if (r.errors.length === 0) return undefined;
		return `${label}: ${r.errors[0]!.message}`;
	} catch (err) {
		return `${label}: parser threw: ${err instanceof Error ? err.message : String(err)}`;
	}
}

async function cleanupItems(bridge: BridgeClient, names: string[]): Promise<void> {
	let safety = 10;
	while (safety-- > 0) {
		const refs = await bridge.getRefs();
		const remaining = names.filter((n) => refs.items[n] !== undefined);
		if (remaining.length === 0) return;
		// Track whether ANY deletion in this pass actually made
		// progress. If the bridge is in a degraded state (RPC dead,
		// returning `accepted: false` for everything), every delete
		// call silently "succeeds" but nothing changes — the safety
		// loop would otherwise hammer the bridge 10 times for no
		// effect. Bail out early when no progress detected.
		let madeProgress = false;
		for (const name of remaining) {
			const ifVersion = refs.items[name];
			if (ifVersion === undefined) continue;
			try {
				const res = await bridge.pushBatch({ ops: [{ op: "deleteItem", name, ifVersion }] });
				if (res.accepted === true) {
					madeProgress = true;
				} else {
					console.log(
						`    (cleanup) bridge rejected deleteItem ${name}` +
							(res.conflicts !== undefined && res.conflicts.length > 0
								? `: ${res.conflicts[0]?.reason ?? "unknown"}`
								: ""),
					);
				}
			} catch (err) {
				console.log(`    (cleanup) deleteItem ${name} failed: ${err instanceof Error ? err.message : err}`);
			}
		}
		if (!madeProgress) {
			console.log(`    (cleanup) no deletion succeeded this pass — bridge may be degraded; bailing out`);
			return;
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
