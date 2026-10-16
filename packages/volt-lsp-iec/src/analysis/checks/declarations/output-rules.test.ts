/**
 * output-rules (C0222) — a VAR_OUTPUT declared as REFERENCE TO.
 */
import { test, expect } from "bun:test"
import { diagnose } from "../../../../test/support/diagnose.js"

const out = (src: string): string[] => {
  return diagnose(src)
    .filter((d) => d.code === "output-reference-type")
    .map((d) => d.message)
}

test("a REFERENCE TO output is flagged; a REFERENCE TO local var is fine", () => {
  expect(out(`FUNCTION_BLOCK F\nVAR_OUTPUT rv : REFERENCE TO INT;\nEND_VAR\nEND_FUNCTION_BLOCK`)).toEqual([
    "Outputs can't be of type REFERENCE TO",
  ])
  expect(out(`FUNCTION_BLOCK F\nVAR rv : REFERENCE TO INT;\nEND_VAR\nEND_FUNCTION_BLOCK`)).toEqual([])
})
