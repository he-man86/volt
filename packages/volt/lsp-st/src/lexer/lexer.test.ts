/**
 * Lexer tests. Focus areas (in order of bug-likelihood for ST):
 *   1. Keyword case-insensitivity and canonical form
 *   2. Nested block comments (* (* *) *)
 *   3. String escapes ($$ $L $N $P $R $T $' $" $<hex>)
 *   4. Numeric literals — decimal, hex 16#, oct 8#, bin 2#, real, real-with-exponent
 *   5. Time / date / TOD / DT literals
 *   6. Typed literals (INT#42, REAL#1.5, BOOL#TRUE)
 *   7. Range op `..` vs real `.0`
 *   8. Pragma blocks
 *   9. The `METHOD PROTECTED FINAL Execute` regression family — these
 *      are real header lines from the April 2026 incident.
 */
import { describe, expect, it } from "bun:test";
import { lex } from "./lexer.js";
import type { Keyword, Token } from "./tokens.js";

/** Tokens with trivia stripped — what the parser would see. */
function meaningful(src: string): Token[] {
	return lex(src).filter(
		(t) =>
			t.kind !== "whitespace" &&
			t.kind !== "line_comment" &&
			t.kind !== "block_comment" &&
			t.kind !== "pragma" &&
			t.kind !== "eof",
	);
}

function kinds(src: string): string[] {
	return meaningful(src).map((t) => t.kind);
}

function keywords(src: string): (Keyword | undefined)[] {
	return meaningful(src).map((t) => t.keyword);
}

function texts(src: string): string[] {
	return meaningful(src).map((t) => t.text);
}

describe("lexer: keywords", () => {
	it("recognizes a single uppercase keyword", () => {
		const tokens = meaningful("FUNCTION_BLOCK");
		expect(tokens).toHaveLength(1);
		expect(tokens[0]?.kind).toBe("keyword");
		expect(tokens[0]?.keyword).toBe("FUNCTION_BLOCK");
		expect(tokens[0]?.text).toBe("FUNCTION_BLOCK");
	});

	it("is case-insensitive but preserves original casing in text", () => {
		const tokens = meaningful("function_block");
		expect(tokens[0]?.keyword).toBe("FUNCTION_BLOCK");
		expect(tokens[0]?.text).toBe("function_block");
	});

	it("treats mixed-case keywords correctly", () => {
		const tokens = meaningful("Function_Block");
		expect(tokens[0]?.keyword).toBe("FUNCTION_BLOCK");
	});

	it("distinguishes keywords from identifiers that contain a keyword", () => {
		const tokens = meaningful("IF_NOT_FOUND");
		expect(tokens[0]?.kind).toBe("identifier");
	});
});

describe("lexer: identifiers", () => {
	it("simple identifier", () => {
		const tokens = meaningful("FB_Motor");
		expect(tokens[0]?.kind).toBe("identifier");
		expect(tokens[0]?.text).toBe("FB_Motor");
	});

	it("identifier with leading underscore", () => {
		const tokens = meaningful("_helper");
		expect(tokens[0]?.kind).toBe("identifier");
	});

	it("identifier with digits", () => {
		const tokens = meaningful("var_42");
		expect(tokens[0]?.kind).toBe("identifier");
	});
});

describe("lexer: nested block comments", () => {
	it("plain block comment", () => {
		const all = lex("(* hello *)x");
		expect(all[0]?.kind).toBe("block_comment");
		expect(all[0]?.text).toBe("(* hello *)");
	});

	it("nested block comment — full input is one comment", () => {
		const all = lex("(* outer (* inner *) still outer *)");
		const blocks = all.filter((t) => t.kind === "block_comment");
		expect(blocks).toHaveLength(1);
		expect(blocks[0]?.text).toBe("(* outer (* inner *) still outer *)");
	});

	it("doubly nested", () => {
		const all = lex("(* a (* b (* c *) b *) a *)");
		expect(all.filter((t) => t.kind === "block_comment")).toHaveLength(1);
	});
});

