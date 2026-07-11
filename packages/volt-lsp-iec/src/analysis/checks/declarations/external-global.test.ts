/**
 * external-global — C0237 (no matching VAR_GLOBAL) + C0236 (type mismatch). A VAR_EXTERNAL with a matching
 * same-type global stays silent (zero-FP).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const run = (prg: string, gvl?: string) => {
  const inputs = [
    { uri: "PLC_PRG.prg", source: prg, parseResult: parseSource(prg) },
    ...(gvl ? [{ uri: "GVL.gvl", source: gvl, parseResult: parseSource(gvl) }] : []),
  ]
  const project = buildSymbolTable(inputs)
  return computeSemanticDiagnostics({ parseResult: inputs[0].parseResult, source: prg, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code.startsWith("external-"))
}
const codes = (prg: string, gvl?: string) => run(prg, gvl).map((d) => d.code)

test("C0237 — VAR_EXTERNAL with no matching global", () => {
  const ds = run("PROGRAM PLC_PRG\nVAR_EXTERNAL\n g_i : INT;\nEND_VAR\nEND_PROGRAM")
  expect(ds.map((d) => d.code)).toEqual(["external-no-global"])
  expect(ds[0].message).toBe(`No global definition found for VAR_EXTERNAL 'g_i'`)
})

test("C0236 — VAR_EXTERNAL type differs from the global", () => {
  const ds = run("PROGRAM PLC_PRG\nVAR_EXTERNAL\n g_i : BOOL;\nEND_VAR\nEND_PROGRAM", "VAR_GLOBAL\n g_i : INT;\nEND_VAR")
  expect(ds.map((d) => d.code)).toEqual(["external-type-mismatch"])
  expect(ds[0].message).toBe(`Wrong type definition for VAR_EXTERNAL g_i`)
})

test("matching name + type — no FP", () => {
  expect(codes("PROGRAM PLC_PRG\nVAR_EXTERNAL\n g_i : INT;\nEND_VAR\nEND_PROGRAM", "VAR_GLOBAL\n g_i : INT;\nEND_VAR")).toEqual([])
})
