/**
 * A STRING LITERAL PAST ASCII — which bytes a character that is not ASCII, TYPED into a STRING literal, becomes (openspec
 * `wstring-utf8-narrowing` left it unmeasured; the transpiler refuses it, `string-non-ascii`). A two-, a three- and a
 * four-byte character, a literal cut at the STRING's capacity inside a character, and the widen of such a literal.
 *
 * Run on the exec oracle's project, whose compile option "UTF-8 encoding" is on (`codesys.run.json`; the replay hands its
 * `Project Settings.projectsettings`), built on the build-recording project, where it is off (`codesys.build.json`).
 * Each probe stores the literal in the body and reads single bytes (BYTE by index) and `LEN`, never a rendered string.
 */
import type { LanguageTest } from "../../types.js"

/** The probe FB: `temps` are VAR_TEMP (no run reads a string whole), `decls` what the run reads. */
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

const indices = (count: number) => Array.from({ length: count }, (_, i) => i)

/** `'text'` stored into a STRING(`capacity`): its `LEN` and its first `count` bytes. */
function literal(slug: string, text: string, capacity: number, count: number, feature: string): LanguageTest {
  const type = capacity === 80 ? "STRING" : `STRING(${capacity})`
  const decl = "\tn : INT;\n" + indices(count).map((i) => `\tu${i} : BYTE;`).join("\n")
  const read = "n := LEN(txt);\n" + indices(count).map((i) => `u${i} := txt[${i}];`).join("\n")
  return probe(slug, `\ttxt : ${type};`, decl, `txt := '${text}';\n${read}`, feature)
}

/** `STRING_TO_WSTRING('text')`: its first `count` units. */
function widened(slug: string, text: string, count: number, feature: string): LanguageTest {
  const decl = indices(count).map((i) => `\tu${i} : WORD;`).join("\n")
  const read = indices(count).map((i) => `u${i} := w[${i}];`).join("\n")
  return probe(slug, "\tw : WSTRING;", decl, `w := STRING_TO_WSTRING('${text}');\n${read}`, feature)
}

export const STRING_LITERAL_UTF8_TESTS: readonly LanguageTest[] = [
  literal("slit_two_byte", "größe", 80, 8, "a STRING literal of two-byte characters (ö, ß): its LEN and every byte"),
  literal("slit_three_byte", "a计b", 80, 6, "a STRING literal of a three-byte character (计)"),
  literal("slit_four_byte", "a😀b", 80, 7, "a STRING literal of a four-byte character (U+1F600)"),
  literal("slit_cut_inside", "größe", 3, 4, "a STRING literal into a STRING(3): the capacity ends inside ö"),
  widened("slit_widen_two_byte", "größe", 6, "STRING_TO_WSTRING of a STRING literal of two-byte characters"),
  literal("slit_long_three_byte", "abcdefghijklmnopqrstuvwxyz计", 80, 2, "a long STRING literal ending in a three-byte character: how the build quotes it"),
  probe("slit_into_wstring", "\tw : WSTRING;", "\tu1 : WORD;", "w := 'a计b';\nu1 := w[1];", "a STRING literal of a three-byte character stored into a WSTRING"),
]
