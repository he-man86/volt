/**
 * The one operand meet (task 1.7.15) and its three contexts.
 */
import { expect, test } from "bun:test"
import type { Scope } from "../../../frontend/symbols/index.js"
import { elementaryRef, type Type } from "../../../frontend/types/index.js"
import { run } from "../../interp/index.js"
import type { IrExpr } from "../../ir/index.js"
import { Lowering } from "../core/lowering.js"
import { lowerSource } from "../index.js"
import { meet } from "./promote.js"

const span = undefined as never
const lw = new Lowering({} as Scope, {} as Scope)
const ty = (name: string) => elementaryRef(name)
const variable = (t: Type): IrExpr => ({ kind: "load", place: { slot: 0, path: [], type: t, span }, type: t, span })
const constant = (value: bigint | number, t: Type): IrExpr => ({ kind: "const", value, type: t, span })
const name = (t: Type | undefined) => (t as { elem?: { name: string } } | undefined)?.elem?.name

test("binary: a literal beside a narrow variable takes the promoted type, the meet is promoted when the operator lifts", () => {
  const met = meet(lw, [variable(ty("SINT")), constant(1000n, ty("INT"))], { kind: "binary", lift: true, operator: "+" }, span)!
  expect(name(met.type)).toBe("DINT")
  expect(met.operands.map((o) => name(o.type))).toEqual(["SINT", "DINT"])
  const unlifted = meet(lw, [variable(ty("SINT")), variable(ty("SINT"))], { kind: "binary", lift: false, operator: "SHL" }, span)!
  expect(name(unlifted.type)).toBe("SINT")
})

test("binary: two integer constants fold at full width", () => {
  const met = meet(lw, [constant(1n, ty("INT")), constant(2n, ty("INT"))], { kind: "binary", lift: true, operator: "+" }, span)!
  expect(met.operands.map((o) => name(o.type))).toEqual(["LINT", "LINT"])
})

test("builtin: the variables decide and a REAL constant widens; the operands are not retyped", () => {
  const ops = [variable(ty("INT")), constant(2.5, ty("LREAL"))]
  const met = meet(lw, ops, { kind: "builtin" }, span)!
  expect(name(met.type)).toBe("LREAL")
  expect(met.operands).toEqual(ops)
})

// two types meet promoted (`for_limit_sign_change_uint_counter_out_of_int_range`, `_uint_limit_out_of_int_range`)
test("for-compare: one type stays itself; two meet in their common type, promoted", () => {
  expect(name(meet(lw, [variable(ty("INT")), variable(ty("DINT"))], { kind: "for-compare" }, span)!.type)).toBe("DINT")
  expect(name(meet(lw, [variable(ty("SINT")), variable(ty("SINT"))], { kind: "for-compare" }, span)!.type)).toBe("SINT")
  expect(name(meet(lw, [variable(ty("UINT")), variable(ty("INT"))], { kind: "for-compare" }, span)!.type)).toBe("DINT")
  expect(name(meet(lw, [variable(ty("UDINT")), variable(ty("DINT"))], { kind: "for-compare" }, span)!.type)).toBe("DINT")
})

/** Lower and require success — most tests are about the SHAPE, not the failure path. */
function ir(src: string, name?: string) {
  const { pou, diagnostics } = lowerSource(src, name)
  expect(diagnostics).toEqual([])
  return pou!
}

