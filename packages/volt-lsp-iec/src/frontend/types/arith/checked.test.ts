/**
 * The checked arithmetic types (openspec transpile-restructure 1.1.8): what the compiler's message names for `a <op> b`
 * and for `-a` — the pairs `fixtures/operators/mixed-type.ts` and `cc_neg_*` / `uop_neg_*` measured.
 */
import { expect, test } from "bun:test"
import { elementaryRef, elemOf } from "../type.js"
import { checkedMeetType, checkedNegationType } from "./checked.js"

const T = elementaryRef
const meet = (a: string, b: string): string | undefined => {
  const t = checkedMeetType(T(a), T(b))
  return t === undefined ? undefined : elemOf(t)?.name
}

test("checkedMeetType: a REAL wins as it is; otherwise the widest width, signed if either is", () => {
  expect([meet("LINT", "REAL"), meet("DINT", "LREAL"), meet("REAL", "LREAL"), meet("REAL", "INT")]).toEqual(["REAL", "LREAL", "LREAL", "REAL"])
  expect([meet("BYTE", "BYTE"), meet("BYTE", "WORD"), meet("DWORD", "SINT"), meet("BOOL", "INT")]).toEqual(["USINT", "UINT", "DINT", "INT"])
})

test("checkedMeetType: a pair the recordings do not cover has no meet", () => {
  expect([meet("BOOL", "BOOL"), meet("TIME", "INT"), meet("STRING", "INT"), meet("DATE", "DINT")]).toEqual([undefined, undefined, undefined, undefined])
})

test("checkedNegationType: the signed integer of the operand's width, at least 16 bits; a REAL keeps its type", () => {
  const neg = (n: string): string | undefined => elemOf(checkedNegationType(T(n)))?.name
  expect(["SINT", "USINT", "BYTE", "UINT", "WORD", "UDINT"].map(neg)).toEqual(["INT", "INT", "INT", "INT", "INT", "DINT"])
  expect(["INT", "DINT", "LINT", "ULINT", "LWORD"].map(neg)).toEqual(["INT", "DINT", "LINT", "LINT", "LINT"])
  expect(["STRING", "TIME", "LTIME", "BOOL", "REAL", "LREAL"].map(neg)).toEqual(["INT", "DINT", "LINT", "INT", "REAL", "LREAL"])
})
