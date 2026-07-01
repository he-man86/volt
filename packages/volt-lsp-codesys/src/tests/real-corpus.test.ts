/**
 * Real-project LSP coverage — a RATCHET test against a committed materialized corpus (a full-option
 * CODESYS project, `test-corpus/pro2193/`). Asserts coverage never regresses; as parser/precision
 * gaps are fixed, tighten the thresholds toward the goal (100% parse, 0 diagnostics). The corpus is
 * the ground truth: it compiles clean in the IDE, so every LSP diagnostic on it is a false-positive.
 *
 * Run: `bun test src/tests/real-corpus.test.ts` — also prints the current coverage numbers.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { computeCoverage } from "../../scripts/coverage-report.js";

const CORPUS = join(import.meta.dir, "..", "..", "test-corpus", "pro2193");

// ── Baseline (2026-07-01, kind-based-file-extensions). Tighten as gaps are fixed; never loosen. ──
const BASE = {
	files: 424, // corpus size — must not shrink (files went missing)
	parseCleanFiles: 239, // 56.4% — floor; raise as parser gaps close
	ingestFiles: 418, // 98.6% — floor
	totalDiags: 9285, // ceiling — every diagnostic on the clean project is a false-positive suspect
};

describe("real-project coverage (pro2193)", () => {
	const cov = computeCoverage(CORPUS, "codesys");

	test("report", () => {
		const pct = (n: number, d: number) => ((100 * n) / d).toFixed(1) + "%";
		console.log(
			`\n  corpus ${cov.files} files / ${cov.units} units` +
				`\n  parse   ${cov.parseCleanFiles}/${cov.files} clean (${pct(cov.parseCleanFiles, cov.files)}) — ${cov.parseErrors} errors` +
				`\n  ingest  ${cov.ingestFiles}/${cov.files} (${pct(cov.ingestFiles, cov.files)})` +
				`\n  precision ${cov.totalDiags} diagnostics (target 0): ${JSON.stringify(cov.byCode)}`,
		);
		expect(cov.files).toBeGreaterThanOrEqual(BASE.files);
	});

	test("parse coverage does not regress", () => {
		expect(cov.parseCleanFiles).toBeGreaterThanOrEqual(BASE.parseCleanFiles);
	});

	test("ingest coverage does not regress", () => {
		expect(cov.ingestFiles).toBeGreaterThanOrEqual(BASE.ingestFiles);
	});

	test("precision does not regress (no new false positives)", () => {
		expect(cov.totalDiags).toBeLessThanOrEqual(BASE.totalDiags);
	});
});