// transpile-review 6: an untyped literal beside a variable took the neighbour's type even when it did not fit, and wrapped
// (`x + -3000000000` was 1294967301). CODESYS (`tr_6_literal_beyond_dint_neighbour`): the literal keeps its own type and the
// pair meets — a UDINT literal beside a DINT at LINT; MAX(ud, 5000000000) is 5000000000.
test("an integer literal that does not fit its neighbour's type keeps its own and meets it wider", () => {
  const vars = "x : DINT := 5; ud : UDINT := 3; g1 : BOOL; s1 : LINT; s2 : LINT; g2 : BOOL; g3 : BOOL; g4 : BOOL; m : LINT; mx : LINT;"
  const body = [
    "g1 := x > -3000000000;",
    "s1 := x + -3000000000;",
    "s2 := ud + 5000000000;",
    "g2 := ud > 5000000000;",
    "g3 := x > 3000000000;",
    "g4 := 3000000000 < x;",
    "m := ud * 5000000000;",
    "mx := MAX(ud, 5000000000);",
  ].join("\n")
  const runner = run(ir(`PROGRAM P\nVAR ${vars} END_VAR\n${body}\nEND_PROGRAM\n`, "P"))
  runner.scan()
  expect(["g1", "s1", "s2", "g2", "g3", "g4", "m", "mx"].map((n) => runner.get(n))).toEqual([
    true, -2999999995n, 5000000003n, false, false, false, 15000000000n, 5000000000n,
  ])
})

// rule LT12 (`lt_literal_negative_in_comparison_unsigned`, CODESYS 2026-10-03): an untyped NEGATIVE literal compared with a
// narrower UNSIGNED operand converts INTO UDINT (the build warns "signed Type 'SINT' to unsigned Type 'UDINT'"), so
// `ui > -1` with `ui : UINT := 3` is FALSE and `u = -1` with `u : USINT := 255` FALSE; comparing them as numbers gave TRUE.
test("an untyped negative literal compared with a narrower unsigned operand converts into UDINT (LT12)", () => {
  const vars = "u : USINT := 255; ui : UINT := 3; b1 : BOOL; b2 : BOOL; b3 : BOOL; b4 : BOOL;"
  const body = ["b1 := u = -1;", "b2 := ui > -1;", "b3 := -1 < ui;", "b4 := ui <> -1;"].join("\n")
  const runner = run(ir(`PROGRAM P\nVAR ${vars} END_VAR\n${body}\nEND_PROGRAM\n`, "P"))
  runner.scan()
  expect(["b1", "b2", "b3", "b4"].map((n) => runner.get(n))).toEqual([false, false, false, true])
})

// transpile-restructure 6.2 gate (CODESYS record:exec + record:language 2026-10-09, `tr_6_negative_*_beside_unsigned`): LT12
// holds for every negative literal class, each into the unsigned type of its own width or 32 bits — -200 (INT) and
// -40000 (DINT) into UDINT, -3000000000 (LINT) into ULINT — so each compares FALSE; a parenthesised -1 is the literal
// (FALSE); the constant expression 0 - 1 is no literal and compares as a number (TRUE).
test("LT12 for every negative literal class, parenthesised too; a constant expression compares as a number", () => {
  const vars = "u : USINT := 255; ui : UINT := 3; b1 : BOOL; b2 : BOOL; b3 : BOOL; b4 : BOOL; b5 : BOOL; b6 : BOOL;"
  const body = ["b1 := u > -200;", "b2 := ui > -200;", "b3 := ui > -40000;", "b4 := ui > -3000000000;", "b5 := ui > (-1);", "b6 := ui > 0 - 1;"].join("\n")
  const runner = run(ir(`PROGRAM P\nVAR ${vars} END_VAR\n${body}\nEND_PROGRAM\n`, "P"))
  runner.scan()
  expect(["b1", "b2", "b3", "b4", "b5", "b6"].map((n) => runner.get(n))).toEqual([false, false, false, false, false, true])
})

/** The narrow-arithmetic rule's shape: the binary/unary/builtin node a store holds, as `[op, type]` all the way down. */
function shape(e: IrExpr): unknown {
  if (e.kind === "binary") return [e.op, name(e.type), shape(e.left), shape(e.right)]
  if (e.kind === "unary") return [e.op, name(e.type), shape(e.operand)]
  if (e.kind === "builtin") return [e.name, name(e.type), ...e.args.map(shape)]
  if (e.kind === "convert") return ["convert", name(e.type), shape(e.value)]
  if (e.kind === "const") return [`${e.value}`, name(e.type)]
  return name(e.type)
}
const storedShapes = (src: string): unknown[] =>
  ir(src, "P").body.flatMap((s) => (s.kind === "assign" ? [shape(s.value)] : s.kind === "if" ? [shape(s.cond)] : []))

