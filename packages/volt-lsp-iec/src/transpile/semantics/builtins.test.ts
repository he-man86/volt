/**
 * MAX / MIN / LIMIT as compare-select (transpile-restructure 6.7, RC 28), over every cell `SELECT_CASES` holds — the
 * recorded NaN and signed-zero cells of `tr_28_minmax_limit_nan_signed_zero_{real,lreal}`. Compared as VALUES (`Object.is`
 * tells -0 from +0 and NaN from a number): a JavaScript NaN carries no sign, so the recorded NaN's sign bit is the twin's
 * to check (`test/conformance/runtime-twins.test.ts`, the bits).
 */
import { expect, test } from "bun:test"
import { elementaryRef } from "../../frontend/types/index.js"
import { builtinValue } from "./builtins.js"
import { SELECT_CASES, TRUNC_CASES } from "./numeric.cases.js"

/** The number a REAL's or LREAL's bits hold. */
function fromBits(bits: bigint, type: "REAL" | "LREAL"): number {
  const view = new DataView(new ArrayBuffer(8))
  if (type === "REAL") {
    view.setUint32(0, Number(bits))
    return view.getFloat32(0)
  }
  view.setBigUint64(0, bits)
  return view.getFloat64(0)
}

const shown = (v: unknown): string => (Object.is(v, -0) ? "-0" : String(v))

test("MAX / MIN / LIMIT answer every recorded NaN and signed-zero cell — the second argument on a tie or a NaN", () => {
  expect(SELECT_CASES).toHaveLength(18)
  const got = SELECT_CASES.map((c) => {
    const t = elementaryRef(c.input.type)
    return `${c.name}: ${shown(builtinValue(c.input.fn, c.input.args, t, c.input.args.map(() => t)))}`
  })
  expect(got).toEqual(SELECT_CASES.map((c) => `${c.name}: ${shown(fromBits(c.expected, c.input.type))}`))
})

// transpile-restructure 6.A.4 (Appendix A): a shift or rotate COUNT above 2^53 — a ULINT/LWORD count is an exact bigint,
// and `Number()` rounded it: 2^53 + 1 became 2^53 and then 0 under `& 63` (the low bits gone), where the CPU masks the
// exact count to 1. The value of each: SHL/SHR mask the count to the width, ROL/ROR take it modulo the width.
test("SHL / SHR / ROL / ROR read a count above 2^53 exactly — its low bits, not a rounded number's", () => {
  const lword = elementaryRef("LWORD")
  const ulint = elementaryRef("ULINT")
  const count = 2n ** 53n + 1n // & 63 = 1, % 64 = 1
  const at = (fn: "shl" | "shr" | "rol" | "ror", v: bigint, n: bigint): unknown => builtinValue(fn, [v, n], lword, [lword, ulint])
  expect(at("shl", 1n, count)).toBe(2n)
  expect(at("shr", 4n, count)).toBe(2n)
  expect(at("rol", 1n, count)).toBe(2n)
  expect(at("ror", 1n, count)).toBe(2n ** 63n)
  // and the largest count a ULINT holds: & 63 = 63, % 64 = 63
  const max = 2n ** 64n - 1n
  expect(at("shl", 1n, max)).toBe(2n ** 63n)
  expect(at("rol", 1n, max)).toBe(2n ** 63n)
})

test("TRUNC answers every recorded DINT cell — toward zero, DINT's minimum out of range", () => {
  expect(TRUNC_CASES.map((c) => `${c.name}: ${builtinValue("trunc", [c.input.value], elementaryRef("DINT"), [elementaryRef(c.input.from)])}`)).toEqual(
    TRUNC_CASES.map((c) => `${c.name}: ${c.expected}`),
  )
})
