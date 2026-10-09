/**
 * MAX / MIN / LIMIT as compare-select (transpile-restructure 6.7, RC 28), over every cell `SELECT_CASES` holds — the
 * recorded NaN and signed-zero cells of `tr_28_minmax_limit_nan_signed_zero_{real,lreal}`. Compared as VALUES (`Object.is`
 * tells -0 from +0 and NaN from a number): a JavaScript NaN carries no sign, so the recorded NaN's sign bit is the twin's
 * to check (`test/conformance/runtime-twins.test.ts`, the bits).
 */
import { expect, test } from "bun:test"
import { elementaryRef } from "../../frontend/types/index.js"
import { builtinValue } from "./builtins.js"
import { SELECT_CASES } from "./numeric.cases.js"

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
