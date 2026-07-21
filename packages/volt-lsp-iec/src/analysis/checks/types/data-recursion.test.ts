/**
 * data-recursion (C0101): an FB/struct that (transitively) contains an instance of itself. A POINTER/REFERENCE
 * member breaks the cycle and is not flagged.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const rec = (src: string): string[] => {
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "data-recursion")
    .map((d) => d.message)
}

test("a direct self-member is flagged", () => {
  expect(rec(`FUNCTION_BLOCK FB1\nVAR s : FB1; END_VAR\nEND_FUNCTION_BLOCK`)).toEqual(["Data recursion: FB1 -> FB1"])
})

test("an indirect cycle is flagged (each participating unit reports its own path)", () => {
  const src = `FUNCTION_BLOCK FB1\nVAR x : FB2; END_VAR\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK FB2\nVAR y : FB1; END_VAR\nEND_FUNCTION_BLOCK`
  expect(rec(src)).toEqual(["Data recursion: FB1 -> FB2 -> FB1", "Data recursion: FB2 -> FB1 -> FB2"])
})

test("a POINTER TO self does not nest — not flagged; an ARRAY OF self does", () => {
  expect(rec(`FUNCTION_BLOCK FB1\nVAR p : POINTER TO FB1; END_VAR\nEND_FUNCTION_BLOCK`)).toEqual([])
  expect(rec(`FUNCTION_BLOCK FB1\nVAR a : ARRAY[0..1] OF FB1; END_VAR\nEND_FUNCTION_BLOCK`)).toEqual([
    "Data recursion: FB1 -> FB1",
  ])
})

test("a self-referential struct is flagged; a non-recursive one is not", () => {
  expect(rec(`TYPE S :\nSTRUCT\nself : S;\nEND_STRUCT\nEND_TYPE`)).toEqual(["Data recursion: S -> S"])
  expect(rec(`TYPE S :\nSTRUCT\nn : INT;\nEND_STRUCT\nEND_TYPE`)).toEqual([])
})
