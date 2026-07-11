/**
 * loop-exit — C0266. A FOR whose end bound is at/beyond the counter's type range can never exit (endless);
 * a bound within range, a non-constant bound, and a wider counter type all stay silent (zero-FP).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const diag = (decls: string, body: string): { code: string; message: string }[] => {
  const src = `PROGRAM PLC_PRG\nVAR\n${decls}\nEND_VAR\n${body}\nEND_PROGRAM`
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.prg", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
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
