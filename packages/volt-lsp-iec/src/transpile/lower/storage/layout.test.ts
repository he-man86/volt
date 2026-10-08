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
