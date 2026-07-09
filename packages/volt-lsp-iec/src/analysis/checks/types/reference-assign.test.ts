/**
 * reference-assign (C0140) — REF= to a non-reference target. Provisional. (C0141 "RHS must be writable" is
 * NOT implemented — `r REF= 0` is a valid null-out, so a literal RHS is not an error.)
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const ref = (body: string): string[] => {
  const src = `FUNCTION_BLOCK F\nVAR r : REFERENCE TO INT; i : INT;\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK`
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "reference-assign-target")
    .map((d) => d.message)
}

test("REF= to a non-reference target is flagged (C0140); a reference target is fine", () => {
  expect(ref(`i REF= i;`)).toEqual(["Reference assign is only allowed to variables of Reference type"])
  expect(ref(`r REF= i;`)).toEqual([])
  expect(ref(`r REF= 0;`)).toEqual([]) // null-out a reference — valid
})
