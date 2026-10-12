/**
 * the helpers `string-edges.ts`'s parts share: the fixture builders and the data they are built from (openspec
 * lsp-same-standard 4.4).
 */
import type { LanguageTest } from "../../types.js"

/** A whole-FB fixture: every variable the body writes is recorded, so one fixture asks several related questions. */
export function whole(name: string, feature: string, source: string): LanguageTest {
  const pouName = /FUNCTION_BLOCK (\w+)/.exec(source)![1]!
  return { name, pouName, kind: "function_block", feature, fromDoc: "06-data-types.md#string", source, plcPrgVar: `inst : ${pouName};`, plcPrgBody: "inst();" }
}

/**
 * transpile-restructure 3.1 — the measurements model 2 (strings) is chosen by (design §3.2 M1-M5). Each fixture dumps the
 * BUFFER, not only the string: the recorded value of a STRING stops at its first 0, so every unit the question is about is
 * copied into an ARRAY OF BYTE (a WSTRING's into an ARRAY OF WORD) by `s[i]`, which reaches all n + 1 units
 * (`lib_prim_char_past_length`). A destination is filled with 'Z' (90) before the store under test, so a unit the store did
 * NOT write reads 90 and one it wrote reads what it wrote. The long operands are filled by index, never by CONCAT, so no
 * library cut can stand in for the store being measured.
 */

/**
 * A length counted by a loop up to the first 0, one loop per string: LEN itself takes a STRING(255) and would cut what M5
 * measures. Counting every non-zero unit of the buffer instead (the first recording, 2026-10-08) read 211 for a 200-unit
 * result — the units behind its terminator are not 0 there — so a loop that does not stop at the terminator measures
 * something else.
 */
export const lengths = (pairs: readonly (readonly [string, string])[]): string =>
  pairs
    .map(([text, len]) => `${len} := 0;\nFOR i := 0 TO 400 DO\n\tIF ${text}[i] = 0 THEN\n\t\tEXIT;\n\tEND_IF\n\t${len} := ${len} + 1;\nEND_FOR\n`)
    .join("")

/** The units [199..262] of a 400-unit string, in four arrays of 16 (`run-paths` reads at most 16 elements of one). */
export const TAIL_RANGES: readonly (readonly [number, number])[] = [[199, 214], [215, 230], [231, 246], [247, 262]]

export const tailArrays = (name: string, unit: string): string =>
  TAIL_RANGES.map(([lo, hi], k) => `\t${name}Tail${k} : ARRAY[${lo}..${hi}] OF ${unit};\n`).join("")

export const tailDumps = (name: string): string =>
  TAIL_RANGES.map(([lo, hi], k) => `FOR i := ${lo} TO ${hi} DO\n\t${name}Tail${k}[i] := ${name}[i];\nEND_FOR\n`).join("")

/** A STRING(20)'s 21 bytes, as `<p>Lo` [0..15] and `<p>Hi` [16..20]. */
export const dumpArrays = (prefixes: readonly string[]): string =>
  prefixes.map((p) => `\t${p}Lo : ARRAY[0..15] OF BYTE;\n\t${p}Hi : ARRAY[16..20] OF BYTE;\n`).join("")

/** The dump paths of units [from..to] of a 400-unit string's tail arrays (`tailArrays`). */
export const tailPaths = (name: string, from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, k) => from + k).map(
    (i) => `inst.${name}Tail${TAIL_RANGES.findIndex(([lo, hi]) => i >= lo && i <= hi)}[${i}]`,
  )

/** The dump paths of bytes [from..to] of a STRING(20) (`dumpArrays`). */
export const dumpPaths = (p: string, from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, k) => from + k).map((i) => `inst.${p}${i <= 15 ? "Lo" : "Hi"}[${i}]`)

