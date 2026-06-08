/**
 * Formatter tests — the token-driven re-indenter (`queries/format.ts`).
 *
 * Invariants that matter more than any single golden output:
 *   1. Correct nesting depth for POU shells, VAR sections, methods,
 *      and statement blocks (IF/FOR/CASE/REPEAT).
 *   2. Idempotency — `format(format(x)) === format(x)`.
 *   3. Round-trip safety — the non-trivia token stream is unchanged
 *      (we only ever move whitespace).
 *   4. Multi-line string/comment interiors are emitted verbatim.
 */
import { describe, expect, it } from "bun:test";
import { reindentSt, formatDocument, type IndentOptions } from "../../lsp/queries/format.js";
import { lex } from "../../lexer/lexer.js";
import { isTrivia } from "../../lexer/tokens.js";

const TABS: IndentOptions = { tabSize: 4, insertSpaces: false };
const SPACES2: IndentOptions = { tabSize: 2, insertSpaces: true };

/** The non-trivia token stream as `kind|text` pairs — the round-trip oracle. */
function meaningfulTokens(src: string): string[] {
	return lex(src)
		.filter((t) => !isTrivia(t.kind) && t.kind !== "eof")
		.map((t) => `${t.kind}|${t.text}`);
}

describe("reindentSt — nesting depth", () => {
	it("indents an FB with a VAR section and a nested method", () => {
		const input = [
			"FUNCTION_BLOCK FB_Demo",
			"VAR",
			"x : INT;",
			"END_VAR",
			"METHOD Run",
			"x := x + 1;",
			"END_METHOD",
			"END_FUNCTION_BLOCK",
			"",
		].join("\n");
		const out = reindentSt(input, TABS);
		expect(out).toBe(
			[
				"FUNCTION_BLOCK FB_Demo",
				"\tVAR",
				"\t\tx : INT;",
				"\tEND_VAR",
				"\tMETHOD Run",
				"\t\tx := x + 1;",
				"\tEND_METHOD",
				"END_FUNCTION_BLOCK",
				"",
			].join("\n"),
		);
	});

	it("dedents ELSE/ELSIF to the IF level and re-indents their bodies", () => {
		const input = [
			"FUNCTION_BLOCK FB",
			"METHOD M",
			"IF a THEN",
			"b := 1;",
			"ELSIF c THEN",
			"b := 2;",
			"ELSE",
			"b := 3;",
			"END_IF",
			"END_METHOD",
			"END_FUNCTION_BLOCK",
			"",
		].join("\n");
		const out = reindentSt(input, TABS).split("\n");
		expect(out[2]).toBe("\t\tIF a THEN");
		expect(out[3]).toBe("\t\t\tb := 1;");
		expect(out[4]).toBe("\t\tELSIF c THEN");
		expect(out[5]).toBe("\t\t\tb := 2;");
		expect(out[6]).toBe("\t\tELSE");
		expect(out[7]).toBe("\t\t\tb := 3;");
		expect(out[8]).toBe("\t\tEND_IF");
	});

	it("handles REPEAT/UNTIL and FOR/CASE blocks", () => {
		const input = [
			"PROGRAM P",
			"FOR i := 0 TO 9 DO",
			"REPEAT",
			"n := n + 1;",
			"UNTIL n > 3",
			"END_REPEAT",
			"END_FOR",
			"END_PROGRAM",
			"",
		].join("\n");
		const out = reindentSt(input, TABS).split("\n");
		expect(out[1]).toBe("\tFOR i := 0 TO 9 DO");
		expect(out[2]).toBe("\t\tREPEAT");
		expect(out[3]).toBe("\t\t\tn := n + 1;");
		expect(out[4]).toBe("\t\tUNTIL n > 3");
		expect(out[5]).toBe("\t\tEND_REPEAT");
		expect(out[6]).toBe("\tEND_FOR");
	});

	it("supports spaces with a configurable tab size", () => {
		const input = "FUNCTION_BLOCK FB\nVAR\nx : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n";
		const out = reindentSt(input, SPACES2).split("\n");
		expect(out[1]).toBe("  VAR");
		expect(out[2]).toBe("    x : INT;");
		expect(out[3]).toBe("  END_VAR");
	});
});

