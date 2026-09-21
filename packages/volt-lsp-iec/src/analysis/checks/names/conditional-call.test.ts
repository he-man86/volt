/**
 * conditional-call — `CALC` is the IL conditional call and CODESYS's ST parser reads it as one. Wording measured
 * on SP21 (conformance `cc_il_name_calc`, `ilc_calc_declared_unused`, `_other_type`, `_used_not_declared`,
 * `_called_properly`); TwinCAT unmeasured.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import type { Vendor } from "../../config.js"

function diagnose(decls: string, body: string, vendor: Vendor = "codesys") {
  const src = `FUNCTION_BLOCK F\nVAR\n${decls}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n`
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }], [], vendor)
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === "conditional-call")
    .map((d) => d.message)
}
const SECOND = "Second parameter of conditional call must be a valid call statement"

test("`calc` as a declared name is the parser looking for `CALC (`", () => {
  expect(diagnose("\tcalc : INT;\n\tn : INT;", "n := 1;")).toEqual([
    "'(' expected instead of ':'",
    "This code is not supported in declaration part",
    SECOND,
  ])
  // the recovery does NOT depend on the declared type — a STRING with its own parentheses answers identically
  expect(diagnose("\tcalc : STRING(8);\n\tn : INT;", "n := 1;")).toEqual(diagnose("\tcalc : INT;\n\tn : INT;", "n := 1;"))
})

test("`calc` as an assignment target names the operator it found instead", () => {
  expect(diagnose("\tn : INT;", "calc := 1;\nn := 1;")).toEqual(["Expression expected instead of ':='", SECOND])
})

test("written the way the parser wants it, the SECOND parameter must be a call", () => {
  expect(diagnose("\tflag : BOOL;\n\tn : INT;", "CALC(flag, n := 2);")).toEqual([SECOND])
  // a real call statement there is the one shape the operator accepts, so nothing is said about it
  expect(diagnose("\tflag : BOOL;\n\tt : TON;", "CALC(flag, t());")).toEqual([])
})

test("a name that merely starts with it is an ordinary identifier; TwinCAT hyphenates the rest", () => {
  expect(diagnose("\tcalcTotal : INT;", "calcTotal := 1;")).toEqual([])
  // measured 2026-09-20 (`cc_il_name_calc`): the same two messages, "call-statement" and "Declaration part"
  expect(diagnose("\tcalc : INT;\n\tn : INT;", "n := 1;", "twincat").length).toBeGreaterThan(0)
})
