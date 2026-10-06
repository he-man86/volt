/**
 * binary-op-type-mismatch — arithmetic on a string operand (gap 11). Every expectation is CODESYS's recorded wording
 * (conformance `cc_string_*`, `cc_int_plus_string`, `cc_wstring_plus_wstring`; execution oracle `string_arithmetic_rejected`).
 */
import { expect, test } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../test-uri.js"

const mismatches = (vars: string, body: string): string[] => {
  const src = `PROGRAM PLC_PRG\nVAR\n${vars}\nEND_VAR\n${body}\nEND_PROGRAM`
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }])
  return computeSemanticDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "binary-op-type-mismatch")
    .map((d) => d.message)
}

test("a string on the LEFT of + - * / must become a number — one ANY_NUM message, STRING and WSTRING alike", () => {
  // It was silent: the check knew MOD and BOOL-with-a-number, and no fixture added two strings.
  for (const op of ["+", "-"]) expect(mismatches("a : STRING; b : STRING; c : STRING;", `c := a ${op} b;`)).toEqual(["Cannot convert type 'STRING' to type 'ANY_NUM'"])
  for (const op of ["*", "/"]) expect(mismatches("a : STRING; i : INT; c : STRING;", `c := a ${op} i;`)).toEqual(["Cannot convert type 'STRING' to type 'ANY_NUM'"])
  expect(mismatches("a : WSTRING; b : WSTRING; c : WSTRING;", "c := a + b;")).toEqual(["Cannot convert type 'WSTRING' to type 'ANY_NUM'"])
})

test("a string on the RIGHT of a number must become that number's type", () => {
  expect(mismatches("a : STRING; i : INT; j : INT;", "j := i + a;")).toEqual(["Cannot convert type 'STRING' to type 'INT'"])
})

test("comparing strings is not arithmetic — no message", () => {
  expect(mismatches("a : STRING; b : STRING; same : BOOL;", "same := a = b;")).toEqual([])
})

// transpile-review-2026-09-29 task 40 (`tr_40_*`): a 32-bit date ± an LTIME, either order, is ULINT arithmetic CODESYS
// refuses — "Cannot convert type 'LTIME' to type 'ULINT'".
test("DATE / DT / TOD plus or minus an LTIME is refused; with a TIME it is not", () => {
  const ltime = ["Cannot convert type 'LTIME' to type 'ULINT'"]
  expect(mismatches("d : DATE; dur : LTIME;", "d := d + dur;")).toEqual(ltime)
  expect(mismatches("d : DT; dur : LTIME;", "d := d + dur;")).toEqual(ltime)
  expect(mismatches("t : TOD; dur : LTIME;", "t := t - dur;")).toEqual(ltime)
  expect(mismatches("d : DATE; dur : LTIME;", "d := dur + d;")).toEqual(ltime)
  expect(mismatches("d : DATE; dur : TIME;", "d := d + dur;")).toEqual([])
})

// Rule AR18 (`arith/temporal` `durationScaleResultType`): a TIME scaled by a 64-bit integer is that INTEGER, and the TIME
// is refused into it — "Cannot convert type 'TIME' to type 'LINT'" for `t * li` and `li * t`, 'TIME' to 'ULINT' for
// `t / ul` (`ar_time_scaled_by_wide_or_unsigned_int_type`, both vendors 2026-10-03). It was silent wherever the result
// was stored into a matching integer: only the STRING stores of the probe reported anything.
test("a TIME scaled by a 64-bit integer refuses the TIME into the integer; a narrower integer refuses nothing", () => {
  expect(mismatches("t : TIME; li : LINT; x : LINT;", "x := t * li;")).toEqual(["Cannot convert type 'TIME' to type 'LINT'"])
  expect(mismatches("t : TIME; li : LINT; x : LINT;", "x := li * t;")).toEqual(["Cannot convert type 'TIME' to type 'LINT'"])
  expect(mismatches("t : TIME; ul : ULINT; x : ULINT;", "x := t / ul;")).toEqual(["Cannot convert type 'TIME' to type 'ULINT'"])
  expect(mismatches("t : TIME; n : INT;", "t := t * n;")).toEqual([])
  expect(mismatches("t : TIME; n : SINT;", "t := t / n;")).toEqual([])
  expect(mismatches("t : LTIME; n : LINT;", "t := n * t;")).toEqual([])
})

test("AND_THEN / OR_ELSE on integers: a BOOL operand refused into the unsigned integer they meet in, that integer refused as the condition (cb_and_then_*, CB5)", () => {
  const vars = "a : INT; b : INT; wa : WORD; wb : WORD; ba : BOOL; bb : BOOL; i : INT; w : WORD; o : BOOL;"
  expect(mismatches(vars, "i := a AND_THEN b;")).toEqual(["Cannot convert type 'UINT' to type 'BOOL'"])
  expect(mismatches(vars, "i := a OR_ELSE b;")).toEqual(["Cannot convert type 'UINT' to type 'BOOL'"])
  expect(mismatches(vars, "w := wa AND_THEN wb;")).toEqual(["Cannot convert type 'UINT' to type 'BOOL'"])
  expect(mismatches(vars, "o := ba AND_THEN a;")).toEqual(["Cannot convert type 'BOOL' to type 'UINT'", "Cannot convert type 'UINT' to type 'BOOL'"])
  expect(mismatches(vars, "o := ba AND_THEN bb;\no := ba OR_ELSE bb;")).toEqual([])
  // a BIT is a 1-bit boolean, not an integer: BIT AND_THEN BIT and BOOL AND_THEN BIT are logic, nothing refused
  expect(mismatches("x : BIT; y : BIT; ba : BOOL; o : BOOL;", "o := x AND_THEN y;\no := ba AND_THEN y;\no := x OR_ELSE ba;")).toEqual([])
  // only 16 bits were recorded (two INTs, two WORDs, a BOOL beside an INT): another width names no meet, so nothing is said
  expect(mismatches("a : BYTE; b : BYTE; c : DINT; d : DINT; e : LINT; f : LINT; ba : BOOL; o : BOOL;", "o := a AND_THEN b;\no := c AND_THEN d;\no := e OR_ELSE f;\no := ba AND_THEN c;")).toEqual([])
})
