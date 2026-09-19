/**
 * `LREAL_TO_STRING` — every cell measured on CODESYS SP21 (conformance `fmt_lreal_*`, 2026-09-19). The emitter's
 * `iec_lreal_text` mirrors this line for line, and `transpile.test.ts` grades both against the recording; this is
 * the one that fails FIRST, in milliseconds, when the formatter drifts.
 */
import { test, expect } from "bun:test"
import { lrealText } from "../ir/values.js"

test("fifteen significant digits, trailing zeros stripped, never fewer than one decimal", () => {
  expect(lrealText(0)).toBe("0.0")
  expect(lrealText(-0)).toBe("0.0")
  expect(lrealText(1)).toBe("1.0")
  expect(lrealText(1.5)).toBe("1.5")
  expect(lrealText(-2.25)).toBe("-2.25")
  expect(lrealText(3.14159265)).toBe("3.14159265")
  expect(lrealText(1234.5678)).toBe("1234.5678")
  expect(lrealText(123456789)).toBe("123456789.0")
  expect(lrealText(99999990)).toBe("99999990.0")
})

test("fixed up to 1E13 and exponential from 1E14 — the boundary, measured a magnitude at a time", () => {
  expect(lrealText(1e12)).toBe("1000000000000.0")
  expect(lrealText(1e13)).toBe("10000000000000.0")
  expect(lrealText(1e14)).toBe("1.0e14")
  expect(lrealText(1e20)).toBe("1.0e20")
  expect(lrealText(-1e20)).toBe("-1.0e20")
})

test("anything below one is exponential, which is where the REAL formatter parts company", () => {
  expect(lrealText(0.1)).toBe("1.0e-1")
  expect(lrealText(0.0001)).toBe("1.0e-4")
  expect(lrealText(1e-10)).toBe("1.0e-10")
  expect(lrealText(-1e-20)).toBe("-1.0e-20")
  expect(lrealText(0.000123456789)).toBe("1.23456789e-4")
  expect(lrealText(1 / 3)).toBe("3.33333333333333e-1")
  expect(lrealText(2 / 3)).toBe("6.66666666666667e-1") // the fifteenth digit rounds up
  expect(lrealText(1 / 7)).toBe("1.42857142857143e-1")
})

test("the two non-numbers, and the sign that survives one of them", () => {
  expect(lrealText(NaN)).toBe("#NaN")
  expect(lrealText(Infinity)).toBe("#Inf")
  expect(lrealText(-Infinity)).toBe("-#Inf")
})
