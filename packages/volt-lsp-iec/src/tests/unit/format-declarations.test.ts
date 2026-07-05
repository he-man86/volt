/**
 * Whole-document formatting (st-format wire-up) — declarations + the two structural bugs the corpus
 * surfaced. These are the fast, focused checks (the corpus test is only the final net):
 *   1. VAR sections reprint with canonical `name : TYPE := init;` spacing from the declaration AST.
 *   2. A body does NOT own its POU header line — a trailing comment on `METHOD Foo : BOOL // …` must survive.
 *   3. The re-indenter counts a closer keyword that shares a line with a multi-line comment's close
 *      (`*) END_CASE`) — otherwise the level drifts for the rest of the file (idempotency break).
 */
import { describe, expect, it } from "bun:test";
import { formatDocument } from "../../lsp/queries/format.js";

const fmt = (src: string): string => {
	const edits = formatDocument({ source: src, options: { insertSpaces: false, tabSize: 4 } });
	return edits.length === 0 ? src : edits[0]!.newText;
};

describe("st-format declarations: canonical VAR spacing", () => {
	it("normalizes column padding to a single space around `:` and `:=`", () => {
		const src = "FUNCTION_BLOCK FB\nVAR_INPUT\n\ta\t\t\t: INT := 5;\n\tb:BOOL;\nEND_VAR\nEND_FUNCTION_BLOCK";
		expect(fmt(src)).toBe("FUNCTION_BLOCK FB\n\tVAR_INPUT\n\t\ta : INT := 5;\n\t\tb : BOOL;\n\tEND_VAR\nEND_FUNCTION_BLOCK\n");
	});

	it("keeps the AT clause, initializer, and multi-name declarations", () => {
		const src = "PROGRAM P\nVAR\n\tx,y:INT;\n\tmapped AT %IX0.0:BOOL;\nEND_VAR\nEND_PROGRAM";
		expect(fmt(src)).toBe("PROGRAM P\n\tVAR\n\t\tx, y : INT;\n\t\tmapped AT %IX0.0 : BOOL;\n\tEND_VAR\nEND_PROGRAM\n");
	});

	it("preserves the source order of section modifiers (never reorders RETAIN/PERSISTENT)", () => {
		const src = "VAR_GLOBAL PERSISTENT RETAIN\n\tg:INT;\nEND_VAR";
		expect(fmt(src)).toContain("VAR_GLOBAL PERSISTENT RETAIN"); // order kept, not "RETAIN PERSISTENT"
		expect(fmt(src)).toContain("\tg : INT;");
	});

	it("weaves a pragma above the declaration it annotates", () => {
		const src = "PROGRAM P\nVAR\n\t{attribute 'hide'} secret:BOOL;\nEND_VAR\nEND_PROGRAM";
		expect(fmt(src)).toBe("PROGRAM P\n\tVAR\n\t\t{attribute 'hide'}\n\t\tsecret : BOOL;\n\tEND_VAR\nEND_PROGRAM\n");
	});

	it("falls back (keeps re-indented text) for a declaration with a comment interleaved in the type", () => {
		// `USINT(*..*) := 50` — a comment between type and `:=` would be relocated by slice-and-reweave, so the
		// whole section is left to the re-indenter. The comment must stay exactly where it was.
		const src = "VAR\n\tu\t: USINT(*(1..100)*) := 50;\nEND_VAR";
		expect(fmt(src)).toContain("USINT(*(1..100)*) := 50");
	});

	it("falls back for a multi-line initializer (array literal spread over lines)", () => {
		const src = "VAR\n\tarr : ARRAY[1..2] OF INT := [\n\t\t1,\n\t\t2];\nEND_VAR";
		const out = fmt(src);
		expect(out).toContain(":= [");
		expect(out).toContain("2];");
	});
});

describe("st-format: a body does not own the POU header line", () => {
	it("never clobbers a `METHOD … : BOOL // trailing` header when formatting the body", () => {
		const src = "METHOD PUBLIC EStop : BOOL\t// standstill\nEStop:=drivesStopped;\nEND_METHOD";
		const out = fmt(src);
		expect(out).toContain("METHOD PUBLIC EStop : BOOL"); // header survived
		expect(out).toContain("// standstill"); // trailing comment survived
		expect(out).toContain("EStop := drivesStopped;"); // body still formatted
	});
});

describe("st-format re-indenter: closer keyword on a comment-closing line", () => {
	it("counts an END_CASE that shares a line with a multi-line comment's close (no level drift)", () => {
		const src = [
			"FUNCTION_BLOCK FB",
			"CASE i OF",
			"\t1: x := 1; (* long",
			"\tcomment *) END_CASE",
			"y := 2;",
			"END_FUNCTION_BLOCK",
		].join("\n");
		const once = fmt(src);
		// After END_CASE the level returns to the FB body — `y := 2;` sits at one indent, not two.
		expect(once).toContain("\n\ty := 2;\n");
		// And formatting is idempotent (the drift bug made it non-idempotent).
		expect(fmt(once)).toBe(once);
	});
});
