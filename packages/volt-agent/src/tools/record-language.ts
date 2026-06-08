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
import { parseSource } from "@opencode-ai/volt-lsp";
import { ALL_TESTS, CATEGORIES, type LanguageTest } from "@opencode-ai/volt-lsp/conformance";
import { BridgeClient } from "../bridge/client.js";
import type { BridgeDiagnostic, PushOp } from "../bridge/types.js";
import { findExistingFile } from "../cli/_shared.js";
import { pickExtension } from "../engine/extension-registry.js";

const BRIDGE_PORT = Number.parseInt(process.env.VOLT_BRIDGE_PORT ?? "8555", 10);
const LANG_PREFIX_RE = /^(FB|GVL|DUT|ITF)_LANG_/;

/**
 * Optional category filter for incremental recording. When set to a
 * comma-separated list of category names (e.g.
 * `VOLT_RECORD_CATEGORIES=fbd-element,ld-element`), the recorder:
 *
 *   - records ONLY the listed categories' tests
 *   - MERGES the new results into the existing `expected-*.json`,
 *     preserving recordings for categories NOT in the filter
 *   - drops stale entries: tests removed from a filtered category
 *     since the last full run are evicted, so the merged file stays
 *     in sync with the current catalog for the filtered set
 *
 * Unset = behave like a full run (record every category, overwrite
 * the JSON). The filter exists so fixture iteration on FBD/LD costs
 * seconds instead of minutes — the 200+ trusted ST recordings don't
 * have to be re-derived against TC every time we tweak a graphical
 * fixture.
 */
const CATEGORY_FILTER = parseCategoryFilter(process.env.VOLT_RECORD_CATEGORIES);

function parseCategoryFilter(raw: string | undefined): ReadonlySet<string> | undefined {
	if (raw === undefined) return undefined;
	const trimmed = raw.trim();
	if (trimmed.length === 0) return undefined;
	const names = trimmed.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
	if (names.length === 0) return undefined;
	const known = new Set(CATEGORIES.map((c) => c.name));
	const unknown = names.filter((n) => !known.has(n));
	if (unknown.length > 0) {
		console.error(
			`VOLT_RECORD_CATEGORIES contains unknown categor(ies): ${unknown.join(", ")}\n` +
				`known categories: ${[...known].join(", ")}`,
		);
		process.exit(1);
	}
	return new Set(names);
}
const THIS_DIR = dirname(fileURLToPath(import.meta.url));
// This script compiles to `packages/volt-agent/dist/tools/`; the CLI
// bin (the script that owns `volt init` / `volt push`) lives in the
// sibling `dist/cli/` directory.
const CLI_PATH = resolve(THIS_DIR, "..", "cli", "bin.js");
// The catalog + recorded ground truth live in volt-lsp-st's test tree
// (the LSP is what the recordings verify). From this file's compiled
// location at `packages/volt-agent/dist/tools/`, three `..` segments
// climb to `packages/`.
const RECORDINGS_DIR = resolve(
	THIS_DIR, "..", "..", "..", "volt-lsp-st", "src", "tests", "conformance", "recordings",
);

/** Map the bridge's `health.platform` to its output JSON file under
 *  `volt-lsp-st/src/conformance/recordings/`. Both vendors have their
 *  own ground truth file; `language.test.ts` replays each. Recording
 *  against the wrong file would silently overwrite the other
 *  vendor's data. */
function outputPathForPlatform(platform: string): string {
	switch (platform) {
		case "beckhoff":
			return resolve(RECORDINGS_DIR, "expected-tc.json");
		case "codesys":
			return resolve(RECORDINGS_DIR, "expected-codesys.json");
		default:
			throw new Error(
				`recorder doesn't know which output file to write for bridge platform '${platform}' — ` +
					"add a case to outputPathForPlatform()",
			);
	}
}

