/**
 * unary-operand — a unary operator converts its operand into the type it computes in, and says so. Measured one
 * operand type at a time on both live IDEs (`uop_neg_*`, `uop_not_*`, `unary_minus_on_bool`), completed 2026-09-21
 * with the four cells that had never been asked: `-BOOL` into a STRING, and `NOT` on TOD, DT and LTIME.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import type { Vendor } from "../../config.js"

function msgs(decl: string, op: string, outType: string, vendor: Vendor = "codesys"): string[] {
  const src = `FUNCTION_BLOCK F\nVAR\n\t${decl}\n\tout : ${outType};\nEND_VAR\nout := ${op} x;\nEND_FUNCTION_BLOCK`
  const parseResult = parseSource(src, vendor)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }], [], vendor)
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === "unary-operand-type")
    .map((d) => d.message)
}

test("unary minus names the signed integer it computes in", () => {
  expect(msgs("x : BOOL := TRUE;", "-", "STRING")).toEqual(["Cannot convert type 'BOOL' to type 'INT'"])
  expect(msgs("x : TIME := T#2S;", "-", "STRING")).toEqual(["Cannot convert type 'TIME' to type 'DINT'"])
  expect(msgs("x : LTIME := LTIME#2S;", "-", "STRING")).toEqual(["Cannot convert type 'LTIME' to type 'LINT'"])
  expect(msgs("x : DATE := D#2024-01-01;", "-", "STRING")).toEqual(["Cannot convert type 'DATE' to type 'DINT'"])
  expect(msgs("x : STRING := 'ab';", "-", "INT")).toEqual(["Cannot convert type 'STRING' to type 'INT'"])
})

test("NOT names the UNSIGNED integer of the operand's width", () => {
  expect(msgs("x : TIME := T#2S;", "NOT", "STRING")).toEqual(["Cannot convert type 'TIME' to type 'UDINT'"])
  expect(msgs("x : DATE := D#2024-01-01;", "NOT", "STRING")).toEqual(["Cannot convert type 'DATE' to type 'UDINT'"])
  expect(msgs("x : TOD := TOD#12:00:00;", "NOT", "STRING")).toEqual(["Cannot convert type 'TIME_OF_DAY' to type 'UDINT'"])
  expect(msgs("x : DT := DT#2024-01-01-12:00:00;", "NOT", "STRING")).toEqual(["Cannot convert type 'DATE_AND_TIME' to type 'UDINT'"])
  // the WIDTH follows the operand, which is what LTIME is here to show
  expect(msgs("x : LTIME := LTIME#2S;", "NOT", "STRING")).toEqual(["Cannot convert type 'LTIME' to type 'ULINT'"])
})

// THE ONE ASYMMETRY, and it is the measurement's: there is no integer `NOT` could produce from a REAL or a
// STRING, so it names the generic family instead of a concrete type.
test("NOT on a REAL or a STRING names ANY_BIT", () => {
  expect(msgs("x : REAL := 1.0;", "NOT", "STRING")).toEqual(["Cannot convert type 'REAL' to type 'ANY_BIT'"])
  expect(msgs("x : STRING := 'ab';", "NOT", "INT")).toEqual(["Cannot convert type 'STRING' to type 'ANY_BIT'"])
  expect(msgs('x : WSTRING := "ab";', "NOT", "STRING")).toEqual(["Cannot convert type 'WSTRING' to type 'ANY_BIT'"])
})

test("an operand already of the right family says nothing", () => {
  for (const decl of ["x : INT := 1;", "x : DWORD := 1;"]) {
    expect(msgs(decl, "-", "STRING")).toEqual([])
    expect(msgs(decl, "NOT", "STRING")).toEqual([])
  }
  // a REAL passes through `-` unchanged and is exactly what `NOT` cannot take, which is the pair worth stating
  expect(msgs("x : LREAL := 1.0;", "-", "STRING")).toEqual([])
  expect(msgs("x : LREAL := 1.0;", "NOT", "STRING")).toEqual(["Cannot convert type 'LREAL' to type 'ANY_BIT'"])
  // `NOT BOOL` is BOOL — already the type it computes in, so there is no conversion to report
  expect(msgs("x : BOOL := TRUE;", "NOT", "STRING")).toEqual([])
})

test("both vendors word it identically", () => {
  expect(msgs("x : TIME := T#2S;", "NOT", "STRING", "twincat")).toEqual(["Cannot convert type 'TIME' to type 'UDINT'"])
  expect(msgs("x : BOOL := TRUE;", "-", "STRING", "twincat")).toEqual(["Cannot convert type 'BOOL' to type 'INT'"])
})
