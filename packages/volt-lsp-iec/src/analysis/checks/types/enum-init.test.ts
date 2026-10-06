/**
 * enum-init (C0124): an enum member initialized with a real value is flagged; integer inits, references to
 * sibling members, and plain enums are not.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../test-uri.js"

const ei = (src: string): string[] => {
  const pr = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
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
  return computeSemanticDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => (d.severity === "error" || d.severity === "warning") && d.code !== "signature-name-mismatch")
    .map((d) => `${d.severity}: ${d.message}`)
    .sort()
}

test("each value kind an enum member refuses, as both vendors word it (eninit_*)", () => {
  expect(enumAll("'x'")).toEqual(["error: 'x' is no valid initialisation for an enumeration", "error: Cannot convert type 'STRING(INT#1)' to type 'DUT'"])
  expect(enumAll("TRUE")).toEqual(["error: Cannot convert type 'BOOL' to type 'DUT'", "error: TRUE is no valid initialisation for an enumeration"])
  // a TIME literal is only the conversion — "no valid initialisation" is not said
  expect(enumAll("T#1S")).toEqual(["error: Cannot convert type 'TIME' to type 'DUT'"])
  // a non-constant global: not constant, and no valid initialisation
  expect(enumAll("g_var", "VAR_GLOBAL\n\tg_var : INT := 4;\nEND_VAR\n")).toEqual([
    "error: Initialisation of constant variable 'B' not constant",
    "error: g_var is no valid initialisation for an enumeration",
  ])
  // another enum's member converts with the enum-change warning
  expect(enumAll("SRC.X", "TYPE SRC : (X := 3); END_TYPE\n")).toEqual(["warning: Implicit conversion from one enumeration type (SRC) to another (DUT)"])
  // what converts stays silent: a typed INT literal, a sibling plus one, a global CONSTANT
  expect(enumAll("INT#5")).toEqual([])
  expect(enumAll("A + 1")).toEqual([])
  expect(enumAll("g_c", "VAR_GLOBAL CONSTANT\n\tg_c : INT := 4;\nEND_VAR\n")).toEqual([])
})
