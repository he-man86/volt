/**
 * The type predicates the transpiler asks (openspec transpile-restructure 1.1.5, design.md §6 need 5) and `typeZero`
 * (1.1.4): one answer per elementary family, a BIT a BOOLEAN.
 */
import { expect, test } from "bun:test"
import { typeZero } from "./defaults.js"
import { floatBits, hasTextFormat, holdsIntegerBits, isBit, isBoolValued, isIntegral, isReal, stringKind } from "./predicates.js"
import { elementaryRef, type Type } from "./type.js"

const T = (name: string): Type => elementaryRef(name)
const STRUCT: Type = { kind: "struct", name: "S" } as Type
const rows: [string, Type][] = [
  ["BOOL", T("BOOL")],
  ["BIT", T("BIT")],
  ["BYTE", T("BYTE")],
  ["DINT", T("DINT")],
  ["ULINT", T("ULINT")],
  ["REAL", T("REAL")],
  ["LREAL", T("LREAL")],
  ["TIME", T("TIME")],
  ["LTIME", T("LTIME")],
  ["DT", T("DT")],
  ["TOD", T("TOD")],
  ["STRING", T("STRING")],
  ["WSTRING", T("WSTRING")],
  ["struct", STRUCT],
]

test("every predicate, every family", () => {
  const table = rows.map(([name, t]) => [
    name,
    isBit(t),
    isBoolValued(t),
    isIntegral(t),
    holdsIntegerBits(t),
    stringKind(t) ?? "-",
    isReal(t),
    floatBits(t) ?? "-",
    hasTextFormat(t),
  ])
  // name, isBit, isBoolValued, isIntegral, holdsIntegerBits, stringKind, isReal, floatBits, hasTextFormat
  expect(table).toEqual([
    ["BOOL", false, true, false, false, "-", false, "-", false],
    ["BIT", true, true, false, false, "-", false, "-", false],
    ["BYTE", false, false, true, true, "-", false, "-", false],
    ["DINT", false, false, true, true, "-", false, "-", false],
    ["ULINT", false, false, true, true, "-", false, "-", false],
    ["REAL", false, false, false, false, "-", true, 32, false],
    ["LREAL", false, false, false, false, "-", true, 64, false],
    ["TIME", false, false, false, true, "-", false, "-", true],
    ["LTIME", false, false, false, true, "-", false, "-", true],
    ["DT", false, false, false, true, "-", false, "-", true],
    ["TOD", false, false, false, true, "-", false, "-", true],
    ["STRING", false, false, false, false, "STRING", false, "-", false],
    ["WSTRING", false, false, false, false, "WSTRING", false, "-", false],
    ["struct", false, false, false, false, "-", false, "-", false],
  ])
})

test("typeZero: FALSE for a BOOL and a BIT, 0.0 for a real, '' for a string, 0 for the rest", () => {
  expect(rows.map(([name, t]) => [name, typeZero(t)])).toEqual([
    ["BOOL", false],
    ["BIT", false],
    ["BYTE", 0n],
    ["DINT", 0n],
    ["ULINT", 0n],
    ["REAL", 0],
    ["LREAL", 0],
    ["TIME", 0n],
    ["LTIME", 0n],
    ["DT", 0n],
    ["TOD", 0n],
    ["STRING", ""],
    ["WSTRING", ""],
    ["struct", 0n],
  ])
})
