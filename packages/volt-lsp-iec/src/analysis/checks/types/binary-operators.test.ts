/**
 * binary-op-type-mismatch — arithmetic on a string operand (gap 11). Every expectation is CODESYS's recorded wording
 * (conformance `cc_string_*`, `cc_int_plus_string`, `cc_wstring_plus_wstring`; execution oracle `string_arithmetic_rejected`).
 */
import { expect, test } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const mismatches = (vars: string, body: string): string[] => {
  const src = `PROGRAM PLC_PRG\nVAR\n${vars}\nEND_VAR\n${body}\nEND_PROGRAM`
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.prg", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "binary-op-type-mismatch")
    .map((d) => d.message)
}

test("a string on the LEFT of + - * / must become a number — one ANY_NUM message, STRING and WSTRING alike", () => {
  // It was silent: the check knew MOD and BOOL-with-a-number, and no fixture added two strings.
  for (const op of ["+", "-"]) expect(mismatches("a : STRING; b : STRING; c : STRING;", `c := a ${op} b;`)).toEqual(["Cannot convert type 'STRING' to type 'ANY_NUM'"])
  for (const op of ["*", "/"]) expect(mismatches("a : STRING; i : INT; c : STRING;", `c := a ${op} i;`)).toEqual(["Cannot convert type 'STRING' to type 'ANY_NUM'"])
  expect(mismatches("a : WSTRING; b : WSTRING; c : WSTRING;", "c := a + b;")).toEqual(["Cannot convert type 'WSTRING' to type 'ANY_NUM'"])
})

test("a string on the RIGHT of a number must become that number's type", () => {
  expect(mismatches("a : STRING; i : INT; j : INT;", "j := i + a;")).toEqual(["Cannot convert type 'STRING' to type 'INT'"])
})

test("comparing strings is not arithmetic — no message", () => {
  expect(mismatches("a : STRING; b : STRING; same : BOOL;", "same := a = b;")).toEqual([])
})
