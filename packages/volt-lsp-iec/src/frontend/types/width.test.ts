/** Widths (openspec transpile-restructure 1.1.6, 6.B.2): the integer ladder, the one store wrap, the one store rule, and a
 *  type's width. */
import { expect, test } from "bun:test"
import { elementaryType } from "./elementary.js"
import { elementaryRef } from "./type.js"
import { integerOfWidth, storeInteger, widthOf, wrapToWidth } from "./width.js"

test("integerOfWidth: the narrowest type of each signedness that holds the bits", () => {
  expect([1, 8, 9, 16, 17, 32, 33, 64].map((b) => integerOfWidth(b, true).name)).toEqual(["SINT", "SINT", "INT", "INT", "DINT", "DINT", "LINT", "LINT"])
  expect([8, 16, 32, 64].map((b) => integerOfWidth(b, false).name)).toEqual(["USINT", "UINT", "UDINT", "ULINT"])
})

test("wrapToWidth: two's complement at a signed width, modulo at an unsigned one", () => {
  const e = (n: string) => elementaryType(n)!
  expect(wrapToWidth(40000n, e("INT"))).toBe(-25536n)
  expect(wrapToWidth(128n, e("SINT"))).toBe(-128n)
  expect(wrapToWidth(-1n, e("BYTE"))).toBe(255n)
  expect(wrapToWidth(-1n, e("UDINT"))).toBe(4294967295n)
  expect(wrapToWidth(5n, e("DINT"))).toBe(5n)
})

test("widthOf: an elementary type's bits; undefined for anything else", () => {
  expect(widthOf(elementaryRef("DWORD"))).toBe(32)
  expect(widthOf(elementaryRef("LTIME"))).toBe(64)
  expect(widthOf({ kind: "struct", name: "S" } as never)).toBeUndefined()
})

test("storeInteger: an integer, bit string, duration or date wraps at its width; anything else holds the integer unchanged", () => {
  expect(storeInteger(40000n, elementaryRef("INT"))).toBe(-25536n)
  expect(storeInteger(-1n, elementaryRef("WORD"))).toBe(65535n)
  expect(storeInteger(2n ** 32n + 5n, elementaryRef("TIME"))).toBe(5n)
  expect(storeInteger(2n ** 32n + 5n, elementaryRef("DT"))).toBe(5n)
  expect(storeInteger(2n ** 64n + 5n, elementaryRef("LTIME"))).toBe(5n)
  // a BIT holds a BOOLEAN (`isBit`): no width to wrap at, as for a BOOL, a REAL and a STRING
  for (const name of ["BIT", "BOOL", "REAL", "STRING"]) expect(storeInteger(300n, elementaryRef(name))).toBe(300n)
  expect(storeInteger(300n, { kind: "struct", name: "S" } as never)).toBe(300n)
})
