/**
 * Coverage scan — runs the transpiler against every fixture in
 * `__fixtures__/` and reports pass/fail counts.
 *
 * Each fixture's TC-accepted bodies are EXPECTED to transpile cleanly.
 * Negative fixtures (expectTcAccepts: false — dangling refs, duplicate
 * localIds, etc.) are EXPECTED to fail.
 *
 * This file isn't a snapshot test — it's a coverage report. Failures
 * here aren't regressions; they're the worklist for extending the
 * transpiler. Output is logged so you can see exactly which patterns
 * still need handling.
 */
import { describe, test } from "bun:test";
import { FBD_ELEMENT_TESTS } from "./__fixtures__/fbd-bodies.js";
import { LD_ELEMENT_TESTS } from "./__fixtures__/ld-bodies.js";
import { transpileGraphicalBodyToST } from "./transpile-graphical-to-st.js";

function bodyOf(fileSource: string): string | undefined {
	const m = fileSource.match(/<body[\s\S]*<\/body>/);
	return m === null ? undefined : m[0];
}

describe("transpiler coverage report", () => {
	test("scan all fixtures", () => {
		const allFixtures = [
			...FBD_ELEMENT_TESTS.map((t) => ({ ...t, lang: "FBD" as const })),
			...LD_ELEMENT_TESTS.map((t) => ({ ...t, lang: "LD" as const })),
		];
		const okPositive: string[] = [];
		const failPositive: Array<{ name: string; reason: string }> = [];
		const okNegative: string[] = []; // negative fixtures that correctly fail
		const wrongNegative: Array<{ name: string; reason: string }> = []; // negative fixtures that incorrectly succeed
		const noBody: string[] = [];

		for (const fx of allFixtures) {
			const body = bodyOf(fx.source);
			if (body === undefined) {
				noBody.push(fx.name);
				continue;
			}
			const result = transpileGraphicalBodyToST(body);
			if (fx.expectTcAccepts) {
				if (result.ok) {
					okPositive.push(fx.name);
				} else {
					failPositive.push({ name: fx.name, reason: result.reason });
				}
			} else {
				if (result.ok) {
					wrongNegative.push({ name: fx.name, reason: "negative fixture transpiled OK (should have failed)" });
				} else {
					okNegative.push(fx.name);
				}
			}
		}

		const total = allFixtures.length;
		const positives = allFixtures.filter((f) => f.expectTcAccepts).length;
		const negatives = total - positives;
		const positiveCoverage = positives > 0 ? Math.round((okPositive.length / positives) * 100) : 0;

		console.log("\n=== Transpiler coverage ===");
		console.log(`Total fixtures: ${total} (positive: ${positives}, negative: ${negatives})`);
		console.log(`Positive fixtures transpiled OK: ${okPositive.length}/${positives} (${positiveCoverage}%)`);
		console.log(`Negative fixtures correctly failed: ${okNegative.length}/${negatives}`);
		if (noBody.length > 0) console.log(`Fixtures with no <body>: ${noBody.length}`);
		if (failPositive.length > 0) {
			console.log(`\nPositive fixtures that FAILED transpilation (${failPositive.length}):`);
			for (const f of failPositive) console.log(`  - ${f.name}: ${f.reason}`);
		}
		if (wrongNegative.length > 0) {
			console.log(`\nNegative fixtures that did NOT fail (${wrongNegative.length}):`);
			for (const w of wrongNegative) console.log(`  - ${w.name}: ${w.reason}`);
		}
		console.log("===========================\n");
	});
});
