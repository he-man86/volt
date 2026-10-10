/**
 * Lowering tests of `operators.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { describe, expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import type { IrAssign, IrIf, IrLoop } from "../../ir/index.js"
import { lowerSource } from "../index.js"

/** Lower and require success — most tests are about the SHAPE, not the failure path. */
function ir(src: string, name?: string) {
  const { pou, diagnostics } = lowerSource(src, name)
  expect(diagnostics).toEqual([])
  return pou!
}

const wrap = (body: string, vars = "iCount : INT;") => `PROGRAM P\nVAR\n  ${vars}\nEND_VAR\n${body}\nEND_PROGRAM\n`

describe("lower — semantics resolved before any backend sees them", () => {
  test("ELSIF becomes a nested IF, so a backend has one branch shape", () => {
    const pou = ir(wrap("IF iCount > 5 THEN\n  iCount := 0;\nELSIF iCount > 2 THEN\n  iCount := 1;\nELSE\n  iCount := 2;\nEND_IF"))
    const outer = pou.body[0] as IrIf
    expect(outer.kind).toBe("if")
    expect(outer.else.length).toBe(1)
    const inner = outer.else[0] as IrIf
    expect(inner.kind).toBe("if")
    expect(inner.else.length).toBe(1) // the real ELSE
  })

  test("mixing INT and REAL inserts an explicit conversion — a backend never widens on its own", () => {
    const pou = ir(wrap("rate := rate + iCount;", "iCount : INT;\n  rate : REAL;"))
    const assign = pou.body[0] as IrAssign
    const sum = assign.value
    expect(sum.kind).toBe("binary")
    if (sum.kind !== "binary") return
    expect(sum.left.kind).toBe("load") // REAL already
    expect(sum.right.kind).toBe("convert") // INT widened, explicitly
    expect(sum.right.type.kind === "elementary" && sum.right.type.name).toBe("REAL")
  })

  test("a comparison's operands meet at their own common type, not at the BOOL result", () => {
    const pou = ir(wrap("flag := iCount < rate;", "iCount : INT;\n  rate : REAL;\n  flag : BOOL;"))
    const cmp = (pou.body[0] as IrAssign).value
    expect(cmp.kind === "binary" && cmp.op).toBe("lt")
    expect(cmp.kind === "binary" && cmp.left.kind).toBe("convert") // INT → REAL
    expect(cmp.type.kind === "elementary" && cmp.type.name).toBe("BOOL")
  })

  test("all three loop forms lower to ONE shape", () => {
    const kinds = ["FOR i := 1 TO 3 DO iCount := iCount + 1; END_FOR", "WHILE iCount < 3 DO iCount := iCount + 1; END_WHILE", "REPEAT iCount := iCount + 1; UNTIL iCount >= 3 END_REPEAT"].map(
      (body) => ir(wrap(body, "iCount : INT;\n  i : INT;")).body[0]!.kind,
    )
    expect(kinds).toEqual(["loop", "loop", "loop"])
  })

  // This pinned the limit "evaluated ONCE, into a temp slot" — never recorded. The recording made in the review of batch 3a
  // (`callshape_for_bounds_changed_in_body`) shows CODESYS reads the limit and the step on every pass.
  test("FOR reads its limit on every pass — no temp holds it", () => {
    const pou = ir(wrap("FOR i := 1 TO iCount DO iCount := 0; END_FOR", "iCount : INT;\n  i : INT;"))
    expect(pou.slots.map((s) => s.section)).toEqual(["VAR", "VAR"])
    const loop = pou.body[0] as IrLoop
    expect(loop.init.length).toBe(1) // the control variable
    expect(loop.test?.atEnd).toBe(false)
    expect(loop.step.length).toBe(1)
  })

  test("REPEAT's UNTIL is negated into a keep-going test at the tail", () => {
    const loop = ir(wrap("REPEAT iCount := iCount + 1; UNTIL iCount >= 3 END_REPEAT")).body[0] as IrLoop
    expect(loop.test?.atEnd).toBe(true)
    expect(loop.test?.cond.kind).toBe("unary")
  })

  test("CASE labels become resolved constant ranges", () => {
    const pou = ir(wrap("CASE iCount OF\n  1: iCount := 0;\n  2..4: iCount := 1;\nEND_CASE"))
    const sw = pou.body[0]
    expect(sw.kind).toBe("switch")
    if (sw.kind !== "switch") return
    expect(sw.arms.map((a) => a.labels)).toEqual([[{ lo: 1n, hi: 1n }], [{ lo: 2n, hi: 4n }]])
  })
})

