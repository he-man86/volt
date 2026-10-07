/**
 * enum-init (C0124): an enum member initialized with a real value is flagged; integer inits, references to
 * sibling members, and plain enums are not.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../test-uri.js"

const ei = (src: string): string[] => {
  const pr = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  return computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "enum-init-not-convertible")
    .map((d) => d.message)
}

test("a real-valued enum initializer is flagged — twice, as the compiler reports it", () => {
  // the VALUE as written, then the conversion it could not make (conformance `cc5_enum_init_not_convertible`)
  expect(ei(`TYPE DUT : (A := 1, B := 2.5); END_TYPE`)).toEqual([
    "2.5 is no valid initialisation for an enumeration",
    "Cannot convert type 'LREAL' to type 'DUT'",
  ])
})

test("integer inits, sibling references, and plain enums are not flagged", () => {
  expect(ei(`TYPE E : (A := 1, B := A, C := 10/3); END_TYPE`)).toEqual([])
  expect(ei(`TYPE E : (RED, GREEN, BLUE); END_TYPE`)).toEqual([])
})

/** Every error and warning an enum `(A := 0, B := <value>)` gives, with `before` ahead of it. */
const enumAll = (value: string, before = ""): string[] => {
  const src = `${before}TYPE DUT : (A := 0, B := ${value}); END_TYPE`
  const pr = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  return computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => (d.severity === "error" || d.severity === "warning") && d.code !== "signature-name-mismatch")
    .map((d) => `${d.severity}: ${d.message}`)
    .sort()
}

// A refused value leaves the member 0, beside `A := 0` here: both vendors then warn the duplicate value too (C0125 — the
// eninit_* recordings carry it; this test left it out while no check gave it, analysis-conformance 3.11).
test("each value kind an enum member refuses, as both vendors word it (eninit_*)", () => {
  expect(enumAll("'x'")).toEqual(["error: 'x' is no valid initialisation for an enumeration", "error: Cannot convert type 'STRING(INT#1)' to type 'DUT'", "warning: The constant 0 is assigned to more than one enumeration"])
  expect(enumAll("TRUE")).toEqual(["error: Cannot convert type 'BOOL' to type 'DUT'", "error: TRUE is no valid initialisation for an enumeration", "warning: The constant 0 is assigned to more than one enumeration"])
  // a TIME literal is only the conversion — "no valid initialisation" is not said
  expect(enumAll("T#1S")).toEqual(["error: Cannot convert type 'TIME' to type 'DUT'"])
  // a non-constant global: not constant, and no valid initialisation
  expect(enumAll("g_var", "VAR_GLOBAL\n\tg_var : INT := 4;\nEND_VAR\n")).toEqual([
    "error: Initialisation of constant variable 'B' not constant",
    "error: g_var is no valid initialisation for an enumeration",
    "warning: The constant 0 is assigned to more than one enumeration",
  ])
  // another enum's member converts with the enum-change warning
  expect(enumAll("SRC.X", "TYPE SRC : (X := 3); END_TYPE\n")).toEqual(["warning: Implicit conversion from one enumeration type (SRC) to another (DUT)"])
  // what converts stays silent: a typed INT literal, a sibling plus one, a global CONSTANT
  expect(enumAll("INT#5")).toEqual([])
  expect(enumAll("A + 1")).toEqual([])
  expect(enumAll("g_c", "VAR_GLOBAL CONSTANT\n\tg_c : INT := 4;\nEND_VAR\n")).toEqual([])
})

