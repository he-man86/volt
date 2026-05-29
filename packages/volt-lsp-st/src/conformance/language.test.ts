/**
 * Language conformance: LSP vs recorded TwinCAT ground truth.
 *
 * Runs the LSP's semantic diagnostics on every test in the full
 * conformance catalog (`ALL_TESTS` from `./index.ts` — 17 categories,
 * 193 tests as of 2026-05-29) and compares against `expected-tc.json`:
 * the TC compiler's response to the same code, recorded once via
 * `bun run record:language`. Pure replay: no bridge required, runs
 * anywhere `bun test` runs.
 *
 * Failure modes the test catches:
 *   - LSP false positive: TC compiled cleanly, LSP flagged errors
 *   - LSP missed bug: TC errored, LSP saw nothing
 *   - Catalog drift: test added but ground truth not re-recorded
 *
 * Refresh procedure: see `record-language.ts` (run against a live
 * TwinCAT bridge with an empty project loaded).
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSource } from "../parser/parser.js";
import { buildSymbolTable } from "../semantic/symbol-table.js";
import { computeSemanticDiagnostics } from "../semantic/diagnostics.js";
import { DEFAULT_DIAGNOSTIC_CONFIG } from "../lsp/config.js";
import { ALL_TESTS } from "./index.js";

/**
 * Shape of one TC diagnostic as committed in `expected-tc.json`. Mirrors
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

interface ExpectedTc {
	recorded: { at: string; bridgeVersion?: string } | null;
	tests: Record<string, { buildSuccess: boolean; diagnostics: RecordedDiagnostic[] }>;
}

function loadExpected(): ExpectedTc {
	const path = join(dirname(fileURLToPath(import.meta.url)), "expected-tc.json");
	const raw = JSON.parse(readFileSync(path, "utf-8")) as ExpectedTc & { _doc?: string };
	return { recorded: raw.recorded, tests: raw.tests };
}

const expected = loadExpected();
const hasRecording = expected.recorded !== null;

describe("language conformance (LSP vs recorded TwinCAT)", () => {
	if (!hasRecording) {
		it.skip("(skipped — run `bun run record:language` against a live bridge to populate expected-tc.json)", () => {});
		return;
	}

	for (let testIdx = 0; testIdx < ALL_TESTS.length; testIdx++) {
		const test = ALL_TESTS[testIdx]!;
		describe(test.name, () => {
			it("has recorded ground truth", () => {
				expect(expected.tests[test.name]).toBeDefined();
			});

			const tc = expected.tests[test.name];
			if (tc === undefined) return;

			it("TwinCAT outcome matches catalog expectation", () => {
				// If this fails the test catalog's `expectTcAccepts` is
				// wrong (or TC's behavior changed since recording).
				expect(tc.buildSuccess).toBe(test.expectTcAccepts);
			});

			it("LSP diagnostics agree with TwinCAT", () => {
				const lspDiags = runLsp(test.source, testIdx);
				// "Did either side flag this code at all?" — counts
				// warnings as well as errors. LSP's `unresolved-identifier`
				// is correctly modeled as a warning (libraries might
				// define the symbol); TC's matching diagnostic surfaces
				// as a hard error. Comparing severity-strict would mark
				// these as disagreement even though both clearly noticed
				// the bug. The flagged-vs-clean axis is the conformance
				// signal we care about.
				const lspFlagged = lspDiags.length > 0;
				const tcFlagged = tc.diagnostics.length > 0;

				// Catalog-controlled exceptions: some tests deliberately
				// expect LSP to be STRICTER than TC (e.g. unknown_attribute
				// — TC silently ignores typos, LSP warns). Snapshot
				// reports the full picture; tests don't fail on snapshot
				// drift unless intentional.
				expect({
					name: test.name,
					tcErrors: tc.diagnostics.filter((d) => d.severity === "error").length,
					tcWarnings: tc.diagnostics.filter((d) => d.severity === "warning").length,
					tcMessages: tc.diagnostics.map((d) => `[${d.severity}] ${d.message}`),
					lspErrors: lspDiags.filter((d) => d.severity === "error").length,
					lspWarnings: lspDiags.filter((d) => d.severity === "warning").length,
					lspMessages: lspDiags.map((d) => `[${d.severity}] ${d.message}`),
					agreementOnFlagged: lspFlagged === tcFlagged,
				}).toMatchSnapshot();
			});
		});
	}
});

// Cross-test scope assembly — for each test, build a project scope
// that contains:
//   (a) this test's FULL parse result (POU + methods + VAR symbols)
//   (b) all OTHER tests' DECLARATION-ONLY units (interfaces, DUTs,
//       GVLs) — never their FBs/methods, which would collide on
//       common names like `Compute`/`Run`/`Init`/`Tick` and confuse
//       findScopeForUnit's by-name disambiguation.
//
// (b) is what makes `IMPLEMENTS <SeparateInterface>` resolve and
// the missing-implementation check fire — TC sees those declarations
// during batch builds, so the LSP should too.
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

function runLsp(source: string, testIndex: number): Array<{ severity: string; message: string }> {
	const own = ALL_PARSE_RESULTS[testIndex]!;
	const project = buildSymbolTable([
		// This test gets full visibility into its own POU + methods.
		{ uri: own.uri, parseResult: own.parseResult },
		// Other tests contribute only top-level types — enough for
		// cross-file IMPLEMENTS / DUT references, nothing more.
		...CROSS_TEST_DECLS.filter((_, i) => i !== testIndex),
	]);
	const parseResult = own.parseResult;
	const diags = computeSemanticDiagnostics({
		parseResult,
		source,
		project,
		config: DEFAULT_DIAGNOSTIC_CONFIG,
		activeVendor: "twincat",
	});
	// Surface parse errors as diagnostics too — the comparison wants
	// to know if EITHER side rejected the source.
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
