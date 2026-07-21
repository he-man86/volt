/**
 * obsolete-usage — C0357, a 3-state configurable diagnostic (off/warning/error), default warning. Verified live
 * against CODESYS 3.5.21: `POU '<name>' has been marked as obsolete: <msg>`. The obsolete set is injected here the
 * way the workspace scan produces it (the attribute is parser trivia, collected from raw file text).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig, EMPTY_WORKSPACE_REFS } from "../../index.js"
import type { DiagnosticState } from "../../config.js"
import { obsoletePousInText } from "../../../workspace-refs.js"

const OBSOLETE = new Map([["oldfb", { name: "OldFB", message: "use NewFB instead" }], ["oldfn", { name: "OldFn", message: "gone in v2" }]])

function obs(src: string, state: DiagnosticState = "warning") {
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  const references = { ...EMPTY_WORKSPACE_REFS, obsoletePous: OBSOLETE }
  const config = resolveConfig({ vendor: "codesys", diagnostics: { "obsolete-usage": state } })
  return computeSemanticDiagnostics({ parseResult, source: src, project, config, references }).filter((d) => d.code === "obsolete-usage")
}

test("a variable typed with an obsolete FB is flagged, byte-identical to CODESYS", () => {
  const d = obs(`FUNCTION_BLOCK Use\nVAR\n  inst : OldFB;\nEND_VAR\nEND_FUNCTION_BLOCK`)
  expect(d).toHaveLength(1)
  expect(d[0]?.severity).toBe("warning")
  expect(d[0]?.message).toBe("POU 'OldFB' has been marked as obsolete: use NewFB instead")
})

test("a direct call to an obsolete FUNCTION is flagged", () => {
  const d = obs(`FUNCTION_BLOCK Use\nVAR\n  r : INT;\nEND_VAR\nr := OldFn();\nEND_FUNCTION_BLOCK`)
  expect(d).toHaveLength(1)
  expect(d[0]?.message).toBe("POU 'OldFn' has been marked as obsolete: gone in v2")
})

test("a non-obsolete type/call is not flagged", () => {
  expect(obs(`FUNCTION_BLOCK Use\nVAR\n  inst : FreshFB;\n  r : INT;\nEND_VAR\nr := FreshFn();\nEND_FUNCTION_BLOCK`)).toEqual([])
})

test("case-insensitive: obsolete match ignores identifier casing (IEC)", () => {
  expect(obs(`FUNCTION_BLOCK Use\nVAR\n  inst : oldfb;\nEND_VAR\nEND_FUNCTION_BLOCK`)).toHaveLength(1)
})

test("state 'off' drops it; 'error' forces error severity", () => {
  const src = `FUNCTION_BLOCK Use\nVAR\n  inst : OldFB;\nEND_VAR\nEND_FUNCTION_BLOCK`
  expect(obs(src, "off")).toEqual([])
  expect(obs(src, "error")[0]?.severity).toBe("error")
})

// ── extractor: obsoletePousInText (the workspace scan reads the attribute from raw text) ──

test("extractor: a POU-level obsolete attribute is collected", () => {
  const got = obsoletePousInText(`{attribute 'obsolete' := 'gone'}\nFUNCTION_BLOCK OldFB\nEND_FUNCTION_BLOCK`)
  expect(got).toEqual([["oldfb", { name: "OldFB", message: "gone" }]])
})

test("extractor: a METHOD-level obsolete attribute is NOT collected (POU-scoped, guards the corpus FPs)", () => {
  // Real corpus obsolete markers sit on METHODs; matching them would mis-name the POU. The regex requires a
  // POU keyword (FUNCTION_BLOCK/FUNCTION/PROGRAM/INTERFACE) right after the attribute — METHOD is skipped.
  expect(obsoletePousInText(`FUNCTION_BLOCK LockFB\n{attribute 'obsolete' := 'no sense'}\nMETHOD M : INT\nEND_METHOD\nEND_FUNCTION_BLOCK`)).toEqual([])
})

test("extractor: leading extra attributes before the POU header are tolerated", () => {
  const got = obsoletePousInText(`{attribute 'obsolete' := 'gone'}\n{attribute 'hide'}\nFUNCTION OldFn : INT\nEND_FUNCTION`)
  expect(got).toEqual([["oldfn", { name: "OldFn", message: "gone" }]])
})

test("no obsolete set (empty workspace) ⇒ nothing flagged", () => {
  const src = `FUNCTION_BLOCK Use\nVAR\n  inst : OldFB;\nEND_VAR\nEND_FUNCTION_BLOCK`
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  const d = computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) }).filter((x) => x.code === "obsolete-usage")
  expect(d).toEqual([])
})
