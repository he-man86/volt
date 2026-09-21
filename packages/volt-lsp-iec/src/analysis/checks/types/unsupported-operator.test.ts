/**
 * unsupported-operator — `**` and `&` are not CODESYS operators, and what FOLLOWS one is left over: a literal is
 * simply named, an identifier is re-read as a statement of its own and warned about (`analysis/resync`). Recorded
 * live on CODESYS SP21 (conformance `cc_power_operator`, `cc_fp_op_ampersand`); TwinCAT unmeasured, CODESYS-only.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import type { Vendor } from "../../config.js"

function unsupported(decls: string, body: string, vendor: Vendor = "codesys") {
  const src = `PROGRAM PLC_PRG\nVAR\n  ${decls}\nEND_VAR\n${body}\nEND_PROGRAM`
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.prg", parseResult, source: src }], [], vendor)
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === "unsupported-operator")
    .map((d) => d.message)
}

test("`**` reports CODESYS's two parse errors — the grammar took it from the IEC standard, never from a compiler", () => {
  expect(unsupported("x : REAL;", "x := 2.0 ** 3.0;")).toEqual([
    "';' expected instead of '**'",
    "Unexpected token '**' found",
    // `3.0` cannot start a statement, so it is simply named
    "';' expected instead of '3.0'",
    "Unexpected token '3.0' found",
  ])
})

test("`&` is not CODESYS's AND either — found when every grammar operator was required to have a fixture", () => {
  expect(unsupported("a : BOOL; b : BOOL; c : BOOL;", "c := a & b;")).toEqual([
    "';' expected instead of '&'",
    "Unexpected token '&' found",
    // `b` CAN start a statement, so the compiler re-reads `b;` as one — which does nothing
    "';' expected instead of 'b'",
    `The code 'b;\n' has no effect. Is this the intent?`,
  ])
})

test("the operators CODESYS does have are not flagged", () => {
  expect(unsupported("x : REAL;", "x := EXPT(2.0, 3.0);")).toEqual([])
  expect(unsupported("a : BOOL; b : BOOL; c : BOOL;", "c := a AND b;\nc := a XOR b;\nc := a AND_THEN b;")).toEqual([])
})

// TWINCAT MEASURED, 2026-09-20: it has neither operator either. `power_operator_rejected` and
// `ampersand_operator_rejected` record the same two messages on both vendors — "';' expected instead of '**'"
// and the echoed token — so "may accept either" was a guess, and the recording says no.
test("TwinCAT has neither operator either", () => {
  expect(unsupported("x : REAL;", "x := 2.0 ** 3.0;", "twincat").length).toBeGreaterThan(0)
  expect(unsupported("a : BOOL; b : BOOL; c : BOOL;", "c := a & b;", "twincat").length).toBeGreaterThan(0)
})
