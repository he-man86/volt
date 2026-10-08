import { describe, expect, test } from "bun:test"
import { load } from "../index.js"

// End to end, ST -> lower -> interpreter: STRING and WSTRING stores and conversions.
describe("interp — STRING (design §18; every expectation recorded in conformance `string_*`)", () => {
  const scanned = (vars: string, body: string) => {
    const pou = load(`PROGRAM P\nVAR\n${vars}\nEND_VAR\n${body}\nEND_PROGRAM\n`)
    pou.scan()
    return pou
  }

  test("a store keeps the target's capacity — STRING(5) := 'abcdefgh' is 'abcde'", () => {
    expect(scanned("five : STRING(5);", "five := 'abcdefgh';").get("five")).toBe("abcde")
  })

  test("a WSTRING counts UTF-16 units — \"héllo\" into a WSTRING(3) is \"hél\"", () => {
    expect(scanned('short3 : WSTRING(3); wide : WSTRING := "héllo";', "short3 := wide;").get("short3")).toBe("hél")
  })

  test("a literal with an embedded $00 ends at the NUL; its bytes are stored, compared and copied as CODESYS holds them", () => {
    // tr_45_string_embedded_nul (CODESYS-recorded): txt reads 'ab', equals both 'ab' and 'ab$00c', txt[2] = txt[3] = 0,
    // and the copy u is 'ab' with u[3] = 0. (LEN/CONCAT run from the library repo, so the fixture covers those rows.)
    const pou = scanned(
      "txt : STRING(3) := 'ab$00c'; u : STRING(10); c2 : BYTE; c3 : BYTE; uc3 : BYTE; eqAb : BOOL; eqFull : BOOL;",
      "eqAb := txt = 'ab'; eqFull := txt = 'ab$00c'; c2 := txt[2]; c3 := txt[3]; u := txt; uc3 := u[3];",
    )
    expect(["txt", "eqAb", "eqFull", "c2", "c3", "u", "uc3"].map((n) => pou.get(n))).toEqual([
      "ab", true, true, 0n, 0n, "ab", 0n,
    ])
  })

  // Model 2's store (design §3.2, `storeString`): min(n, m) units of the SOURCE's buffer and a 0, the destination's units
  // behind them kept. The units are read back through `s[i]`, which reaches the whole buffer.
  test("a store into a wider string keeps the destination's units behind the source's (string_assign_tail_wide)", () => {
    // recorded: 97 98 99 0 101…106 0, then 90 at [11..19] and 0 at [20]
    const pou = scanned(
      "src : STRING(10); dst : STRING(20); u4 : BYTE; u10 : BYTE; u11 : BYTE; u19 : BYTE; u20 : BYTE;",
      "src := 'abcdefghij'; src[3] := 0; dst := 'ZZZZZZZZZZZZZZZZZZZZ'; dst := src; u4 := dst[4]; u10 := dst[10]; u11 := dst[11]; u19 := dst[19]; u20 := dst[20];",
    )
    expect(["dst", "u4", "u10", "u11", "u19", "u20"].map((n) => pou.get(n))).toEqual(["abc", 101n, 0n, 90n, 90n, 0n])
  })

  test("a literal is a source of its own units, the ones behind its $00 too (string_literal_nul_tail)", () => {
    // recorded: 'ab$00cd' over 'ZZZZZZZZZZ' is 97 98 0 99 100 0 90 90 90 90 0
    const pou = scanned("a : STRING(10); u3 : BYTE; u5 : BYTE; u6 : BYTE; u9 : BYTE;", "a := 'ZZZZZZZZZZ'; a := 'ab$00cd'; u3 := a[3]; u5 := a[5]; u6 := a[6]; u9 := a[9];")
    expect(["a", "u3", "u5", "u6", "u9"].map((n) => pou.get(n))).toEqual(["ab", 99n, 0n, 90n, 90n])
  })

  test("an FB's VAR_INPUT is stored into by the call's pass, keeping its own units behind (string_store_destination_kinds_tail)", () => {
    const pou = load(
      "FUNCTION_BLOCK FB_In\nVAR_INPUT\n\tp : STRING(20);\nEND_VAR\nEND_FUNCTION_BLOCK\n\n" +
        "PROGRAM P\nVAR\n\tsrc : STRING(10);\n\tfb : FB_In;\n\tu4 : BYTE;\n\tu11 : BYTE;\nEND_VAR\n" +
        "src := 'abcdefghij';\nsrc[3] := 0;\nfb.p := 'ZZZZZZZZZZZZZZZZZZZZ';\nfb(p := src);\nu4 := fb.p[4];\nu11 := fb.p[11];\nEND_PROGRAM\n",
      "P",
    )
    pou.scan()
    expect([pou.get("u4"), pou.get("u11")]).toEqual([101n, 90n])
  })

  test("an FB's VAR_OUTPUT copied out by => is a store: the wider target keeps its units behind (string_store_destination_kinds_tail)", () => {
    // recorded (gate 3c): out = 97 98 99 0 101…106 0 at [0..10], then 90 at [11..19] and 0 at [20]
    const pou = load(
      "FUNCTION_BLOCK FB_Out\nVAR_OUTPUT\n\to : STRING(10);\nEND_VAR\no := 'abcdefghij';\no[3] := 0;\nEND_FUNCTION_BLOCK\n\n" +
        "PROGRAM P\nVAR\n\tfb : FB_Out;\n\tt : STRING(20) := 'ZZZZZZZZZZZZZZZZZZZZ';\n\tu4 : BYTE;\n\tu10 : BYTE;\n\tu11 : BYTE;\n\tu19 : BYTE;\nEND_VAR\n" +
        "fb(o => t);\nu4 := t[4];\nu10 := t[10];\nu11 := t[11];\nu19 := t[19];\nEND_PROGRAM\n",
      "P",
    )
    pou.scan()
    expect(["t", "u4", "u10", "u11", "u19"].map((n) => pou.get(n))).toEqual(["abc", 101n, 0n, 90n, 90n])
  })

  test("s[i] reaches behind the terminator: a right-to-left fill and a 0 overwritten (tr_34_lib_prim_char_behind)", () => {
    const pou = scanned(
      "digits : STRING(10); t : STRING(10) := 'abcdef';",
      "digits := ''; digits[4] := 0; digits[3] := 49; digits[2] := 50; digits[1] := 51; digits[0] := 52; t := 'abcdef'; t[2] := 0; t[2] := 88;",
    )
    expect([pou.get("digits"), pou.get("t")]).toEqual(["4321", "abXdef"])
  })

  test("STRING_TO_REAL reads a decimal prefix after spaces and tabs — and nothing numeric is 0", () => {
    const pou = scanned(
      "dotFirst : STRING := '.5'; bareExp : STRING := '$T1.5E'; wrd : STRING := 'abc'; x : REAL; y : REAL; z : REAL;",
      "x := STRING_TO_REAL(dotFirst); y := STRING_TO_REAL(bareExp); z := STRING_TO_REAL(wrd);",
    )
    expect([pou.get("x"), pou.get("y"), pou.get("z")]).toEqual([0.5, 1.5, 0])
  })

  test("STRING_TO_INT skips leading spaces, takes a sign, stops at a non-digit — and wraps", () => {
    const pou = scanned("spaced : STRING := ' +12abc'; huge : STRING := '99999'; x : INT; y : INT;", "x := STRING_TO_INT(spaced); y := STRING_TO_INT(huge);")
    expect([pou.get("x"), pou.get("y")]).toEqual([12n, -31073n])
  })
})
