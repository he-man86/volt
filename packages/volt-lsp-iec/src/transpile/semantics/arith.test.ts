/**
 * `arith`'s two traps (transpile-restructure 6.A.3, Appendix B mod-min-by-minus-one): x86's `idiv` computes the quotient and
 * the remainder at once, so `MIN MOD -1` faults where `MIN / -1` does — in the width the operation COMPUTES in. Recorded
 * (CODESYS record:exec 2026-10-10): DINT and LINT stop (`arithedge_{dint,lint}_mod_min_by_minus_one`), SINT and INT answer 0
 * (computed in DINT, where -128 and -32768 are no minimum). It answered 0 everywhere.
 */
import { expect, test } from "bun:test"
import { elementaryRef } from "../../frontend/types/index.js"
import { arith } from "./arith.js"
import { IecFault } from "./faults.js"

const outcome = (op: "div" | "mod", l: bigint, r: bigint, type: string): string => {
  try {
    return String(arith(op, l, r, elementaryRef(type)))
  } catch (error) {
    if (error instanceof IecFault) return `stop: ${error.kind}`
    throw error
  }
}

test("MIN MOD -1 stops the task in the width it computes in, as MIN / -1 does", () => {
  expect(outcome("mod", -(2n ** 31n), -1n, "DINT")).toBe("stop: division-overflow")
  expect(outcome("mod", -(2n ** 63n), -1n, "LINT")).toBe("stop: division-overflow")
  expect(outcome("div", -(2n ** 31n), -1n, "DINT")).toBe("stop: division-overflow")
})

test("a remainder that does not overflow is the remainder — the minimum of a narrower type, any other dividend", () => {
  expect(outcome("mod", -128n, -1n, "DINT")).toBe("0") // SINT's minimum, promoted
  expect(outcome("mod", -(2n ** 31n) + 1n, -1n, "DINT")).toBe("0")
  expect(outcome("mod", -(2n ** 31n), 2n, "DINT")).toBe("0")
  expect(outcome("mod", -7n, 2n, "DINT")).toBe("-1")
  expect(outcome("mod", 2n ** 32n - 1n, 2n ** 32n - 1n, "UDINT")).toBe("0")
})
