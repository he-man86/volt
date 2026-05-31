/**
 * Lock-in test: `stBodyParser` output must equal `scanAllIdentifiersInBody`
 * over a corpus of representative POU bodies.
 *
 * Purpose: P1 promised "zero behavior change" — the ST body model is
 * just the existing identifier scan wearing a uniform interface. If
 * the two ever diverge, every body-dependent LSP feature (references,
 * highlight, completion, call-hierarchy, unresolved-identifier) would
 * shift output. This test catches that regression at the seam.
 *
 * The fixtures cover the patterns the existing scan handles:
 * straight identifiers, calls (`name(`), member access (`x.y`),
 * pragmas (skipped as trivia), block comments (skipped), nested
 * structures.
 */
import { describe, expect, test } from "bun:test";
import { parseSource } from "../../parser/parser.js";
import { scanAllIdentifiersInBody } from "../../semantic/resolver.js";
import { stBodyParser } from "./parser.js";

interface Fixture {
	name: string;
	source: string;
}

const FIXTURES: Fixture[] = [
	{
		name: "simple FB with single assignment",
		source: `FUNCTION_BLOCK FB_Counter
VAR_INPUT enable : BOOL; END_VAR
VAR_OUTPUT count : INT; END_VAR
VAR step : INT := 1; END_VAR
IF enable THEN count := count + step; END_IF
END_FUNCTION_BLOCK
`,
	},
	{
		name: "FB with call sites and member access",
		source: `FUNCTION_BLOCK FB_Caller
VAR fb : FB_Inner; result : INT; END_VAR
fb.execute(value := 10);
result := fb.output + ADD(a := 1, b := 2);
END_FUNCTION_BLOCK
`,
	},
	{
		name: "FB with comments + pragmas (must be skipped)",
		source: `FUNCTION_BLOCK FB_WithComments
VAR x : INT; END_VAR
(* this is a block comment with identifier_in_comment *)
{attribute 'instance-path'}
// line comment with another_identifier
x := x + 1;
END_FUNCTION_BLOCK
`,
	},
	{
		name: "PROGRAM with control flow",
		source: `PROGRAM MAIN
VAR i : INT; total : INT; END_VAR
FOR i := 1 TO 10 DO
  total := total + i;
END_FOR
END_PROGRAM
`,
	},
	{
		name: "FUNCTION with return type",
		source: `FUNCTION Compute : INT
VAR_INPUT a : INT; b : INT; END_VAR
Compute := a * b;
END_FUNCTION
`,
	},
];

describe("stBodyParser", () => {
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
			const model = stBodyParser.parse({
				source: fx.source,
				bodyRegion: { start: unit.body.span.start, end: unit.body.span.end },
				st: unit.body,
			});

			// Same count
			expect(model.identifiers.length).toBe(expected.length);

			// Same names + spans + flags, in same order
			for (let i = 0; i < expected.length; i++) {
				const e = expected[i]!;
				const m = model.identifiers[i]!;
				expect(m.name).toBe(e.token.text);
				expect(m.span.start).toBe(e.span.start);
				expect(m.span.end).toBe(e.span.end);
				expect(m.isCall).toBe(e.isCall);
				expect(m.isMemberAccess).toBe(e.isMemberAccess);
			}

			// Calls field is the subset where isCall === true
			const expectedCalls = expected.filter((o) => o.isCall);
			expect(model.calls.length).toBe(expectedCalls.length);
			for (let i = 0; i < expectedCalls.length; i++) {
				const e = expectedCalls[i]!;
				const c = model.calls[i]!;
				expect(c.name).toBe(e.token.text);
				expect(c.span.start).toBe(e.span.start);
			}

			// st field is preserved by reference (no copy, no transformation)
			expect(model.st).toBe(unit.body);
			expect(model.languageId).toBe("structured-text");
		});
	}

	test("registry routes 'structured-text' to stBodyParser", async () => {
		const { bodyParsers, buildBodyModel } = await import("../index.js");
		expect(bodyParsers.get("structured-text")).toBe(stBodyParser);

		const source = `FUNCTION_BLOCK X
VAR a : INT; END_VAR
a := a + 1;
END_FUNCTION_BLOCK
`;
		const parsed = parseSource(source);
		const unit = parsed.units[0];
		if (unit === undefined || !("body" in unit) || unit.body === undefined) {
			throw new Error("fixture body missing");
		}
		const model = buildBodyModel("structured-text", {
			source,
			bodyRegion: { start: unit.body.span.start, end: unit.body.span.end },
			st: unit.body,
		});
		expect(model.languageId).toBe("structured-text");
		// Two `a` identifiers in the body.
		const aRefs = model.identifiers.filter((i) => i.name === "a");
		expect(aRefs.length).toBe(2);
	});

	test("unknown languageId falls back to ST parser (graceful degradation)", async () => {
		const { buildBodyModel } = await import("../index.js");
		const source = `FUNCTION_BLOCK X
VAR a : INT; END_VAR
a := 1;
END_FUNCTION_BLOCK
`;
		const parsed = parseSource(source);
		const unit = parsed.units[0];
		if (unit === undefined || !("body" in unit) || unit.body === undefined) {
			throw new Error("fixture body missing");
		}
		// "plc-zzz" is unregistered — must fall through to ST so the
		// file at least opens without crashing. Output keeps the ST
		// languageId tag (the parser's own identity, not the input).
		const model = buildBodyModel("plc-zzz", {
			source,
			bodyRegion: { start: unit.body.span.start, end: unit.body.span.end },
			st: unit.body,
		});
		expect(model.languageId).toBe("structured-text");
	});
});
