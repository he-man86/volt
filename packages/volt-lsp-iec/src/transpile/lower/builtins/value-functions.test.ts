/**
 * Lowering tests of `value-functions.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { describe, expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { lowerSource } from "../index.js"

/** Lower and require success — most tests are about the SHAPE, not the failure path. */
function ir(src: string, name?: string) {
  const { pou, diagnostics } = lowerSource(src, name)
  expect(diagnostics).toEqual([])
  return pou!
}

/**
 * MAX / MIN / LIMIT OVER A STRING IS REFUSED — one backend was guessing and the other would not build.
 *
 * It lowered, and the interpreter compared the text (`MAX('abc','abd')` gave 'abd') while the emitted Rust printed
 * `.max()` on an `IecStr`, which has `PartialOrd` but not `Ord` — so the crate failed with E0599. That is the worst
 * shape a divergence can take, and the guess is the more dangerous half: nothing records what CODESYS orders two
 * STRINGs by, or whether it accepts the call at all. `operator_string_*` record it.
 *
 * SEL is untouched: it PICKS an operand rather than comparing them, so it needs no order.
 */
describe("a value function over a STRING", () => {
  /** The one string the program computes, run. */
  const value = (body: string): unknown => {
    const r = lowerSource(`PROGRAM PLC_PRG
VAR
	sv : STRING;
END_VAR
${body}
END_PROGRAM
`, "PLC_PRG")
    expect(r.diagnostics).toEqual([])
    const p = run(r.pou!)
    p.scan()
    return p.get("sv")
  }

  // CODESYS compares two STRINGs BYTE BY BYTE, UNSIGNED, a prefix losing to what it is a prefix of — six pairs,
  // each asked of MAX, MIN and the operators at once (conformance `strord_*`, 2026-09-19). These were refused as
  // `value-string-order` until that was measured.
  test("MAX and MIN over a STRING order it the way the vendor does", () => {
    expect(value("sv := MAX('abc','abd');")).toBe("abd")
    expect(value("sv := MIN('abc','abd');")).toBe("abc")
    expect(value("sv := MAX('abc','ABC');")).toBe("abc") // lower case wins — the bytes are unsigned
    expect(value("sv := MAX('ab','abc');")).toBe("abc") // a prefix loses
    expect(value("sv := MAX('','a');")).toBe("a")
    expect(value("sv := MAX('b','abc');")).toBe("b") // the FIRST byte decides, not the length
    expect(value("sv := MAX('$FF','a');")).toBe(String.fromCharCode(0xc3, 0xbf)) // UNSIGNED: 0xC3 beats 'a'
    expect(value("sv := MAX('abc','abc');")).toBe("abc")
  })

  test("LIMIT over a STRING is MIN(MAX(IN, MN), MX), as it is for a number", () => {
    expect(value("sv := LIMIT('a','b','c');")).toBe("b")
    expect(value("sv := LIMIT('b','a','c');")).toBe("b")
    expect(value("sv := LIMIT('a','z','c');")).toBe("c")
  })

  test("SEL over a STRING still lowers — it picks, it does not order", () => {
    const r = lowerSource("PROGRAM PLC_PRG\nVAR\n\tsv : STRING;\nEND_VAR\nsv := SEL(TRUE,'a','b');\nEND_PROGRAM\n", "PLC_PRG")
    expect(r.diagnostics).toEqual([])
    const p = run(r.pou!)
    p.scan()
    expect(p.get("sv")).toBe("b")
  })

  test("and MAX over numbers is untouched", () => {
    const r = lowerSource("PROGRAM PLC_PRG\nVAR\n\tn : INT;\nEND_VAR\nn := MAX(1,5,3);\nEND_PROGRAM\n", "PLC_PRG")
    expect(r.diagnostics).toEqual([])
    const p = run(r.pou!)
    p.scan()
    expect(p.get("n")).toBe(5n)
  })
})