// THE NARROW-ARITHMETIC RULE (lean 3, transpile-restructure 7.3.1): add, sub, mul, neg, AND/OR/XOR, MAX/MIN/LIMIT and ABS of
// T values stored straight back into T compute in T — truncation is a ring homomorphism, and MAX/MIN/LIMIT answer one of
// their operands — so the IR both backends run carries the narrow node, and every value at the edges is the promoted one.
test("arithmetic of T values stored back into T computes in T, and answers what the promoted computation answers", () => {
  const vars = "a : INT := 32767; b : INT := 2; c : INT := -32768; si : SINT := -128; u : UINT := 1; w : WORD := 16#F0F0; x : INT; y : INT; z : INT; n : INT; q : SINT; v : UINT; m : INT; l : INT; k : INT; bw : WORD;"
  const body = ["x := a + b;", "y := a * b - c;", "z := -c;", "n := ABS(c);", "q := si * si + 1;", "v := u - 2;", "m := MAX(a, c, 5);", "l := LIMIT(c, b, 10);", "k := (a + b) * 3;", "bw := w AND 16#FF00 OR w;"].join("\n")
  const src = `PROGRAM P\nVAR ${vars} END_VAR\n${body}\nEND_PROGRAM\n`
  expect(storedShapes(src)).toEqual([
    ["add", "INT", "INT", "INT"],
    ["sub", "INT", ["mul", "INT", "INT", "INT"], "INT"],
    ["neg", "INT", "INT"],
    ["abs", "INT", "INT"],
    ["add", "SINT", ["mul", "SINT", "SINT", "SINT"], ["1", "SINT"]],
    ["sub", "UINT", "UINT", ["2", "UINT"]],
    ["max", "INT", "INT", "INT", ["5", "INT"]],
    ["limit", "INT", "INT", "INT", ["10", "INT"]],
    ["mul", "INT", ["add", "INT", "INT", "INT"], ["3", "INT"]],
    ["or", "WORD", ["and", "WORD", "WORD", ["65280", "WORD"]], "WORD"],
  ])
  const runner = run(ir(src, "P"))
  runner.scan()
  // the promoted answers, wrapped on the store: 32769 -> -32767, 65534 + 32768 -> 32766, |MIN| -> MIN, 16385 -> 16385 - 65536…
  expect(["x", "y", "z", "n", "q", "v", "m", "l", "k", "bw"].map((n) => runner.get(n))).toEqual([
    -32767n, 32766n, -32768n, -32768n, 1n, 65535n, 32767n, 2n, -32765n, 0xf0f0n,
  ])
})

// 7.3.3: a comparison of two values of one type (or a constant that type holds) compares in that type — a widening that
// keeps every value keeps their order; a constant it does not hold, or two types, keep the promoted compare
test("a comparison of one type's values, or a constant that type holds, compares in that type", () => {
  const src = "PROGRAM P\nVAR a : INT; b : INT; si : SINT; u : UINT; rl : REAL; g1 : BOOL; g2 : BOOL; g3 : BOOL; g4 : BOOL; g5 : BOOL; g6 : BOOL; END_VAR\ng1 := a <= b;\ng2 := a > 10;\ng3 := a < 40000;\ng4 := si = a;\ng5 := u > a;\ng6 := rl < 2.5;\nEND_PROGRAM\n"
  expect(storedShapes(src)).toEqual([
    ["le", "BOOL", "INT", "INT"],
    ["gt", "BOOL", "INT", ["10", "INT"]],
    ["lt", "BOOL", ["convert", "DINT", "INT"], ["40000", "DINT"]],
    ["eq", "BOOL", ["convert", "INT", "SINT"], "INT"],
    ["gt", "BOOL", ["convert", "DINT", "UINT"], ["convert", "DINT", "INT"]],
    ["lt", "BOOL", "REAL", ["2.5", "REAL"]],
  ])
})