// ─── C0125: the duplicate enum value (analysis-conformance 3.11) ───
// "The constant <n> is assigned to more than one enumeration", a WARNING both vendors give alike, once for every member
// whose value an earlier member already holds (`enumdup_three_alike`: two, at B and C) — written, implicit or folded
// (`enumdup_implicit_meets_written`, `_constant_and_literal`, `_other_enum_member`, `_sibling_name`), on an inline enum too
// (`enumdup_inline_enum`). A refused value leaves 0 (`eninit_*` beside `A := 0`; `eninit_invalid_first_member`,
// `_beside_nonzero` silent), and the member after it is no fact (`enumdup_after_refused_implicit`: (1, 2.5, C) is silent).
const dups = (src: string): string[] => {
  const pr = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  return computeDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "enum-duplicate-value")
    .map((d) => `${d.severity}: ${d.message}`)
}
const dupWarning = (n: string): string => `warning: The constant ${n} is assigned to more than one enumeration`

test("a value an earlier member holds warns, once per repeating member", () => {
  expect(dups("TYPE E : (A := 0, B := 0); END_TYPE")).toEqual([dupWarning("0")])
  expect(dups("TYPE E : (A := 1, B := 1, C := 1); END_TYPE")).toEqual([dupWarning("1"), dupWarning("1")])
  expect(dups("TYPE E : (A := 1, B := 1, C := 2, D := 2); END_TYPE")).toEqual([dupWarning("1"), dupWarning("2")])
  expect(dups("TYPE E : (A := 1, B, C := 2); END_TYPE")).toEqual([dupWarning("2")])
  expect(dups("TYPE E : (A := -1, B := -1); END_TYPE")).toEqual([dupWarning("-1")])
  expect(dups("TYPE E : (A := 1, B := 1) BYTE; END_TYPE")).toEqual([dupWarning("1")])
  expect(dups("TYPE E : (A := 1, B := A); END_TYPE")).toEqual([dupWarning("1")])
  expect(dups("VAR_GLOBAL CONSTANT\n\tg4 : INT := 4;\nEND_VAR\nTYPE E : (A := g4, B := 4); END_TYPE")).toEqual([dupWarning("4")])
  expect(dups("TYPE S : (X := 3); END_TYPE\nTYPE E : (A := 3, B := S.X); END_TYPE")).toEqual([dupWarning("3")])
  expect(dups("FUNCTION_BLOCK F\nVAR\n\te : (A := 1, B := 1);\nEND_VAR\nEND_FUNCTION_BLOCK")).toEqual([dupWarning("1")])
})

test("distinct values are silent; a refused value is 0 and the member after it no fact", () => {
  expect(dups("TYPE E : (A, B, C); END_TYPE")).toEqual([])
  expect(dups("TYPE E : (A := 1, B := A + 1); END_TYPE")).toEqual([])
  expect(dups("TYPE E : (A := 0, B := 2.5); END_TYPE")).toEqual([dupWarning("0")])
  expect(dups("TYPE E : (A := 2.5, B := 1); END_TYPE")).toEqual([])
  expect(dups("TYPE E : (A := 5, B := 2.5, C := 6); END_TYPE")).toEqual([])
  expect(dups("TYPE E : (A := 1, B := 2.5, C); END_TYPE")).toEqual([])
})

// The 3.11 gate review's cells (both vendors alike): a LATER sibling's name folds as an earlier one does
// (`enumdup_forward_sibling`: "The constant 1" at B); a refused member before a member written 0 is 0 too
// (`enumdup_refused_then_zero`), and two refused members meet at 0 (`enumdup_two_refused`, one warning); an inline enum as
// a STRUCT's component warns as one of a variable does (`enumdup_struct_inline_enum`).
test("a later sibling, a refused member first, two refused members, an inline enum in a STRUCT", () => {
  expect(dups("TYPE E : (A := B, B := 1); END_TYPE")).toEqual([dupWarning("1")])
  expect(dups("TYPE E : (A := 2.5, B := 0); END_TYPE")).toEqual([dupWarning("0")])
  expect(dups("TYPE E : (A := 2.5, B := 3.5); END_TYPE")).toEqual([dupWarning("0")])
  expect(dups("TYPE S :\nSTRUCT\n\te : (A := 1, B := 1);\nEND_STRUCT\nEND_TYPE")).toEqual([dupWarning("1")])
})
