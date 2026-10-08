/**
 * The enumerator numbering and the enum default (`numberEnumerators`, `enumDefaultValue`) — one home for the LSP and the
 * transpiler (transpile-restructure 1.7.14). The default's cases are the recordings `enumDefault`'s doc names.
 */
import { expect, test } from "bun:test"
import type { Expr } from "../syntax/index.js"
import { enumDefaultValue, numberEnumerators } from "./enums.js"

const lit = (n: bigint): Expr => ({ kind: "literal", value: n }) as unknown as Expr
const unfoldable = { kind: "ident_expr", name: "k" } as unknown as Expr
const valueOf = (e: Expr): bigint | undefined => (e.kind === "literal" ? (e as unknown as { value: bigint }).value : undefined)
const members = (...list: [string, Expr?][]) => list.map(([text, value]) => ({ name: { text }, ...(value === undefined ? {} : { value }) }))

test("numbered in declaration order: a written value folded, an unwritten one the previous plus one, the first 0", () => {
  const n = numberEnumerators(members(["Idle"], ["Busy"], ["High", lit(10n)], ["Next"]), valueOf)
  expect([...n.values]).toEqual([["IDLE", 0n], ["BUSY", 1n], ["HIGH", 10n], ["NEXT", 11n]])
  expect(n.unfolded).toBeUndefined()
})

test("a written value that does not fold ends the numbering; `until` stops after that member, folding nothing past it", () => {
  const list = members(["A"], ["B", unfoldable], ["C"])
  const all = numberEnumerators(list, valueOf)
  expect([...all.values]).toEqual([["A", 0n]])
  expect(all.unfolded).toBe("B")
  let asked = 0
  const counting = (e: Expr) => (asked++, valueOf(e))
  const untilA = numberEnumerators(list, counting, "a")
  expect([...untilA.values]).toEqual([["A", 0n]])
  expect([untilA.unfolded, asked]).toEqual([undefined, 0])
})

test("the default: zero when zero is a value, else the first; a type-level `:= Name` names one; undefined when one does not fold", () => {
  expect(enumDefaultValue(members(["Forward", lit(1n)], ["Reverse", lit(2n)]), undefined, valueOf)).toBe(1n)
  expect(enumDefaultValue(members(["Reverse", lit(-1n)], ["Neutral", lit(0n)], ["Forward", lit(1n)]), undefined, valueOf)).toBe(0n)
  expect(enumDefaultValue(members(["High", lit(10n)], ["None", lit(0n)]), undefined, valueOf)).toBe(0n)
  expect(enumDefaultValue(members(["Idle"], ["Busy"]), undefined, valueOf)).toBe(0n)
  expect(enumDefaultValue(members(["Idle"], ["Busy"]), { kind: "ident_expr", name: "busy" }, valueOf)).toBe(1n)
  expect(enumDefaultValue(members(["Idle"], ["Busy"]), { kind: "literal" }, valueOf)).toBeUndefined()
  expect(enumDefaultValue(members(["A", unfoldable]), undefined, valueOf)).toBeUndefined()
})
