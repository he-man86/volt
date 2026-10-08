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