// transpile-review-2026-09-29 task 9 (conformance `rotate_of_expression`, recorded): ROL/ROR took its width from the
// LOWERED operand, and an expression is already promoted to DINT there — `ROL(w AND m, 1)` with w = 16#8001 was 2 and
// `ROR(b OR b, 1)` with b = 16#81 was 64. CODESYS rotates the expression's own (checked) width; the promoted bits above
// it ride along, so `ROL(b + b2, 1)` (16#101) into a WORD is 16#102 = 258, and into a BYTE 2.
test("ROL/ROR on an expression rotate in the expression's checked width, not the promoted one", () => {
  const source =
    "PROGRAM P\nVAR w : WORD := 16#8001; m : WORD := 16#FFFF; b : BYTE := 16#81; b2 : BYTE := 16#80; one : BYTE := 1; w0 : WORD := 0;\n" +
    "rolWordAnd : WORD; rorWordAnd : WORD; rolByteAdd0 : BYTE; rolByteMax : BYTE; rorByteOr : BYTE;\n" +
    "rolByteAndLit : BYTE; rolByteOverflow : BYTE; rolByteOverflowWide : WORD; rolMixed : WORD; END_VAR\n" +
    "rolWordAnd := ROL(w AND m, 1); rorWordAnd := ROR(w AND m, 1); rolByteAdd0 := ROL(b + 0, 1); rolByteMax := ROL(MAX(b, one), 1);\n" +
    "rorByteOr := ROR(b OR b, 1); rolByteAndLit := ROL(b AND 16#FF, 1); rolByteOverflow := ROL(b + b2, 1);\n" +
    "rolByteOverflowWide := ROL(b + b2, 1); rolMixed := ROL(b OR w0, 1);\nEND_PROGRAM\n"
  const runner = run(ir(source, "P"))
  runner.scan()
  const names = ["rolWordAnd", "rorWordAnd", "rolByteAdd0", "rolByteMax", "rorByteOr", "rolByteAndLit", "rolByteOverflow", "rolByteOverflowWide", "rolMixed"]
  expect(names.map((n) => runner.get(n))).toEqual([3n, 49152n, 3n, 3n, 192n, 3n, 2n, 258n, 258n])
})

// transpile-restructure 6Aa+6Ae gate review: a shift count that is no integer reached the interpreter, whose `countOf` throws
// a LoweringBug — out of a body's scan, and out of lowering itself through an initializer's fold. What CODESYS does with a
// REAL count is unrecorded, so it is refused by name (`shift-count`), never thrown.
test("a SHL count that is no integer is refused by name, in a body and in an initializer", () => {
  const body = lowerSource("PROGRAM P\nVAR\n  dw0 : DWORD := 1;\n  dw : DWORD;\nEND_VAR\ndw := SHL(dw0, 2.0);\nEND_PROGRAM\n", "P")
  expect(body.diagnostics.map((d) => d.code)).toEqual(["shift-count"])
  const init = lowerSource("PROGRAM P\nVAR\n  dw : DWORD := SHL(DWORD#1, 2.0);\nEND_VAR\ndw := dw;\nEND_PROGRAM\n", "P")
  // the initializer then reports it does not fold, as every refused initializer does
  expect(init.diagnostics.map((d) => d.code)).toEqual(["shift-count", "init-not-constant"])
})