describe("lexer: line comments", () => {
	it("consumes through end of line, not newline", () => {
		const tokens = lex("// hi\nX");
		expect(tokens[0]?.kind).toBe("line_comment");
		expect(tokens[0]?.text).toBe("// hi");
		// Then whitespace (\n), then identifier
		expect(tokens[1]?.kind).toBe("whitespace");
		expect(tokens[2]?.kind).toBe("identifier");
	});
});

describe("lexer: pragmas", () => {
	it("simple attribute block", () => {
		const tokens = lex("{attribute 'qualified_only'}\nVAR");
		expect(tokens[0]?.kind).toBe("pragma");
		expect(tokens[0]?.text).toBe("{attribute 'qualified_only'}");
	});

	it("pragma with arbitrary contents", () => {
		const tokens = lex("{some pragma with whatever inside}");
		expect(tokens[0]?.kind).toBe("pragma");
	});
});

describe("lexer: numeric literals", () => {
	it("integer", () => {
		expect(kinds("42")).toEqual(["int_lit"]);
	});

	it("hex integer", () => {
		const tokens = meaningful("16#FF");
		expect(tokens[0]?.kind).toBe("int_lit");
		expect(tokens[0]?.text).toBe("16#FF");
	});

	it("octal integer", () => {
		const tokens = meaningful("8#77");
		expect(tokens[0]?.text).toBe("8#77");
	});

	it("binary integer", () => {
		const tokens = meaningful("2#1010");
		expect(tokens[0]?.text).toBe("2#1010");
	});

	it("real with decimal point", () => {
		expect(kinds("1.5")).toEqual(["real_lit"]);
	});

	it("real with exponent", () => {
		const tokens = meaningful("1.5e-3");
		expect(tokens[0]?.kind).toBe("real_lit");
		expect(tokens[0]?.text).toBe("1.5e-3");
	});

	it("real with positive exponent", () => {
		expect(meaningful("2.0E+10")[0]?.text).toBe("2.0E+10");
	});

	it("range operator `1..10` lexes as int, .., int (NOT real)", () => {
		expect(kinds("1..10")).toEqual(["int_lit", "punct", "int_lit"]);
		expect(texts("1..10")).toEqual(["1", "..", "10"]);
	});
});

describe("lexer: typed literals", () => {
	it("INT#42", () => {
		const tokens = meaningful("INT#42");
		expect(tokens[0]?.kind).toBe("typed_lit");
		expect(tokens[0]?.text).toBe("INT#42");
	});

	it("REAL#1.5", () => {
		const tokens = meaningful("REAL#1.5");
		expect(tokens[0]?.kind).toBe("typed_lit");
		expect(tokens[0]?.text).toBe("REAL#1.5");
	});

	it("BOOL#TRUE", () => {
		const tokens = meaningful("BOOL#TRUE");
		expect(tokens[0]?.kind).toBe("typed_lit");
	});
});

describe("lexer: time/date/tod/dt literals", () => {
	it("T#10ms", () => {
		const tokens = meaningful("T#10ms");
		expect(tokens[0]?.kind).toBe("time_lit");
		expect(tokens[0]?.text).toBe("T#10ms");
	});

	it("TIME#1h30m", () => {
		expect(meaningful("TIME#1h30m")[0]?.text).toBe("TIME#1h30m");
	});

	it("DATE#2026-05-23", () => {
		const tokens = meaningful("DATE#2026-05-23");
		expect(tokens[0]?.kind).toBe("date_lit");
		expect(tokens[0]?.text).toBe("DATE#2026-05-23");
	});

	it("D#2026-05-23", () => {
		expect(meaningful("D#2026-05-23")[0]?.kind).toBe("date_lit");
	});

	it("TOD#12:30:00", () => {
		const tokens = meaningful("TOD#12:30:00");
		expect(tokens[0]?.kind).toBe("tod_lit");
		expect(tokens[0]?.text).toBe("TOD#12:30:00");
	});

	it("DT#2026-05-23-12:30:00", () => {
		const tokens = meaningful("DT#2026-05-23-12:30:00");
		expect(tokens[0]?.kind).toBe("datetime_lit");
	});
});

