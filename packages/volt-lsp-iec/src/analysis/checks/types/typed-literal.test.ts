/**
 * typed-literal — what CODESYS and TwinCAT answer for a `<word>#<operand>` that is no typed number (S10–S13), and for a
 * direct address used as an operand (A1, A2). Every expectation is a recorded build (`lit_*`, 2026-10-01), whole: the
 * full error list of the one assignment the fixture holds.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import type { Vendor } from "../../config.js"
import { uriFor } from "../../test-uri.js"

const ENUM = "TYPE E_Mode :\n(\n\tIdle,\n\tRunning\n);\nEND_TYPE\n"

function errors(type: string, value: string, vendor: Vendor = "codesys"): string[] {
  const src = `FUNCTION_BLOCK F\nVAR\n\tv : ${type};\nEND_VAR\nv := ${value};\nEND_FUNCTION_BLOCK\n`
  const parseResult = parseSource(src, { networkText: true }, vendor)
  const enumParse = parseSource(ENUM, { networkText: true }, vendor)
  const project = build.buildSymbolTable(
    [
      { uri: "F.pou", parseResult, source: src },
      { uri: "E_Mode.dut", parseResult: enumParse, source: ENUM },
    ],
    [],
    vendor,
  )
  return computeSemanticDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.severity === "error")
    .map((d) => d.message)
    .sort()
}

test("a pair that is no literal asks for a component of its word, as written (S10, S12)", () => {
  // `lit_char_typed`, `_double_quote`, `_number`, `_lowercase_prefix`, `lit_wchar_typed*`, `lit_unknown_prefix_quoted*`,
  // `lit_uchar_double_quote`, `lit_utf8_double_quote` — one error, whatever the target
  expect(errors("BYTE", "CHAR#'A'")).toEqual(["''A'' is no component of 'CHAR'"])
  expect(errors("BOOL", "CHAR#'A'")).toEqual(["''A'' is no component of 'CHAR'"])
  expect(errors("BYTE", 'CHAR#"A"')).toEqual(["'\"A\"' is no component of 'CHAR'"])
  expect(errors("BYTE", "CHAR#65")).toEqual(["'65' is no component of 'CHAR'"])
  expect(errors("BYTE", "char#'A'")).toEqual(["''A'' is no component of 'char'"])
  expect(errors("WORD", 'WCHAR#"A"')).toEqual(["'\"A\"' is no component of 'WCHAR'"])
  expect(errors("STRING", "XYZ#'abc'")).toEqual(["''abc'' is no component of 'XYZ'"])
  expect(errors("UDINT", 'UCHAR#"A"')).toEqual(["'\"A\"' is no component of 'UCHAR'"])
  expect(errors("STRING", 'UTF8#"a"')).toEqual(["'\"a\"' is no component of 'UTF8'"])
})

test("an ENUM type's `Type#Value` is a value of unknown type — IEC's typed enum literal is not supported (S12)", () => {
  // `lit_enum_typed_value`, `_unknown_value`, `_qualified_only`: the enum named in capitals, as the compiler names one
  expect(errors("E_Mode", "E_Mode#Running")).toEqual(["Cannot convert type 'Unknown type: 'E_Mode#Running'' to type 'E_MODE'"])
  expect(errors("E_Mode", "E_Mode#Missing")).toEqual(["Cannot convert type 'Unknown type: 'E_Mode#Missing'' to type 'E_MODE'"])
})

test("UCHAR#'…' is a UDINT when it is one character, else a STRING of its own text (S10)", () => {
  // `lit_uchar_typed_udint`, `_non_ascii`, `_escape` build; `lit_uchar_typed_into_bool`
  expect(errors("UDINT", "UCHAR#'A'")).toEqual([])
  expect(errors("UDINT", "UCHAR#'€'")).toEqual([])
  expect(errors("UDINT", "UCHAR#'$41'")).toEqual([])
  expect(errors("BOOL", "UCHAR#'A'")).toEqual(["Cannot convert type 'UDINT' to type 'BOOL'"])
  // `lit_uchar_two_chars`, `_empty`, `_lowercase_prefix`, `_two_escapes`; `lit_uchar_two_chars_into_string` builds
  expect(errors("UDINT", "UCHAR#'AB'")).toEqual(["Cannot convert type 'STRING(INT#8)' to type 'UDINT'"])
  expect(errors("UDINT", "UCHAR#''")).toEqual(["Cannot convert type 'STRING(INT#6)' to type 'UDINT'"])
  expect(errors("UDINT", "uchar#'A'")).toEqual(["Cannot convert type 'STRING(INT#7)' to type 'UDINT'"])
  expect(errors("UDINT", "UCHAR#'$41$42'")).toEqual(["Cannot convert type 'STRING(INT#8)' to type 'UDINT'"])
  expect(errors("STRING", "UCHAR#'AB'")).toEqual([])
})

test("UTF8#'…' is a STRING sized by its UTF-8 bytes (S13)", () => {
  // `lit_utf8_string`, `_escape`, `_non_ascii`, `_lowercase_prefix` build; `lit_utf8_into_wstring`,
  // `_non_ascii_into_wstring`, `_lowercase_into_wstring`
  expect(errors("STRING", "UTF8#'abc'")).toEqual([])
  expect(errors("STRING", "utf8#'a'")).toEqual([])
  expect(errors("WSTRING", "UTF8#'a'")).toEqual(["Cannot convert type 'STRING(INT#1)' to type 'WSTRING'"])
  expect(errors("WSTRING", "UTF8#'ä'")).toEqual(["Cannot convert type 'STRING(INT#2)' to type 'WSTRING'"])
  expect(errors("WSTRING", "utf8#'a'")).toEqual(["Cannot convert type 'STRING(INT#6)' to type 'WSTRING'"])
})

test("STRING# and WSTRING# are refused words on both vendors (S11)", () => {
  // `lit_string_typed*`, `lit_wstring_typed*`: the word, then the string, each cascading to the `;`
  const refused = (word: string, operand: string, token: string) =>
    [`';' expected instead of '${word}'`, `Expression expected instead of '${word}'`, `Unexpected ${token} '${word}' found`, `';' expected instead of '${operand}'`, `Unexpected ${token} '${operand}' found`].sort()
  expect(errors("STRING", "STRING#'abc'")).toEqual(refused("STRING#", "'abc'", "token"))
  expect(errors("BOOL", "STRING#'abc'")).toEqual(refused("STRING#", "'abc'", "token"))
  expect(errors("WSTRING", 'WSTRING#"abc"')).toEqual(refused("WSTRING#", '"abc"', "token"))
  expect(errors("STRING", "STRING#'abc'", "twincat")).toEqual(refused("STRING#", "'abc'", "Token"))
})

test("on TwinCAT every such word is refused the same way (S10–S13)", () => {
  const refused = (word: string, operand: string) =>
    [`';' expected instead of '${word}'`, `Expression expected instead of '${word}'`, `Unexpected Token '${word}' found`, `';' expected instead of '${operand}'`, `Unexpected Token '${operand}' found`].sort()
  expect(errors("BYTE", "CHAR#'A'", "twincat")).toEqual(refused("CHAR#", "'A'"))
  expect(errors("BYTE", "CHAR#65", "twincat")).toEqual(refused("CHAR#", "65"))
  expect(errors("STRING", "XYZ#'abc'", "twincat")).toEqual(refused("XYZ#", "'abc'"))
  expect(errors("STRING", "UTF8#'abc'", "twincat")).toEqual(refused("UTF8#", "'abc'"))
})

test("an address as an operand: incomplete is refused, malformed has no type (A1, A2)", () => {
  // `lit_address_in_body`, `lit_address_bit_in_body` build
  expect(errors("WORD", "%MW6")).toEqual([])
  expect(errors("BOOL", "%MX7.3")).toEqual([])
  // `lit_address_incomplete_in_body`: as a refused literal
  expect(errors("BOOL", "%I*")).toEqual(["';' expected instead of '%I*'", "Expression expected instead of '%I*'", "Unexpected token '%I*' found"].sort())
  // `lit_address_unsized_in_body`: the echo with its `?`
  expect(errors("BOOL", "%M0.1")).toEqual(["Cannot convert type 'Unknown type: '%M?0.1'' to type 'BOOL'"])
  expect(errors("BOOL", "%M0.1", "twincat")).toEqual(["Cannot convert type 'Unknown type: '%M?0.1'' to type 'BOOL'"])
})

test("a refused prefix is echoed whole, however long — it is a word, not a literal cut at 20 (S12)", () => {
  // `lit_enum_typed_*` on TwinCAT: "Expression expected instead of 'DUT_LANG_enum_simple#'", 21 characters
  expect(errors("INT", "DUT_LANG_enum_simple#Running", "twincat")).toContain("Expression expected instead of 'DUT_LANG_enum_simple#'")
})

// ─── 2.2b: the same two holes where something other than an assignment meets them (CODESYS 2026-10-01) ─────────────
test("a malformed address or an enum `Type#Value` under an operator that passes its type through is a hole there too", () => {
  // `lit_address_unsized_as_argument`, `_under_not`, `_under_adr`: the operand is "Unknown type", and the operation —
  // whose type IS its operand's — is the hole the assignment cannot convert
  expect(errors("INT", "ABS(%M0.1)")).toEqual(["Cannot convert type 'Unknown type: 'ABS(%M?0.1)'' to type 'INT'", "Unknown type: '%M?0.1'"])
  expect(errors("BOOL", "NOT %M0.1")).toEqual(["Cannot convert type 'Unknown type: 'NOT(%M?0.1)'' to type 'BOOL'", "Unknown type: '%M?0.1'"])
  expect(errors("POINTER TO BOOL", "ADR(%M0.1)")).toEqual(["Cannot convert type 'Unknown type: 'ADR(%M?0.1)'' to type 'POINTER TO BOOL'", "Unknown type: '%M?0.1'"])
  // `lit_enum_typed_as_argument`, `_under_minus` — a negation is echoed as a subtraction from zero
  expect(errors("INT", "ABS(E_Mode#Running)")).toEqual(["Cannot convert type 'Unknown type: 'ABS(E_Mode#Running)'' to type 'INT'", "Unknown type: 'E_Mode#Running'"])
  expect(errors("INT", "-E_Mode#Running")).toEqual(["Cannot convert type 'Unknown type: '(INT#0 - E_Mode#Running)'' to type 'INT'", "Unknown type: 'E_Mode#Running'"])
})

test("…and as a bare conversion's argument it is converted to ANY, while the conversion keeps its type", () => {
  // `lit_address_unsized_as_conversion_argument`, `lit_enum_typed_as_conversion_argument`
  expect(errors("INT", "TO_INT(%M0.1)")).toEqual(["Cannot convert type 'Unknown type: '%M?0.1'' to type 'ANY'"])
  expect(errors("INT", "TO_INT(E_Mode#Running)")).toEqual(["Cannot convert type 'Unknown type: 'E_Mode#Running'' to type 'ANY'"])
})

/** The "no component" errors of one object's source, alone in its project. */
function componentErrors(src: string): string[] {
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "X.pou", parseResult, source: src }], [], "codesys")
  return computeSemanticDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "typed-literal")
    .map((d) => d.message)
}

test("no component in every initializer position: an aggregate, a STRUCT field, an enum value (S10)", () => {
  // `lit_char_typed_in_array_init`, `lit_char_typed_in_struct_field`, `lit_char_typed_in_enum_value` (CODESYS
  // 2026-10-01) — each says "''A'' is no component of 'CHAR'"; what the vendor says AFTER it in a STRUCT or an enum is
  // its own (`support/divergences.ts`)
  expect(componentErrors("FUNCTION_BLOCK F\nVAR\n\ta : ARRAY[0..1] OF BYTE := [CHAR#'A', 1];\nEND_VAR\nEND_FUNCTION_BLOCK\n")).toEqual(["''A'' is no component of 'CHAR'"])
  expect(componentErrors("TYPE S :\nSTRUCT\n\ta : BYTE := CHAR#'A';\nEND_STRUCT\nEND_TYPE\n")).toEqual(["''A'' is no component of 'CHAR'"])
  expect(componentErrors("TYPE E :\n(\n\tA := CHAR#'A',\n\tB\n);\nEND_TYPE\n")).toEqual(["''A'' is no component of 'CHAR'"])
})
