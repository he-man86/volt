/**
 * Language conformance: LSP vs recorded IDE ground truth.
 *
 * Runs the LSP's semantic diagnostics on every test in the full
 * conformance catalog (`ALL_TESTS` from `./index.ts`) and compares
 * against PER-VENDOR recordings:
 *
 *   - `expected-tc.json`      — TwinCAT compiler ground truth
 *   - `expected-codesys.json` — CODESYS compiler ground truth
 *
 * Both populated by `bun run record:language` against the matching
 * bridge (`VOLT_BRIDGE_PORT=8555` for TC, `=8556` for CODESYS). The
 * replay test runs pure — no live bridge required.
 *
 * The test runs the corpus TWICE — once per vendor — feeding the
 * LSP its vendor-filtered config (via `resolveConfig`, the same
 * code path production uses). A regression in either vendor's
 * agreement count fails the suite.
 *
 * Failure modes:
 *   - LSP false positive: IDE compiled cleanly, LSP flagged errors
 *   - LSP missed bug:    IDE errored, LSP saw nothing
 *   - Catalog drift:     test added but ground truth not re-recorded
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSource } from "../../declarations/parser.js";
import { buildSymbolTable } from "../../semantic/symbol-table.js";
import { computeSemanticDiagnostics } from "../../semantic/diagnostics.js";
import { buildBodyModelsForParseResult } from "../../body/index.js";
import { resolveConfig, type Vendor } from "../../lsp/config.js";
import { ALL_TESTS } from "../fixtures/index.js";

/**
 * Shape of one IDE diagnostic as committed in `expected-*.json`. Mirrors
 * the bridge wire shape (`BridgeDiagnostic` in volt-agent) — kept local
 * here because the replay test only READS the recorded JSON and never
 * talks to a live bridge. Keeping it local avoids a reverse-direction
 * dependency from volt-lsp-st back into volt-agent.
 */
interface RecordedDiagnostic {
	severity: "error" | "warning" | "info";
	message: string;
	line: number;
	object: string | null;
	section: "decl" | "impl" | null;
}

interface ExpectedRecording {
	recorded: { at: string; bridgeVersion?: string } | null;
	tests: Record<string, { buildSuccess: boolean; diagnostics: RecordedDiagnostic[] }>;
}

function loadExpected(filename: string): ExpectedRecording {
	// Recordings live under `conformance/recordings/`. This test file is
	// at `conformance/tests/`, so step up one and into `recordings/`.
	const path = join(dirname(fileURLToPath(import.meta.url)), "..", "recordings", filename);
	const raw = JSON.parse(readFileSync(path, "utf-8")) as ExpectedRecording & {
		_doc?: string;
	};
	return { recorded: raw.recorded, tests: raw.tests };
}

const RECORDINGS: ReadonlyArray<{ vendor: Vendor; filename: string }> = [
	{ vendor: "twincat", filename: "expected-tc.json" },
	{ vendor: "codesys", filename: "expected-codesys.json" },
];

/**
 * Tests where the LSP and the IDE legitimately disagree on whether
 * to flag the code. The disagreement is real but acceptable — adding
 * an LSP rule to close each gap would require functionality outside
 * the LSP's static-analysis scope. Each entry documents WHY.
 *
 * The hard `lspFlagged === ideFlagged` assertion is skipped for these
 * tests; the diagnostic-detail snapshot still records what each side
 * emits so regressions surface as snapshot diffs.
 *
 * Add an entry only with a documented reason. Remove an entry when
 * the LSP grows the capability to close that gap.
 */
const KNOWN_DIVERGENCES: Record<Vendor, ReadonlySet<string>> = {
	twincat: new Set<string>(),
	codesys: new Set<string>([
		// CODESYS-specific warnings not surfaced by TC. The LSP defaults
		// to TC-grade rules; matching every CODESYS heuristic warning
		// would mean importing CODESYS's analyzer ruleset (out of scope).
		"fb_reinit_with_params",
		"implicit_parameter_pouname",
		// Both IDEs reject these via parse error. Our parser is more
		// lenient on `__`-prefixed system calls — closing this would
		// mean tightening the parser, risking false positives on
		// legitimate uses elsewhere.
		"op_sys_currenttask",
		"op_sys_queryinterface",
		"op_sys_varinfo",
		// CODESYS rejects with a runtime-config diagnostic ("No memory
		// for dynamic object creation defined"). Not a language-level
		// check the LSP can perform — it's about application device
		// configuration, which isn't in the source code.
		"op_sys_new_delete",
		// CODESYS accepts `dword%W1` bit-access syntax; TC parses but
		// rejects. Our parser matches TC. Aligning with CS would mean
		// teaching the parser the CODESYS extension.
		"operand_partial_word_in_dword",
	]),
};

