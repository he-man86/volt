import { expect, test } from "bun:test"
import { commonType, temporalResultType } from "./arith.js"
import { elementaryRef, elemOf } from "./type.js"

const meet = (a: string, b: string): string | undefined => elemOf(commonType(elementaryRef(a), elementaryRef(b)))?.name

// transpile-review-2026-09-29 task 1 (conformance `meet_mixed_sign_wider_unsigned`): a WIDER unsigned operand does not
// make the meet unsigned. ULINT 6 / SINT -2 is -3 and DWORD 10 / INT -2 is -5 in CODESYS, 0 > INT -2 is TRUE — the
// meet is the wider width, SIGNED because one side is.
test("a wider unsigned operand meets a narrower signed one at the wider width, signed", () => {
  expect(meet("ULINT", "SINT")).toBe("LINT")
  expect(meet("SINT", "ULINT")).toBe("LINT")
  expect(meet("DWORD", "INT")).toBe("DINT")
  expect(meet("UDINT", "INT")).toBe("DINT")
  expect(meet("INT", "UDINT")).toBe("DINT")
})

test("same-sign and signed-wider pairs keep the wider type", () => {
  expect(meet("UDINT", "USINT")).toBe("UDINT")
  expect(meet("DINT", "USINT")).toBe("DINT")
  expect(meet("LINT", "UDINT")).toBe("LINT")
  expect(meet("DINT", "UDINT")).toBe("DINT")
  expect(meet("UDINT", "DINT")).toBe("DINT")
})

// transpile-review-2026-09-29 task 40 (`tr_40_*`): a 32-bit date (DATE, DT, TOD) and an LTIME are no temporal pair —
// CODESYS computes them as ULINT and refuses the result ("Cannot convert type 'LTIME' to type 'ULINT'" …).
test("DATE / DT / TOD with an LTIME is no temporal pair, either order; with a TIME it is", () => {
  expect(temporalResultType("+", "DATE", "LTIME")).toBeUndefined()
  expect(temporalResultType("+", "DT", "LTIME")).toBeUndefined()
  expect(temporalResultType("-", "TOD", "LTIME")).toBeUndefined()
  expect(temporalResultType("+", "LTIME", "DATE")).toBeUndefined()
  expect(temporalResultType("+", "DATE", "TIME")).toBe("DATE")
  expect(temporalResultType("-", "TOD", "TIME")).toBe("TOD")
})
