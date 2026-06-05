/**
 * Lock-in test: `buildBodyModel` output equals `scanAllIdentifiersInBody`
 * over a corpus of representative ST POU bodies.
 *
 * The body module is a thin adapter wrapping the identifier scan; if
 * the two ever diverge, every body-dependent LSP feature (references,
 * highlight, completion, call-hierarchy, unresolved-identifier) would
 * shift output. This test catches that regression at the seam.
 */
import { describe, expect, test } from "bun:test";
import { parseSource } from "../../parser/parser.js";
import { scanAllIdentifiersInBody } from "../../semantic/identifier-scan.js";
import { buildBodyModel } from "../../semantic/body.js";

interface Fixture {
	name: string;
	source: string;
}

const FIXTURES: Fixture[] = [
	{
		name: "straight identifiers + assignment",
		source: `FUNCTION_BLOCK FB
VAR a : INT; b : INT; END_VAR
a := b + 1;
END_FUNCTION_BLOCK
`,
	},
	{
		name: "call site (`(` after name)",
		source: `FUNCTION_BLOCK FB
VAR t : TON; END_VAR
t(IN := TRUE, PT := T#100ms);
END_FUNCTION_BLOCK
`,
	},
	{
		name: "member access (`x.y`)",
		source: `FUNCTION_BLOCK FB
VAR t : TON; out : BOOL; END_VAR
out := t.Q;
END_FUNCTION_BLOCK
`,
	},
	{
		name: "block comments are skipped as trivia",
		source: `FUNCTION_BLOCK FB
VAR a : INT; END_VAR
(* comment with a in it *) a := 1;
END_FUNCTION_BLOCK
`,
	},
];

describe("buildBodyModel", () => {
	for (const fx of FIXTURES) {
		test(fx.name, () => {
			const parsed = parseSource(fx.source);
			const unit = parsed.units[0];
			if (
				unit === undefined ||
				!("body" in unit) ||
				unit.body === undefined
			) {
				throw new Error(`fixture "${fx.name}" produced no body`);
			}
			const expected = scanAllIdentifiersInBody(unit.body);
			const model = buildBodyModel(unit.body);

			expect(model.identifiers.length).toBe(expected.length);
			for (let i = 0; i < expected.length; i++) {
				const e = expected[i]!;
				const m = model.identifiers[i]!;
				expect(m.name).toBe(e.token.text);
				expect(m.span.start).toBe(e.span.start);
				expect(m.span.end).toBe(e.span.end);
				expect(m.isCall).toBe(e.isCall);
				expect(m.isMemberAccess).toBe(e.isMemberAccess);
			}

			const expectedCalls = expected.filter((o) => o.isCall);
			expect(model.calls.length).toBe(expectedCalls.length);
			for (let i = 0; i < expectedCalls.length; i++) {
				const e = expectedCalls[i]!;
				const c = model.calls[i]!;
				expect(c.name).toBe(e.token.text);
				expect(c.span.start).toBe(e.span.start);
			}

			expect(model.st).toBe(unit.body);
		});
	}
});
