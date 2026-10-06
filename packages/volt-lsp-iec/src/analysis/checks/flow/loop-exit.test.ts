/**
 * loop-exit — C0266. A FOR whose end bound is at/beyond the counter's type range can never exit (endless);
 * a bound within range, a non-constant bound, and a wider counter type all stay silent (zero-FP).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../test-uri.js"

const diag = (decls: string, body: string): { code: string; message: string }[] => {
  const src = `PROGRAM PLC_PRG\nVAR\n${decls}\nEND_VAR\n${body}\nEND_PROGRAM`
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: uriFor(parseResult), parseResult, source: src }])
  return computeSemanticDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
}
const codes = (decls: string, body: string): string[] => diag(decls, body).map((d) => d.code)

test("C0266 — FOR b := 0 TO 255 with b : BYTE is endless", () => {
  const ds = diag(" b : BYTE;\n i : INT;", "FOR b := 0 TO 255 BY 1 DO\n i := i + 1;\nEND_FOR;")
  expect(ds.map((d) => d.code)).toEqual(["loop-exit-constant"])
  expect(ds[0].message).toBe(`Loop exit condition 'b > 255' is constant FALSE. Possible endless loop.`)
})

test("descending FOR b := 255 TO 0 with a USINT (min 0) is endless", () => {
  expect(codes(" b : USINT;", "FOR b := 255 TO 0 BY -1 DO\n ;\nEND_FOR;")).toEqual(["loop-exit-constant"])
})

test("bound within range terminates — no FP", () => {
  expect(codes(" b : BYTE;", "FOR b := 0 TO 254 DO\n ;\nEND_FOR;")).toEqual([])
})

test("a wider counter (INT) reaching 255 terminates — no FP", () => {
  expect(codes(" i : INT;", "FOR i := 0 TO 255 DO\n ;\nEND_FOR;")).toEqual([])
})

test("non-constant end bound is skipped — no FP", () => {
  expect(codes(" b : BYTE;\n n : INT;", "FOR b := 0 TO n DO\n ;\nEND_FOR;")).toEqual([])
})

test("a bound BEYOND the counter's range is a conversion, not an endless loop: FOR si := 1 TO 200 over a SINT (`lt_literal_for_bounds_out_of_range`, both vendors 2026-10-03)", () => {
  // the vendors convert 200 into the SINT counter (USINT → SINT, a sign-change warning) and say nothing of the exit
  expect(codes(" si : SINT;\n n : INT;", "FOR si := 1 TO 200 DO\n n := n + 1;\nEND_FOR;")).toEqual(["sign-change-conversion"])
})

// A bound beyond the counter's range that is NOT the measured same-width unsigned → signed literal conversion keeps
// C0266: the conversion check says nothing for it (no measured warning), and dropping C0266 there would drop every word
// (step 4a review). Unrecorded beyond that — the base behaviour, kept until a recording decides it.
test("a bound beyond the counter that needs a wider type, or a typed constant, keeps C0266", () => {
  const decls = " i : INT;\n bt : BYTE;\n cMax : DINT := 40000;\n cB : INT := 300;"
  expect(codes(decls, "FOR bt := 0 TO 300 DO\n ;\nEND_FOR;")).toEqual(["loop-exit-constant"])
  expect(codes(decls, "FOR i := 0 TO 70000 DO\n ;\nEND_FOR;")).toEqual(["loop-exit-constant"])
  const constants = (body: string): string[] => {
    const src = `PROGRAM PLC_PRG\nVAR CONSTANT\n cMax : DINT := 40000;\n cB : INT := 300;\nEND_VAR\nVAR\n i : INT;\n bt : BYTE;\nEND_VAR\n${body}\nEND_PROGRAM`
    const parseResult = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: uriFor(parseResult), parseResult, source: src }])
    return computeSemanticDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) }).map((d) => d.code)
  }
  expect(constants("FOR i := 0 TO cMax DO\n ;\nEND_FOR;")).toEqual(["loop-exit-constant"])
  expect(constants("FOR bt := 0 TO cB DO\n ;\nEND_FOR;")).toEqual(["loop-exit-constant"])
})
