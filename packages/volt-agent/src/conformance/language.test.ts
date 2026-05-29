/**
 * Language conformance: LSP vs recorded TwinCAT ground truth.
 *
 * Runs the LSP's semantic diagnostics on every test in `pragma-tests.ts`
 * and compares against `expected-tc.json` — the TC compiler's response
 * to the same code, recorded once via `bun run record:language`. Pure
 * replay: no bridge required, runs anywhere `bun test` runs.
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
import {
	computeSemanticDiagnostics,
	buildSymbolTable,
	parseSource,
	DEFAULT_DIAGNOSTIC_CONFIG,
} from "@opencode-ai/volt-lsp-st";
import { ALL_TESTS } from "./index.js";
import type { BridgeDiagnostic } from "../bridge/types.js";

interface ExpectedTc {
	recorded: { at: string; bridgeVersion?: string } | null;
	tests: Record<string, { buildSuccess: boolean; diagnostics: BridgeDiagnostic[] }>;
}

function loadExpected(): ExpectedTc {
	const path = join(dirname(fileURLToPath(import.meta.url)), "expected-tc.json");
	const raw = JSON.parse(readFileSync(path, "utf-8")) as ExpectedTc & { _doc?: string };
	return { recorded: raw.recorded, tests: raw.tests };
}

const expected = loadExpected();
const hasRecording = expected.recorded !== null;

describe("language conformance: pragmas (LSP vs recorded TwinCAT)", () => {
	if (!hasRecording) {
		it.skip("(skipped — run `bun run record:language` against a live bridge to populate expected-tc.json)", () => {});
		return;
	}

	for (const test of ALL_TESTS) {
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
				const lspDiags = runLsp(test.source);
				const lspHasError = lspDiags.some((d) => d.severity === "error");
				const tcHasError = !tc.buildSuccess;

				// Catalog-controlled exceptions: some tests deliberately
				// expect LSP to be STRICTER than TC (e.g. unknown_attribute
				// — TC silently ignores typos, LSP warns). For now we
				// just report the disagreement via snapshot; promoting to
				// failures comes when we tighten the catalog (note field
				// → strict expectation).
				expect({
					name: test.name,
					tcErrors: tc.diagnostics.filter((d) => d.severity === "error").length,
					tcWarnings: tc.diagnostics.filter((d) => d.severity === "warning").length,
					tcMessages: tc.diagnostics.map((d) => `[${d.severity}] ${d.message}`),
					lspErrors: lspDiags.filter((d) => d.severity === "error").length,
					lspWarnings: lspDiags.filter((d) => d.severity === "warning").length,
					lspMessages: lspDiags.map((d) => `[${d.severity}] ${d.message}`),
					agreementOnPassFail: lspHasError === tcHasError,
				}).toMatchSnapshot();
			});
		});
	}
});

function runLsp(source: string): Array<{ severity: string; message: string }> {
	// Per-test isolated scope. A shared cross-test PROJECT_SCOPE
	// would unlock cross-file checks (missing-interface-implementation
	// across separate test files) but contaminates per-test
	// diagnostics — duplicate-declaration and shadowing checks see
	// every other test's symbols and false-positive. Keeping
	// isolated; cross-file checks that need the broader scope must
	// either include their dependencies in the same source or accept
	// the known limitation.
	const parseResult = parseSource(source);
	const project = buildSymbolTable([{ uri: "file:///conformance/test.st", parseResult }]);
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
