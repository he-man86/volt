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
