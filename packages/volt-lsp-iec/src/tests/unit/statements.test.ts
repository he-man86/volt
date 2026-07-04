/**
 * Statement-parser tests — `src/parser/statements.ts`. Lexes a body
 * snippet, parses it, and asserts statement structure + the `ok`
 * contract (well-formed ⇒ ok; unmodeled construct ⇒ ok=false, no
 * throw). See openspec change `st-body-ast`.
 */
import { describe, expect, it } from "bun:test";
import { lex } from "../../lexer/lexer.js";
import { parseStatements } from "../../parser/statements.js";
import type { BodySpan } from "../../parser/ast.js";
import type { CaseStatement, ForStatement, IfStatement, RepeatStatement } from "../../parser/ast.js";

function body(src: string): BodySpan {
	return { kind: "body", tokens: lex(src), span: { start: 0, end: src.length, startLine: 1, startCol: 0, endLine: 1, endCol: 0 } };
}
function run(src: string) {
	return parseStatements(body(src));
}

describe("simple statements", () => {
	it("assignment", () => {
		const r = run("x := a + 1;");
		expect(r.ok).toBe(true);
		expect(r.statements).toHaveLength(1);
		expect(r.statements[0]!.kind).toBe("assign");
	});

	it("member/index l-value assignment", () => {
		const r = run("motor.speed[i] := 5;");
		expect(r.ok).toBe(true);
		expect(r.statements[0]!.kind).toBe("assign");
	});

	it("bare call statement", () => {
		const r = run("Increment.State(ActState, Foo(), S1);");
		expect(r.ok).toBe(true);
		expect(r.statements[0]!.kind).toBe("call_stmt");
	});

	it("empty statement (stray semicolon)", () => {
		const r = run("x := 1;; y := 2;");
		expect(r.ok).toBe(true);
		expect(r.statements.map((s) => s.kind)).toEqual(["assign", "empty", "assign"]);
	});

	it("RETURN / EXIT / CONTINUE", () => {
		expect(run("RETURN;").statements[0]!.kind).toBe("return");
		expect(run("EXIT;").statements[0]!.kind).toBe("exit");
		expect(run("CONTINUE;").statements[0]!.kind).toBe("continue");
	});
});

describe("IF", () => {
	it("IF / ELSIF / ELSE / END_IF", () => {
		const r = run("IF a THEN x := 1; ELSIF b THEN x := 2; ELSE x := 3; END_IF");
		expect(r.ok).toBe(true);
		const s = r.statements[0] as IfStatement;
		expect(s.kind).toBe("if");
		expect(s.branches).toHaveLength(2); // IF + ELSIF
		expect(s.elseBody).toHaveLength(1);
	});

	it("nested IF inside a branch", () => {
		const r = run("IF a THEN IF b THEN x := 1; END_IF END_IF");
		expect(r.ok).toBe(true);
		const outer = r.statements[0] as IfStatement;
		expect(outer.branches[0]!.body[0]!.kind).toBe("if");
	});
});

describe("CASE", () => {
	it("labels, ranges, ELSE", () => {
		const r = run("CASE state OF 0: x := 1; 1, 2: x := 2; 10..20: x := 3; ELSE x := 9; END_CASE");
		expect(r.ok).toBe(true);
		const s = r.statements[0] as CaseStatement;
		expect(s.kind).toBe("case");
		expect(s.arms).toHaveLength(3);
		expect(s.arms[1]!.labels).toHaveLength(2); // "1, 2"
		expect(s.arms[2]!.labels[0]!.upper).toBeDefined(); // range 10..20
		expect(s.elseBody).toHaveLength(1);
	});

	it("enum + qualified labels with a call body (real-shape)", () => {
		const r = run(
			"CASE ActState OF StateNone: ; StateGo: Increment.State(ActState, Foo(), StateNext); END_CASE",
		);
		expect(r.ok).toBe(true);
		const s = r.statements[0] as CaseStatement;
		expect(s.arms).toHaveLength(2);
		expect(s.arms[1]!.body[0]!.kind).toBe("call_stmt");
	});
});

describe("loops", () => {
	it("FOR with BY", () => {
		const r = run("FOR i := 1 TO 10 BY 2 DO total := total + i; END_FOR");
		expect(r.ok).toBe(true);
		const s = r.statements[0] as ForStatement;
		expect(s.kind).toBe("for");
		expect(s.by).toBeDefined();
	});

	it("WHILE", () => {
		const r = run("WHILE a < 10 DO a := a + 1; END_WHILE");
		expect(r.ok).toBe(true);
		expect(r.statements[0]!.kind).toBe("while");
	});

	it("REPEAT / UNTIL", () => {
		const r = run("REPEAT a := a + 1; UNTIL a >= 10 END_REPEAT");
		expect(r.ok).toBe(true);
		const s = r.statements[0] as RepeatStatement;
		expect(s.kind).toBe("repeat");
		expect(s.until).toBeDefined();
	});
});

describe("conditional-compile pragmas are ignored (trivia)", () => {
	it("pragma guards do not break parsing", () => {
		const r = run("{IF defined(FOO)}\nx := 1;\n{END_IF}\ny := 2;");
		expect(r.ok).toBe(true);
		expect(r.statements.map((s) => s.kind)).toEqual(["assign", "assign"]);
	});
});

describe("ok=false fallback (no throw, no invented nodes)", () => {
	it("unmodeled S= set-assignment falls back cleanly", () => {
		const r = run("myState.xCmdInit S= (FALSE);");
		expect(r.ok).toBe(false); // known gap (harden 8.2) — must fall back, not throw
	});

	it("truncated IF falls back", () => {
		const r = run("IF a THEN x := 1;");
		expect(r.ok).toBe(false);
	});

	it("garbage tokens fall back without throwing", () => {
		expect(() => run("@@@ ??? :=:=:=")).not.toThrow();
		expect(run("@@@ ??? :=:=:=").ok).toBe(false);
	});
});

describe("empty body", () => {
	it("empty body is ok with no statements", () => {
		const r = run("");
		expect(r.ok).toBe(true);
		expect(r.statements).toHaveLength(0);
	});
});
