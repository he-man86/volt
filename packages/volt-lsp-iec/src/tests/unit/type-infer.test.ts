/**
 * Expression type-inference tests (st-type-inference §2). Build a symbol
 * table from a small project, parse an expression, and assert its inferred
 * type name / member-chain symbol. `unknown` propagation is the key
 * zero-FP guarantee. See openspec change `st-type-inference`.
 */
import { describe, expect, it } from "bun:test";
import { lex } from "../../lexer/lexer.js";
import { Cursor } from "../../parser/cursor.js";
import { parseExpression } from "../../parser/expression.js";
import { inferExprType, resolveMemberChain } from "../../semantic/type-infer.js";
import type { Scope } from "../../semantic/symbol-table.js";
import { buildProject } from "../support/diagnostics.js";

const SRC = `
TYPE Point : STRUCT x : REAL; y : LREAL; END_STRUCT END_TYPE
FUNCTION_BLOCK Motor
VAR
	speed : LREAL;
	running : BOOL;
	name : STRING;
	pos : Point;
	arr : ARRAY[0..9] OF INT;
	p : POINTER TO DINT;
END_VAR
END_FUNCTION_BLOCK
`;

function build(): { project: Scope; fb: Scope } {
	const { project } = buildProject(SRC);
	const fb = project.children.find((c) => c.name.toLowerCase() === "motor");
	if (fb === undefined) throw new Error("Motor scope not built");
	return { project, fb };
}
function parseExpr(s: string) {
	const e = parseExpression(new Cursor(lex(s)));
	if (e === undefined) throw new Error(`cannot parse: ${s}`);
	return e;
}
function typeOf(src: string): string | undefined {
	const { project, fb } = build();
	return inferExprType(parseExpr(src), fb, project).name;
}

describe("identifier + elementary types", () => {
	it("LREAL var", () => expect(typeOf("speed")).toBe("LREAL"));
	it("BOOL var", () => expect(typeOf("running")).toBe("BOOL"));
	it("STRING var", () => expect(typeOf("name")).toBe("STRING"));
	it("unknown identifier ⇒ undefined (skip)", () => expect(typeOf("nope")).toBeUndefined());
});

describe("member / index / deref chains", () => {
	it("member: pos.x is REAL", () => expect(typeOf("pos.x")).toBe("REAL"));
	it("member: pos.y is LREAL", () => expect(typeOf("pos.y")).toBe("LREAL"));
	it("array element: arr[3] is INT", () => expect(typeOf("arr[3]")).toBe("INT"));
	it("deref: p^ is DINT", () => expect(typeOf("p^")).toBe("DINT"));
	it("unknown member ⇒ undefined", () => expect(typeOf("pos.z")).toBeUndefined());
});

describe("operators", () => {
	it("comparison ⇒ BOOL", () => expect(typeOf("speed > speed")).toBe("BOOL"));
	it("equality ⇒ BOOL", () => expect(typeOf("running = running")).toBe("BOOL"));
	it("same-type arithmetic keeps the type", () => expect(typeOf("speed + speed")).toBe("LREAL"));
	it("mixed/unknown arithmetic ⇒ undefined (conservative)", () => expect(typeOf("speed + arr")).toBeUndefined());
	it("unary NOT preserves operand type", () => expect(typeOf("NOT running")).toBe("BOOL"));
	it("parens are transparent", () => expect(typeOf("(pos.x)")).toBe("REAL"));
	it("numeric literal is context-dependent ⇒ undefined", () => expect(typeOf("42")).toBeUndefined());
});

describe("resolveMemberChain (nav primitive)", () => {
	it("resolves the final member symbol", () => {
		const { project, fb } = build();
		const sym = resolveMemberChain(parseExpr("pos.x"), fb, project);
		expect(sym?.name).toBe("x");
	});
	it("resolves a bare ident", () => {
		const { project, fb } = build();
		expect(resolveMemberChain(parseExpr("speed"), fb, project)?.name).toBe("speed");
	});
	it("undefined for an unresolved chain", () => {
		const { project, fb } = build();
		expect(resolveMemberChain(parseExpr("pos.z"), fb, project)).toBeUndefined();
	});
});