export const dumps = (pairs: readonly (readonly [string, string])[]): string =>
  `FOR i := 0 TO 15 DO\n${pairs.map(([p, text]) => `\t${p}Lo[i] := ${text}[i];\n`).join("")}END_FOR\n` +
  `FOR i := 16 TO 20 DO\n${pairs.map(([p, text]) => `\t${p}Hi[i] := ${text}[i];\n`).join("")}END_FOR\n`

/**
 * The cells of `wstring_parse_grammar` (transpile-restructure 8.2): `[name, text]`, the text as it stands inside a WSTRING
 * literal (`$T` a tab). The integer ones are the `tr_a10_*` STRING cells of `semantics/parse.cases.ts` widened, then plain
 * decimals and what may stand before or after them; the REAL ones `string_to_real_parse`'s, then trailing characters.
 */
export const WIDE_PARSE_INT: readonly (readonly [string, string])[] = [
  ["Hex", "16#FF"], ["Bin", "2#101"], ["Oct", "8#17"], ["Typed", "INT#5"], ["TypedHex", "INT#16#1F"], ["LowerHex", "16#ff"],
  ["Under", "1_000"], ["NegHex", "-16#F"], ["SpaceHex", " 16#FF"], ["BadHex", "16#G"],
  ["HexUnder", "16#FF_FF"], ["DoubleUnder", "1__0"], ["LeadUnder", "_5"], ["TrailUnder", "5_"], ["NoDigits", "16#"],
  ["OctNine", "8#19"], ["PlusHex", "+16#F"], ["Base3", "3#12"], ["Base10", "10#99"], ["HexTail", "16#1FZ"], ["ZeroHex", "016#F"],
  ["NegUnder", "-1_0"], ["PlusLead", "+_5"], ["SpaceLead", " _5"], ["Only", "_"], ["NegLead", "-_5"], ["HexLead", "16#_F"],
  ["BinUnder", "2#1_0"], ["DoubleLead", "__5"], ["SpaceInside", "1 0"], ["TabLead", "$T16#F"],
  ["Plain", "5"], ["Neg", "-5"], ["Plus", "+5"], ["Lead", " 5"], ["TabPlain", "$T7"], ["Letters", "12abc"], ["SpaceSign", "- 5"],
  ["Empty", ""], ["TrailSpace", "5 "], ["TrailTab", "5$T"], ["TrailLetter", "5a"], ["Big", "99999"], ["HexTrailSpace", "16#FF "],
  ["Alpha", "abc"],
]

export const WIDE_PARSE_REAL: readonly (readonly [string, string])[] = [
  ["DotFirst", ".5"], ["DotLast", "5."], ["BareExp", "1.5E"], ["LowerExp", "2e2"], ["NegR", " -2.5"], ["AlphaR", "abc"],
  ["TabbedR", "$T3.25"], ["Comma", "1,5"], ["Long", "1.23456789"], ["TrailSpaceR", "1.5 "], ["TrailTabR", "1.5$T"],
  ["TrailLetterR", "1.5x"], ["IntR", "7"], ["EmptyR", ""], ["ExpSpace", "1E3 "],
]

/**
 * The cells of `wstring_parse_widths` (gate 8c): texts past 32 bits, past 64, negative, past INT and SINT, each parsed into
 * every integer type by WSTRING_TO_<type> and by STRING_TO_<type> beside it — `wstring_parse_grammar` parsed into a DINT
 * only, so whether the wide parse wraps into a narrower or wider type as the STRING one does is asked here.
 */
export const WIDE_WIDTH_TEXTS: readonly (readonly [string, string])[] = [
  ["Past32", "9999999999"], ["Two32", "4294967296"], ["Neg5", "-5"], ["Past16", "70000"], ["Past8", "300"], ["NegPast8", "-129"],
  ["U64Max", "18446744073709551615"], ["Past64", "99999999999999999999"], ["NegPast64", "-9223372036854775809"],
]

export const WIDE_WIDTH_TYPES = ["SINT", "USINT", "INT", "UINT", "DINT", "UDINT", "LINT", "ULINT", "BYTE", "WORD", "DWORD", "LWORD"] as const
