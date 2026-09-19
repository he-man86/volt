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
  const src = `FUNCTION_BLOCK F\nVAR rv : REFERENCE TO INT; i : INT;\nEND_VAR\nVAR CONSTANT K : INT := 7;\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK`
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

// WHICH ERROR A LITERAL GETS DEPENDS ON ITS OWN TYPE, and it took two live measurements to see it.
//
// The first (`cc3_reference_assign`) found `bound REF= 7` is "Cannot convert type 'SINT' to type 'REFERENCE TO
// INT'" — a type error, with C0141 firing beside it as a false positive. The conclusion drawn was "a literal is
// the type's business", full stop, and this line asserted it with 314.
//
// The second (`cc6_reference_assign_literal`) asked the compiler about 314 itself: "Reference assign needs
// variable with write access". Same reference type, opposite answer. An untyped integer literal takes the
// smallest type that holds it — 7 is SINT, 314 is INT — and `REF=` wants that type to BE the referenced one.
// 7 is inside INT's range and is still refused; 314 equals INT and gets through to the write-access rule.
//
// One measurement generalised to a rule it did not cover. Both cases are pinned here now.
test("C0141: REF= RHS needs write access — a named CONSTANT, and a literal whose type ALREADY matches", () => {
  expect(c0141(`rv REF= K;`)).toEqual(["Reference assign needs variable with write access"]) // VAR CONSTANT
  expect(c0141(`rv REF= 314;`)).toEqual(["Reference assign needs variable with write access"]) // INT, = the referenced type
  expect(c0141(`rv REF= 7;`)).toEqual([]) // SINT ≠ INT — the conversion error below is what fires
})

test("C0141: `REF= 0` (null idiom) and `REF= <writable var>` are valid", () => {
  expect(c0141(`rv REF= 0;`)).toEqual([]) // null-out a reference
  expect(c0141(`rv REF= i;`)).toEqual([]) // writable variable
})

test("a LITERAL on the right of REF= is a TYPE error, not the write-access one", () => {
  const src = `FUNCTION_BLOCK F\nVAR\nbound : REFERENCE TO INT;\nEND_VAR\nbound REF= 7;\nEND_FUNCTION_BLOCK`
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  const msgs = computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "assignment-type-mismatch" || d.code.startsWith("reference-assign"))
    .map((d) => d.message)
  expect(msgs).toEqual(["Cannot convert type 'SINT' to type 'REFERENCE TO INT'"])
})
