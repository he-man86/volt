/**
 * external-global — C0237 (no matching VAR_GLOBAL). A VAR_EXTERNAL with a matching global stays silent (zero-FP).
 * C0236 (type mismatch) is NOT checked — the live IDE builds it clean (not an error).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const run = (prg: string, gvl?: string) => {
  const inputs = [
    { uri: "PLC_PRG.pou", source: prg, parseResult: parseSource(prg, { networkText: true }) },
    ...(gvl ? [{ uri: "GVL.gvl", source: gvl, parseResult: parseSource(gvl, { networkText: true }) }] : []),
  ]
  const project = build.buildSymbolTable(inputs)
  return computeSemanticDiagnostics({ parseResult: inputs[0].parseResult, source: prg, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code.startsWith("external-"))
}
const codes = (prg: string, gvl?: string) => run(prg, gvl).map((d) => d.code)

test("C0237 — VAR_EXTERNAL with no matching global", () => {
  const ds = run("PROGRAM PLC_PRG\nVAR_EXTERNAL\n g_i : INT;\nEND_VAR\nEND_PROGRAM")
  expect(ds.map((d) => d.code)).toEqual(["external-no-global"])
  expect(ds[0].message).toBe(`No global definition found for VAR_EXTERNAL g_i`)
})

test("a matching global exists (even a different type) — no FP (the IDE does not flag a type mismatch)", () => {
  expect(codes("PROGRAM PLC_PRG\nVAR_EXTERNAL\n g_i : INT;\nEND_VAR\nEND_PROGRAM", "VAR_GLOBAL\n g_i : INT;\nEND_VAR")).toEqual([])
  expect(codes("PROGRAM PLC_PRG\nVAR_EXTERNAL\n g_i : BOOL;\nEND_VAR\nEND_PROGRAM", "VAR_GLOBAL\n g_i : INT;\nEND_VAR")).toEqual([])
})

// frontend-conformance 3.1.3 (rule Y13): a VAR_EXTERNAL binds the global of its name the way a bare name reaches it — a
// `qualified_only` list's variable is reachable only as `GVL.v`, so it is no global for VAR_EXTERNAL either: "No global
// definition found for VAR_EXTERNAL g_veqo", and every use is then undefined (`sym_var_external_qualified_only_global`,
// both vendors 2026-10-02)
test("a VAR_EXTERNAL naming a qualified_only list's variable finds no global, and its uses are undefined", () => {
  const ds = run(
    "PROGRAM PLC_PRG\nVAR_EXTERNAL\n g_q : INT;\nEND_VAR\nVAR\n o : INT;\nEND_VAR\no := g_q;\nEND_PROGRAM",
    "{attribute 'qualified_only'}\nVAR_GLOBAL\n g_q : INT;\nEND_VAR",
  )
  expect(ds.map((d) => d.message)).toEqual(["No global definition found for VAR_EXTERNAL g_q"])
})