// Cross-test scope assembly — for each test, build a project scope that
// contains the test's full parse result + every OTHER test's declaration-
// only units (interfaces, DUTs, GVLs). Lets `IMPLEMENTS <X>` resolve
// across test files without leaking FBs/methods that would collide on
// common names. Computed ONCE, reused across both vendor runs.
const ALL_PARSE_RESULTS = ALL_TESTS.map((t) => ({
	uri: `file:///conformance/${t.name}.st` as const,
	parseResult: parseSource(t.source),
}));

const CROSS_TEST_DECLS = ALL_PARSE_RESULTS.map((p) => ({
	uri: p.uri,
	parseResult: {
		units: p.parseResult.units.filter(
			(u) => u.kind === "interface" || u.kind === "type_decl" || u.kind === "global_var_list",
		),
		errors: [],
	},
}));

function runLsp(
	source: string,
	testIndex: number,
	vendor: Vendor,
): Array<{ severity: string; message: string }> {
	const own = ALL_PARSE_RESULTS[testIndex]!;
	const project = buildSymbolTable([
		{ uri: own.uri, parseResult: own.parseResult },
		...CROSS_TEST_DECLS.filter((_, i) => i !== testIndex),
	]);
	const parseResult = own.parseResult;
	// Run through the same config-resolution code path production uses,
	// so the rule-vendor-applicability filter is applied identically.
	const resolved = resolveConfig({ vendor });
	const diags = computeSemanticDiagnostics({
		parseResult,
		source,
		project,
		config: resolved.diagnostics,
		activeVendor: resolved.vendor,
		languageId: "structured-text",
		bodyModels: buildBodyModelsForParseResult("structured-text", source, parseResult),
	});
	// Surface parse errors as diagnostics too — comparison wants to know
	// if EITHER side rejected the source.
	for (const e of parseResult.errors) {
		diags.push({
			severity: "error",
			span: e.span,
			source: "volt-lsp-st-parse",
			code: "parse-error",
			message: e.message,
		});
	}
	return diags.map((d) => ({ severity: d.severity, message: d.message }));
}

for (const { vendor, filename } of RECORDINGS) {
	const expected = loadExpected(filename);
	const hasRecording = expected.recorded !== null;

	describe(`language conformance (LSP vs ${vendor} recording)`, () => {
		if (!hasRecording) {
			it.skip(`(skipped — run \`VOLT_BRIDGE_PORT=${vendor === "twincat" ? "8555" : "8556"} bun run record:language\` to populate ${filename})`, () => {});
			return;
		}

		for (let testIdx = 0; testIdx < ALL_TESTS.length; testIdx++) {
			const test = ALL_TESTS[testIdx]!;
			describe(test.name, () => {
				const recorded = expected.tests[test.name];
				if (recorded === undefined) {
					// Catalog has the test but the bridge recording is
					// stale. Skip gracefully — `bun run record:language`
					// against the matching bridge re-populates entries
					// and flips the skip back to hard assertions.
					it.skip(
						`(no recording in ${filename}; re-record to enable hard checks)`,
						() => {},
					);
					return;
				}

				it("has recorded ground truth", () => {
					expect(expected.tests[test.name]).toBeDefined();
				});

				it(`${vendor} outcome matches catalog expectation`, () => {
					// `expectTcAccepts` is the TC ground truth declared by
					// the catalog author. We use it as the cross-vendor
					// "expected to compile" signal — both vendors should
					// agree on it for tests we expect to be vendor-neutral.
					// Per-vendor divergences are captured in the snapshot.
					if (vendor === "twincat") {
						expect(recorded.buildSuccess).toBe(test.expectTcAccepts);
					}
				});

				it(`LSP diagnostics agree with ${vendor}`, () => {
					const lspDiags = runLsp(test.source, testIdx, vendor);
					const lspFlagged = lspDiags.length > 0;
					const recordedFlagged = recorded.diagnostics.length > 0;

					// HARD assertion: did the LSP flag the same code the IDE
					// flagged? Skipped for documented divergences. Snapshot
					// below captures diagnostic detail for regression diffs.
					const isKnownDivergent = KNOWN_DIVERGENCES[vendor].has(test.name);
					if (!isKnownDivergent) {
						expect({
							lspFlagged,
							ideFlagged: recordedFlagged,
						}).toEqual({
							lspFlagged: recordedFlagged,
							ideFlagged: recordedFlagged,
						});
					}

					expect({
						name: test.name,
						vendor,
						knownDivergent: isKnownDivergent,
						ideErrors: recorded.diagnostics.filter((d) => d.severity === "error").length,
						ideWarnings: recorded.diagnostics.filter((d) => d.severity === "warning").length,
						ideMessages: recorded.diagnostics.map((d) => `[${d.severity}] ${d.message}`),
						lspErrors: lspDiags.filter((d) => d.severity === "error").length,
						lspWarnings: lspDiags.filter((d) => d.severity === "warning").length,
						lspMessages: lspDiags.map((d) => `[${d.severity}] ${d.message}`),
					}).toMatchSnapshot();
				});
			});
		}
	});
}
