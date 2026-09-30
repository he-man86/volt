import { expect, test } from "bun:test"
import { commonType } from "./runtime.js"
import { elementaryRef, elemOf } from "../type.js"

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
