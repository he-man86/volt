/** Widths (openspec transpile-restructure 1.1.6): the integer ladder, the one store wrap, and a type's width. */
import { expect, test } from "bun:test"
import { elementaryType } from "./elementary.js"
import { elementaryRef } from "./type.js"
import { integerOfWidth, widthOf, wrapToWidth } from "./width.js"

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