// 6.A.14 recorded an UNTYPED literal shifted (`tr_a14_shift_untyped_literal_*`) only as the whole value of a `:=` store,
// with a literal count or a plain variable count, and a non-negative literal. Every other shape — beside an LWORD in a sum
// (where the two operand orders lowered 2^40 and 256), a negative literal (LINT or LWORD), a named CONSTANT count (folded
// in 64 bits, or masked to 31?) — is unrecorded and refused `shift-untyped-width` (6Aa+6Ae gate review; 0 body shifts of
// an untyped literal in the six corpora).
describe("SHL / SHR of an untyped literal", () => {
  const lower = (vars: string, body: string) => lowerSource(`PROGRAM P\nVAR\n${vars}\nEND_VAR\nVAR CONSTANT\n  C40 : INT := 40;\nEND_VAR\n${body}\nEND_PROGRAM\n`, "P")
  const codes = (vars: string, body: string) => lower(vars, body).diagnostics.map((d) => d.code)

  test("the recorded stores still lower to their recorded values", () => {
    const r = lower("n40 : INT := 40; n33 : INT := 33; lw5 : LWORD; dw2 : DWORD; lw6 : LWORD; lw7 : LWORD; li2 : LINT; dw : DWORD;",
      "lw5 := SHL(1, n40); dw2 := SHL(1, n33); lw6 := SHL(1, 65); lw7 := SHR(SHL(1, 40), 8); li2 := SHL(1, n40); dw := SHL(1, 40);")
    expect(r.diagnostics).toEqual([])
    const p = run(r.pou!)
    p.scan()
    expect(["lw5", "dw2", "lw6", "lw7", "li2", "dw"].map((n) => p.get(n))).toEqual([1n << 40n, 2n, 2n, 1n << 32n, 1n << 40n, 0n])
  })

  test("a variable count anywhere but the stored value is refused, in either operand order", () => {
    const vars = "lw0 : LWORD; n40 : INT := 40; a : LWORD;"
    expect(codes(vars, "a := lw0 + SHL(1, n40);")).toEqual(["shift-untyped-width"])
    expect(codes(vars, "a := SHL(1, n40) + lw0;")).toEqual(["shift-untyped-width"])
    expect(codes(vars, "a := MAX(lw0, SHL(1, n40));")).toEqual(["shift-untyped-width"])
  })

  test("a negative literal and a named CONSTANT count are refused", () => {
    expect(codes("li : LINT;", "li := SHR(-8, 1);")).toEqual(["shift-untyped-width"])
    expect(codes("dw : DWORD;", "dw := SHL(1, C40);")).toEqual(["shift-untyped-width"])
  })
})

