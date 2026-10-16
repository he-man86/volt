/**
 * external-initializer — C0238: a VAR_EXTERNAL declaration with an inline initializer. A VAR_EXTERNAL without
 * one (the normal form) stays quiet.
 */
import { test, expect } from "bun:test"
import { diagnose } from "../../../../test/support/diagnose.js"

const msgs = (src: string): string[] => {
  return diagnose(src)
    .filter((d) => d.code === "external-initializer")
    .map((d) => d.message)
}

test("C0238: a VAR_EXTERNAL with an initializer is flagged; without one is fine", () => {
  expect(msgs(`PROGRAM P\nVAR_EXTERNAL\n ig : INT := 2;\nEND_VAR\nEND_PROGRAM`)).toEqual([
    "No initial value allowed for VAR_EXTERNAL ig",
  ])
  expect(msgs(`PROGRAM P\nVAR_EXTERNAL\n ig : INT;\nEND_VAR\nEND_PROGRAM`)).toEqual([])
})
