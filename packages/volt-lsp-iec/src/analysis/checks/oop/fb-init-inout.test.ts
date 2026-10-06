/**
 * fb-init-inout — C0179. An inline FB-init field targeting a VAR_IN_OUT is rejected (only inputs are assignable
 * at declaration); input/output fields and non-FB targets stay silent (zero-FP).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../test-uri.js"

const FB = `\nFUNCTION_BLOCK MyFB\nVAR_IN_OUT\n io : INT;\nEND_VAR\nVAR_INPUT\n inp : INT;\nEND_VAR\nEND_FUNCTION_BLOCK`
const diag = (decls: string): { code: string; message: string }[] => {
  const src = `PROGRAM PLC_PRG\nVAR\n${decls}\nEND_VAR\nEND_PROGRAM${FB}`
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: uriFor(parseResult), parseResult, source: src }])
  return computeSemanticDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
}
const codes = (decls: string): string[] => diag(decls).map((d) => d.code)

// In a FUNCTION_BLOCK's declarations both vendors also warn the access is to an UNINITIALIZED VAR_IN_OUT
// (`cc5_fb_init_inout`, `ioinit_fb_instance_literal`, recorded): that warning is inout-initializer's, and measured in an FB
// only — this PROGRAM's declaration does not draw it (gate review 3.4+3.6). (A literal's own conversion into the
// reference is below.)
test("C0179 — single-field init assigns a VAR_IN_OUT", () => {
  const ds = diag(" own : INT;\n fb : MyFB := (io := own);").filter((d) => d.code === "fb-init-inout")
  expect(ds.map((d) => d.message)).toEqual([`'io' is no input of 'MyFB'`])
  expect(codes(" own : INT;\n fb : MyFB := (io := own);")).toEqual(["fb-init-inout"])
})

test("C0179 — multi-field init flags only the VAR_IN_OUT field", () => {
  expect(codes(" own : INT;\n fb : MyFB := (inp := 1, io := own);")).toEqual(["fb-init-inout"])
})

test("assigning an INPUT at init is legal — no FP", () => {
  expect(codes(" fb : MyFB := (inp := 1);")).toEqual([])
})

test("a struct (non-FB) init is left alone — no FP", () => {
  // Not `s : S`: CODESYS rejects the name `s` (the set keyword — conformance cc_reserved_name_s_string), so the
  // "no FP" premise did not hold for the names this test used, only for the struct init it is about.
  const src = `TYPE ST_Io : STRUCT io : INT; END_STRUCT END_TYPE`
  const p1 = parseSource(src, { networkText: true })
  const main = `PROGRAM PLC_PRG\nVAR\n stIo : ST_Io := (io := 3);\nEND_VAR\nEND_PROGRAM`
  const p2 = parseSource(main, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "s.dut", parseResult: p1, source: src }, { uri: uriFor(p2), parseResult: p2, source: main }])
  const ds = computeSemanticDiagnostics({ uri: uriFor(p2), parseResult: p2, source: main, project, config: resolveConfig({ vendor: "codesys" }) })
  expect(ds.map((d) => d.code)).toEqual([])
})

// analysis-conformance 3.6 (both vendors, recorded 2026-10-06): the value a VAR_IN_OUT field is given binds a REFERENCE,
// so it must BE the parameter's type — a literal or a variable of another type is "Cannot convert type 'SINT' / 'BOOL' to
// type 'REFERENCE TO INT'" (TwinCAT names the pair the other way round, as for every literal REF=), an INT variable none
// (`ioinit_fb_instance_literal`, `oopa_fb_init_inout_other_type`, `cc5_fb_init_inout`)
test("C0179 — the value of a VAR_IN_OUT field converts into a REFERENCE TO the parameter's type", () => {
  const conv = (decls: string, vendor: "codesys" | "twincat" = "codesys"): string[] => {
    const src = `PROGRAM PLC_PRG\nVAR\n${decls}\nEND_VAR\nEND_PROGRAM${FB}`
    const parseResult = parseSource(src, { networkText: true }, vendor)
    const project = build.buildSymbolTable([{ uri: uriFor(parseResult), parseResult, source: src }], [], vendor)
    return computeSemanticDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor }) })
      .filter((d) => d.message.startsWith("Cannot convert"))
      .map((d) => d.message)
  }
  expect(conv(" fb : MyFB := (io := 3);")).toEqual(["Cannot convert type 'SINT' to type 'REFERENCE TO INT'"])
  expect(conv(" fb : MyFB := (io := 3);", "twincat")).toEqual(["Cannot convert type 'REFERENCE TO INT' to type 'SINT'"])
  expect(conv(" flag : BOOL;\n fb : MyFB := (io := flag);")).toEqual(["Cannot convert type 'BOOL' to type 'REFERENCE TO INT'"])
  expect(conv(" own : INT;\n fb : MyFB := (io := own);")).toEqual([])
})
