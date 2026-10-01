import { test, expect } from "bun:test"
import { decodeStringLiteral, decodeUtf8Literal } from "./string.js"

test("a hex escape is decoded through CP1252 and stored as UTF-8", () => {
  const len = (text: string): number => decodeStringLiteral(text)!.length
  expect(len("$41")).toBe(1) // ASCII
  expect(len("$83")).toBe(2) // ƒ  U+0192 — defined in CP1252, below U+0800
  expect(len("$80")).toBe(3) // €  U+20AC — the cell that ruled the Latin-1 reading out
  expect(len("$92")).toBe(3) // '  U+2019
  expect(len("$8D")).toBe(2) // UNDEFINED in CP1252, so it stays U+008D
  expect(len("$FF")).toBe(2) // ÿ  U+00FF — CP1252 agrees with Latin-1 here
  expect(len("a$80b")).toBe(5)
  // the € really is the three UTF-8 bytes of U+20AC, not three of anything else
  expect([...decodeStringLiteral("$80")!].map((c) => c.charCodeAt(0))).toEqual([0xe2, 0x82, 0xac])
})

test("the named escapes, in either case, in a STRING and in a WSTRING alike (S3, S8)", () => {
  // `lit_wstring_named_escapes`, `lit_string_lowercase_escapes`, `lit_wstring_lowercase_escapes` (2026-10-01): every one
  // compares equal to the code unit it names, on both widths
  const named: Record<string, string> = { N: "\n", L: "\n", R: "\r", P: "\f", T: "\t", n: "\n", l: "\n", r: "\r", p: "\f", t: "\t", $: "$", "'": "'", '"': '"' }
  for (const [c, v] of Object.entries(named)) {
    expect(decodeStringLiteral(`$${c}`)).toBe(v)
    expect(decodeStringLiteral(`$${c}`, true)).toBe(v)
  }
})

test("the other quote needs no escape (S9)", () => {
  // `lit_string_double_quote_inside` (LEN 3), `lit_wstring_single_quote_inside`
  expect(decodeStringLiteral('a"b')).toBe('a"b')
  expect(decodeStringLiteral("a'b", true)).toBe("a'b")
})

test("a UTF8# literal stores each character as its UTF-8 bytes, and decodes its escapes as a STRING does (S13)", () => {
  // `lit_utf8_non_ascii`: LEN(UTF8#'ä') is 2, and `lit_utf8_non_ascii_into_wstring` names it STRING(INT#2) (2026-10-01)
  expect([...decodeUtf8Literal("ä")!].map((c) => c.charCodeAt(0))).toEqual([0xc3, 0xa4])
  expect(decodeUtf8Literal("€")!.length).toBe(3)
  // `lit_utf8_escape`: UTF8#'$21' is '!'
  expect(decodeUtf8Literal("$21")).toBe("!")
  expect(decodeUtf8Literal("abc")).toBe("abc")
  expect(decodeUtf8Literal("$Q")).toBeUndefined()
})
