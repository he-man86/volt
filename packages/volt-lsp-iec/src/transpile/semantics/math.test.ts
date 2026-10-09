import { expect, test } from "bun:test"
import { IecFault } from "./faults.js"
import { expt } from "./math.js"
import { EXPT_CASES } from "./numeric.cases.js"

/**
 * EXPT is C's `pow`, correctly rounded — what CODESYS answers and Rust's `powf` computes (transpile-review-2026-09-29
 * task 46, recorded as `tr_46_exptdom_*`). JavaScriptCore's `Math.pow` differs on both counts: `1 ** NaN` and
 * `(-1) ** ±Infinity` are NaN where C says 1, and an INTEGER exponent is repeated multiplication, rounded at every
 * step — 1E19 ** 8 comes out 9.999999999999998E151 where CODESYS says 1E+152.
 *
 * And a zero raised to a finite negative power is a division by zero: it stops the task on CODESYS. A zero to -Infinity
 * is +Infinity, and runs.
 */
test("EXPT has C's pow special cases", () => {
  expect(expt(1, NaN)).toBe(1)
  expect(expt(-1, Infinity)).toBe(1)
  expect(expt(-1, -Infinity)).toBe(1)
  expect(expt(NaN, 0)).toBe(1)
  expect(expt(0, -Infinity)).toBe(Infinity)
  expect(expt(2, NaN)).toBeNaN()
  expect(expt(-8, 1 / 3)).toBeNaN()
})

test("EXPT of zero to a finite negative power stops the task", () => {
  expect(() => expt(0, -1)).toThrow(RangeError)
  expect(() => expt(0, -0.5)).toThrow(RangeError)
  expect(() => expt(-0, -3)).toThrow(RangeError)
})

test("EXPT with an integer exponent is correctly rounded, as Rust's powf is", () => {
  expect(expt(1e19, 8)).toBe(1e152)
  // cross-checked against Rust `f64::powf` 2026-09-29 — `Math.pow` misses each of these by a few ULPs
  expect(expt(0.006729743003845215, 45)).toBe(1.8194142192131608e-98)
  expect(expt(-10.970263481140135, 40)).toBe(4.061461485393576e41)
  expect(expt(976295471191.4073, 14)).toBe(7.147231449636255e167)
  expect(expt(29154367446899.414, 18)).toBe(2.3156089312612504e242)
  // exact cases: a power of two, a tie that must not loop, the ends of the range
  expect(expt(-2, 3)).toBe(-8)
  expect(expt(3, 40)).toBe(12157665459056928801)
  expect(expt(2, -1074)).toBe(5e-324)
  expect(expt(2, -1075)).toBe(0)
  expect(expt(2, 1024)).toBe(Infinity)
  expect(expt(1 + 2 ** -52, 2 ** 52)).toBe(2.718281828459045) // e, from the nearest double above 1
  expect(expt(1 + 2 ** -52, -(2 ** 52))).toBe(0.3678794411714424)
})

// transpile-restructure 6.18: the table (`numeric.cases.ts` `EXPT_CASES`), every recorded `tr_46_exptdom_*` cell
test("EXPT answers every recorded domain-edge cell — a value, or the task stopping", () => {
  const got = EXPT_CASES.map((c) => {
    try {
      const v = expt(c.input.x, c.input.y)
      return `${c.name}: ${c.input.type === "REAL" ? Math.fround(v) : v}`
    } catch (error) {
      return `${c.name}: ${error instanceof IecFault ? "stop" : String(error)}`
    }
  })
  expect(got).toEqual(EXPT_CASES.map((c) => `${c.name}: ${c.expected}`))
})
