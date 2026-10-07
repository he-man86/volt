/**
 * statement-rules: C0018 (assign to a VAR CONSTANT) + C0132 (EXIT outside a loop).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { computeDiagnostics, resolveConfig } from "../../index.js"
import { build } from "../../../frontend/symbols/index.js"
import { uriFor } from "../../test-uri.js"

const run =
  (code: string) =>
  (body: string): string[] => {
    const src = `PROGRAM P\nVAR i:INT; ii:INT;\nEND_VAR\nVAR CONSTANT j:INT:=0;\nEND_VAR\n${body}\nEND_PROGRAM`
    const pr = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
    return computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
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
    const pr = parseSource(src(b), { networkText: true })
    const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src(b) }])
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
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }])
  const msgs = computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "exit-outside-loop")
    .map((d) => d.message)
  expect(msgs).toEqual(["No enclosing loop of which to exit", "No enclosing loop of which to continue"])
  // inside a loop, both are fine
  const ok = `FUNCTION_BLOCK F\nVAR\ni : INT;\nEND_VAR\nFOR i := 1 TO 3 DO\nCONTINUE;\nEXIT;\nEND_FOR\nEND_FUNCTION_BLOCK`
  const okParse = parseSource(ok, { networkText: true })
  expect(
    computeDiagnostics({
      uri: uriFor(okParse),
      parseResult: okParse,
      source: ok,
      project: build.buildSymbolTable([{ uri: "F.pou", parseResult: okParse, source: ok }]),
      config: resolveConfig({ vendor: "codesys" }),
    }).filter((d) => d.code === "exit-outside-loop"),
  ).toEqual([])
})

// A CONSTANT global written through the global-namespace dot is the same refusal, quoting the target as written:
// "'.gcTarget' is no valid assignment target" (`expr_global_namespace_constant_target`, both vendors 2026-10-02).
test("C0018: a CONSTANT global written as `.g` is flagged as written (expr_global_namespace_constant_target, E33)", () => {
  const src = `VAR_GLOBAL CONSTANT\ngc : INT := 7;\nEND_VAR\nVAR_GLOBAL\ngv : INT;\nEND_VAR\nFUNCTION_BLOCK F\nVAR gc : INT;\nEND_VAR\n.gc := 5;\n.gv := 5;\ngc := 5;\nEND_FUNCTION_BLOCK`
  const pr = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
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
    const pr = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
    return computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "for-control-type" || d.code === "loop-exit-constant")
      .map((d) => d.message)
  }
  // both vendors 2026-10-02 — and nothing else: no endless-loop warning on the refused BOOL counter
  expect(forType("rv : REAL", "FOR rv := 1.0 TO 3.0 DO\n\tn := n + 1;\nEND_FOR")).toEqual(["Cannot convert type 'REAL' to type 'ANY_INT'"])
  expect(forType("bv : BOOL", "FOR bv := 0 TO 1 DO\n\tn := n + 1;\nEND_FOR")).toEqual(["Cannot convert type 'BOOL' to type 'ANY_INT'"])
  expect(forType("dw : DWORD", "FOR dw := 1 TO 3 DO\n\tn := n + 1;\nEND_FOR")).toEqual([])
})

test("C0018: a direct address is a target, no literal refused (lit_address_in_body, ca_direct_address_expression)", () => {
  expect(assign(`%MW6 := i;\n%MX7.3 := TRUE;`)).toEqual([])
})

// analysis-conformance 3.9 (`flw_assign_input_constant`, both vendors 2026-10-06): a VAR_INPUT CONSTANT is written in the
// body without a word from either vendor — CONSTANT there forbids nothing the body does
test("a VAR_INPUT CONSTANT assigned in the body is no constant target", () => {
  const src = `FUNCTION_BLOCK F\nVAR_INPUT CONSTANT\n\tlimit_ : INT := 4;\nEND_VAR\nlimit_ := 5;\nEND_FUNCTION_BLOCK`
  const pr = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  expect(
    computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "not-assignment-target")
      .map((d) => d.message),
  ).toEqual([])
})