// 7.3.7: MAX/MIN/LIMIT of a REAL and an untyped real literal an f32 holds meet in LREAL, and stored back into the REAL the
// selection computes in REAL — it picks an operand, and the widening kept every one; a literal an f32 does not hold (0.1)
// keeps the LREAL computation
test("a REAL selection with an exact real literal, stored back into a REAL, computes in REAL", () => {
  const src = "PROGRAM P\nVAR n : REAL := 3.5; a : REAL; b : REAL; c : REAL; END_VAR\na := MAX(n, 2.5);\nb := LIMIT(0.5, n, 10.0);\nc := MIN(n, 0.1);\nEND_PROGRAM\n"
  expect(storedShapes(src)).toEqual([
    ["max", "REAL", "REAL", ["2.5", "REAL"]],
    ["limit", "REAL", ["0.5", "REAL"], "REAL", ["10", "REAL"]],
    ["convert", "REAL", ["min", "LREAL", ["convert", "LREAL", "REAL"], ["0.1", "LREAL"]]],
  ])
  const runner = run(ir(src, "P"))
  runner.scan()
  expect(["a", "b", "c"].map((v) => runner.get(v))).toEqual([3.5, 3.5, Math.fround(0.1)])
})

// 7.3.11: WHERE THE PROMOTION STAYS — each a case the narrow rule must not take, pinned with the value the promoted
// computation answers. DIV: SINT -128 / -1 is 128 in DINT and wraps to -128 on the store, where a narrow i8 division traps
// (`arithedge_sint_div_min_by_minus_one`, recorded SINT#-128); MOD by a variable: -128 MOD -1 is 0
// (`arithedge_sint_mod_min_by_minus_one`); a mixed-sign meet (INT and UINT meet in DINT); a shift (SHL masks its count by the
// promoted width: SHL(BYTE 1, 9) into a WORD is 512, `shift_basic`); a store into a WIDER type (32767 + 1 into a DINT is 32768,
// no truncation undoes the promotion). And 7.3.13: MOD — and DIV — by a constant other than 0 and -1 computes narrow.
test("DIV and MOD by a variable, mixed signs, shifts and wider stores stay promoted; by a harmless constant they narrow", () => {
  const vars = "si : SINT := -128; m1 : SINT := -1; q : SINT; rm : SINT; i : INT := 7; u : UINT := 65535; sm : DINT; b : BYTE := 1; n : INT := 9; w : WORD; a : INT := 32767; d : DINT; k : INT; kd : INT;"
  const body = ["q := si / m1;", "rm := si MOD m1;", "sm := i + u;", "w := SHL(b, n);", "d := a + 1;", "k := i MOD 4;", "kd := i / 4;"].join("\n")
  const src = `PROGRAM P\nVAR ${vars} END_VAR\n${body}\nEND_PROGRAM\n`
  const shapes = storedShapes(src) as unknown[][]
  // the first five keep their DINT computation under a conversion (or are DINT already); the last is an INT `%`
  expect(shapes.slice(0, 5).map((s) => (s[0] === "convert" ? `${s[1]} <- ${(s[2] as unknown[])[1]}` : `${s[0]} ${s[1]}`))).toEqual([
    "SINT <- DINT",
    "SINT <- DINT",
    "add DINT",
    "WORD <- DINT",
    "add DINT",
  ])
  expect(shapes[5]).toEqual(["mod", "INT", "INT", ["4", "INT"]])
  expect(shapes[6]).toEqual(["div", "INT", "INT", ["4", "INT"]])
  const runner = run(ir(src, "P"))
  runner.scan()
  expect(["q", "rm", "sm", "w", "d", "k", "kd"].map((v) => runner.get(v))).toEqual([-128n, 0n, 65542n, 512n, 32768n, 3n, 1n])
})
