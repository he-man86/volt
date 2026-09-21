/**
 * subrange-out-of-range (D.3): a constant outside its declared `(lo..hi)` bounds, in a declaration's initializer
 * and in an assignment. CODESYS spells the assignment target's lower bound with a type prefix; TwinCAT does not
 * (conformance `subrange_init_above_range`, `subrange_assign_const_out`).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"


test("an ASSIGNMENT out of the subrange is the same error — CODESYS types the lower bound, TwinCAT does not", () => {
  // silent before: only declaration initializers were checked (conformance `subrange_assign_const_out`).
  const src = `FUNCTION_BLOCK F\nVAR\nvalue : INT(1..100);\nEND_VAR\nEND_FUNCTION_BLOCK\n\nMETHOD Set\nvalue := 200;\nEND_METHOD`
  const run = (vendor: "codesys" | "twincat") => {
    const parseResult = parseSource(src)
    const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }], [], vendor)
    return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor }) })
      .filter((d) => d.code === "subrange-out-of-range")
      .map((d) => d.message)
  }
  expect(run("codesys")).toEqual(["Cannot convert type '200' to type 'INT (INT#1..100)'"])
  expect(run("twincat")).toEqual(["Cannot convert type '200' to type 'INT (1..100)'"])
})

test("an assignment INSIDE the subrange is silent", () => {
  const src = `FUNCTION_BLOCK F\nVAR\nvalue : INT(1..100);\nEND_VAR\nEND_FUNCTION_BLOCK\n\nMETHOD Set\nvalue := 50;\nEND_METHOD`
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }], [], "codesys")
  expect(
    computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "subrange-out-of-range"),
  ).toEqual([])
})
