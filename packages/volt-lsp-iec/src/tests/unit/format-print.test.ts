/**
 * Structural printer (st-format) — `lsp/queries/format-print.ts`. Asserts canonical output per form
 * AND the semantic round-trip invariant: `parse(print(parse(x)))` deep-equals `parse(x)` (spans aside).
 */
import { describe, expect, it } from "bun:test";
import { lex } from "../../lexer/lexer.js";
import { parseStatements } from "../../parser/statements.js";
import type { BodySpan } from "../../parser/ast.js";
import { printStatements, printBody, type PrintContext } from "../../lsp/queries/format-print.js";

const CTX: PrintContext = { unit: "\t", eol: "\n" };
const body = (src: string): BodySpan => ({ kind: "body", tokens: lex(src), span: { start: 0, end: src.length, startLine: 1, startCol: 0, endLine: 1, endCol: 0 } });
const print = (src: string): string => printStatements(parseStatements(body(src)).statements, CTX, 0);

/** Recursively drop `span` so two ASTs compare on structure only (positions change after reprint). */
function stripSpans(v: unknown): unknown {
	if (Array.isArray(v)) return v.map(stripSpans);
	if (v && typeof v === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, val] of Object.entries(v)) if (k !== "span") out[k] = stripSpans(val);
		return out;
	}
	return v;
}
const ast = (src: string): unknown => stripSpans(parseStatements(body(src)).statements);

describe("format-print: canonical output", () => {
	const cases: Array<[string, string]> = [
		["x:=a+b;", "x := a + b;"],
		["x:=a+b*(c-d);", "x := a + b * (c - d);"],
		["x := (a+b)*c;", "x := (a + b) * c;"],
		["y:=NOT flag AND (a>=b);", "y := NOT flag AND (a >= b);"],
		["motor.speed[i]:=fb.Compute(In:=1,rDelay);", "motor.speed[i] := fb.Compute(In := 1, rDelay);"],
		["p^ := -x;", "p^ := -x;"],
		["a:=b:=c;", "a := b := c;"],
		["fb.Run();", "fb.Run();"],
		["x S= TRUE;", "x S= TRUE;"],
	];
	for (const [input, expected] of cases) {
		it(`${input}  →  ${expected}`, () => expect(print(input)).toBe(expected));
	}

	it("IF/ELSIF/ELSE nests and indents", () => {
		expect(print("IF a THEN x:=1; ELSIF b THEN x:=2; ELSE x:=3; END_IF")).toBe(
			"IF a THEN\n\tx := 1;\nELSIF b THEN\n\tx := 2;\nELSE\n\tx := 3;\nEND_IF",
		);
	});

	it("CASE with labels + range", () => {
		expect(print("CASE s OF 1: x:=1; 2..4: x:=2; ELSE x:=9; END_CASE")).toBe(
			"CASE s OF\n\t1:\n\t\tx := 1;\n\t2..4:\n\t\tx := 2;\n\tELSE\n\t\tx := 9;\nEND_CASE",
		);
	});

	it("FOR with BY", () => {
		expect(print("FOR i:=0 TO 10 BY 2 DO x:=x+i; END_FOR")).toBe("FOR i := 0 TO 10 BY 2 DO\n\tx := x + i;\nEND_FOR");
	});
});

describe("format-print: semantic round-trip (parse ≡ parse∘print)", () => {
	const bodies = [
		"x := a + b * (c - d);",
		"IF a AND NOT b THEN y := f(1, g := 2); ELSE y := 0; END_IF",
		"CASE state OF 1, 2: run(); 3..5: stop(); ELSE idle(); END_CASE",
		"FOR i := 0 TO n BY 2 DO acc := acc + arr[i]; END_FOR",
		"WHILE p^ <> 0 DO p := p^.next; END_WHILE",
		"REPEAT count := count + 1; UNTIL count >= max END_REPEAT",
		"a.b.c[i].d := (r := compute()) + 1;",
	];
	for (const src of bodies) {
		it(`round-trips: ${src.slice(0, 40)}…`, () => {
			const printed = printStatements(parseStatements(body(src)).statements, CTX, 0);
			expect(ast(printed)).toEqual(ast(src));
		});
	}

	it("is idempotent", () => {
		for (const src of bodies) {
			const once = printStatements(parseStatements(body(src)).statements, CTX, 0);
			const twice = printStatements(parseStatements(body(once)).statements, CTX, 0);
			expect(twice).toBe(once);
		}
	});
});

describe("format-print: comment weaving", () => {
	const fmt = (src: string): string => {
		const toks = lex(src);
		return printBody(parseStatements({ kind: "body", tokens: toks, span: { start: 0, end: src.length, startLine: 1, startCol: 0, endLine: 1, endCol: 0 } }).statements, toks, CTX);
	};
	/** Multiset of comment texts, for the preservation invariant. */
	const comments = (src: string): string[] =>
		lex(src).filter((t) => t.kind === "line_comment" || t.kind === "block_comment").map((t) => t.text).sort();

	it("keeps an own-line comment between statements at the right indent", () => {
		expect(fmt("x:=1;\n// step two\ny:=2;")).toBe("x := 1;\n// step two\ny := 2;");
	});

	it("keeps a trailing comment after the statement", () => {
		expect(fmt("x:=1; // set x")).toBe("x := 1; // set x");
	});

	it("weaves a comment inside a nested block at the body indent", () => {
		expect(fmt("IF a THEN\n// inside\nx:=1;\nEND_IF")).toBe("IF a THEN\n\t// inside\n\tx := 1;\nEND_IF");
	});

	it("relocates an interior comment to trailing but never drops it", () => {
		const out = fmt("a := b (* note *) + c;");
		expect(out).toContain("(* note *)"); // preserved
		expect(comments(out)).toEqual(comments("a := b (* note *) + c;"));
	});

	it("PRESERVES the comment multiset over varied bodies (the load-bearing invariant)", () => {
		const srcs = [
			"// header\nx := 1;\ny := 2; // trailing\n// footer",
			"IF a THEN\n// then\nx := 1;\nELSE\n// else\nx := 2;\nEND_IF",
			"FOR i := 0 TO n DO\n// loop\nacc := acc + i;\nEND_FOR\n// after",
			"CASE s OF\n1: // one\nrun();\n2: stop();\nEND_CASE",
		];
		for (const src of srcs) {
			expect(comments(fmt(src))).toEqual(comments(src));
		}
	});

	it("is idempotent with comments", () => {
		const src = "// header\nIF a THEN\nx := 1; // set\nEND_IF\n// tail";
		const once = fmt(src);
		expect(fmt(once)).toBe(once);
	});
});
