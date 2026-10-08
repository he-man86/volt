/**
 * Lowering tests of `layout.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { expect, test } from "bun:test"
import { lowerSource } from "../index.js"

// A compiler struct (`VERSION`, an `ANY` input's struct — frontend-conformance TY14/TY15) has no declaration in the
// project, so its refusal has no span of its own; it is refused where the program USES it. It fell back to 0:0 before
// (frontend-conformance review, step 5): a refusal pointing nowhere.
test("a compiler struct lowering cannot lay out is refused at the declaration that uses it, never at 0:0", () => {
  const source = "FUNCTION_BLOCK FB_V\nVAR\n\tvTag : VERSION;\nEND_VAR\nEND_FUNCTION_BLOCK\n"
  const { diagnostics } = lowerSource(source, "FB_V")
  expect(diagnostics.map((d) => [d.code, d.span.startLine])).toEqual([["layout-struct", 3]])
})

// A POINTEE's string capacity is a fact like any other (transpile-restructure 3.3, gate 3c review): `POINTER TO
// STRING(n)` / `REFERENCE TO STRING(n)` over a capacity the scope cannot fold — a VARIABLE (CODESYS refuses it,
// `decl_string_length_variable`) or a constant this scope cannot see — lowered as STRING(80) with no diagnostic.
test("a pointee STRING whose capacity does not fold is refused string-capacity, never sized 80", () => {
  const cases = [
    "p : POINTER TO STRING(n); END_VAR p := ADR(y); p^ := 'abcdefgh';",
    "rf : REFERENCE TO STRING(n); END_VAR rf REF= y; rf := 'abcdefgh';",
    "p : POINTER TO STRING(UNKNOWN_CONST); END_VAR p := ADR(y); p^ := 'abcdefgh';",
  ]
  for (const c of cases) {
    const { diagnostics } = lowerSource(`PROGRAM P\nVAR n : INT := 5; y : STRING; ${c}\nEND_PROGRAM\n`, "P")
    expect(diagnostics.map((d) => d.code)).toContain("string-capacity")
  }
})
