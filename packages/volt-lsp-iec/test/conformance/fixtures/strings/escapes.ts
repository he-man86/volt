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
    ...(slug.endsWith("hex_80") ? { deferred: { transpile: EIGHTY } } : {}),
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
const HEX: readonly string[] = ["41", "7E", "7F", "80", "81", "A9", "C3", "FF"]

/**
 * `$80` IS THE ONE CELL NOTHING EXPLAINS. Every other escape at or above 0x80 is TWO bytes, which is exactly the
 * UTF-8 encoding of U+00XX — `$81`, `$A9`, `$C3` and `$FF` all agree. `$80` answers THREE. U+0080 encodes as C2 80,
 * which is two; three bytes is what a replacement character (EF BF BD) costs, so the shape of a guess is visible and
 * it does not survive `$81` being two. Recorded and deferred rather than fitted.
 */
const EIGHTY = "2026-09-19: LEN answers 3 for `$80` where every other escape at or above 0x80 answers 2 — the UTF-8 encoding of U+0080 is two bytes (C2 80), and no reading that gives 3 here leaves `$81` at 2. Measured, unexplained, and not bent to fit."

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