// transpile-restructure 6.A.30 (Appendix B rotate-in-promoted-width; recorded `tr_a30_rotate_untyped_literal`, `_variable_count`,
// `_initializer`, `_into_int`): ROL / ROR rotate an UNTYPED literal in the width of what it is stored into — ROL(129, 1) is 3
// into a BYTE and 258 into a WORD, DWORD or LWORD, ROR(1, 1) 2^(width - 1), ROL(16#80000001, 1) 3 into a DWORD and 2^32 + 2
// into an LWORD; by a literal or a variable count, as a body's store, a VARIABLE's initializer and a CONSTANT's. They
// rotated in the literal's own narrowest width (3, 128, …). Every other shape is unrecorded and refused like SHL's.
describe("ROL / ROR of an untyped literal", () => {
  const lower = (vars: string, body: string) => lowerSource(`PROGRAM P\nVAR\n${vars}\nEND_VAR\n${body}\nEND_PROGRAM\n`, "P")
  const values = (vars: string, body: string, names: string[]) => {
    const r = lower(vars, body)
    expect(r.diagnostics).toEqual([])
    const p = run(r.pou!)
    p.scan()
    return names.map((n) => p.get(n))
  }

  test("a store rotates it in the destination's width, by a literal or a variable count", () => {
    const vars = "n1 : INT := 1; b1 : BYTE; w1 : WORD; d1 : DWORD; l1 : LWORD; b2 : BYTE; w2 : WORD; d2 : DWORD; l2 : LWORD; d3 : DWORD; l3 : LWORD; w4 : WORD; di : DINT;"
    const body = "b1 := ROL(129, 1); w1 := ROL(129, 1); d1 := ROL(129, n1); l1 := ROL(129, 1); b2 := ROR(1, 1); w2 := ROR(1, n1); d2 := ROR(1, 1); l2 := ROR(1, 1); d3 := ROL(16#80000001, 1); l3 := ROL(16#80000001, 1); w4 := ROR(1, n1); di := ROR(1, 1);"
    expect(values(vars, body, ["b1", "w1", "d1", "l1", "b2", "w2", "d2", "l2", "d3", "l3", "w4", "di"])).toEqual([
      3n, 258n, 258n, 258n, 128n, 32768n, 2147483648n, 9223372036854775808n, 3n, 4294967298n, 32768n, -2147483648n,
    ])
  })

  test("an initializer rotates it in the declared type's width, a VARIABLE's and a CONSTANT's", () => {
    const vars = "w1 : WORD := ROL(129, 1); d1 : DWORD := ROR(1, 1); l1 : LWORD := ROL(16#80000001, 1); w2 : WORD; d2 : DWORD; l2 : LWORD;\nEND_VAR\nVAR CONSTANT CW : WORD := ROL(129, 1); CD : DWORD := ROR(1, 1); CL : LWORD := ROL(16#80000001, 1);"
    expect(values(vars, "w2 := CW; d2 := CD; l2 := CL;", ["w1", "d1", "l1", "w2", "d2", "l2"])).toEqual([258n, 2147483648n, 4294967298n, 258n, 2147483648n, 4294967298n])
  })

  test("an unrecorded shape is refused by name", () => {
    const codes = (vars: string, body: string) => lower(vars, body).diagnostics.map((d) => d.code)
    // an operand of an operator: which operand's width, or the destination's, is not told apart by a recording
    expect(codes("w0 : WORD; w3 : WORD;", "w3 := ROL(129, 1) OR w0;")).toEqual(["shift-untyped-width"])
    // a negative literal, and a destination narrower than the literal
    expect(codes("d : DWORD;", "d := ROL(-1, 1);")).toEqual(["shift-untyped-width"])
    expect(codes("b : BYTE;", "b := ROL(16#1FF, 1);")).toEqual(["shift-untyped-width"])
  })

  // 6Af gate review: an initializer folds with its declared type as the context, and that fold gave every refused shape a
  // silent value — `b1 : BYTE := ROL(16#1FF, 1)` 255, the same as a CONSTANT's, `w : WORD := ROL(16#1FFFF, 1)` 65535 —
  // where the store `b1 := ROL(16#1FF, 1)` is refused. An initializer is refused the same shapes as a store.
  test("an initializer is refused the shapes a store is", () => {
    const codes = (vars: string) => lower(vars, "").diagnostics.map((d) => d.code)
    expect(codes("b1 : BYTE := ROL(16#1FF, 1);")).toEqual(["shift-untyped-width"])
    expect(codes("w : WORD := ROL(16#1FFFF, 1);")).toEqual(["shift-untyped-width"])
    expect(codes("x : WORD;\nEND_VAR\nVAR CONSTANT CB : BYTE := ROL(16#1FF, 1);")).toEqual(["shift-untyped-width"])
    expect(codes("w3 : WORD := ROL(129, 1) OR 0;")).toEqual(["shift-untyped-width"])
    expect(codes("d : DWORD := ROR(-1, 1);")).toEqual(["shift-untyped-width"])
  })
})

// 6Af gate review (recorded `tr_a29_widened_constant_reads`, run, and `tr_a29_rol_bound_widened_byte_constant`, both
// vendors, 2026-10-10): a shift or rotation of a CONSTANT held past its type (B : BYTE := KB + 1, 256) is a constant
// expression, folded on the held value in the declared width — ROL(B, 1) 2, ROR(B, 1) 128, SHR(B, 1) 128, NOT B 255; in a
// body, a VARIABLE's initializer and a CONSTANT's alike. The body rotated its run-time read (DINT 256) with the bits above
// the byte riding along, as an expression's (`rotate_of_expression`): 256.
test("a shift or rotation of a constant held past its type folds on the held value", () => {
  const r = lowerSource(
    "PROGRAM P\nVAR r1 : DWORD; r2 : DWORD; h1 : DWORD; n1 : DWORD; r3 : DWORD := ROL(B, 1); r4 : DWORD; END_VAR\nVAR CONSTANT KB : BYTE := 255; B : BYTE := KB + 1; RB : DWORD := ROL(B, 1); END_VAR\nr1 := ROL(B, 1); r2 := ROR(B, 1); h1 := SHR(B, 1); n1 := NOT B; r4 := RB;\nEND_PROGRAM\n",
    "P",
  )
  expect(r.diagnostics).toEqual([])
  const p = run(r.pou!)
  p.scan()
  expect(["r1", "r2", "h1", "n1", "r3", "r4"].map((n) => p.get(n))).toEqual([2n, 128n, 128n, 255n, 2n, 2n])
})
