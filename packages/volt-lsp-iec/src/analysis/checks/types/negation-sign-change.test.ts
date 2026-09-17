/**
 * The "change of sign" a unary minus puts on an UNSIGNED operand (narrowing.ts `negationOperandWarning`). Wording
 * and trigger set recorded live on CODESYS SP21 (conformance `cc_neg_uint_into_int`, `cc_neg_word_into_word`,
 * `cc_neg_udint_into_udint`, `cc_neg_usint_into_usint`).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../test-uri.js"

function warnings(decls: string, body: string) {
  const src = `PROGRAM PLC_PRG\nVAR\n  ${decls}\nEND_VAR\n${body}\nEND_PROGRAM`
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: uriFor(parseResult), parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.severity === "warning" || d.severity === "error")
    .map((d) => d.message)
}

test("negating a UINT converts it to INT first — CODESYS warns on the operand", () => {
  // Invisible before: unary minus was typed as its operand, so there was no conversion to warn about.
  expect(warnings("a : UINT; b : INT;", "b := -a;")).toEqual([
    "Implicit conversion from unsigned Type 'UINT' to signed Type 'INT' : Possible change of sign",
  ])
})

test("storing it back into the UINT adds the assignment's own change of sign — both recorded", () => {
  expect(warnings("a : UINT; b : UINT;", "b := -a;").sort()).toEqual(
    [
      "Implicit conversion from signed Type 'INT' to unsigned Type 'UINT' : Possible change of sign",
      "Implicit conversion from unsigned Type 'UINT' to signed Type 'INT' : Possible change of sign",
    ].sort(),
  )
})

test("an 8-bit unsigned operand widens into INT silently, and storing it back is the error CODESYS reports", () => {
  expect(warnings("a : USINT; b : USINT;", "b := -a;")).toEqual(["Cannot convert type 'INT' to type 'USINT'"])
  expect(warnings("a : SINT; b : SINT;", "b := -a;")).toEqual(["Cannot convert type 'INT' to type 'SINT'"])
})

test("a signed operand of 16 bits or more is untouched", () => {
  expect(warnings("a : INT; b : INT;", "b := -a;")).toEqual([])
  expect(warnings("a : SINT; b : INT;", "b := -a;")).toEqual([])
})