/**
 * A DURATION CONSTANT BESIDE AN INTEGER VARIABLE computes in the DURATION's type.
 *
 * The rule existed and ran too late. `adopt` retypes a constant to its variable neighbour's promoted type
 * first, so when the DURATION was the constant, the TIME literal had already been stamped with the promoted
 * INTEGER type by the time `isDuration(left.type)` was asked — and the expression computed in signed DINT.
 *
 *   t := T#49D17H2M47S295MS / n   with n : INT := 2   gave 0, where CODESYS answers 2147483647
 *   b := (T#1S * n) > u           was refused `type-unknown`, while the same expression with the duration in
 *                                 a VARIABLE lowered
 *
 * Both backends agreed with each other and both differed from the vendor, so only a measurement could find it —
 * and `calendarArithmetic` already sits above the retyping with a comment about the identical hazard
 * (`dt + T#1S` stamping a 1000-ms literal as a DT). The duration rule now sits beside it.
 */
test("a duration CONSTANT divided by an integer VARIABLE computes in the duration's type", () => {
  const r = lowerSource("PROGRAM PLC_PRG\nVAR\n\tn : INT := 2;\n\tt : TIME;\n\tb : BOOL;\n\tu : TIME := T#4S;\nEND_VAR\nt := T#49D17H2M47S295MS / n;\nb := (T#1S * n) > u;\nEND_PROGRAM\n", "PLC_PRG")
  expect(r.diagnostics).toEqual([])
  const p = run(r.pou!)
  p.scan()
  // T#49D17H2M47S295MS is TIME's maximum in milliseconds; halved and back is the vendor's own answer
  expect(p.get("t")).toBe(2147483647n)
  // and the comparison lowers at all, which it did not
  expect(p.get("b")).toBe(false)
})

// transpile-review-2026-09-29 task 8 (conformance `unary_minus_unsigned_widened`, recorded): `-x` on a UDINT/DWORD/
// ULINT/LWORD negated in the unsigned type, so `-u` into a LINT was 4294967291 and `-u < 0` FALSE. CODESYS negates in
// the signed integer of the operand's width (DINT / LINT) — `-udMax` with udMax = 4294967295 is 1.
test("unary minus on a 32/64-bit unsigned operand negates in the signed type of its width", () => {
  const source =
    "PROGRAM P\nVAR u : UDINT := 5; dw : DWORD := 5; ul : ULINT := 5; lw : LWORD := 5; udMax : UDINT := 4294967295;\n" +
    "negU : LINT; negDw : LINT; negUl : LREAL; negLw : LINT; negUdMax : LINT; uLess : BOOL; ulLess : BOOL; END_VAR\n" +
    "negU := -u; negDw := -dw; negUl := -ul; negLw := -lw; negUdMax := -udMax; uLess := -u < 0; ulLess := -ul < 0;\nEND_PROGRAM\n"
  const runner = run(ir(source, "P"))
  runner.scan()
  expect(["negU", "negDw", "negUl", "negLw", "negUdMax", "uLess", "ulLess"].map((n) => runner.get(n))).toEqual([
    -5n, -5n, -5, -5n, 1n, true, true,
  ])
})

/**
 * `0 = p` / `0 <> p` IS `p = 0` / `p <> 0` (transpile-restructure 4.13 (c)). Only a zero on the RIGHT was recognised, so the
 * zero on the left fell through to arithmetic and was refused `pointer-value` ("a pointer's value used as a number").
 * Recorded: conformance `pointer_zero_on_left_compare` (a pointer into the instance) and `_local` (a FUNCTION's tag).
 */
describe("a zero on the left of a pointer compare", () => {
  test("compares as the zero on the right, for a pointer that holds an address and for one that keeps a tag", () => {
    const image = run(ir(wrap("isNull := 0 = p;\np := ADR(a);\nnotNull := 0 <> p;", "a : INT; p : POINTER TO INT; isNull : BOOL; notNull : BOOL;"), "P"))
    image.scan()
    expect([image.get("isNull"), image.get("notNull")]).toEqual([true, true])
    const local =
      "PROGRAM P\nVAR isNull : BOOL; notNull : BOOL; END_VAR\nisNull := F(notNull => notNull);\nEND_PROGRAM\n\n" +
      "FUNCTION F : BOOL\nVAR_OUTPUT notNull : BOOL; END_VAR\nVAR a : INT; p : POINTER TO INT; END_VAR\nF := 0 = p;\np := ADR(a);\nnotNull := 0 <> p;\nEND_FUNCTION\n"
    const tagged = run(ir(local, "P"))
    tagged.scan()
    expect([tagged.get("isNull"), tagged.get("notNull")]).toEqual([true, true])
  })
})

// transpile-restructure 6.B.5 (H4): lowering's NOT and duration scaling read the front-end's rules.
// `NOT` of a signed integer is the UNSIGNED integer of its width (`types/arith/operators` `notResultType`, recorded
// `uop_not_*`: `NOT sint` is USINT) — the same value as the bit string lowering stamped (BYTE), another IR type.
test("NOT of a signed integer types as the unsigned integer of its width", () => {
  const pou = ir(wrap("u := NOT si; w := NOT i; d := NOT di; l := NOT li;", "si : SINT; i : INT; di : DINT; li : LINT; u : USINT; w : UINT; d : UDINT; l : ULINT;"))
  const types = pou.body.map((s) => {
    const v = (s as IrAssign).value
    return v.kind === "unary" && v.type.kind === "elementary" ? v.type.name : v.kind
  })
  expect(types).toEqual(["USINT", "UINT", "UDINT", "ULINT"])
})

