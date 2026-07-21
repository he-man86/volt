/**
 * reference-assign — C0140 (REF= to a non-reference target) + C0141 (REF= RHS needs write access). The C0141
 * rule was re-verified live against CODESYS 3.5.21: `REF= 0` (null idiom) and `REF= <writable var>` are valid;
 * `REF= <non-zero literal>` and `REF= <constant>` error.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const codes = (body: string, code: string): string[] => {
  const src = `FUNCTION_BLOCK F\nVAR r : REFERENCE TO INT; i : INT;\nEND_VAR\nVAR CONSTANT K : INT := 7;\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK`
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === code)
    .map((d) => d.message)
}
const c0140 = (b: string) => codes(b, "reference-assign-target")
const c0141 = (b: string) => codes(b, "reference-assign-write")

test("C0140: REF= to a non-reference target is flagged; a reference target is fine", () => {
  expect(c0140(`i REF= i;`)).toEqual(["Reference assign is only allowed to variables of reference type"])
  expect(c0140(`r REF= i;`)).toEqual([])
})

test("C0141: REF= RHS needs write access — non-zero literal and constant error", () => {
  expect(c0141(`r REF= 314;`)).toEqual(["Reference assign needs variable with write access"]) // non-zero literal
  expect(c0141(`r REF= K;`)).toEqual(["Reference assign needs variable with write access"]) // VAR CONSTANT
})

test("C0141: `REF= 0` (null idiom) and `REF= <writable var>` are valid", () => {
  expect(c0141(`r REF= 0;`)).toEqual([]) // null-out a reference
  expect(c0141(`r REF= i;`)).toEqual([]) // writable variable
})
