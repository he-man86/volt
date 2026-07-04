/**
 * Expression-parser tests — the Pratt/precedence-climbing grammar in
 * `src/parser/expression.ts`. Each case lexes a snippet, parses one
 * expression, and asserts the tree SHAPE (operator nesting), which is
 * how we pin precedence and associativity. Spans are checked to map
 * back to source. See openspec change `st-body-ast`.
 */
import { describe, expect, it } from "bun:test";
import { lex } from "../../lexer/lexer.js";
import { Cursor } from "../../parser/cursor.js";
import { parseExpression } from "../../parser/expression.js";
import type { BinaryExpr, CallExpr, Expr, IndexExpr, MemberExpr, UnaryExpr } from "../../parser/ast.js";

function parse(src: string): { expr: Expr; ok: boolean } {
	const cur = new Cursor(lex(src));
	const expr = parseExpression(cur);
	const ok = expr !== undefined && cur.getErrors().length === 0 && cur.atEof();
	if (expr === undefined) throw new Error(`failed to parse: ${src}`);
	return { expr, ok };
}

/** Compact shape string for asserting nesting: `(op L R)`, `name`, `lit`, `call(callee; args)`. */
function shape(e: Expr): string {
	switch (e.kind) {
		case "ident_expr":
			return e.name;
		case "literal":
			return e.text;
		case "binary":
			return `(${e.op} ${shape(e.left)} ${shape(e.right)})`;
		case "unary":
			return `(${e.op}. ${shape(e.operand)})`;
		case "member":
			return `${shape(e.base)}.${e.member.name}`;
		case "index":
			return `${shape(e.base)}[${e.indices.map(shape).join(",")}]`;
		case "deref":
			return `${shape(e.base)}^`;
		case "call":
			return `${shape(e.callee)}(${e.args.map((a) => (a.param ? `${a.param.name}${a.output ? "=>" : ":="}` : "") + (a.value ? shape(a.value) : "")).join(",")})`;
		case "paren":
			return `<${shape(e.inner)}>`;
	}
}

describe("expression precedence", () => {
	it("multiplicative binds tighter than additive", () => {
		expect(shape(parse("a + b * c").expr)).toBe("(+ a (* b c))");
	});

	it("additive binds tighter than comparison, comparison tighter than equality", () => {
		expect(shape(parse("a + b < c = d").expr)).toBe("(= (< (+ a b) c) d)");
	});

	it("AND binds tighter than OR; NOT is unary and tightest of the boolean ops", () => {
		expect(shape(parse("a OR b AND NOT c").expr)).toBe("(OR a (AND b (NOT. c)))");
	});

	it("& is AND-level", () => {
		expect(shape(parse("a & b OR c").expr)).toBe("(OR (& a b) c)");
	});

	it("MOD is multiplicative-level", () => {
		expect(shape(parse("a + b MOD c").expr)).toBe("(+ a (MOD b c))");
	});
});

describe("associativity", () => {
	it("additive is left-associative", () => {
		expect(shape(parse("a - b - c").expr)).toBe("(- (- a b) c)");
	});

	it("exponent is right-associative", () => {
		expect(shape(parse("a ** b ** c").expr)).toBe("(** a (** b c))");
	});
});

describe("postfix chains", () => {
	it("member / index / deref chain, tighter than operators", () => {
		expect(shape(parse("p^.field[i]").expr)).toBe("p^.field[i]");
	});

	it("bit access a.0 / a.15 (CODESYS numeric member)", () => {
		// From the corpus: `slice.0 := sliceInfo.component[1].forceValue`.
		expect(shape(parse("slice.0").expr)).toBe("slice.0");
		expect(shape(parse("status.15").expr)).toBe("status.15");
	});

	it("member chain a.b.c", () => {
		const e = parse("a.b.c").expr as MemberExpr;
		expect(e.kind).toBe("member");
		expect(e.member.name).toBe("c");
		expect((e.base as MemberExpr).member.name).toBe("b");
		expect(shape(e)).toBe("a.b.c");
	});

	it("nested calls a(b(c))", () => {
		expect(shape(parse("a(b(c))").expr)).toBe("a(b(c))");
	});

	it("member call fb.method() is a call on a member", () => {
		const e = parse("fb.method()").expr as CallExpr;
		expect(e.kind).toBe("call");
		expect((e.callee as MemberExpr).kind).toBe("member");
	});
});

