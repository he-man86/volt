/** The operators' result types (from `types.test.ts`, transpile-restructure 1.1.11). */
import { expect, test } from "bun:test"
import { elementaryType, type Type } from "../index.js"

test("operatorFunctionResult: a comparison box is BOOL, a bit-operator box a type of ANY_BIT, any other box nothing", async () => {
  const { operatorFunctionResult, isBitOperatorWireType } = await import("../index.js")
  for (const box of ["GT", "ge", "LT", "LE", "EQ", "NE"]) expect(operatorFunctionResult(box)).toEqual({ exact: "BOOL" })
  for (const box of ["AND", "or", "XOR", "NOT"]) expect(operatorFunctionResult(box)).toEqual({ group: "ANY_BIT" })
  expect(operatorFunctionResult("ADD")).toBeUndefined()
  expect(operatorFunctionResult("TON")).toBeUndefined()
  // a bit-operator box's wire is BOOL or a bit string — ANY_BIT without BIT, as the bridge's gate (`NetworkSpelling.BitStrings`)
  for (const t of ["BOOL", "BYTE", "WORD", "DWORD", "LWORD"]) expect(isBitOperatorWireType(t)).toBe(true)
  for (const t of ["BIT", "INT", "UDINT", "REAL", "TIME", "STRING", "NotAType"]) expect(isBitOperatorWireType(t)).toBe(false)
})

test("shortCircuitType: two BOOLs are BOOL, integers meet in the unsigned integer of their width (cb_and_then_*, CB5)", async () => {
  const { shortCircuitType } = await import("../index.js")
  const el = (n: string): Type => ({ kind: "elementary", name: n, elem: elementaryType(n)! }) as Type
  expect(shortCircuitType(el("BOOL"), el("BOOL"))).toMatchObject({ name: "BOOL" })
  expect(shortCircuitType(el("INT"), el("INT"))).toMatchObject({ name: "UINT" })
  expect(shortCircuitType(el("WORD"), el("WORD"))).toMatchObject({ name: "UINT" })
  expect(shortCircuitType(el("BOOL"), el("INT"))).toMatchObject({ name: "UINT" })
  expect(shortCircuitType(el("INT"), el("DINT"))).toBeUndefined() // two widths: unmeasured
  expect(shortCircuitType(el("REAL"), el("BOOL"))).toBeUndefined()
  // a BIT is a 1-bit boolean: beside a BIT or a BOOL it is BOOL logic; beside an integer unmeasured
  expect(shortCircuitType(el("BIT"), el("BIT"))).toMatchObject({ name: "BOOL" })
  expect(shortCircuitType(el("BOOL"), el("BIT"))).toMatchObject({ name: "BOOL" })
  expect(shortCircuitType(el("BIT"), el("INT"))).toBeUndefined()
  // only 16 bits were recorded: every other width is unmeasured
  for (const [a, b] of [["BYTE", "BYTE"], ["DINT", "DINT"], ["LINT", "LINT"], ["BOOL", "DINT"], ["SINT", "BOOL"]] as const)
    expect(shortCircuitType(el(a), el(b))).toBeUndefined()
})

test("pointerArithmeticType: a pointer minus a REAL computes in the pointer on CODESYS, in the REAL on TwinCAT (dt_pointer_arithmetic_refused)", async () => {
  const { pointerArithmeticType } = await import("../index.js")
  const real: Type = { kind: "elementary", name: "REAL", elem: elementaryType("REAL")! } as Type
  const ptr: Type = { kind: "pointer", target: { kind: "elementary", name: "INT", elem: elementaryType("INT")! } as Type }
  expect(pointerArithmeticType("-", ptr, real, false, false, "codesys")).toBe(ptr)
  expect(pointerArithmeticType("-", ptr, real, false, false, "twincat")).toBe(real)
  expect(pointerArithmeticType("*", ptr, real, false, true, "codesys")).toBeUndefined()
})
