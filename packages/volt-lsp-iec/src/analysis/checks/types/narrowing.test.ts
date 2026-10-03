/**
 * narrowing / sign-change on a DECLARATION's initializer, and how often the compiler reports it (see
 * `pushForDeclaration`). The conversion relation itself is covered by `implicit-conversion.test.ts`.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"


test("a VAR CONSTANT initializer warns ONCE in an FB, where a plain VAR warns twice", () => {
  // A constant is folded at compile time, not stored on the instance, so there is no instance initialisation to
  // check it a second time (conformance `co_any_to_conversions` — one warning — against `ir_initializer_warning_*`).
  const run = (section: string) => {
    const src = `FUNCTION_BLOCK F\n${section}\ncLimit : DINT := 16#80000000;\nEND_VAR\nEND_FUNCTION_BLOCK`
    const parseResult = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }])
    return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "sign-change-conversion")
      .map((d) => d.message)
  }
  expect(run("VAR CONSTANT")).toHaveLength(1)
  expect(run("VAR")).toHaveLength(2)
})

// THE CONVERSIONS INSIDE AN INITIALIZER, which is the body arm's question asked in the other place. The store
// here converts nothing — a DINT into a DINT — and the ARGUMENT converts everything: `EXPT` answers LREAL and
// `REAL_TO_DINT` wants a REAL (`cfold_expt`, `cfold_sqrt`, both recordings 2026-09-21).
test("a conversion ARGUMENT inside an initializer warns, and twice like any declaration", () => {
  const src = `FUNCTION_BLOCK F
VAR
	i : DINT := REAL_TO_DINT(EXPT(2, 10));
END_VAR
END_FUNCTION_BLOCK`
  const pr = parseSource(src, { networkText: true }, "codesys")
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult: pr, source: src }], [], "codesys")
  const messages = computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "narrowing-conversion")
    .map((d) => d.message)
  expect(messages).toEqual([
    "Implicit conversion from 'LREAL' to 'REAL': Possible loss of information",
    "Implicit conversion from 'LREAL' to 'REAL': Possible loss of information",
  ])
})

// ── LITERAL TYPING IN A CONTEXT (frontend-conformance 4.2, rule LT12; both vendors recorded 2026-10-03) ──

/** The sign-change and narrowing messages over `body` in an FB declaring `vars`, as `vendor`. */
const signMessages = (vars: string, body: string, vendor: "codesys" | "twincat"): string[] => {
  const src = `FUNCTION_BLOCK F\nVAR\n${vars}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK`
  const pr = parseSource(src, { networkText: true }, vendor)
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult: pr, source: src }], [], vendor)
  return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === "sign-change-conversion" || d.code === "narrowing-conversion")
    .map((d) => d.message)
}

test("an untyped non-negative literal beside a narrower variable converts nothing in a comparison — both vendors (`lt_literal_in_comparison`)", () => {
  for (const vendor of ["codesys", "twincat"] as const)
    expect(signMessages("si : SINT; i : INT; b : BOOL;", "b := si = 200;\nb := si < 300;\nb := i = 70000;\nb := i > -40000;", vendor)).toEqual([])
})

test("an untyped NEGATIVE literal beside an unsigned variable converts the literal — into the operand's type on TwinCAT, into UDINT on CODESYS (`lt_literal_negative_in_comparison_unsigned`)", () => {
  const body = "b := u = -1;\nb := ui > -1;"
  expect(signMessages("u : USINT; ui : UINT; b : BOOL;", body, "twincat")).toEqual([
    "Implicit conversion from signed Type 'SINT' to unsigned Type 'USINT' : possible change of sign",
    "Implicit conversion from signed Type 'SINT' to unsigned Type 'UINT' : possible change of sign",
  ])
  expect(signMessages("u : USINT; ui : UINT; b : BOOL;", body, "codesys")).toEqual([
    "Implicit conversion from signed Type 'SINT' to unsigned Type 'UDINT' : Possible change of sign",
    "Implicit conversion from signed Type 'SINT' to unsigned Type 'UDINT' : Possible change of sign",
  ])
})

test("a CASE label converts into the selector's type: 200 under a SINT selector is USINT → SINT (`lt_literal_case_label_out_of_range`)", () => {
  expect(signMessages("si : SINT; out : INT;", "CASE si OF\n100: out := 1;\n200: out := 2;\nEND_CASE", "codesys")).toEqual([
    "Implicit conversion from unsigned Type 'USINT' to signed Type 'SINT' : Possible change of sign",
  ])
  // labels the selector's type holds convert nothing (`lt_literal_case_label`)
  expect(signMessages("si : SINT; out : INT;", "CASE si OF\n-128: out := 1;\n0..10: out := 2;\n127: out := 3;\nEND_CASE", "twincat")).toEqual([])
})

test("a FOR bound converts into the counter's type: TO 200 over a SINT counter is USINT → SINT (`lt_literal_for_bounds_out_of_range`)", () => {
  expect(signMessages("si : SINT; n : INT;", "FOR si := 1 TO 200 DO\n\tn := n + 1;\nEND_FOR", "twincat")).toEqual([
    "Implicit conversion from unsigned Type 'USINT' to signed Type 'SINT' : possible change of sign",
  ])
  expect(signMessages("si : SINT; n : INT;", "FOR si := -128 TO 126 DO\n\tn := n + 1;\nEND_FOR\nFOR si := 0 TO 100 BY 2 DO\n\tn := n + 1;\nEND_FOR", "codesys")).toEqual([])
})

test("a CASE label converts only in the measured shape — a same-width unsigned literal under a signed selector; a negative label under an unsigned selector is unmeasured and silent (step 4a review)", () => {
  for (const vendor of ["codesys", "twincat"] as const)
    expect(signMessages("w : WORD; n : INT;", "CASE w OF\n-1: n := 2;\nEND_CASE", vendor)).toEqual([])
})

test("a NEGATIVE literal beside a 32- or 64-bit unsigned operand is unmeasured on both vendors and stays silent (step 4a review)", () => {
  for (const vendor of ["codesys", "twincat"] as const)
    expect(signMessages("ud : UDINT; ul : ULINT; b : BOOL;", "b := ud > -1;\nb := ul = -1;", vendor)).toEqual([])
})