// A duration × or ÷ an integer converts as `types/arith/temporal` `durationScaleConversion` says: an integer WIDER than
// the duration makes the DURATION convert into it, which CODESYS and TwinCAT refuse — "Cannot convert type 'TIME' to type
// 'LINT'" (`ar_duration_scaled_stores`, `ar_time_scaled_by_wide_or_unsigned_int_type`); lowering converted the LINT to
// TIME and ran it. One no wider converts into the signed integer of the duration's width, then computes in the duration.
test("a duration scaled by a wider integer is refused as the vendors refuse it; a narrower one computes in the duration", () => {
  const codes = (body: string) => lowerSource(wrap(body, "t : TIME; li : LINT; ul : ULINT; ud : UDINT; ltm : LTIME; x : LINT; ux : ULINT; n : INT := 2;"), "P").diagnostics
  expect(codes("x := t * li;").map((d) => [d.code, d.message])).toEqual([["duration-scale", "Cannot convert type 'TIME' to type 'LINT'"]])
  expect(codes("x := li * t;").map((d) => d.code)).toEqual(["duration-scale"])
  expect(codes("ux := t / ul;").map((d) => [d.code, d.message])).toEqual([["duration-scale", "Cannot convert type 'TIME' to type 'ULINT'"]])
  expect(codes("t := t * ud; ltm := ltm * ul; t := t / n;")).toEqual([])
})

// A bit string beside a duration is the UNSIGNED integer of its width (recorded 6Bb gate review, both vendors): TIME × /
// ÷ BYTE, WORD, DWORD and LTIME × DWORD, LWORD build and compute in the duration — `t / big` with every bit set is 0, an
// unsigned divisor (`tr_b5_time_times_*`, `tr_b5_time_div_*`, `tr_b5_ltime_times_*`); TIME × LWORD (either order) and
// TIME ÷ LWORD are refused "Cannot convert type 'TIME' to type 'ULINT'" (`tr_b5_time_times_lword`, `tr_b5_lword_times_time`,
// `tr_b5_time_div_lword`). Lowering refused all of them `type-unknown`.
test("a duration scaled by a bit string computes as by the unsigned integer of its width", () => {
  const vars = "t : TIME := T#3S; ltm : LTIME := LTIME#3S; b : BYTE := 3; w : WORD := 3; dw : DWORD := 3; big : DWORD := 16#FFFFFFFF; lw : LWORD := 3; res : TIME; lres : LTIME;"
  const diags = (body: string) => lowerSource(wrap(body, vars), "P").diagnostics
  for (const body of ["res := t * b;", "res := t * w;", "res := t * dw;", "res := dw * t;", "res := t / dw;", "lres := ltm * dw;", "lres := ltm * lw;"])
    expect(diags(body)).toEqual([])
  for (const body of ["res := t * lw;", "res := lw * t;", "res := t / lw;"])
    expect(diags(body).map((d) => [d.code, d.message])).toEqual([["duration-scale", "Cannot convert type 'TIME' to type 'ULINT'"]])
  const value = (body: string, name: string) => {
    const runner = run(ir(wrap(body, vars), "P"))
    runner.scan()
    return runner.get(name)
  }
  expect(value("res := t * dw;", "res")).toBe(9000n)
  expect(value("res := t / big;", "res")).toBe(0n)
  expect(value("res := t * big;", "res")).toBe(4294964296n)
})

// The division by a negative signed integer is the duration's, unsigned (`tr_b5_time_by_negative_signed`, CODESYS run
// 2026-10-10): T#3S ÷ SINT -1, ÷ INT -2, ÷ DINT -1 are 0; × SINT -1 is 4294964296 ms. An untyped literal past 32 bits
// beside a TIME is refused (`tr_b5_time_times_wide_literal`, both vendors); 3000000000 computes (`_udint_literal`).
test("a duration by a negative signed integer computes unsigned; a literal past 32 bits is refused", () => {
  const vars = "t : TIME := T#3S; si : SINT := -1; i : INT := -2; d : DINT := -1; res : TIME;"
  const value = (body: string) => {
    const runner = run(ir(wrap(body, vars), "P"))
    runner.scan()
    return runner.get("res")
  }
  expect([value("res := t / si;"), value("res := t / i;"), value("res := t / d;"), value("res := t * si;")]).toEqual([0n, 0n, 0n, 4294964296n])
  expect(lowerSource(wrap("res := t * 5000000000;", vars), "P").diagnostics.map((d) => d.code)).toEqual(["duration-scale"])
  expect(value("res := t * 3000000000;")).toBe(BigInt.asUintN(32, 3000n * 3000000000n))
})
