/**
 * inout-external-access — C0178. External access to an FB's VAR_IN_OUT member (read or write) is rejected;
 * the FB's own THIS/SUPER access and every other member kind stay silent (zero-FP). Wording provisional.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const FB = `\nFUNCTION_BLOCK FB\nVAR_IN_OUT\n io : INT;\nEND_VAR\nVAR_INPUT\n inp : INT;\nEND_VAR\nVAR\n loc : INT;\nEND_VAR\nEND_FUNCTION_BLOCK`
const diag = (body: string): { code: string; message: string }[] => {
  const src = `PROGRAM PLC_PRG\nVAR\n inst : FB;\n i : INT;\nEND_VAR\n${body}\nEND_PROGRAM${FB}`
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
}
const codes = (body: string): string[] => diag(body).map((d) => d.code)

test("C0178 — external READ of a VAR_IN_OUT member", () => {
  const ds = diag("i := inst.io;")
  expect(ds.map((d) => d.code)).toEqual(["inout-no-external-access"])
  expect(ds[0].message).toBe(`No external access to VAR_IN_OUT parameter 'io' of 'FB'."`)
})

test("C0178 — external WRITE of a VAR_IN_OUT member (single fire, not external-write)", () => {
  expect(codes("inst.io := 5;")).toEqual(["inout-no-external-access"])
})

test("a VAR_INPUT member is externally accessible — no FP", () => {
  expect(codes("i := inst.inp;")).toEqual([])
  expect(codes("inst.inp := 5;")).toEqual([])
})

test("a method accessing its OWN FB's VAR_IN_OUT is the C0371 warning, NOT the C0178 error", () => {
  const src = `FUNCTION_BLOCK FB_Test\nVAR_IN_OUT\n io : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\nMETHOD METH : BOOL\nVAR\n x : INT;\nEND_VAR\nio := x;\nEND_METHOD`
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  // Default config: the C0371 warning (default on), never the C0178 error.
  const def = computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
  expect(def.map((d) => ({ code: d.code, sev: d.severity }))).toEqual([{ code: "inout-own-access", sev: "warning" }])
  // A project that disabled the warning: no diagnostic at all (still never the C0178 error).
  const off = computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys", diagnostics: { "inout-own-access": "off" } }) })
  expect(off).toEqual([])
})
