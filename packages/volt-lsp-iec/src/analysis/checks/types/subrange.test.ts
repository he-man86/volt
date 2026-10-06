/**
 * subrange-out-of-range (D.3): a constant outside its declared `(lo..hi)` bounds, in a declaration's initializer
 * and in an assignment. CODESYS spells the assignment target's lower bound with a type prefix; TwinCAT does not
 * (conformance `subrange_init_above_range`, `subrange_assign_const_out`).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../test-uri.js"


test("an ASSIGNMENT out of the subrange is the same error — CODESYS types the lower bound, TwinCAT does not", () => {
  // silent before: only declaration initializers were checked (conformance `subrange_assign_const_out`).
  const src = `FUNCTION_BLOCK F\nVAR\nvalue : INT(1..100);\nEND_VAR\nEND_FUNCTION_BLOCK\n\nMETHOD Set\nvalue := 200;\nEND_METHOD`
  const run = (vendor: "codesys" | "twincat") => {
    const parseResult = parseSource(src, { networkText: true }, vendor)
    const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }], [], vendor)
    return computeSemanticDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor }) })
      .filter((d) => d.code === "subrange-out-of-range")
      .map((d) => d.message)
  }
  expect(run("codesys")).toEqual(["Cannot convert type '200' to type 'INT (INT#1..100)'"])
  expect(run("twincat")).toEqual(["Cannot convert type '200' to type 'INT (1..100)'"])
})

test("an assignment INSIDE the subrange is silent", () => {
  const src = `FUNCTION_BLOCK F\nVAR\nvalue : INT(1..100);\nEND_VAR\nEND_FUNCTION_BLOCK\n\nMETHOD Set\nvalue := 50;\nEND_METHOD`
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }], [], "codesys")
  expect(
    computeSemanticDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "subrange-out-of-range"),
  ).toEqual([])
})

/** The subrange messages of `src` (one file) on `vendor`. */
function subrangeMessages(src: string, vendor: "codesys" | "twincat" = "codesys"): string[] {
  const parseResult = parseSource(src, { networkText: true }, vendor)
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }], [], vendor)
  return computeSemanticDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === "subrange-out-of-range")
    .map((d) => d.message)
}

// frontend-conformance 4.7.1 (rule DT3; `dt_subrange_member_assign`, `dt_subrange_assign_*`, CODESYS 2026-10-03): the range
// is the Type's, so a STRUCT member of a subrange type is checked as a variable is — it was silent, the check read the
// declaration of a bare name — and CODESYS types only a POSITIVE lower bound, with the subrange's own base.
test("a constant stored into a STRUCT member of a subrange type outside it is refused", () => {
  const src = "TYPE R :\nSTRUCT\n\tf : INT(0..10);\nEND_STRUCT\nEND_TYPE\n\nFUNCTION_BLOCK F\nVAR\n\trec : R;\nEND_VAR\nrec.f := 20;\nrec.f := 5;\nEND_FUNCTION_BLOCK\n"
  expect(subrangeMessages(src)).toEqual(["Cannot convert type '20' to type 'INT (0..10)'"])
  expect(subrangeMessages(src, "twincat")).toEqual(["Cannot convert type '20' to type 'INT (0..10)'"])
})

test("CODESYS types a positive lower bound with the base, a zero or negative one bare", () => {
  const src = "FUNCTION_BLOCK F\nVAR\n\ta : INT(0..10);\n\tb : INT(-10..10);\n\tc : UINT(1..10);\nEND_VAR\na := 20;\nb := 20;\nc := 20;\nEND_FUNCTION_BLOCK\n"
  expect(subrangeMessages(src)).toEqual([
    "Cannot convert type '20' to type 'INT (0..10)'",
    "Cannot convert type '20' to type 'INT (-10..10)'",
    "Cannot convert type '20' to type 'UINT (UINT#1..10)'",
  ])
})