describe("lexer: string literals", () => {
	it("simple single-quoted string", () => {
		const tokens = meaningful("'hello'");
		expect(tokens[0]?.kind).toBe("string_lit");
		expect(tokens[0]?.text).toBe("'hello'");
	});

	it("wstring (double-quoted)", () => {
		const tokens = meaningful('"hello"');
		expect(tokens[0]?.kind).toBe("wstring_lit");
	});

	it("string with $$ escape (literal dollar)", () => {
		expect(meaningful("'foo$$bar'")[0]?.text).toBe("'foo$$bar'");
	});

	it("string with $' escape (literal single quote)", () => {
		expect(meaningful("'it$'s'")[0]?.text).toBe("'it$'s'");
	});

	it("string with $L $N $P $R $T whitespace escapes", () => {
		const tokens = meaningful("'a$Lb$Nc$Pd$Re$Tf'");
		expect(tokens[0]?.kind).toBe("string_lit");
		expect(tokens[0]?.text).toBe("'a$Lb$Nc$Pd$Re$Tf'");
	});

	it("string with $<hex> escape", () => {
		expect(meaningful("'$41'")[0]?.text).toBe("'$41'");
	});

	it("string does not span newlines (recovery)", () => {
		// Unterminated string — the lexer stops at \n. Subsequent
		// tokens are the next line's content. We just check the
		// initial token is a (truncated) string_lit, not that the
		// whole stream is correct.
		const tokens = lex("'unterm\nX");
		expect(tokens[0]?.kind).toBe("string_lit");
	});
});

describe("lexer: operators and punctuation", () => {
	it("multi-char assignment :=", () => {
		const tokens = meaningful(":=");
		expect(tokens[0]?.kind).toBe("punct");
		expect(tokens[0]?.text).toBe(":=");
	});

	it("output assignment =>", () => {
		expect(meaningful("=>")[0]?.text).toBe("=>");
	});

	it("not-equal <>", () => {
		expect(meaningful("<>")[0]?.text).toBe("<>");
	});

	it("less-equal and greater-equal", () => {
		expect(texts("<= >=")).toEqual(["<=", ">="]);
	});

	it("exponent operator **", () => {
		expect(meaningful("**")[0]?.text).toBe("**");
	});

	it("range ..", () => {
		expect(meaningful("..")[0]?.text).toBe("..");
	});

	it("parens / brackets / semicolon / comma / dot", () => {
		expect(texts("();[],.")).toEqual(["(", ")", ";", "[", "]", ",", "."]);
	});
});

describe("lexer: spans", () => {
	it("first token starts at line 1 col 0", () => {
		const t = lex("FB")[0]!;
		expect(t.span.startLine).toBe(1);
		expect(t.span.startCol).toBe(0);
	});

	it("tracks newlines", () => {
		const tokens = lex("A\nB");
		const aTok = tokens.find((t) => t.text === "A")!;
		const bTok = tokens.find((t) => t.text === "B")!;
		expect(aTok.span.startLine).toBe(1);
		expect(bTok.span.startLine).toBe(2);
		expect(bTok.span.startCol).toBe(0);
	});

	it("offsets reconstruct the token", () => {
		const src = "FOO BAR";
		const tokens = lex(src);
		for (const t of tokens) {
			if (t.kind !== "eof") {
				expect(src.slice(t.span.start, t.span.end)).toBe(t.text);
			}
		}
	});
});

describe("lexer: April 2026 stacked-modifier regression cases", () => {
	// Ported from bridges/test_code_parser.py. These are real header
	// lines that broke the bridge-side regex when it only allowed one
	// access modifier. Lexing them here should always work — the
	// lexer doesn't care about METHOD-specific grammar; that's the
	// parser's job. But we lock down that we produce the expected
	// token shape so the parser has a stable input.
	const cases = [
		"METHOD PROTECTED FINAL Execute",
		"METHOD PUBLIC Foo : BOOL",
		"METHOD Bar",
		"METHOD PUBLIC ABSTRACT FINAL Baz : INT",
		"method protected final Execute",
		"METHOD PROTECTED FINAL Init : BOOL",
	];

	for (const src of cases) {
		it(`lexes "${src}"`, () => {
			const tokens = meaningful(src);
			expect(tokens[0]?.keyword).toBe("METHOD");
			// Last token should be the method name (identifier) or a
			// return type after `:` — we just check no unknown tokens.
			expect(tokens.every((t) => t.kind !== "unknown")).toBe(true);
		});
	}
});

