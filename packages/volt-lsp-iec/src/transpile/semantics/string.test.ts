import { describe, expect, test } from "bun:test"
import { load } from "../index.js"
import { STRING_CASES, type StringInput } from "./string.cases.js"
import { setChar, storeString } from "./string.js"

// `s[i]` end to end — the character primitive `charAt` / `setChar` (`string.ts`) as the interpreter runs it.
describe("interp — STRING (design §18; every expectation recorded in conformance `string_*`)", () => {
  const scanned = (vars: string, body: string) => {
    const pou = load(`PROGRAM P\nVAR\n${vars}\nEND_VAR\n${body}\nEND_PROGRAM\n`)
    pou.scan()
    return pou
  }

  // `s[i]` — the one primitive the Standard library's string functions are written in (`semantics/string.ts` charAt/setChar).
  // Counted from 0 and a BYTE: `string_non_ascii_bytes` records `text[0]` of 'caf…' as BYTE#99.
  test("s[i] reads a character from 0, and the terminator at the length", () => {
    const pou = scanned("sx : STRING := 'abc'; first : BYTE; last : BYTE; end : BYTE;", "first := sx[0]; last := sx[2]; end := sx[3];")
    expect([pou.get("first"), pou.get("last"), pou.get("end")]).toEqual([97n, 99n, 0n])
  })

  test("s[i] := c replaces below the length, appends at it, and a 0 cuts the string there", () => {
    const pou = scanned("a : STRING := 'abc'; b : STRING := 'abc'; c : STRING := 'abc';", "a[1] := 88; b[3] := 100; c[1] := 0;")
    expect([pou.get("a"), pou.get("b"), pou.get("c")]).toEqual(["aXc", "abcd", "a"])
  })

  test("s[i] reaches every byte of the variable — past the length it reads 0, and a store there leaves the string", () => {
    // recorded: lib_prim_char_past_length — `buf[SIZEOF(buf) - 1] := 0` on a short string runs in CODESYS
    const pou = scanned("sx : STRING(10) := 'ab'; x : BYTE; y : BYTE;", "x := sx[4]; sx[5] := 88; sx[10] := 0; y := sx[10];")
    expect([pou.get("x"), pou.get("sx"), pou.get("y")]).toEqual([0n, "ab", 0n])
  })

  test("s[i] outside the variable faults — past the capacity, or a character where only the terminator fits", () => {
    expect(() => scanned("sx : STRING(3) := 'abc'; x : BYTE;", "x := sx[4];")).toThrow(RangeError)
    expect(() => scanned("sx : STRING(3) := 'abc';", "sx[3] := 100;")).toThrow(RangeError)
    expect(() => scanned("sx : STRING := 'abc';", "sx[-1] := 100;")).toThrow(RangeError)
    // a 0 AT the capacity is the terminator CODESYS already holds there: nothing changes
    expect(scanned("sx : STRING(3) := 'abc';", "sx[3] := 0;").get("sx")).toBe("abc")
  })

  test("s[i] on a WSTRING is a WORD", () => {
    const pou = scanned('w : WSTRING := "h$00E9"; c : WORD;', "c := w[1]; w[0] := 72;")
    expect([pou.get("c"), pou.get("w")]).toEqual([0xe9n, "Hé"])
  })
})

// The buffer model against its case table (`string.cases.ts`): the store (`storeString`) and `s[i]` (`setChar`) on the whole
// buffer — the check that fails FIRST when the model drifts; the twin harness runs the same table through rustc.
describe("the string buffer model — its case table (string.cases.ts)", () => {
  const ran = (input: StringInput): string =>
    input.ops.reduce((s, op) => ("store" in op ? storeString(s, op.within ?? input.m, op.store, op.n) : setChar(s, BigInt(op.at), BigInt(op.unit), input.m)), "")
  for (const [rule, cases] of Object.entries(STRING_CASES))
    test(rule, () => {
      expect(cases.map((c) => `${c.name}: ${JSON.stringify(ran(c.input))}`)).toEqual(cases.map((c) => `${c.name}: ${JSON.stringify(c.expected)}`))
    })

  test("a store into a destination holding nothing is the source cut at the destination — today's fresh copy", () => {
    expect(storeString("", 3, "abcdef", 6)).toBe("abc")
    expect(storeString("", 10, "abc", 3)).toBe("abc")
    expect(storeString("ZZZZ", 4, "", 0)).toBe("\0ZZZ")
  })
})
