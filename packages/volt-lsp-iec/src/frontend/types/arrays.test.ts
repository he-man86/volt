/** `peelArray` and `elementOf` (openspec transpile-restructure 1.1.3): one dimension per step, a `[*]` dimension open. */
import { expect, test } from "bun:test"
import type { ArrayDim } from "../syntax/index.js"
import { elementOf, peelArray } from "./arrays.js"
import { elementaryRef, type Type } from "./type.js"

const INT = elementaryRef("INT")
const dim = {} as ArrayDim
const sized = (bounds: [bigint, bigint][], element: Type = INT): Type => ({
  kind: "array",
  element,
  dims: bounds.map(() => dim),
  bounds: bounds.map(([lower, upper]) => ({ lower, upper })),
})

test("peelArray: the first dimension's lower bound and length, the rest as the element", () => {
  expect(peelArray(sized([[1n, 5n]]))).toEqual({ element: INT, lower: 1n, length: 5 })
  const two = peelArray(sized([[0n, 2n], [-1n, 1n]]))!
  expect([two.lower, two.length]).toEqual([0n, 3])
  expect(peelArray(two.element)).toEqual({ element: INT, lower: -1n, length: 3 })
})

test("peelArray: undefined for a non-array and for an array whose bounds do not fold", () => {
  expect(peelArray(INT)).toBeUndefined()
  expect(peelArray({ kind: "array", element: INT, dims: [dim] })).toBeUndefined()
})

test("elementOf: a sized array's element; an open array's remaining dimensions, then its element", () => {
  expect(elementOf(sized([[1n, 5n]]))).toEqual(INT)
  const open: Type = { kind: "array", element: INT, dims: [dim, dim] }
  expect(elementOf(open)).toEqual({ kind: "array", element: INT, dims: [dim] })
  expect(elementOf(elementOf(open)!)).toEqual(INT)
  expect(elementOf(INT)).toBeUndefined()
})