describe("lexer: end-to-end fixture", () => {
	it("real FB declaration", () => {
		const src = `
{attribute 'qualified_only'}
FUNCTION_BLOCK FB_Motor EXTENDS FB_BaseDevice IMPLEMENTS IControllable
VAR_INPUT
	bEnable : BOOL := FALSE;
	rSpeed : REAL := 0.0;
END_VAR
VAR_OUTPUT
	eState : E_MotorState;
END_VAR
VAR
	tCycle : TIME := T#100ms;
END_VAR
		`;
		const tokens = meaningful(src);
		expect(tokens.find((t) => t.keyword === "FUNCTION_BLOCK")).toBeDefined();
		expect(tokens.find((t) => t.keyword === "EXTENDS")).toBeDefined();
		expect(tokens.find((t) => t.keyword === "IMPLEMENTS")).toBeDefined();
		expect(tokens.find((t) => t.keyword === "VAR_INPUT")).toBeDefined();
		expect(tokens.find((t) => t.keyword === "END_VAR")).toBeDefined();
		expect(tokens.find((t) => t.text === "T#100ms")?.kind).toBe("time_lit");
		// No unknown tokens
		expect(tokens.filter((t) => t.kind === "unknown")).toEqual([]);
	});
});

describe("lexer: underscore separators in numeric literals", () => {
	it("decimal integer with underscores", () => {
		const tokens = meaningful("1_000_000");
		expect(tokens).toHaveLength(1);
		expect(tokens[0]?.kind).toBe("int_lit");
		expect(tokens[0]?.text).toBe("1_000_000");
	});

	it("hex integer with underscores", () => {
		const tokens = meaningful("16#FFFF_FFFF");
		expect(tokens).toHaveLength(1);
		expect(tokens[0]?.kind).toBe("int_lit");
		expect(tokens[0]?.text).toBe("16#FFFF_FFFF");
	});

	it("real number with underscores in fraction", () => {
		const tokens = meaningful("1_000.123_456");
		expect(tokens).toHaveLength(1);
		expect(tokens[0]?.kind).toBe("real_lit");
	});
});

describe("lexer: ExST assignment operators", () => {
	it("S= as a single punct token", () => {
		const tokens = meaningful("xSet S= xCond;");
		// expected: identifier "xSet", punct "S=", identifier "xCond", punct ";"
		expect(tokens[0]?.kind).toBe("identifier");
		expect(tokens[1]?.kind).toBe("punct");
		expect(tokens[1]?.text).toBe("S=");
		expect(tokens[2]?.text).toBe("xCond");
	});

	it("R= as a single punct token", () => {
		const tokens = meaningful("xReset R= xCond;");
		expect(tokens[1]?.text).toBe("R=");
	});

	it("REF= as a single punct token", () => {
		const tokens = meaningful("ref REF= target;");
		expect(tokens[1]?.text).toBe("REF=");
	});

	it("does NOT confuse a var named S followed by :=", () => {
		const tokens = meaningful("S := 1;");
		// expected: identifier S, punct :=, int_lit 1, ;
		expect(tokens[0]?.text).toBe("S");
		expect(tokens[0]?.kind).toBe("identifier");
		expect(tokens[1]?.text).toBe(":=");
	});

	it("does NOT confuse REFERENCE TO ... as REF=", () => {
		const tokens = meaningful("REFERENCE TO INT");
		expect(tokens[0]?.keyword).toBe("REFERENCE");
		expect(tokens[0]?.kind).toBe("keyword");
	});
});

