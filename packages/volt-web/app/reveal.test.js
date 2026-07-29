import { test, expect } from "bun:test"
import { revealDelay } from "./reveal.jsx"

test("revealDelay staggers by index", () => {
  expect(revealDelay(0)).toBe(0)
  expect(revealDelay(3)).toBe(240)
  expect(revealDelay(2, 100)).toBe(200)
  expect(revealDelay(-5)).toBe(0) // never negative
})
