import { test, expect } from "bun:test"
import { parseLiteralValue, typedLiteralForm } from "./value.js"
import type { DurationValue } from "../ast/nodes.js"

test("integer literals: decimal, radix, underscores", () => {
  expect(parseLiteralValue("int", "42").value).toBe(42n)
  expect(parseLiteralValue("int", "1_000_000").value).toBe(1_000_000n)
  expect(parseLiteralValue("int", "16#FF").value).toBe(255n)
  expect(parseLiteralValue("int", "16#FFFF_FFFF").value).toBe(0xffff_ffffn)
  expect(parseLiteralValue("int", "8#77").value).toBe(63n)
  expect(parseLiteralValue("int", "2#1010").value).toBe(10n)
})

test("real literals", () => {
  expect(parseLiteralValue("real", "1.5").value).toBe(1.5)
  expect(parseLiteralValue("real", "1_000.5").value).toBe(1000.5)
  expect(parseLiteralValue("real", "1.5e3").value).toBe(1500)
})

test("bool literals", () => {
  expect(parseLiteralValue("bool", "TRUE").value).toBe(true)
  expect(parseLiteralValue("bool", "false").value).toBe(false)
})

test("string literals strip quotes", () => {
  expect(parseLiteralValue("string", "'hi'").value).toBe("hi")
  expect(parseLiteralValue("wstring", '"wide"').value).toBe("wide")
})

test("duration literals normalize to nanoseconds", () => {
  expect((parseLiteralValue("time", "T#10ms").value as DurationValue).ns).toBe(10_000_000n)
  expect((parseLiteralValue("time", "T#1s").value as DurationValue).ns).toBe(1_000_000_000n)
  // 1h30m = 5400s
  expect((parseLiteralValue("time", "TIME#1h30m").value as DurationValue).ns).toBe(5_400_000_000_000n)
  expect((parseLiteralValue("time", "T#-10ms").value as DurationValue).ns).toBe(-10_000_000n)
  expect((parseLiteralValue("time", "LTIME#100ns").value as DurationValue).ns).toBe(100n)
  // fractional
  expect((parseLiteralValue("time", "T#1.5s").value as DurationValue).ns).toBe(1_500_000_000n)
})

test("typed literals split prefix + value", () => {
  expect(parseLiteralValue("typed", "INT#42")).toEqual({ prefix: "INT", value: 42n })
  expect(parseLiteralValue("typed", "REAL#1.5")).toEqual({ prefix: "REAL", value: 1.5 })
  expect(parseLiteralValue("typed", "BOOL#TRUE")).toEqual({ prefix: "BOOL", value: true })
  expect(parseLiteralValue("typed", "WORD#16#FF")).toEqual({ prefix: "WORD", value: 255n })
})

test("malformed literals yield undefined, never throw", () => {
  expect(parseLiteralValue("int", "16#GG").value).toBeUndefined()
  expect(parseLiteralValue("real", "not-a-number").value).toBeUndefined()
})

/**
 * `$hh` IS A WINDOWS-1252 BYTE. Sixteen cells measured on CODESYS SP21 with `LEN` as the instrument
 * (conformance `esc_len_hex_*`, `esc_around_hex_*`), and the byte count follows the codepage exactly.
 */

test("a `<word>#<operand>` pair is a typed literal, a character, a UTF-8 string, the token's own text, or a component (S10–S13)", () => {
  // `lit_uchar_typed_udint`, `_non_ascii`, `_escape` run as UDINT#65, #8364, #65 (CODESYS 2026-10-01)
  expect(typedLiteralForm("UCHAR#'A'")).toEqual({ kind: "char", code: 65n })
  expect(typedLiteralForm("UCHAR#'€'")).toEqual({ kind: "char", code: 8364n })
  expect(typedLiteralForm("UCHAR#'$41'")).toEqual({ kind: "char", code: 65n })
  // an escape past ASCII is ONE character, its Windows-1252 one: `lit_uchar_high_escape` runs as UDINT#196 and
  // `lit_uchar_escape_80` as UDINT#8364 (`€`, not the byte 128) — CODESYS 2026-10-01
  expect(typedLiteralForm("UCHAR#'$C4'")).toEqual({ kind: "char", code: 196n })
  expect(typedLiteralForm("UCHAR#'$80'")).toEqual({ kind: "char", code: 8364n })
  // `lit_uchar_two_chars_into_string` runs as 'CHAR#$'AB'; `lit_uchar_two_chars` / `_empty` / `_lowercase_prefix` /
  // `_two_escapes` are STRING(8)/(6)/(7)/(8) and `lit_utf8_lowercase_prefix` runs as 'tf8#$'a': NOT one character, or
  // the prefix not in capitals, and the token is a STRING of its own text less its first and last character
  expect(typedLiteralForm("UCHAR#'AB'")).toEqual({ kind: "text", raw: "CHAR#'AB" })
  expect(typedLiteralForm("UCHAR#''")).toEqual({ kind: "text", raw: "CHAR#'" })
  expect(typedLiteralForm("uchar#'A'")).toEqual({ kind: "text", raw: "char#'A" })
  expect(typedLiteralForm("UCHAR#'$41$42'")).toEqual({ kind: "text", raw: "CHAR#'$41$42" })
  expect(typedLiteralForm("utf8#'a'")).toEqual({ kind: "text", raw: "tf8#'a" })
  // `lit_utf8_string`, `_escape`, `_non_ascii`
  expect(typedLiteralForm("UTF8#'abc'")).toEqual({ kind: "utf8", raw: "abc" })
  // `lit_char_typed*`, `lit_wchar_typed*`, `lit_uchar_double_quote`, `lit_utf8_double_quote`, `lit_unknown_prefix_quoted`,
  // `lit_enum_typed_*`: "'<operand>' is no component of '<word>'", the word and operand as written
  expect(typedLiteralForm("char#'A'")).toEqual({ kind: "component", prefix: "char", operand: "'A'" })
  expect(typedLiteralForm("CHAR#65")).toEqual({ kind: "component", prefix: "CHAR", operand: "65" })
  expect(typedLiteralForm('UCHAR#"A"')).toEqual({ kind: "component", prefix: "UCHAR", operand: '"A"' })
  expect(typedLiteralForm("E_Mode#Running")).toEqual({ kind: "component", prefix: "E_Mode", operand: "Running" })
  expect(typedLiteralForm("INT#5")).toEqual({ kind: "typed", prefix: "INT", body: "5" })
  // the values the parser stores
  expect(parseLiteralValue("typed", "UCHAR#'A'")).toEqual({ prefix: "UCHAR", value: 65n })
  expect(parseLiteralValue("typed", "UCHAR#'AB'")).toEqual({ prefix: "UCHAR", value: "CHAR#'AB" })
  expect(parseLiteralValue("typed", "UTF8#'abc'")).toEqual({ prefix: "UTF8", value: "abc" })
  expect(parseLiteralValue("typed", "CHAR#'A'")).toEqual({ prefix: "CHAR", value: undefined })
})
