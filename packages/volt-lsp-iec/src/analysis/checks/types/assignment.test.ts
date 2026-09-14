/**
 * assignment-type-mismatch — the duration literals (gap 8). The AST gives `T#` and `LTIME#` one literalKind, and inference
 * typed both TIME. Expectations are CODESYS's recorded answers (conformance `cc_ltime_literal_into_time`,
 * `cc_fp_ltime_literal_into_ltime`).
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
    .filter((d) => d.code === "assignment-type-mismatch")
    .map((d) => d.message)
}

test("an LTIME literal into a TIME does not convert — it was silent", () => {
  expect(mismatches("t1 : TIME;", "t1 := LTIME#1S;")).toEqual(["Cannot convert type 'LTIME' to type 'TIME'"])
})

test("an LTIME literal into an LTIME is clean — typed TIME, it was a false positive", () => {
  expect(mismatches("lt1 : LTIME;", "lt1 := LTIME#1S;")).toEqual([])
  expect(mismatches("t1 : TIME;", "t1 := T#1S;")).toEqual([])
})