/** Workspace file extension for a test. Routes through the canonical
 *  extension registry — same path the engine uses on every pull.
 *  Conformance fixtures are all ST now (graphical fixtures moved to
 *  volt-agent's transpiler test inputs at `engine/__fixtures__/`), so
 *  source POU kinds always get the ST extension. The registry change
 *  that made body language MANDATORY for POU kinds (no silent fallback)
 *  means we have to pass it explicitly. */
function extensionFor(t: LanguageTest): string {
	const isSourcePou = t.kind === "function_block" || t.kind === "function" || t.kind === "program";
	return pickExtension(t.kind, isSourcePou ? "ST" : undefined);
}

interface RecordedEntry {
	buildSuccess: boolean;
	durationMs: number;
	diagnostics: BridgeDiagnostic[];
}

interface ExpectedTc {
	recorded: { at: string; bridgeVersion: string; testCount: number };
	tests: Record<string, RecordedEntry>;
}

/**
 * Write the vendor's `expected-*.json` from the current `recorded` map.
 * Called incrementally after each category completes so a downstream
 * category failure doesn't drop hours of upstream recordings on the
 * floor. Always overwrites — the file IS the snapshot of accumulated
 * progress.
 */
function writeExpected(
	recorded: Record<string, RecordedEntry>,
	bridgeVersion: string,
	outputPath: string,
): void {
	// Schema reference is relative to the output file's directory.
	const schemaName = outputPath.endsWith("expected-codesys.json")
		? "./expected-codesys.schema.json"
		: "./expected-tc.schema.json";
	const output: ExpectedTc & { $schema: string; _doc: string } = {
		$schema: schemaName,
		_doc:
			"Auto-generated by `bun run record:language`. " +
			"Do not edit by hand — re-record after editing the test catalog. " +
			"Written incrementally per-category so partial runs persist.",
		recorded: {
			at: new Date().toISOString(),
			bridgeVersion,
			testCount: Object.keys(recorded).length,
		},
		tests: recorded,
	};
	writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf-8");
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
	console.log(`  project: ${health.projectName}/${health.plcProjectName}`);
	const outputPath = outputPathForPlatform(health.platform);
	console.log(`  output: ${outputPath}\n`);

	// Sweep LANG_* leftovers.
	const refs = await bridge.getRefs();
	const leftovers = Object.keys(refs.items).filter((n) => LANG_PREFIX_RE.test(n));
	if (leftovers.length > 0) {
		console.log(`  (cleaning ${leftovers.length} LANG_* leftover(s) before recording)`);
		await cleanupItems(bridge, leftovers);
	}

	// ─── Apply category filter (incremental recording) ─────────────────
	// When VOLT_RECORD_CATEGORIES is set, restrict the run to those
	// categories' tests. Builds `categoryTestNames` (the set of tests
	// inside the filter) so the merge-write below knows which entries
	// in the existing JSON to refresh vs leave alone.
	const filteredCategories =
		CATEGORY_FILTER === undefined
			? CATEGORIES
			: CATEGORIES.filter((c) => CATEGORY_FILTER.has(c.name));
	const filterTestNames = new Set<string>();
	for (const c of filteredCategories) {
		for (const t of c.tests) filterTestNames.add(t.name);
	}
	const candidates =
		CATEGORY_FILTER === undefined
			? ALL_TESTS
			: ALL_TESTS.filter((t) => filterTestNames.has(t.name));

	if (CATEGORY_FILTER !== undefined) {
		console.log(
			`  category filter: ${[...CATEGORY_FILTER].join(", ")} ` +
				`(${candidates.length}/${ALL_TESTS.length} tests; ` +
				`other categories merged from existing recording)\n`,
		);
	}

	// ─── Filter tests by parseability + recorderSkip ───────────────────
	// Validate each test source AND its plcPrg snippet upfront. Any
	// test that can't be parsed by volt-lsp-st would crash the batch
	// push — better to log and exclude it.
	//
	// Also drop fixtures with `recorderSkip: true` — these are
	// LSP-only diagnostic exercises (dangling refs, duplicate localIds,
	// etc.) that produce IDE-corrupt POUs on import. Their TC/CODESYS
	// recordings are silent in a misleading way (the IDE never gets
	// far enough to emit a meaningful diagnostic), and LSP-side unit
	// tests under `semantic/checks/_fbd/check-*.test.ts` already cover
	// the relevant checks.
	const valid: LanguageTest[] = [];
	const skipped: Array<{ name: string; reason: string }> = [];
	for (const t of candidates) {
		if (t.recorderSkip === true) {
			skipped.push({ name: t.name, reason: "recorderSkip: LSP-only fixture" });
			continue;
		}
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

	// Seed `recorded` from the existing file when running a filtered
	// pass — otherwise the per-category incremental writes (and the
	// final write at end-of-run) would clobber the categories we
	// didn't run. Also drop stale entries for tests that USED to live
	// in a filtered category but no longer do (catalog edits between
	// runs), keeping the merged file in sync with the live catalog.
	const recorded: Record<string, RecordedEntry> = {};
	if (CATEGORY_FILTER !== undefined && existsSync(outputPath)) {
		try {
			const prev = JSON.parse(readFileSync(outputPath, "utf-8")) as Partial<ExpectedTc>;
			const prevTests = prev.tests ?? {};
			for (const [name, entry] of Object.entries(prevTests)) {
				// Keep entries from categories NOT in the filter; drop
				// any entry whose test would have been re-recorded
				// (filterTestNames) and any entry whose test name no
				// longer appears anywhere in the catalog at all (deleted).
				const allKnown = new Set(ALL_TESTS.map((t) => t.name));
				if (!filterTestNames.has(name) && allKnown.has(name)) {
					recorded[name] = entry;
				}
			}
			const preserved = Object.keys(recorded).length;
			console.log(`  merged ${preserved} unchanged test(s) from existing ${outputPath}\n`);
		} catch (err) {
			console.error(
				`failed to read existing recording at ${outputPath}: ${err instanceof Error ? err.message : err}\n` +
					`refusing to silently clobber: delete the file (full re-record) or fix the JSON, then retry.`,
			);
			process.exit(1);
		}
	}

	// ─── Isolated recordings: one push+build cycle per test ────────────
	for (const t of isolated) {
		const ext = extensionFor(t);
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
	const categoryFailures: Array<{ name: string; error: string }> = [];
	for (const category of filteredCategories) {
		const categoryBatch = category.tests.filter(
			(t) => t.recordIsolated !== true && validByName.has(t.name),
		);
		if (categoryBatch.length === 0) continue;

		console.log(`\n  ── ${category.name} (${categoryBatch.length} test(s)) ──`);
		try {
			await recordCategory(category.name, categoryBatch, bridge, workspace, plcPrgPath, recorded);
		} catch (err) {
			// Don't abort the whole run — one category's failure (e.g.
			// bridge-side unsupported feature, network blip, OOM) must
			// not drop the OTHER categories' recordings on the floor.
			// Log + persist what we have + continue.
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`  [${category.name}] FAILED — skipping rest of category: ${msg}`);
			categoryFailures.push({ name: category.name, error: msg });
		}
		// Persist incrementally so partial progress survives a downstream
		// crash, OS-level interrupt, or this Bash invocation's timeout.
		writeExpected(recorded, health.version, outputPath);
	}

	// ─── Teardown ──────────────────────────────────────────────────────
	console.log(`\n  teardown: removing test POUs + resetting PLC_PRG`);
	for (const t of valid) {
		try { rmSync(join(workspace, `${t.pouName}.${extensionFor(t)}`)); } catch { /* ignore */ }
	}
	writeFileSync(plcPrgPath, BARE_PLC_PRG, "utf-8");
	const resetRes = volt(workspace, "push", "--force", "--no-drift-check");
	if (resetRes.code !== 0) {
		console.log(`    (warn) teardown push exit ${resetRes.code}; falling back to direct bridge cleanup`);
		await cleanupItems(bridge, valid.map((t) => t.pouName));
	}
	try { rmSync(rootTmp, { recursive: true, force: true }); } catch { /* ignore */ }

	// ─── Final write + report ─────────────────────────────────────────
	// Incremental per-category writes already happened above; this final
	// call captures the post-teardown timestamp.
	writeExpected(recorded, health.version, outputPath);
	console.log(`\n  wrote ${outputPath}`);
	console.log(`  recorded ${Object.keys(recorded).length}/${ALL_TESTS.length} tests` +
		(skipped.length > 0 ? ` (${skipped.length} skipped at validation)` : ""));
	if (categoryFailures.length > 0) {
		console.log(`  ${categoryFailures.length} categor(ies) failed mid-run:`);
		for (const f of categoryFailures) console.log(`    - ${f.name}: ${f.error}`);
		process.exit(2);
	}
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
			try { rmSync(join(workspace, `${t.pouName}.${extensionFor(t)}`)); } catch { /* ignore */ }
		}
		writeFileSync(plcPrgPath, BARE_PLC_PRG, "utf-8");
		throw new Error(`category '${categoryName}' ${label}; aborting`);
	};

	// 1. Push test sources in sub-chunks of CHUNK_SIZE so each /push
	//    call stays bounded. The bare PLC_PRG already exists from pull
	//    or the prior category's reset, so it's not part of the chunk.
	//
	//    Chunk-batch is the fast path. When a chunk push fails (one
	//    fixture in the chunk has a problem the bridge rejects — XSD
	//    violation in graphical XML, malformed ST, etc.), we DON'T
	//    abort the whole category. Instead we walk that chunk one test
	//    at a time, recording each failure with its bridge error
	//    message and continuing past the bad ones. That keeps the
	//    speed for healthy ST runs and gives granular per-fixture
	//    reporting when iterating on FBD/LD where breakage is common.
	//
	//    `liveTests` = the subset of `tests` that actually reached the
	//    bridge. `pushFailures` = name → bridge error for the ones
	//    that didn't. Both are folded into `recorded` after the build.
	const liveTests: LanguageTest[] = [];
	const pushFailures = new Map<string, string>();

	const chunkCount = Math.ceil(tests.length / CHUNK_SIZE);
	for (let i = 0; i < tests.length; i += CHUNK_SIZE) {
		const chunk = tests.slice(i, i + CHUNK_SIZE);
		for (const t of chunk) {
			writeFileSync(join(workspace, `${t.pouName}.${extensionFor(t)}`), t.source, "utf-8");
		}
		if (chunkCount > 1) {
			console.log(`    pushing sub-chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${chunkCount} (${chunk.length} POU(s))…`);
		}
		const pushRes = volt(workspace, "push", "--force", "--no-drift-check");
		if (pushRes.code === 0) {
			// Fast path — every test in this chunk reached the bridge.
			liveTests.push(...chunk);
			continue;
		}

		// Chunk rejected. The bridge didn't accept ANY of the items
		// (push is atomic), so all the chunk files we just wrote are
		// orphaned on disk. Wipe them, then re-add one at a time so a
		// single failing fixture only fails its own per-test push.
		const chunkLabel = `chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${chunkCount}`;
		console.log(
			`    ${chunkLabel} rejected — re-trying per-test to isolate the bad fixture(s)`,
		);
		for (const t of chunk) {
			try { rmSync(join(workspace, `${t.pouName}.${extensionFor(t)}`)); } catch { /* ignore */ }
		}
		for (const t of chunk) {
			writeFileSync(join(workspace, `${t.pouName}.${extensionFor(t)}`), t.source, "utf-8");
			const r = volt(workspace, "push", "--force", "--no-drift-check");
			if (r.code === 0) {
				liveTests.push(t);
				continue;
			}
			const errMsg = (r.stderr || r.stdout).trim();
			pushFailures.set(t.name, errMsg);
			try { rmSync(join(workspace, `${t.pouName}.${extensionFor(t)}`)); } catch { /* ignore */ }
			const summary = errMsg.length > 100 ? `${errMsg.slice(0, 100)}…` : errMsg;
			console.log(`    ✗ ${t.name.padEnd(40)} push rejected: ${summary}`);
		}
	}

	// 2. Final push: mega PLC_PRG that instantiates this category's
	//    LIVE tests. Skipping pushFailures keeps the program tree
	//    referentially consistent — instantiating an FB the bridge
	//    never accepted would itself fail the build with a misleading
	//    "unknown type" error masking the real fixture problem.
	writeFileSync(plcPrgPath, buildMegaPlcPrg(liveTests), "utf-8");
	const plcPushRes = volt(workspace, "push", "--force", "--no-drift-check");
	if (plcPushRes.code !== 0) {
		await fail("PLC_PRG push failed", plcPushRes.stderr.trim() || plcPushRes.stdout.trim());
	}

	// 3. Build + extract per-test diagnostics for tests that reached
	//    the bridge. Tests in pushFailures get synthetic entries below
	//    so they appear in the same `recorded` shape downstream.
	const buildRes = await bridge.build({ buildType: "full" });
	for (const t of liveTests) {
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

	// 3b. Safety net: any error/warning the build emitted that attributed
	//     to NO test in this category. Silent drops here are EXACTLY how
	//     CODESYS's `Application.`-prefixed objects got recorded as
	//     "silent" — seeding false TC-only divergences. Surface them loudly
	//     so object-naming drift can't quietly corrupt the recordings again.
	const liveNames = new Set(liveTests.map((t) => t.pouName));
	const unattributed = buildRes.diagnostics.filter((d) => {
		if (d.severity === "info" || d.object === null) return false;
		const pou = d.object.split(".")[0]!;
		if (pou === "PLC_PRG") return false; // the harness's instantiation program
		return !liveNames.has(pou);
	});
	if (unattributed.length > 0) {
		console.warn(
			`    ⚠ [${categoryName}] ${unattributed.length} build diagnostic(s) attributed to NO test ` +
				`(object-naming drift? these were NOT recorded):`,
		);
		for (const d of unattributed.slice(0, 8)) {
			console.warn(`        [${d.severity}] object=${d.object} :: ${d.message}`);
		}
	}

	// 4. Record push-rejected fixtures with the bridge's exact error
	//    text as a synthetic diagnostic. Downstream `language.test.ts`
	//    treats `buildSuccess: false` uniformly — the LSP is expected
	//    to also flag (or accept that the LSP can't replicate XSD
	//    validation, in which case the divergence shows in snapshots).
	for (const [name, msg] of pushFailures) {
		recorded[name] = {
			buildSuccess: false,
			durationMs: 0,
			diagnostics: [
				{
					severity: "error",
					message: `bridge rejected POU push: ${msg}`,
					object: name,
					section: null,
					line: 0,
				},
			],
		};
	}

	// 5. Cleanup: delete this category's test files locally, restore
	//    bare PLC_PRG, push to apply on the bridge. Direct bridge
	//    cleanup is a fallback in case the workspace-side push errors.
	//    Only liveTests landed on the bridge, but rm-ing pushFailures
	//    files is a no-op (already removed in step 1), so iterating
	//    the full `tests` list is fine and keeps the comment local.
	for (const t of tests) {
		try { rmSync(join(workspace, `${t.pouName}.${extensionFor(t)}`)); } catch { /* ignore */ }
	}
	writeFileSync(plcPrgPath, BARE_PLC_PRG, "utf-8");
	const cleanupRes = volt(workspace, "push", "--force", "--no-drift-check");
	if (cleanupRes.code !== 0) {
		console.log(`    (warn) [${categoryName}] cleanup push failed; falling back to direct bridge delete`);
		await cleanupItems(bridge, liveTests.map((t) => t.pouName));
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
