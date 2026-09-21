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
/** In a BODY the compiler also names the token, and then re-reads the orphaned unit as a statement of its own. */
const IN_BODY = (literal: string, unit: string) => [
  ...CUT(literal),
  `Unexpected token '${literal}' found`,
  `The code '${unit};\n' has no effect. Is this the intent?`,
]

test("a TIME literal with US or NS is rejected at the literal — in a body and in a declaration", () => {
  expect(flagged("t1 : TIME;", "t1 := T#1500US;")).toEqual(IN_BODY("T#1500", "US"))
  expect(flagged("t1 : TIME;", "t1 := T#5NS;")).toEqual(IN_BODY("T#5", "NS"))
  expect(flagged("t1 : TIME;", "t1 := T#1S500US;")).toEqual(IN_BODY("T#1S500", "US"))
  // as an initializer, CODESYS fails the initial value instead — there is no orphaned statement in a declaration
  expect(flagged("fine : TIME := T#1500US;", "")).toEqual([...CUT("T#1500"), "Cannot convert type 'Unknown type: '!!!'ERROR'!!!'' to type 'TIME'"])
})

test("an LTIME literal keeps its microseconds, and a TIME literal with millisecond units is clean", () => {
  expect(flagged("lt1 : LTIME;", "lt1 := LTIME#1500US;")).toEqual([])
  expect(flagged("t1 : TIME;", "t1 := T#1S500MS;")).toEqual([])
})

// TWINCAT MEASURED, 2026-09-20: `cc_time_microsecond_literal_in_body` and `cc_time_seconds_then_microseconds`
// record the same five messages on both vendors — the literal ends at the unit, and what is left of it stands
// alone as a statement with no effect.
test("TwinCAT ends the literal at the unit too", () => {
  expect(flagged("t1 : TIME;", "t1 := T#1500US;", "twincat").length).toBeGreaterThan(0)
})