describe("reindentSt — invariants", () => {
	const samples = [
		"FUNCTION_BLOCK FB\nVAR\n\t\tx:INT;\nEND_VAR\nMETHOD M\nIF a THEN\nb:=1;\nEND_IF\nEND_METHOD\nEND_FUNCTION_BLOCK\n",
		"TYPE ST :\nSTRUCT\nx : INT;\ny : REAL;\nEND_STRUCT\nEND_TYPE\n",
		"PROGRAM P\n   CASE sel OF\n1: a := 1;\n2: a := 2;\nELSE\na := 0;\nEND_CASE\nEND_PROGRAM\n",
	];

	it("is idempotent", () => {
		for (const s of samples) {
			const once = reindentSt(s, TABS);
			const twice = reindentSt(once, TABS);
			expect(twice).toBe(once);
		}
	});

	it("preserves the non-trivia token stream (round-trip safe)", () => {
		for (const s of samples) {
			expect(meaningfulTokens(reindentSt(s, TABS))).toEqual(meaningfulTokens(s));
		}
	});

	it("ends with exactly one trailing newline and no trailing blank lines", () => {
		const out = reindentSt("FUNCTION_BLOCK FB\nEND_FUNCTION_BLOCK\n\n\n", TABS);
		expect(out.endsWith("END_FUNCTION_BLOCK\n")).toBe(true);
		expect(out.endsWith("\n\n")).toBe(false);
	});

	it("strips trailing whitespace and normalizes blank lines", () => {
		const out = reindentSt("FUNCTION_BLOCK FB   \n\t  \nEND_FUNCTION_BLOCK\n", TABS);
		expect(out).toBe("FUNCTION_BLOCK FB\n\nEND_FUNCTION_BLOCK\n");
	});
});

describe("reindentSt — multi-line token safety", () => {
	// ST string literals are single-line; the real multi-line construct
	// is the block comment `(* ... *)`. Protecting its interior is
	// required for round-trip safety — the comment is ONE token, so
	// re-indenting its continuation lines would mutate the token text.
	it("never re-indents the interior of a multi-line block comment", () => {
		const input = [
			"FUNCTION_BLOCK FB",
			"METHOD M",
			"(* first comment line",
			"        second line stays as-is",
			"   third line *)",
			"x := 1;",
			"END_METHOD",
			"END_FUNCTION_BLOCK",
			"",
		].join("\n");
		const out = reindentSt(input, TABS).split("\n");
		// First line of the comment is re-indented to the body level.
		expect(out[2]).toBe("\t\t(* first comment line");
		// Interior lines are emitted verbatim — original spacing intact.
		expect(out[3]).toBe("        second line stays as-is");
		expect(out[4]).toBe("   third line *)");
		// Code after the comment indents normally.
		expect(out[5]).toBe("\t\tx := 1;");
	});

	it("keeps the token stream byte-identical across a block comment", () => {
		const src = "FUNCTION_BLOCK FB\n(* multi\n   line *)\nMETHOD M\nx:=1;\nEND_METHOD\nEND_FUNCTION_BLOCK\n";
		expect(meaningfulTokens(reindentSt(src, TABS))).toEqual(meaningfulTokens(src));
	});
});

describe("formatDocument — LSP wrapper", () => {
	it("returns a single full-document edit when changes are needed", () => {
		const source = "FUNCTION_BLOCK FB\nVAR\nx : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n";
		const edits = formatDocument({ source, options: TABS });
		expect(edits).toHaveLength(1);
		expect(edits[0]!.range.start).toEqual({ line: 0, character: 0 });
		expect(edits[0]!.newText).toBe(reindentSt(source, TABS));
	});

	it("returns no edits when the document is already formatted", () => {
		const source = "FUNCTION_BLOCK FB\n\tVAR\n\t\tx : INT;\n\tEND_VAR\nEND_FUNCTION_BLOCK\n";
		expect(formatDocument({ source, options: TABS })).toEqual([]);
	});
});
