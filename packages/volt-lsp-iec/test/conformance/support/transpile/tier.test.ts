/**
 * The tier band (`tier.ts`): what makes a fixture's own body `indirect`.
 */
import { expect, test } from "bun:test"
import { lowerSource } from "../../../../src/transpile/index.js"
import { tierOf } from "./tier.js"

const tier = (src: string, own: string): string => {
  const { pou, diagnostics } = lowerSource(src, "P")
  expect(diagnostics).toEqual([])
  return tierOf(pou!, own)
}

// gate 7.6b: a VAR_TEMP is a local of its body's run (7.6.4), and a local is a slot — a scalar counter in one is `arith`,
// as it is in a VAR (`decl_temp_counts` had moved to `indirect` on the local's root alone)
test("a body's VAR_TEMP and a routine's VAR band as slots; an in-out and a global stay indirect", () => {
  const fb = (decls: string, body: string) =>
    `${decls}FUNCTION_BLOCK FB_T\n${body}\nEND_FUNCTION_BLOCK\nPROGRAM P\nVAR inst : FB_T; v : INT; END_VAR\ninst();\nEND_PROGRAM\n`
  expect(tier(fb("", "VAR_TEMP n : INT; END_VAR\nVAR seen : INT; END_VAR\nn := n + 1;\nseen := n;"), "FB_T")).toBe("arith")
  expect(tier(fb("", "VAR_TEMP n : INT; END_VAR\nn := 1;"), "FB_T")).toBe("decl")
  expect(tier(fb("VAR_GLOBAL gq : INT; END_VAR\n", "VAR seen : INT; END_VAR\nseen := gq;"), "FB_T")).toBe("indirect")
})
