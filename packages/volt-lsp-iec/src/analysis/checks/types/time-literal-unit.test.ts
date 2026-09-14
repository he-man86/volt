/**
 * time-literal-unit (gap 7) — a TIME literal with a microsecond or nanosecond unit. Expectations are CODESYS's recorded
 * wording (conformance `cc_time_*`).
 */
import { expect, test } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const flagged = (vars: string, body: string, vendor: "codesys" | "twincat" = "codesys"): string[] => {
  const src = `PROGRAM PLC_PRG\nVAR\n${vars}\nEND_VAR\n${body}\nEND_PROGRAM`
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.prg", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === "time-literal-unit")
    .map((d) => d.message)
}

const CUT = (literal: string) => [`';' expected instead of '${literal}'`, `Expression expected instead of '${literal}'`]

test("a TIME literal with US or NS is rejected at the literal — in a body and in a declaration", () => {
  expect(flagged("t1 : TIME;", "t1 := T#1500US;")).toEqual(CUT("T#1500"))
  expect(flagged("t1 : TIME;", "t1 := T#5NS;")).toEqual(CUT("T#5"))
  expect(flagged("t1 : TIME;", "t1 := T#1S500US;")).toEqual(CUT("T#1S500"))
  // as an initializer, CODESYS also fails the initial value
  expect(flagged("fine : TIME := T#1500US;", "")).toEqual([...CUT("T#1500"), "Cannot convert type 'Unknown type: '!!!'ERROR'!!!'' to type 'TIME'"])
})

test("an LTIME literal keeps its microseconds, and a TIME literal with millisecond units is clean", () => {
  expect(flagged("lt1 : LTIME;", "lt1 := LTIME#1500US;")).toEqual([])
  expect(flagged("t1 : TIME;", "t1 := T#1S500MS;")).toEqual([])
})

test("TwinCAT is unmeasured — nothing reported there", () => {
  expect(flagged("t1 : TIME;", "t1 := T#1500US;", "twincat")).toEqual([])
})
