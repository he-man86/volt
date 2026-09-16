/**
 * non-callable-call — C0036. Calling a non-callable (a scalar var, or a GVL block) is flagged; a real FB
 * instance / function / method call is silent, and — the load-bearing case — a var typed as a LIBRARY FB
 * (which infers to `unknown` offline) is NOT flagged.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const diag = (inputs: { uri: string; src: string }[]): { code: string; message: string }[] => {
  const parsed = inputs.map((i) => ({ uri: i.uri, source: i.src, parseResult: parseSource(i.src) }))
  const project = buildSymbolTable(parsed)
  return parsed.flatMap((f) => computeSemanticDiagnostics({ parseResult: f.parseResult, source: f.source, project, config: resolveConfig({ vendor: "codesys" }) }))
}
const one = (src: string) => diag([{ uri: "F.fb", src }])

test("C0035 — calling a scalar variable (CODESYS asks for a program/function/FB)", () => {
  const ds = one("PROGRAM PLC_PRG\nVAR\n i : INT;\nEND_VAR\ni();\nEND_PROGRAM").filter((d) => d.code === "invalid-call-target")
  expect(ds.map((d) => d.message)).toEqual(["Program name, function or function block instance expected instead of 'i'"])
})

test("C0036 — calling a GVL block (doc's VAR_GLOBAL case, multi-file)", () => {
  const ds = diag([
    { uri: "GVL.gvl", src: "VAR_GLOBAL\n value : INT;\nEND_VAR" },
    { uri: "PLC_PRG.prg", src: "PROGRAM PLC_PRG\nGVL();\nEND_PROGRAM" },
  ]).filter((d) => d.code === "non-callable-call")
  expect(ds.map((d) => d.message)).toEqual(["Cannot call object of type 'VAR_GLOBAL'"])
})

test("a real FB-instance call is NOT flagged", () => {
  const ds = diag([
    { uri: "P.prg", src: "PROGRAM PLC_PRG\nVAR\n inst : FB;\nEND_VAR\ninst();\nEND_PROGRAM" },
    { uri: "FB.fb", src: "FUNCTION_BLOCK FB\nEND_FUNCTION_BLOCK" },
  ]).filter((d) => d.code === "non-callable-call")
  expect(ds).toEqual([])
})

test("a var typed as an UNKNOWN (library) FB is NOT flagged — the conservative rule", () => {
  // `L_IE1P_ReadActualSeverity` is unresolved offline (a library FB); calling the instance must NOT fire.
  const ds = one("PROGRAM PLC_PRG\nVAR\n inst : L_IE1P_ReadActualSeverity;\nEND_VAR\ninst(xEnable := TRUE);\nEND_PROGRAM").filter((d) => d.code === "non-callable-call")
  expect(ds).toEqual([])
})

// A REFERENCE TO an FB IS callable, both as a body call and for its METHODs — measured (conformance
// `xo_reference_to_fb_call`: `chosen REF= right`, then `chosen(throttle := 7)` and `chosen.Boost()` build and RUN,
// leaving `right.revs` at 214 and `left` untouched). `pointer`/`reference` were in the non-callable set outright, so
// every such call was a false positive. Why missed: no fixture ever called through one — the REFERENCE TO cases all
// pinned a declaration or a read.
test("a REFERENCE TO / POINTER TO an FB is callable; one to a plain value is not", () => {
  const withEngine = (body: string) => [
    { uri: "P.prg", src: `PROGRAM PLC_PRG\nVAR\n inst : FB_Engine;\n ref : REFERENCE TO FB_Engine;\n ptr : POINTER TO FB_Engine;\n num : REFERENCE TO INT;\nEND_VAR\n${body}\nEND_PROGRAM` },
    { uri: "FB.fb", src: "FUNCTION_BLOCK FB_Engine\nVAR_INPUT\n throttle : INT;\nEND_VAR\nEND_FUNCTION_BLOCK" },
  ]
  const codes = (body: string) => diag(withEngine(body)).filter((d) => d.code === "invalid-call-target").map((d) => d.message)
  expect(codes("ref REF= inst;\nref(throttle := 7);")).toEqual([])
  expect(codes("ptr := ADR(inst);\nptr^(throttle := 7);")).toEqual([])
  // a reference to something that is not callable still is not
  expect(codes("num(1);")).toEqual(["Program name, function or function block instance expected instead of 'num'"])
})