describe("lexer: backtick identifiers", () => {
	it("simple backtick identifier", () => {
		const tokens = meaningful("`var+9` := 1;");
		expect(tokens[0]?.kind).toBe("identifier");
		expect(tokens[0]?.text).toBe("`var+9`");
	});

	it("backtick around a keyword", () => {
		const tokens = meaningful("`INT` : DINT;");
		expect(tokens[0]?.kind).toBe("identifier");
		expect(tokens[0]?.text).toBe("`INT`");
	});

	it("acute-accent variant (U+00B4)", () => {
		const tokens = meaningful("´var1´ := 1;");
		expect(tokens[0]?.kind).toBe("identifier");
		expect(tokens[0]?.text.length).toBeGreaterThan(2);
	});
});

describe("lexer: address literals", () => {
	it("input bit address with bit position", () => {
		const tokens = meaningful("%IX0.0");
		expect(tokens[0]?.kind).toBe("address_lit");
		expect(tokens[0]?.text).toBe("%IX0.0");
	});

	it("output word address", () => {
		const tokens = meaningful("%QW1");
		expect(tokens[0]?.kind).toBe("address_lit");
		expect(tokens[0]?.text).toBe("%QW1");
	});

	it("flag double-word address", () => {
		const tokens = meaningful("%MD48");
		expect(tokens[0]?.kind).toBe("address_lit");
		expect(tokens[0]?.text).toBe("%MD48");
	});

	it("incomplete address %I*", () => {
		const tokens = meaningful("%I*");
		expect(tokens[0]?.kind).toBe("address_lit");
		expect(tokens[0]?.text).toBe("%I*");
	});

	it("address without size prefix (just area + position)", () => {
		const tokens = meaningful("%Q7.5");
		expect(tokens[0]?.kind).toBe("address_lit");
		expect(tokens[0]?.text).toBe("%Q7.5");
	});

	it("multi-segment address (device-config dependent)", () => {
		const tokens = meaningful("%IW2.5.7.1");
		expect(tokens[0]?.kind).toBe("address_lit");
		expect(tokens[0]?.text).toBe("%IW2.5.7.1");
	});

	it("does NOT consume %5 as an address (no area letter)", () => {
		const tokens = meaningful("%5");
		// "%" punct + int_lit 5
		expect(tokens[0]?.kind).toBe("punct");
		expect(tokens[0]?.text).toBe("%");
	});
});

describe("lexer: extended operator keywords", () => {
	it("operator-word keywords from corpus tokenize as keywords", () => {
		for (const name of [
			"ADD", "SUB", "MUL", "DIV",
			"SHL", "SHR", "ROL", "ROR",
			"SEL", "MUX", "MIN", "MAX", "LIMIT",
			"GT", "LT", "GE", "LE", "EQ", "NE",
			"ABS", "SQRT", "LN", "LOG", "EXP", "EXPT",
			"SIN", "COS", "TAN", "ASIN", "ACOS", "ATAN",
			"ADR", "BITADR", "CAL", "MOVE", "INDEXOF", "SIZEOF", "XSIZEOF",
			"TRUNC", "TRUNC_INT", "INI",
			"VAR_GENERIC", "PARAMS",
		]) {
			const tokens = meaningful(name);
			expect(tokens[0]?.kind, `${name} should be a keyword`).toBe("keyword");
			expect(tokens[0]?.keyword).toBe(name);
		}
	});

	it("system __-prefixed operators tokenize as keywords", () => {
		for (const name of [
			"__NEW", "__DELETE", "__ISVALIDREF",
			"__QUERYINTERFACE", "__QUERYPOINTER",
			"__TRY", "__CATCH", "__FINALLY", "__ENDTRY",
			"__VARINFO", "__CURRENTTASK", "__POSITION", "__POUNAME",
			"__COMPARE_AND_SWAP", "__XADD", "__POOL",
			"TEST_AND_SET",
		]) {
			const tokens = meaningful(name);
			expect(tokens[0]?.kind, `${name} should be a keyword`).toBe("keyword");
			expect(tokens[0]?.keyword).toBe(name);
		}
	});
});
