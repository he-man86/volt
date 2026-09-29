/**
 * A 64-bit integer converts to REAL with ONE rounding, straight to 24 significant bits — the way CODESYS and Rust's
 * `as f32` do it. Rounding through LREAL first (`Number(n)`, then `Math.fround`) rounds twice, and a value just
 * above REAL's halfway point lands exactly ON it in LREAL and then ties to even — downwards.
 *
 * 2^60 + 2^36 + 1: CODESYS says 1152921642045800448 (2^60 + 2^37), recorded as
 * `tr_47_i2r_lint_to_real_double_round` (transpile-review-2026-09-29 task 47).
 */
import { expect, test } from "bun:test"
import { elementaryRef } from "../../types/index.js"
import { coerce, fit } from "./values.js"

const toReal = (v: bigint, from: string) => fit(coerce(v, elementaryRef("REAL"), elementaryRef(from)), elementaryRef("REAL"))

test("LINT/ULINT/LWORD -> REAL rounds once, to 24 bits", () => {
  const v = 2n ** 60n + 2n ** 36n + 1n
  expect(toReal(v, "LINT")).toBe(1152921642045800448)
  expect(toReal(-v, "LINT")).toBe(-1152921642045800448)
  expect(toReal(v, "ULINT")).toBe(1152921642045800448)
  expect(toReal(v, "LWORD")).toBe(1152921642045800448)
})

test("an exact tie still rounds half to even, and LREAL is untouched", () => {
  expect(toReal(2n ** 60n + 2n ** 36n, "LINT")).toBe(2 ** 60)
  expect(toReal(2n ** 60n + 3n * 2n ** 36n, "LINT")).toBe(2 ** 60 + 2 ** 38)
  expect(toReal(16777217n, "DINT")).toBe(16777216)
  expect(coerce(2n ** 60n + 2n ** 36n + 1n, elementaryRef("LREAL"), elementaryRef("LINT"))).toBe(Number(2n ** 60n + 2n ** 36n + 1n))
})
