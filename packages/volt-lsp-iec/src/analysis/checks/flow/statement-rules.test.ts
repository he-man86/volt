/**
 * statement-rules: C0018 (assign to a VAR CONSTANT) + C0132 (EXIT outside a loop).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { computeDiagnostics, resolveConfig } from "../../index.js"
import { build } from "../../../frontend/symbols/index.js"
import { uriFor } from "../../../../test/support/test-uri.js"
import { diagnose } from "../../../../test/support/diagnose.js"

const run =
  (code: string) =>
  (body: string): string[] => {
    const src = `PROGRAM P\nVAR i:INT; ii:INT;\nEND_VAR\nVAR CONSTANT j:INT:=0;\nEND_VAR\n${body}\nEND_PROGRAM`
    return diagnose(src)
      .filter((d) => d.code === code)
      .map((d) => d.message)
  }
const assign = run("not-assignment-target")
const exit = run("exit-outside-loop")

test("C0018: writing to a VAR CONSTANT is flagged; reading it is fine", () => {
  expect(assign(`j := i;`)).toEqual(["'j' is no valid assignment target"])
  expect(assign(`i := j;`)).toEqual([])
})

test("C0132: EXIT outside a loop is flagged; EXIT nested inside a loop is not", () => {
  expect(exit(`EXIT;`)).toEqual(["No enclosing loop of which to exit"])
  expect(exit(`FOR ii:=0 TO 2 DO\n IF i>0 THEN EXIT; END_IF\nEND_FOR`)).toEqual([]) // loop context propagates into IF
})

test("C0509: __NEW in a chained assignment is flagged; a single __NEW is not", () => {
  const src = (b: string) => `FUNCTION_BLOCK F\nVAR pa:POINTER TO BYTE; pb:POINTER TO BYTE;\nEND_VAR\n${b}\nEND_FUNCTION_BLOCK`
  const nw = (b: string) => {
    const pr = parseSource(src(b), { networkText: true, unicodeIdentifiers: false }, "codesys")
    const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src(b) }], [], "codesys")
    return computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src(b), project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "multiple-assignment-new")
      .map((d) => d.message)
  }
  expect(nw(`pb := pa := __NEW(BYTE);`)).toEqual(["Multiple assignments are not allowed for operator '__New'."])
  expect(nw(`pa := __NEW(BYTE);`)).toEqual([])
})

test("CONTINUE outside a loop is reported too, and the compiler names the statement", () => {
  // silent before: only EXIT was checked (conformance `cc2_exit_outside_loop`, which records both).
  const src = `FUNCTION_BLOCK F\nVAR\nn : INT;\nEND_VAR\nn := 1;\nEXIT;\nCONTINUE;\nEND_FUNCTION_BLOCK`
  const parseResult = parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys")
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }], [], "codesys")
  const msgs = computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "exit-outside-loop")
    .map((d) => d.message)
  expect(msgs).toEqual(["No enclosing loop of which to exit", "No enclosing loop of which to continue"])
  // inside a loop, both are fine
  const ok = `FUNCTION_BLOCK F\nVAR\ni : INT;\nEND_VAR\nFOR i := 1 TO 3 DO\nCONTINUE;\nEXIT;\nEND_FOR\nEND_FUNCTION_BLOCK`
  const okParse = parseSource(ok, { networkText: true, unicodeIdentifiers: false }, "codesys")
  expect(
    computeDiagnostics({
      uri: uriFor(okParse),
      parseResult: okParse,
      source: ok,
      project: build.buildSymbolTable([{ uri: "F.pou", parseResult: okParse, source: ok }], [], "codesys"),
      config: resolveConfig({ vendor: "codesys" }),
    }).filter((d) => d.code === "exit-outside-loop"),
  ).toEqual([])
})

// A CONSTANT global written through the global-namespace dot is the same refusal, quoting the target as written:
// "'.gcTarget' is no valid assignment target" (`expr_global_namespace_constant_target`, both vendors 2026-10-02).
test("C0018: a CONSTANT global written as `.g` is flagged as written (expr_global_namespace_constant_target, E33)", () => {
  const src = `VAR_GLOBAL CONSTANT\ngc : INT := 7;\nEND_VAR\nVAR_GLOBAL\ngv : INT;\nEND_VAR\nFUNCTION_BLOCK F\nVAR gc : INT;\nEND_VAR\n.gc := 5;\n.gv := 5;\ngc := 5;\nEND_FUNCTION_BLOCK`
  const pr = parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys")
  const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }], [], "codesys")
  const msgs = computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "not-assignment-target")
    .map((d) => d.message)
  // the local `gc` shadows the global for the bare spelling only
  expect(msgs).toEqual(["'.gc' is no valid assignment target"])
})

test("C0018: a chain's inner target and a FOR control variable that are no name are refused, echoed as the compiler does (stmt_chain_literal_inner_target, expr_inline_assign_operand, stmt_for_literal_control, stmt_chain_negated_inner_target, stmt_for_negated_control, ST4/ST11)", () => {
  expect(assign(`i := 1 := ii;`)).toEqual(["'1' is no valid assignment target"])
  expect(assign(`i := 1 + ii := 2;`)).toEqual(["'(INT#1 + ii)' is no valid assignment target"])
  expect(assign(`FOR 1 := 1 TO 3 DO\n\ti := i + 1;\nEND_FOR`)).toEqual(["'1' is no valid assignment target"])
  // …and a NEGATION, as the compiler writes it (`stmt_chain_negated_inner_target`, `stmt_for_negated_control`, CODESYS
  // 2026-10-02)
  expect(assign(`i := -ii := 2;`)).toEqual(["'(INT#0 - ii)' is no valid assignment target"])
  expect(assign(`FOR -ii := 1 TO 3 DO
	i := ii;
END_FOR`)).toEqual(["'(INT#0 - ii)' is no valid assignment target"])
  // …a name, a member, an index stay targets
  expect(assign(`i := ii := 2;\nFOR ii := 1 TO 3 DO\n\ti := i + 1;\nEND_FOR`)).toEqual([])
})

test("a FOR counts in an integer: a REAL or a BOOL control variable does not convert to ANY_INT, a DWORD does (stmt_for_real_control, stmt_for_bool_control, stmt_for_dword_control, ST11)", () => {
  const forType = (decl: string, loop: string): string[] => {
    const src = `PROGRAM P\nVAR ${decl}; n : INT;\nEND_VAR\n${loop}\nEND_PROGRAM`
    return diagnose(src)
      .filter((d) => d.code === "for-control-type" || d.code === "loop-exit-constant")
      .map((d) => d.message)
  }
  // both vendors 2026-10-02 — and nothing else: no endless-loop warning on the refused BOOL counter
  expect(forType("rv : REAL", "FOR rv := 1.0 TO 3.0 DO\n\tn := n + 1;\nEND_FOR")).toEqual(["Cannot convert type 'REAL' to type 'ANY_INT'"])
  expect(forType("bv : BOOL", "FOR bv := 0 TO 1 DO\n\tn := n + 1;\nEND_FOR")).toEqual(["Cannot convert type 'BOOL' to type 'ANY_INT'"])
  expect(forType("dw : DWORD", "FOR dw := 1 TO 3 DO\n\tn := n + 1;\nEND_FOR")).toEqual([])
})

// lsp-transpile-review-gaps 1.1 / 1.2 / 2.1 (CODESYS run recordings 2026-09-29, 2026-10-08): a FOR bound is judged by its
// TYPE against the counter — a DINT limit or step on an INT counter, an INT one on a BYTE, is "Cannot convert type 'DINT' to
// type 'INT'" — and an untyped literal step by its VALUE (300 on a SINT is "… 'INT' to type 'SINT'"; -1 and 255 on a BYTE
// are taken). A same-width sign change converts, and an expression of untyped literals has no named type.
test("a FOR limit or step that does not convert into the counter is refused (for_limit_wider_than_counter_*, for_step_*, tr_35_*)", () => {
  const bound = (decl: string, loop: string): string[] => {
    const src = `PROGRAM P\nVAR ${decl}; n : INT;\nEND_VAR\nVAR CONSTANT kc : DINT := 3;\nEND_VAR\n${loop}\nEND_PROGRAM`
    return diagnose(src)
      .filter((d) => d.severity === "error")
      .map((d) => d.message)
  }
  const dintIntoInt = ["Cannot convert type 'DINT' to type 'INT'"]
  const body = "DO n := n + 1; END_FOR"
  expect(bound("i : INT; k : DINT", `FOR i := 1 TO k ${body}`)).toEqual(dintIntoInt)
  expect(bound("i : INT; k : DINT", `FOR i := 1 TO k - 1 ${body}`)).toEqual(dintIntoInt)
  expect(bound("i : INT; a : ARRAY[0..4] OF INT", `FOR i := 0 TO UPPER_BOUND(a, 1) ${body}`)).toEqual(dintIntoInt)
  expect(bound("i : INT", `FOR i := 1 TO kc ${body}`)).toEqual(dintIntoInt)
  expect(bound("i : INT", `FOR i := 1 TO DINT#5 ${body}`)).toEqual(dintIntoInt)
  expect(bound("i : INT; k : DINT", `FOR i := 0 TO 10 BY (k - 1) ${body}`)).toEqual(dintIntoInt)
  expect(bound("i : INT; a : ARRAY[0..3] OF INT", `FOR i := 0 TO 10 BY UPPER_BOUND(a, 1) ${body}`)).toEqual(dintIntoInt)
  expect(bound("b : BYTE", `FOR b := 5 TO 0 BY INT#-1 ${body}`)).toEqual(["Cannot convert type 'INT' to type 'BYTE'"])
  expect(bound("b : BYTE; stp : INT", `FOR b := 5 TO 1 BY stp ${body}`)).toEqual(["Cannot convert type 'INT' to type 'BYTE'"])
  expect(bound("sc : SINT", `FOR sc := 1 TO 10 BY 300 ${body}`)).toEqual(["Cannot convert type 'INT' to type 'SINT'"])
  // …and what CODESYS takes
  expect(bound("u : UINT; k : UINT", `FOR u := 0 TO k - 1 ${body}`)).toEqual([])
  expect(bound("u : UINT; k : INT", `FOR u := 1 TO k ${body}`)).toEqual([])
  expect(bound("i : INT; k : UINT", `FOR i := 1 TO k ${body}`)).toEqual([])
  expect(bound("b : BYTE", `FOR b := 5 TO 1 BY -1 ${body}`)).toEqual([])
  expect(bound("b : BYTE", `FOR b := 1 TO 10 BY 255 ${body}`)).toEqual([])
  expect(bound("u : UINT", `FOR u := 10 TO 2 BY -2 ${body}`)).toEqual([])
  expect(bound("sc : SINT", `FOR sc := 5 TO -5 BY -1 ${body}`)).toEqual([])
  expect(bound("sc : SINT", `FOR sc := 1 TO 200 ${body}`)).toEqual([])
  expect(bound("i : INT; g : BOOL", `FOR i := 0 TO 10 BY SEL(g, 2, -2) ${body}`)).toEqual([])
})

test("C0018: a direct address is a target, no literal refused (lit_address_in_body, ca_direct_address_expression)", () => {
  expect(assign(`%MW6 := i;\n%MX7.3 := TRUE;`)).toEqual([])
})

// analysis-conformance 3.9 (`flw_assign_input_constant`, both vendors 2026-10-06): a VAR_INPUT CONSTANT is written in the
// body without a word from either vendor — CONSTANT there forbids nothing the body does
test("a VAR_INPUT CONSTANT assigned in the body is no constant target", () => {
  const src = `FUNCTION_BLOCK F\nVAR_INPUT CONSTANT\n\tlimit_ : INT := 4;\nEND_VAR\nlimit_ := 5;\nEND_FUNCTION_BLOCK`
  const pr = parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys")
  const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }], [], "codesys")
  expect(
    computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "not-assignment-target")
      .map((d) => d.message),
  ).toEqual([])
})
