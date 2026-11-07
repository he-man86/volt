/**
 * WSTRING ⇄ STRING PAST ASCII — what `WSTRING_TO_STRING` and `STRING_TO_WSTRING` do to a character that is not ASCII
 * (openspec `wstring-utf8-narrowing`). `uoff_wstring_control` measured one value: "größe" narrows to 7 units, its UTF-8
 * bytes. This is the class around it: a two-, three- and four-byte character, a lone high and a lone low surrogate, a
 * narrow into a STRING too short for the last character, and the widen back of each.
 *
 * A STRING whose bytes do not decode (a sequence cut short, a lead byte with no continuation) is not here: CODESYS's
 * widen then reads past the terminator, so its answer is whatever memory follows (measured 2026-11-07: `C3` cut at the
 * end and `E9 41` both gave units from behind the buffer), and Volt refuses that conversion by name.
 *
 * Each probe computes in the body, so the conversion is the RUNTIME one, and reads single units (BYTE / WORD by index),
 * never a rendered string. A WSTRING has no `LEN`, so its length is where its units end.
 */
import type { LanguageTest } from "../../types.js"

/** The strings are VAR_TEMP, so no run reads one whole: a string past ASCII as the IDE renders it is its display (two
 *  replacement characters for ED B0 80), no value. Only their units are read. */
function probe(slug: string, temps: string, decls: string, body: string, feature: string): LanguageTest {
  const pou = `FB_LANG_${slug}`
  return {
    name: slug,
    pouName: pou,
    kind: "function_block" as const,
    feature,
    fromDoc: "06-data-types.md",
    plcPrgVar: `inst : ${pou};`,
    plcPrgBody: "inst();",
    source: `FUNCTION_BLOCK ${pou}\nVAR\n${decls}\nEND_VAR\nVAR_TEMP\n${temps}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n`,
  }
}

/** The first `count` units of `of`, and its `LEN` when it is a STRING. */
function units(of: string, type: "BYTE" | "WORD", count: number) {
  const idx = Array.from({ length: count }, (_, i) => i)
  const len = type === "BYTE"
  return {
    decl: (len ? "\tn : INT;\n" : "") + idx.map((i) => `\tu${i} : ${type};`).join("\n"),
    read: (len ? `n := LEN(${of});\n` : "") + idx.map((i) => `u${i} := ${of}[${i}];`).join("\n"),
  }
}

/** `WSTRING_TO_STRING` of `text` into a STRING(`capacity`), read unit by unit. */
function narrow(slug: string, text: string, capacity: number, feature: string): LanguageTest {
  const u = units("txt", "BYTE", Math.min(capacity + 1, 8))
  const type = capacity === 80 ? "STRING" : `STRING(${capacity})`
  return probe(slug, `\tw : WSTRING;\n\ttxt : ${type};`, u.decl, `w := "${text}";\ntxt := WSTRING_TO_STRING(w);\n${u.read}`, feature)
}

/** `text` narrowed into a STRING, then widened back, read up to and including its terminator: past it, CODESYS's
 *  WSTRING holds what the conversion left there (a 1 behind "a计b"), no value of the string. */
function widenBack(slug: string, text: string, length: number, feature: string): LanguageTest {
  const u = units("w2", "WORD", length + 1)
  return probe(
    slug,
    `\tw : WSTRING;\n\tw2 : WSTRING;\n\ttxt : STRING;`,
    u.decl,
    `w := "${text}";\ntxt := WSTRING_TO_STRING(w);\nw2 := STRING_TO_WSTRING(txt);\n${u.read}`,
    feature,
  )
}

export const WSTRING_UTF8_TESTS: readonly LanguageTest[] = [
  narrow("wsu_narrow_two_byte", "größe", 80, "WSTRING_TO_STRING of two-byte characters (ö, ß): the length and every unit"),
  narrow("wsu_narrow_three_byte", "a计b", 80, "WSTRING_TO_STRING of a three-byte character (计)"),
  narrow("wsu_narrow_surrogate_pair", "a$D83D$DE00b", 80, "WSTRING_TO_STRING of a surrogate pair (U+1F600)"),
  narrow("wsu_narrow_lone_surrogate", "a$D800b", 80, "WSTRING_TO_STRING of a lone high surrogate: one 0 byte, the next unit after it"),
  narrow("wsu_narrow_lone_low_surrogate", "a$DC00b", 80, "WSTRING_TO_STRING of a lone low surrogate: its own three bytes"),
  narrow("wsu_narrow_cut_inside", "größe", 5, "WSTRING_TO_STRING into a STRING(5): the capacity ends inside ß"),
  widenBack("wsu_widen_back", "größe", 5, "STRING_TO_WSTRING of two-byte sequences: the widen back"),
  widenBack("wsu_widen_three_byte", "a计b", 3, "STRING_TO_WSTRING of a three-byte sequence"),
  widenBack("wsu_widen_four_byte", "a$D83D$DE00b", 4, "STRING_TO_WSTRING of a four-byte sequence (U+1F600)"),
  widenBack("wsu_widen_lone_low", "a$DC00b", 3, "STRING_TO_WSTRING of ED B0 80, the bytes a lone low surrogate narrows to"),
]
