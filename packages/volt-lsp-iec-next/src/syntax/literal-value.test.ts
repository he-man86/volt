import { test, expect } from "bun:test"
import { parseLiteralValue } from "./literal-value.js"
import type { DurationValue } from "./ast.js"

test("integer literals: decimal, radix, underscores", () => {
  expect(parseLiteralValue("int", "42").value).toBe(42n)
  expect(parseLiteralValue("int", "1_000_000").value).toBe(1_000_000n)
  expect(parseLiteralValue("int", "16#FF").value).toBe(255n)
  expect(parseLiteralValue("int", "16#FFFF_FFFF").value).toBe(0xffff_ffffn)
  expect(parseLiteralValue("int", "8#77").value).toBe(63n)
  expect(parseLiteralValue("int", "2#1010").value).toBe(10n)
})

test("real literals", () => {
  expect(parseLiteralValue("real", "1.5").value).toBe(1.5)
  expect(parseLiteralValue("real", "1_000.5").value).toBe(1000.5)
  expect(parseLiteralValue("real", "1.5e3").value).toBe(1500)
})

test("bool literals", () => {
  expect(parseLiteralValue("bool", "TRUE").value).toBe(true)
  expect(parseLiteralValue("bool", "false").value).toBe(false)
})

test("string literals strip quotes", () => {
  expect(parseLiteralValue("string", "'hi'").value).toBe("hi")
  expect(parseLiteralValue("wstring", '"wide"').value).toBe("wide")
})

test("duration literals normalize to nanoseconds", () => {
  expect((parseLiteralValue("time", "T#10ms").value as DurationValue).ns).toBe(10_000_000n)
  expect((parseLiteralValue("time", "T#1s").value as DurationValue).ns).toBe(1_000_000_000n)
  // 1h30m = 5400s
  expect((parseLiteralValue("time", "TIME#1h30m").value as DurationValue).ns).toBe(5_400_000_000_000n)
  expect((parseLiteralValue("time", "T#-10ms").value as DurationValue).ns).toBe(-10_000_000n)
  expect((parseLiteralValue("time", "LTIME#100ns").value as DurationValue).ns).toBe(100n)
  // fractional
  expect((parseLiteralValue("time", "T#1.5s").value as DurationValue).ns).toBe(1_500_000_000n)
})

test("typed literals split prefix + value", () => {
  expect(parseLiteralValue("typed", "INT#42")).toEqual({ prefix: "INT", value: 42n })
  expect(parseLiteralValue("typed", "REAL#1.5")).toEqual({ prefix: "REAL", value: 1.5 })
  expect(parseLiteralValue("typed", "BOOL#TRUE")).toEqual({ prefix: "BOOL", value: true })
  expect(parseLiteralValue("typed", "WORD#16#FF")).toEqual({ prefix: "WORD", value: 255n })
})

test("malformed literals yield undefined, never throw", () => {
  expect(parseLiteralValue("int", "16#GG").value).toBeUndefined()
  expect(parseLiteralValue("real", "not-a-number").value).toBeUndefined()
})
