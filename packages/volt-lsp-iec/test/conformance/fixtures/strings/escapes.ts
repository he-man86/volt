/**
 * WHAT A STRING ESCAPE IS WORTH — every `$` form, and what `LEN` counts once one of them is not ASCII.
 *
 * `string_high_byte_escape` has been a divergence since it was written, under the reading "a CODESYS STRING is
 * UTF-8 and LEN counts BYTES, while we store one character per escape". That is one fixture, `LEN('$FF')` = 2,
 * and it is the whole evidence for a claim about the entire string model. Two readings fit it:
 *
 *   (A) THE SOURCE IS UTF-8 TEXT. `$FF` means U+00FF, which the compiler encodes as the two bytes C3 BF, and LEN
 *       counts the bytes of the encoded string.
 *   (B) `$FF` IS ONE BYTE, and something else about that fixture makes LEN answer 2.
 *
 * They differ everywhere above U+007F, so this asks the whole escape table and both sides of the boundary:
 *
 *   the named escapes    `$$` `$'` `$L` `$N` `$P` `$R` `$T` — one character each, and nobody has checked
 *   hex below 0x80       `$41` is 'A', and LEN must be 1 under either reading
 *   hex at the boundary  `$7F` `$80` `$81` `$FF` — where the two readings first disagree
 *   two in a row         `$C3$A9`, which is 'é' in UTF-8 and two separate characters in Latin-1
 *   a STRING(n)          holding a multi-byte character that does not fit, where truncation has to cut somewhere
 *   WSTRING              the same boundary in a type that is defined to be wide
 *
 * `LEN` is the instrument throughout, because it is the one function whose answer is a COUNT and so distinguishes
 * the readings without depending on how a value is displayed.
 */
import type { LanguageTest } from "../../types.js"

function probe(slug: string, decl: string, expr: string, outType: string, feature: string): LanguageTest {
  const pou = `FB_LANG_${slug}`
  return {
    name: slug,
    pouName: pou,
    kind: "function_block" as const,
    feature,
    fromDoc: "06-data-types.md",
    plcPrgVar: `inst : ${pou};`,
    plcPrgBody: "inst();",
    source: `FUNCTION_BLOCK ${pou}\nVAR\n\t${decl}\n\tout : ${outType};\nEND_VAR\nout := ${expr};\nEND_FUNCTION_BLOCK\n`,
  }
}

/** Each named escape, alone, so its length is its own answer. */
const NAMED: readonly [string, string][] = [
  ["$$", "dollar"],
  ["$'", "quote"],
  ["$L", "line_feed"],
  ["$N", "newline"],
  ["$P", "page"],
  ["$R", "carriage_return"],
  ["$T", "tab"],
]

const named: LanguageTest[] = NAMED.flatMap(([esc, slug]) => [
  probe(`esc_len_${slug}`, `v : STRING := '${esc}';`, "LEN(v)", "INT", `LEN of a string holding only ${esc}`),
  probe(`esc_around_${slug}`, `v : STRING := 'a${esc}b';`, "LEN(v)", "INT", `LEN of 'a${esc}b' — one escape between two letters`),
])

/** The hex forms, walking across the point where the two readings part. */
// 0x80..0x9F is where WINDOWS-1252 stops agreeing with Latin-1, so that is where these sit: `83` and `8A` and
// `9F` are defined there and encode as TWO UTF-8 bytes, `92`/`99`/`9B` as THREE, and `8D`/`9D` are undefined in
// the codepage at all. If the answers follow that table, `$hh` is a CP1252 byte; if they do not, `$80` stays the
// unexplained cell it was.
const HEX: readonly string[] = ["41", "7E", "7F", "80", "81", "83", "8A", "8D", "92", "99", "9B", "9D", "9F", "A9", "C3", "FF"]

/**
 * `$80` WAS THE CELL NOTHING EXPLAINED, and widening the probe explained it. Read as the code point U+00XX every
 * escape at or above 0x80 should be two UTF-8 bytes, and `$81`, `$A9`, `$C3`, `$FF` were — while `$80` answered
 * THREE. Eight more cells across 0x80..0x9F, the range WINDOWS-1252 does not share with Latin-1, settle it:
 *
 *   $83 $8A $9F   2   ƒ Š Ÿ — defined in the codepage, and below U+0800
 *   $92 $99 $9B   3   ' ™ › — defined, and above it
 *   $8D $9D       2   UNDEFINED in the codepage, so they stay U+008D / U+009D
 *
 * `$hh` is a CP1252 byte the compiler decodes and stores as UTF-8. Sixteen cells, sixteen agreements.
 */

const hex: LanguageTest[] = HEX.flatMap((code) => [
  probe(`esc_len_hex_${code.toLowerCase()}`, `v : STRING := '$${code}';`, "LEN(v)", "INT", `LEN of a string holding only $${code}`),
  probe(
    `esc_around_hex_${code.toLowerCase()}`,
    `v : STRING := 'a$${code}b';`,
    "LEN(v)",
    "INT",
    `LEN of 'a$${code}b' — is the middle one character or two?`,
  ),
])

const sequences: LanguageTest[] = [
  probe("esc_utf8_pair", "v : STRING := '$C3$A9';", "LEN(v)", "INT", "$C3$A9 — 'é' as UTF-8, or two separate bytes?"),
  probe("esc_utf8_pair_around", "v : STRING := 'a$C3$A9b';", "LEN(v)", "INT", "the same pair between two letters"),
  probe("esc_two_high", "v : STRING := '$FF$FF';", "LEN(v)", "INT", "two high bytes in a row"),
  probe("esc_mixed", "v : STRING := 'a$41$FFb';", "LEN(v)", "INT", "an ASCII escape and a high one in the same string"),
]

/** Where a STRING(n) has to cut, and what LEN says afterwards. */
const truncation: LanguageTest[] = [
  probe("esc_fits_exactly", "v : STRING(3) := 'abc';", "LEN(v)", "INT", "a STRING(3) holding three ASCII characters"),
  probe("esc_truncated_ascii", "v : STRING(3) := 'abcde';", "LEN(v)", "INT", "a STRING(3) given five ASCII characters"),
  probe(
    "esc_truncated_high",
    "v : STRING(3) := 'a$C3$A9b';",
    "LEN(v)",
    "INT",
    "a STRING(3) given a multi-byte character — where does the cut land?",
  ),
  probe("esc_high_only_one", "v : STRING(1) := '$FF';", "LEN(v)", "INT", "a STRING(1) given one high byte"),
]

/** The same boundary in WSTRING, which is defined to be wide. */
const wide: LanguageTest[] = [
  probe("esc_wstring_ascii", 'v : WSTRING := "abc";', "LEN(v)", "INT", "LEN of a three-character WSTRING"),
  probe("esc_wstring_hex_41", 'v : WSTRING := "$41";', "LEN(v)", "INT", "LEN of a WSTRING holding $41"),
  probe("esc_wstring_hex_ff", 'v : WSTRING := "$FF";', "LEN(v)", "INT", "LEN of a WSTRING holding $FF"),
  probe("esc_wstring_pair", 'v : WSTRING := "$C3$A9";', "LEN(v)", "INT", "LEN of a WSTRING holding $C3$A9"),
]

export const ESCAPE_TESTS: readonly LanguageTest[] = [...named, ...hex, ...sequences, ...truncation, ...wide]