describe("call arguments", () => {
	it("positional args", () => {
		expect(shape(parse("Increment.State(ActState, XUnitsToParking(), S1)").expr)).toBe(
			"Increment.State(ActState,XUnitsToParking(),S1)",
		);
	});

	it("named input and output args", () => {
		expect(shape(parse("TON(IN := start, PT := t#1s, Q => done)").expr)).toBe(
			"TON(IN:=start,PT:=t#1s,Q=>done)",
		);
	});

	it("unconnected output args (`out => ,` / `out => )`) — CODESYS routes the output nowhere", () => {
		// From the corpus: `InputControl[...](sliceNumber := s, bit1 => x, bit2 => , bit3 => y)`.
		const call = parse("FB(a := 1, b => , c => x)").expr;
		expect(shape(call)).toBe("FB(a:=1,b=>,c=>x)");
		// The empty output keeps its param name but carries no value.
		if (call.kind !== "call") throw new Error("expected a call");
		const empty = call.args[1]!;
		expect(empty.param?.name).toBe("b");
		expect(empty.output).toBe(true);
		expect(empty.value).toBeUndefined();
	});

	it("trailing unconnected output before `)`", () => {
		expect(shape(parse("FB(x := 1, done => )").expr)).toBe("FB(x:=1,done=>)");
	});

	it("unconnected INPUT args (`in := ,`) — CODESYS leaves the input at default", () => {
		// From the corpus (BFU.prg): `GateBFU(xRequestForOpening := , xAcknowledgement := , …)`.
		const call = parse("FB(a := 1, xReq := , xAck := , n := 0)").expr;
		if (call.kind !== "call") throw new Error("expected a call");
		expect(call.args[1]!.param?.name).toBe("xReq");
		expect(call.args[1]!.output).toBe(false); // an INPUT left empty
		expect(call.args[1]!.value).toBeUndefined();
	});
});

describe("inline assignment expression (CODESYS)", () => {
	it("`(x := value)` parses as an assign-expr yielding the value", () => {
		// From the corpus (XYControlFB): `IF (result[1] OR_ELSE (result[1] := yUnit.MoveToTakeover(4))) …`.
		const e = parse("(r := Compute())").expr;
		if (e.kind !== "paren") throw new Error("expected paren");
		expect(e.inner.kind).toBe("assign_expr");
		const a = e.inner;
		if (a.kind !== "assign_expr") throw new Error("expected assign_expr");
		expect(a.target.kind).toBe("ident_expr");
		expect(a.value.kind).toBe("call");
	});
});

describe("standard-function keywords as callees", () => {
	it("ADR(x) parses (ADR is a keyword, not an identifier)", () => {
		expect(shape(parse("ADR(x)").expr)).toBe("ADR(x)");
	});
});

describe("multi-index and parens", () => {
	it("2-D index", () => {
		const e = parse("grid[i, j]").expr as IndexExpr;
		expect(e.kind).toBe("index");
		expect(e.indices).toHaveLength(2);
	});

	it("parens override precedence", () => {
		expect(shape(parse("(a + b) * c").expr)).toBe("(* <(+ a b)> c)");
	});
});

describe("spans map back to source", () => {
	it("binary span covers the whole expression", () => {
		const src = "alpha + beta";
		const { expr } = parse(src);
		expect(src.slice(expr.span.start, expr.span.end)).toBe("alpha + beta");
	});

	it("unary minus span", () => {
		const src = "-x";
		const e = parse(src).expr as UnaryExpr;
		expect(e.kind).toBe("unary");
		expect(src.slice(e.span.start, e.span.end)).toBe("-x");
	});
});

describe("parse cleanliness", () => {
	it("fully consumes a well-formed expression", () => {
		expect(parse("a AND (b OR c) = d").ok).toBe(true);
	});
});
