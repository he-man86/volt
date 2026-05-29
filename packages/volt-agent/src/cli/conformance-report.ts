#!/usr/bin/env node
/**
 * `bun run conformance:report` — print a summary of the language-
 * conformance harness state. Reads the catalog + recorded ground
 * truth + computes the LSP-vs-TC matrix; doesn't need a live bridge.
 *
 * Output: a per-category table + aggregate counts. Use after every
 * recording to confirm where the LSP-vs-TC delta lives.
 *
 * Example:
 *
 *   bun run conformance:report
 *
 *   = Language conformance summary =
 *   Recorded: 2026-05-28T21:00:00Z, bridge 4.9.2, 69 tests
 *
 *   pragma         28 ✓   2 ⚠ LSP-only   0 ✗ TC-only   0 ⚠ disagree
 *   lifecycle       4 ✓   4 ⚠ LSP-only   0 ✗ TC-only   0 ⚠ disagree
 *   ...
 *   ------------------------------------------------------------------
 *   total          50 ✓  11 ⚠ LSP-only   4 ✗ TC-only   4 ⚠ disagree
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	computeSemanticDiagnostics,
	buildSymbolTable,
	parseSource,
	DEFAULT_DIAGNOSTIC_CONFIG,
} from "@opencode-ai/volt-lsp-st";
import { PRAGMA_TESTS } from "../conformance/pragma-tests.js";
import { LIFECYCLE_TESTS } from "../conformance/lifecycle-tests.js";
import { IDENTIFIER_TESTS } from "../conformance/identifier-tests.js";
import { INIT_SLOT_TESTS } from "../conformance/init-slot-tests.js";
import { SHADOWING_TESTS } from "../conformance/shadowing-tests.js";
import { CONVERSION_TESTS } from "../conformance/conversion-tests.js";
import { SEMANTIC_TESTS } from "../conformance/semantic-tests.js";
import { CONDITIONAL_PRAGMA_TESTS } from "../conformance/conditional-pragma-tests.js";
import { OPERATOR_TESTS } from "../conformance/operator-tests.js";
import type { LanguageTest } from "../conformance/index.js";
import type { BridgeDiagnostic } from "../bridge/types.js";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const EXPECTED_PATH = join(THIS_DIR, "..", "..", "src", "conformance", "expected-tc.json");

interface ExpectedTc {
	recorded: { at: string; bridgeVersion: string; testCount: number } | null;
	tests: Record<string, { buildSuccess: boolean; diagnostics: BridgeDiagnostic[] }>;
}

interface CategoryGroup {
	name: string;
	tests: readonly LanguageTest[];
}

const CATEGORIES: CategoryGroup[] = [
	{ name: "pragma", tests: PRAGMA_TESTS },
	{ name: "lifecycle", tests: LIFECYCLE_TESTS },
	{ name: "identifier", tests: IDENTIFIER_TESTS },
	{ name: "init-slot", tests: INIT_SLOT_TESTS },
	{ name: "shadowing", tests: SHADOWING_TESTS },
	{ name: "conversion", tests: CONVERSION_TESTS },
	{ name: "semantic", tests: SEMANTIC_TESTS },
	{ name: "conditional-pragma", tests: CONDITIONAL_PRAGMA_TESTS },
	{ name: "operator", tests: OPERATOR_TESTS },
];

function runLsp(source: string): Array<{ severity: string }> {
	const parseResult = parseSource(source);
	const project = buildSymbolTable([{ uri: "file:///report/test.st", parseResult }]);
	const diags = computeSemanticDiagnostics({
		parseResult,
		source,
		project,
		config: DEFAULT_DIAGNOSTIC_CONFIG,
		activeVendor: "twincat",
	});
	for (const e of parseResult.errors) diags.push({ severity: "error" } as never);
	return diags.map((d) => ({ severity: d.severity }));
}

function classify(test: LanguageTest, expected: ExpectedTc | undefined): "agree" | "lsp-only" | "tc-only" | "disagree" | "no-recording" {
	const rec = expected?.tests[test.name];
	if (rec === undefined) return "no-recording";
	const lspDiags = runLsp(test.source);
	const tcErrCount = rec.diagnostics.filter((d) => d.severity === "error").length;
	const tcWarnCount = rec.diagnostics.filter((d) => d.severity === "warning").length;
	const lspErrCount = lspDiags.filter((d) => d.severity === "error").length;
	const lspWarnCount = lspDiags.filter((d) => d.severity === "warning").length;
	const tcAny = tcErrCount + tcWarnCount > 0;
	const lspAny = lspErrCount + lspWarnCount > 0;
	if (!tcAny && !lspAny) return "agree";
	if (lspAny && !tcAny) return "lsp-only";
	if (tcAny && !lspAny) return "tc-only";
	// Both side fires — count as agree if both indicate error xor both indicate clean
	const lspError = lspErrCount > 0;
	const tcError = tcErrCount > 0;
	return lspError === tcError ? "agree" : "disagree";
}

function main(): void {
	let expected: ExpectedTc | undefined;
	try {
		expected = JSON.parse(readFileSync(EXPECTED_PATH, "utf-8")) as ExpectedTc;
	} catch {
		console.error(`could not read ${EXPECTED_PATH}`);
		process.exit(1);
	}

	console.log("\n= Language conformance summary =\n");
	if (expected?.recorded === null || expected?.recorded === undefined) {
		console.log("(no recording yet — run `bun run record:language` against a live bridge)\n");
	} else {
		console.log(`Recorded: ${expected.recorded.at} | bridge ${expected.recorded.bridgeVersion} | ${expected.recorded.testCount} tests\n`);
	}

	let totalAgree = 0, totalLspOnly = 0, totalTcOnly = 0, totalDisagree = 0, totalNoRec = 0;

	for (const cat of CATEGORIES) {
		let agree = 0, lspOnly = 0, tcOnly = 0, disagree = 0, noRec = 0;
		for (const test of cat.tests) {
			const c = classify(test, expected);
			if (c === "agree") agree++;
			else if (c === "lsp-only") lspOnly++;
			else if (c === "tc-only") tcOnly++;
			else if (c === "disagree") disagree++;
			else if (c === "no-recording") noRec++;
		}
		totalAgree += agree;
		totalLspOnly += lspOnly;
		totalTcOnly += tcOnly;
		totalDisagree += disagree;
		totalNoRec += noRec;
		const label = cat.name.padEnd(20);
		console.log(
			`  ${label}  ${pad(agree, 3)} ✓ agree   ${pad(lspOnly, 3)} ⚠ LSP-only   ${pad(tcOnly, 3)} ✗ TC-only   ${pad(disagree, 3)} ⚠ disagree   ${pad(noRec, 3)} ? unrecorded`,
		);
	}

	const total = totalAgree + totalLspOnly + totalTcOnly + totalDisagree + totalNoRec;
	console.log("  " + "─".repeat(110));
	console.log(
		`  ${"total".padEnd(20)}  ${pad(totalAgree, 3)} ✓ agree   ${pad(totalLspOnly, 3)} ⚠ LSP-only   ${pad(totalTcOnly, 3)} ✗ TC-only   ${pad(totalDisagree, 3)} ⚠ disagree   ${pad(totalNoRec, 3)} ? unrecorded  (${total} tests)`,
	);

	console.log("");
	console.log("Categories:");
	console.log("  ✓ agree      — LSP and TC report the same outcome (both clean or both flag)");
	console.log("  ⚠ LSP-only   — LSP flags something, TC silent (often designed value-add)");
	console.log("  ✗ TC-only    — TC flags something, LSP silent (real gap or batch-fidelity loss)");
	console.log("  ⚠ disagree   — both flag but differ on severity (pass/fail mismatch)");
	console.log("  ? unrecorded — test in catalog but no TC ground truth yet");
	console.log("");
}

function pad(n: number, w: number): string {
	return String(n).padStart(w);
}

main();
