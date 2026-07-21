/**
 * inherited-variable (C0097): a derived FB redeclaring a base variable is flagged; a fresh name is not,
 * and a method/property overriding a base name is not a "variable" duplicate.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const dup = (src: string): string[] => {
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "duplicate-inherited-variable")
    .map((d) => d.message)
}

const BASE = `FUNCTION_BLOCK FB2\nVAR i : INT; k : INT; END_VAR\nEND_FUNCTION_BLOCK`

test("a derived FB redeclaring a base variable is flagged", () => {
  expect(dup(`FUNCTION_BLOCK FB EXTENDS FB2\nVAR i : INT; END_VAR\nEND_FUNCTION_BLOCK\n${BASE}`)).toEqual([
    "Duplicate definition of variable 'i' in function block 'FB' and in base 'FB2'",
  ])
})

test("a derived FB with only fresh names is not flagged", () => {
  expect(dup(`FUNCTION_BLOCK FB EXTENDS FB2\nVAR m : INT; END_VAR\nEND_FUNCTION_BLOCK\n${BASE}`)).toEqual([])
})

test("the collision is found up the grand-base chain", () => {
  const mid = `FUNCTION_BLOCK MID EXTENDS FB2\nEND_FUNCTION_BLOCK`
  const derived = `FUNCTION_BLOCK FB EXTENDS MID\nVAR k : INT; END_VAR\nEND_FUNCTION_BLOCK`
  expect(dup(`${derived}\n${mid}\n${BASE}`)).toEqual([
    "Duplicate definition of variable 'k' in function block 'FB' and in base 'FB2'",
  ])
})
