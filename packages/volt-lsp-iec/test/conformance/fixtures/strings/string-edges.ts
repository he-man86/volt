/**
 * THE STANDARD STRING FUNCTIONS AT THEIR EDGES — position 0, position past the end, a negative count, an empty
 * string, and a result too long for where it is going.
 *
 * `semantics/convert.ts` states the rules and sources them from `string_*` and `string_positions_*`: positions are
 * 1-based, a count clamps to the string, `LEFT('abc', 5)` is 'abc' and `LEFT('abc', -1)` is '', `MID` and `DELETE`
 * select nothing below position 1 or at a length of zero or less, `INSERT` at 0 prepends. That is a real set of
 * measurements — and it is one or two cases per function, chosen by whoever wrote them.
 *
 * Nine functions, each asked at every edge it has:
 *
 *   LEN       empty, one character, and a string holding escapes — where `string_high_byte_escape` already
 *             diverges, because a CODESYS STRING is UTF-8 BYTES and LEN counts them
 *   LEFT      RIGHT   count 0, 1, exactly the length, past it, and negative
 *   MID       position 0, 1, the last, past the end; length 0, negative, longer than what remains
 *   CONCAT    an empty side, and a result longer than the destination can hold
 *   INSERT    at 0, at 1, at the end, past the end
 *   DELETE    at 0, at 1, past the end; length 0 and longer than what remains
 *   REPLACE   a replacement longer and shorter than what it replaces, and at position 0
 *   FIND      present, absent, empty needle, needle longer than the haystack
 *
 * The operands are written by the body, so a constant folded at compile time cannot stand in for the runtime.
 *
 * The haystack is `text` and not `s`: `S` is an IL operator and CODESYS refuses it as a variable name outright —
 * `Unexpected token 's'`, `docs/reserved-il-operators.md`. Thirteen fixtures were once written that way and recorded
 * a parse error in place of an answer, which is a trap this file walked straight into before renaming.
 */
import { FUNCTION_FRAME_RESIDUE_DIVERGENCES } from "../../support/divergences.js"
import type { LanguageTest } from "../../types.js"

function probe(slug: string, expr: string, outType: string, feature: string, decls = ""): LanguageTest {
  const pou = `FB_LANG_${slug}`
  return {
    name: slug,
    pouName: pou,
    kind: "function_block" as const,
    feature,
    fromDoc: "06-data-types.md#string",
    plcPrgVar: `inst : ${pou};`,
    plcPrgBody: "inst();",
    source:
      `FUNCTION_BLOCK ${pou}\nVAR\n\ttext : STRING;\n\tins : STRING;${decls}\n\tout : ${outType};\nEND_VAR\n` +
      `text := 'abcde';\nins := 'XY';\nout := ${expr};\nEND_FUNCTION_BLOCK\n`,
  }
}

const COUNTS: readonly [string, string][] = [
  ["0", "zero"],
  ["1", "one"],
  ["5", "exactly_the_length"],
  ["9", "past_the_end"],
  ["-1", "negative"],
]

const lefts: LanguageTest[] = COUNTS.flatMap(([n, slug]) => [
  probe(`str_left_${slug}`, `LEFT(text, ${n})`, "STRING", `LEFT('abcde', ${n})`),
  probe(`str_right_${slug}`, `RIGHT(text, ${n})`, "STRING", `RIGHT('abcde', ${n})`),
])

const POSITIONS: readonly [string, string][] = [
  ["0", "at_zero"],
  ["1", "at_one"],
  ["5", "at_the_last"],
  ["9", "past_the_end"],
]

const mids: LanguageTest[] = POSITIONS.flatMap(([p, slug]) => [
  probe(`str_mid_${slug}`, `MID(text, 2, ${p})`, "STRING", `MID('abcde', 2, ${p}) — two characters from ${p}`),
  probe(`str_mid_len0_${slug}`, `MID(text, 0, ${p})`, "STRING", `MID('abcde', 0, ${p}) — a length of zero`),
  probe(`str_mid_lenneg_${slug}`, `MID(text, -1, ${p})`, "STRING", `MID('abcde', -1, ${p}) — a negative length`),
  probe(`str_delete_${slug}`, `DELETE(text, 2, ${p})`, "STRING", `DELETE('abcde', 2, ${p})`),
  probe(`str_insert_${slug}`, `INSERT(text, ins, ${p})`, "STRING", `INSERT('abcde', 'XY', ${p})`),
  probe(`str_replace_${slug}`, `REPLACE(text, ins, 2, ${p})`, "STRING", `REPLACE('abcde', 'XY', 2, ${p})`),
])

const lens: LanguageTest[] = [
  probe("str_len_empty", "LEN(empty)", "INT", "LEN of an empty string", "\n\tempty : STRING;"),
  probe("str_len_five", "LEN(text)", "INT", "LEN of 'abcde'"),
  // The initializer is on the DECLARATION, not in the body: `probe` only appends declarations, and a `small` the
  // body never wrote would have measured LEN of an empty STRING(3) while claiming to measure truncation.
  probe("str_len_after_truncation", "LEN(small)", "INT", "LEN of a STRING(3) declared with five characters", "\n\tsmall : STRING(3) := 'abcde';"),
]

const concats: LanguageTest[] = [
  probe("str_concat_both", "CONCAT(text, ins)", "STRING", "CONCAT of two non-empty strings"),
  probe("str_concat_empty_left", "CONCAT(empty, text)", "STRING", "CONCAT with an empty left side", "\n\tempty : STRING;"),
  probe("str_concat_into_short", "CONCAT(text, text)", "STRING(4)", "CONCAT whose result is longer than the destination holds"),
]

const finds: LanguageTest[] = [
  probe("str_find_present", "FIND(text, needle)", "INT", "FIND a substring that is there", "\n\tneedle : STRING := 'cd';"),
  probe("str_find_absent", "FIND(text, ins)", "INT", "FIND a substring that is not"),
  probe("str_find_empty_needle", "FIND(text, empty)", "INT", "FIND an empty needle", "\n\tempty : STRING;"),
  probe("str_find_longer_needle", "FIND(ins, text)", "INT", "FIND a needle longer than the haystack"),
]

/** Assigning past a STRING(n)'s length — the truncation rule `fit` states, asked at each edge. */
const truncation: LanguageTest[] = [
  probe("str_assign_into_shorter", "text", "STRING(3)", "a five-character string into a STRING(3)"),
  probe("str_assign_into_exact", "text", "STRING(5)", "a five-character string into a STRING(5)"),
  probe("str_assign_into_longer", "text", "STRING(9)", "a five-character string into a STRING(9)"),
]

export const STRING_EDGE_TESTS: readonly LanguageTest[] = [
  ...lens,
  ...lefts,
  ...mids,
  ...concats,
  ...finds,
  ...truncation,
]

/** A whole-FB fixture: every variable the body writes is recorded, so one fixture asks several related questions. */
function whole(name: string, feature: string, source: string): LanguageTest {
  const pouName = /FUNCTION_BLOCK (\w+)/.exec(source)![1]!
  return { name, pouName, kind: "function_block", feature, fromDoc: "06-data-types.md#string", source, plcPrgVar: `inst : ${pouName};`, plcPrgBody: "inst();" }
}

/**
 * transpile-review-2026-09-29 root causes in the STRING representation, registered beside `STRING_EDGE_TESTS` in
 * `index.ts`. The values are CODESYS's, taken by `record:exec`, never written here. Every long operand is BUILT in the body by a
 * loop, so no compile-time fold can stand in for the runtime conversion.
 */
export const TRANSPILE_REVIEW_STRING_TESTS: readonly LanguageTest[] = [
  // Task 11: a STRING<->WSTRING or STRING->number conversion must not cut its operand to the 80-character default
  // capacity. `txt` is 90 spaces then '5' (91 chars, the digit past position 80); `at80` puts its digit AT position 80,
  // the last one the default would keep. `wide` is 85 spaces then '12345' for the WSTRING->number pair, `w100` is 100
  // characters narrowed to STRING, `txt91` is `txt` widened, and `w86` goes through the bare TO_STRING. The WSTRINGs are
  // filled by index (`w[i] := code`) and measured by a loop: the recording project references no WCONCAT / WLEN.
  whole("tr_11_string_conversion_beyond_80", "STRING<->WSTRING and STRING->INT of operands longer than 80 characters (transpile-review task 11)",
    `FUNCTION_BLOCK FB_LANG_tr_11_conv_beyond_80
VAR
\ti : INT;
\ttxt : STRING(120);
\tat80 : STRING(120);
\twide : WSTRING(120);
\tw100 : WSTRING(120);
\tw86 : WSTRING(120);
\tnarrow : STRING(120);
\tnarrow86 : STRING(120);
\twidened : WSTRING(120);
\tnamedInt : INT;
\tbareInt : INT;
\tat80Int : INT;
\tcrossNamed : INT;
\tcrossBare : INT;
\tcnt : INT;
\tnarrowLen : INT;
\tn3 : INT;
END_VAR
txt := '';
at80 := '';
wide := "";
w100 := "";
w86 := "";
FOR i := 1 TO 90 DO
\ttxt := CONCAT(txt, ' ');
END_FOR
txt := CONCAT(txt, '5');
FOR i := 1 TO 79 DO
\tat80 := CONCAT(at80, ' ');
END_FOR
at80 := CONCAT(at80, '7');
FOR i := 0 TO 84 DO
\twide[i] := 32;
END_FOR
FOR i := 85 TO 89 DO
\twide[i] := INT_TO_WORD(i - 36);
END_FOR
wide[90] := 0;
FOR i := 0 TO 99 DO
\tw100[i] := 120;
END_FOR
w100[100] := 0;
FOR i := 0 TO 85 DO
\tw86[i] := 121;
END_FOR
w86[86] := 0;
namedInt := STRING_TO_INT(txt);
bareInt := TO_INT(txt);
at80Int := STRING_TO_INT(at80);
crossNamed := WSTRING_TO_INT(wide);
crossBare := TO_INT(wide);
narrow := WSTRING_TO_STRING(w100);
cnt := LEN(narrow);
widened := STRING_TO_WSTRING(txt);
narrowLen := 0;
FOR i := 0 TO 120 DO
	IF widened[i] = 0 THEN
		EXIT;
	END_IF
	narrowLen := narrowLen + 1;
END_FOR
narrow86 := TO_STRING(w86);
n3 := LEN(narrow86);
END_FUNCTION_BLOCK
`),

  // Task 34: STRING(n) is n+1 bytes and s[i] a byte access — bytes behind the terminator are KEPT. Right-to-left digit
  // fill (the terminator is written first, into an empty string); a NUL stored then overwritten (the tail 'def' must
  // come back); and stores past the length through a POINTER TO BYTE, the far one first.
  whole("tr_34_lib_prim_char_behind", "bytes past a STRING's terminator survive: right-to-left fill, NUL then overwrite, POINTER TO BYTE past the length (transpile-review task 34)",
    `FUNCTION_BLOCK FB_LANG_tr_34_char_behind
VAR
\tdigits : STRING(10);
\tt : STRING(10) := 'abcdef';
\tu : STRING(10) := 'abc';
\tp : POINTER TO BYTE;
\tlenDigits : INT;
\tlenT : INT;
\tlenU : INT;
\tcopied : STRING(10);
\tlenCopied : INT;
END_VAR
digits := '';
digits[4] := 0;
digits[3] := 49;
digits[2] := 50;
digits[1] := 51;
digits[0] := 52;
lenDigits := LEN(digits);
t := 'abcdef';
t[2] := 0;
t[2] := 88;
lenT := LEN(t);
u := 'abc';
p := ADR(u);
p[4] := 67;
p[3] := 66;
lenU := LEN(u);
copied := u;
lenCopied := LEN(copied);
END_FUNCTION_BLOCK
`),

  // Task 45: a literal with $00 in the middle — the length ends at the NUL but the bytes behind it are stored, and an
  // assignment copies them. The STRING(3) initializer of a 4-byte literal only warns in CODESYS.
  whole("tr_45_string_embedded_nul", "a STRING / WSTRING literal with an embedded $00: length, comparison, bytes behind the NUL, copy and CONCAT (transpile-review task 45)",
    `FUNCTION_BLOCK FB_LANG_tr_45_embedded_nul
VAR
\ttxt : STRING(3) := 'ab$00c';
\tu : STRING(10);
\tsmall : STRING(3);
\tw : WSTRING := "ab$0000c";
\teqAb : BOOL;
\teqFull : BOOL;
\tlenS : INT;
\tc2 : BYTE;
\tc3 : BYTE;
\tlenU : INT;
\tuc3 : BYTE;
\tweqAb : BOOL;
\tlenW : INT;
\tcat : STRING;
\tlenS3 : INT;
\ti : INT;
END_VAR
eqAb := txt = 'ab';
eqFull := txt = 'ab$00c';
lenS := LEN(txt);
c2 := txt[2];
c3 := txt[3];
u := txt;
lenU := LEN(u);
uc3 := u[3];
weqAb := w = "ab";
lenW := 0;
FOR i := 0 TO 80 DO
	IF w[i] = 0 THEN
		EXIT;
	END_IF
	lenW := lenW + 1;
END_FOR
cat := CONCAT(txt, 'X');
small := u;
lenS3 := LEN(small);
END_FUNCTION_BLOCK
`),
]

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
const lengths = (pairs: readonly (readonly [string, string])[]): string =>
  pairs
    .map(([text, len]) => `${len} := 0;\nFOR i := 0 TO 400 DO\n\tIF ${text}[i] = 0 THEN\n\t\tEXIT;\n\tEND_IF\n\t${len} := ${len} + 1;\nEND_FOR\n`)
    .join("")

/** The units [199..262] of a 400-unit string, in four arrays of 16 (`run-paths` reads at most 16 elements of one). */
const TAIL_RANGES: readonly (readonly [number, number])[] = [[199, 214], [215, 230], [231, 246], [247, 262]]
const tailArrays = (name: string, unit: string): string =>
  TAIL_RANGES.map(([lo, hi], k) => `\t${name}Tail${k} : ARRAY[${lo}..${hi}] OF ${unit};\n`).join("")
const tailDumps = (name: string): string =>
  TAIL_RANGES.map(([lo, hi], k) => `FOR i := ${lo} TO ${hi} DO\n\t${name}Tail${k}[i] := ${name}[i];\nEND_FOR\n`).join("")

/** A STRING(20)'s 21 bytes, as `<p>Lo` [0..15] and `<p>Hi` [16..20]. */
const dumpArrays = (prefixes: readonly string[]): string =>
  prefixes.map((p) => `\t${p}Lo : ARRAY[0..15] OF BYTE;\n\t${p}Hi : ARRAY[16..20] OF BYTE;\n`).join("")
/** The dump paths of units [from..to] of a 400-unit string's tail arrays (`tailArrays`). */
const tailPaths = (name: string, from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, k) => from + k).map(
    (i) => `inst.${name}Tail${TAIL_RANGES.findIndex(([lo, hi]) => i >= lo && i <= hi)}[${i}]`,
  )
/** The dump paths of bytes [from..to] of a STRING(20) (`dumpArrays`). */
const dumpPaths = (p: string, from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, k) => from + k).map((i) => `inst.${p}${i <= 15 ? "Lo" : "Hi"}[${i}]`)
const dumps = (pairs: readonly (readonly [string, string])[]): string =>
  `FOR i := 0 TO 15 DO\n${pairs.map(([p, text]) => `\t${p}Lo[i] := ${text}[i];\n`).join("")}END_FOR\n` +
  `FOR i := 16 TO 20 DO\n${pairs.map(([p, text]) => `\t${p}Hi[i] := ${text}[i];\n`).join("")}END_FOR\n`

/**
 * The cells of `wstring_parse_grammar` (transpile-restructure 8.2): `[name, text]`, the text as it stands inside a WSTRING
 * literal (`$T` a tab). The integer ones are the `tr_a10_*` STRING cells of `semantics/parse.cases.ts` widened, then plain
 * decimals and what may stand before or after them; the REAL ones `string_to_real_parse`'s, then trailing characters.
 */
const WIDE_PARSE_INT: readonly (readonly [string, string])[] = [
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
const WIDE_PARSE_REAL: readonly (readonly [string, string])[] = [
  ["DotFirst", ".5"], ["DotLast", "5."], ["BareExp", "1.5E"], ["LowerExp", "2e2"], ["NegR", " -2.5"], ["AlphaR", "abc"],
  ["TabbedR", "$T3.25"], ["Comma", "1,5"], ["Long", "1.23456789"], ["TrailSpaceR", "1.5 "], ["TrailTabR", "1.5$T"],
  ["TrailLetterR", "1.5x"], ["IntR", "7"], ["EmptyR", ""], ["ExpSpace", "1E3 "],
]

/**
 * The cells of `wstring_parse_widths` (gate 8c): texts past 32 bits, past 64, negative, past INT and SINT, each parsed into
 * every integer type by WSTRING_TO_<type> and by STRING_TO_<type> beside it — `wstring_parse_grammar` parsed into a DINT
 * only, so whether the wide parse wraps into a narrower or wider type as the STRING one does is asked here.
 */
const WIDE_WIDTH_TEXTS: readonly (readonly [string, string])[] = [
  ["Past32", "9999999999"], ["Two32", "4294967296"], ["Neg5", "-5"], ["Past16", "70000"], ["Past8", "300"], ["NegPast8", "-129"],
  ["U64Max", "18446744073709551615"], ["Past64", "99999999999999999999"], ["NegPast64", "-9223372036854775809"],
]
const WIDE_WIDTH_TYPES = ["SINT", "USINT", "INT", "UINT", "DINT", "UDINT", "LINT", "ULINT", "BYTE", "WORD", "DWORD", "LWORD"] as const

export const STRING_MODEL_TESTS: readonly LanguageTest[] = [
  // M1: the bytes behind a $00 inside a literal. RC 45's LIVE run reported c3 = uc3 = 99 for `STRING(3) := 'ab$00c'`; the
  // committed `tr_45_string_embedded_nul` recording says 0. `three` re-asks that cell exactly; `lit`/`bare` ask it where the
  // capacity holds the whole literal (an initializer), `assigned` where the literal is STORED at run time, `copy` whether an
  // assignment carries the bytes behind the NUL, `wideCopy` the same out of the STRING(3).
  whole("string_literal_nul_tail", "the bytes behind a $00 inside a STRING literal: initializer, run-time store and copy (transpile-restructure 3.1 M1)",
    `FUNCTION_BLOCK FB_LANG_string_literal_nul_tail
VAR
\ti : INT;
\tthree : STRING(3) := 'ab$00c';
\tlit : STRING(10) := 'ab$00cd';
\tbare : STRING := 'ab$00cd';
\tassigned : STRING(10);
\tcopy : STRING(10);
\twideCopy : STRING(10);
\tthreeBytes : ARRAY[0..3] OF BYTE;
\tlitBytes : ARRAY[0..10] OF BYTE;
\tbareBytes : ARRAY[0..10] OF BYTE;
\tassignedBytes : ARRAY[0..10] OF BYTE;
\tcopyBytes : ARRAY[0..10] OF BYTE;
\twideCopyBytes : ARRAY[0..10] OF BYTE;
\tlenLit : INT;
\tlenAssigned : INT;
\tlenCopy : INT;
END_VAR
assigned := 'ZZZZZZZZZZ';
assigned := 'ab$00cd';
copy := 'ZZZZZZZZZZ';
copy := lit;
wideCopy := 'ZZZZZZZZZZ';
wideCopy := three;
FOR i := 0 TO 3 DO
\tthreeBytes[i] := three[i];
END_FOR
FOR i := 0 TO 10 DO
\tlitBytes[i] := lit[i];
\tbareBytes[i] := bare[i];
\tassignedBytes[i] := assigned[i];
\tcopyBytes[i] := copy[i];
\twideCopyBytes[i] := wideCopy[i];
END_FOR
lenLit := LEN(lit);
lenAssigned := LEN(assigned);
lenCopy := LEN(copy);
END_FUNCTION_BLOCK
`),

  // M2 narrow: STRING(10) := STRING(20) whose bytes behind the length are not 0. The source is 'abcdefghijklmnopqrst' with a
  // 0 stored at [3] (length 3, 'efgh…t' behind it); `full` is the same 20 characters with no 0, so the cut at the capacity
  // and the terminator at [10] are asked too. len+1 bytes leaves 'ZZZZZZ' behind the 0; min(n, m) bytes brings 'efghij'.
  whole("string_assign_tail_narrow", "STRING(10) := STRING(20) whose bytes behind the terminator are not 0 (transpile-restructure 3.1 M2)",
    `FUNCTION_BLOCK FB_LANG_string_assign_tail_narrow
VAR
\ti : INT;
\tsrc : STRING(20);
\tfull : STRING(20);
\tdst : STRING(10);
\tdstFull : STRING(10);
\tdstBytes : ARRAY[0..10] OF BYTE;
\tdstFullBytes : ARRAY[0..10] OF BYTE;
\tlenDst : INT;
\tlenDstFull : INT;
END_VAR
src := 'abcdefghijklmnopqrst';
src[3] := 0;
full := 'abcdefghijklmnopqrst';
dst := 'ZZZZZZZZZZ';
dst := src;
dstFull := 'ZZZZZZZZZZ';
dstFull := full;
FOR i := 0 TO 10 DO
\tdstBytes[i] := dst[i];
\tdstFullBytes[i] := dstFull[i];
END_FOR
lenDst := LEN(dst);
lenDstFull := LEN(dstFull);
END_FUNCTION_BLOCK
`),

  // M2 wide: STRING(20) := STRING(10). The source is 'abcdefghij' with a 0 at [3]. The whole source buffer (11 bytes) puts
  // 'efghij' and a 0 at [4..10] and leaves 'Z' at [11..19]; len+1 bytes leaves 'Z' from [4]; a copy the size of the
  // DESTINATION would read past the source into its neighbour (`after`, 'QQQQ…').
  whole("string_assign_tail_wide", "STRING(20) := STRING(10) whose bytes behind the terminator are not 0 (transpile-restructure 3.1 M2)",
    `FUNCTION_BLOCK FB_LANG_string_assign_tail_wide
VAR
\ti : INT;
\tsrc : STRING(10);
\tafter : STRING(10);
\tdst : STRING(20);
\tlo : ARRAY[0..15] OF BYTE;
\thi : ARRAY[16..20] OF BYTE;
\tlenDst : INT;
END_VAR
src := 'abcdefghij';
src[3] := 0;
after := 'QQQQQQQQQQ';
dst := 'ZZZZZZZZZZZZZZZZZZZZ';
dst := src;
FOR i := 0 TO 15 DO
\tlo[i] := dst[i];
END_FOR
FOR i := 16 TO 20 DO
\thi[i] := dst[i];
END_FOR
lenDst := LEN(dst);
END_FUNCTION_BLOCK
`),

  // M3: the WSTRING twins of M1 and M2 — units are WORDs, the escape is four hex digits, the filler "Z" is 90. The literal
  // twin asks every cell the STRING one does: the sizeless `bare` and the three lengths too (counted to the first 0 by
  // `lengths` — LEN takes a STRING).
  whole("wstring_literal_nul_tail", "the units behind a $0000 inside a WSTRING literal: initializer, run-time store and copy (transpile-restructure 3.1 M3)",
    `FUNCTION_BLOCK FB_LANG_wstring_literal_nul_tail
VAR
\ti : INT;
\tthree : WSTRING(3) := "ab$0000c";
\tlit : WSTRING(10) := "ab$0000cd";
\tbare : WSTRING := "ab$0000cd";
\tassigned : WSTRING(10);
\tcopy : WSTRING(10);
\twideCopy : WSTRING(10);
\tthreeUnits : ARRAY[0..3] OF WORD;
\tlitUnits : ARRAY[0..10] OF WORD;
\tbareUnits : ARRAY[0..10] OF WORD;
\tassignedUnits : ARRAY[0..10] OF WORD;
\tcopyUnits : ARRAY[0..10] OF WORD;
\twideCopyUnits : ARRAY[0..10] OF WORD;
\tlenLit : INT;
\tlenAssigned : INT;
\tlenCopy : INT;
END_VAR
assigned := "ZZZZZZZZZZ";
assigned := "ab$0000cd";
copy := "ZZZZZZZZZZ";
copy := lit;
wideCopy := "ZZZZZZZZZZ";
wideCopy := three;
FOR i := 0 TO 3 DO
\tthreeUnits[i] := three[i];
END_FOR
FOR i := 0 TO 10 DO
\tlitUnits[i] := lit[i];
\tbareUnits[i] := bare[i];
\tassignedUnits[i] := assigned[i];
\tcopyUnits[i] := copy[i];
\twideCopyUnits[i] := wideCopy[i];
END_FOR
${lengths([["lit", "lenLit"], ["assigned", "lenAssigned"], ["copy", "lenCopy"]])}END_FUNCTION_BLOCK
`),

  whole("wstring_assign_tail_narrow", "WSTRING(10) := WSTRING(20) whose units behind the terminator are not 0 (transpile-restructure 3.1 M3)",
    `FUNCTION_BLOCK FB_LANG_wstring_assign_tail_narrow
VAR
\ti : INT;
\tsrc : WSTRING(20);
\tfull : WSTRING(20);
\tdst : WSTRING(10);
\tdstFull : WSTRING(10);
\tdstUnits : ARRAY[0..10] OF WORD;
\tdstFullUnits : ARRAY[0..10] OF WORD;
END_VAR
src := "abcdefghijklmnopqrst";
src[3] := 0;
full := "abcdefghijklmnopqrst";
dst := "ZZZZZZZZZZ";
dst := src;
dstFull := "ZZZZZZZZZZ";
dstFull := full;
FOR i := 0 TO 10 DO
\tdstUnits[i] := dst[i];
\tdstFullUnits[i] := dstFull[i];
END_FOR
END_FUNCTION_BLOCK
`),

  whole("wstring_assign_tail_wide", "WSTRING(20) := WSTRING(10) whose units behind the terminator are not 0 (transpile-restructure 3.1 M3)",
    `FUNCTION_BLOCK FB_LANG_wstring_assign_tail_wide
VAR
\ti : INT;
\tsrc : WSTRING(10);
\tafter : WSTRING(10);
\tdst : WSTRING(20);
\tlo : ARRAY[0..15] OF WORD;
\thi : ARRAY[16..20] OF WORD;
END_VAR
src := "abcdefghij";
src[3] := 0;
after := "QQQQQQQQQQ";
dst := "ZZZZZZZZZZZZZZZZZZZZ";
dst := src;
FOR i := 0 TO 15 DO
\tlo[i] := dst[i];
END_FOR
FOR i := 16 TO 20 DO
\thi[i] := dst[i];
END_FOR
END_FUNCTION_BLOCK
`),

  // M4: two strings whose bytes differ only behind the terminator ('abc' + 0 + 'def' / 'xyz'), at one capacity and across
  // two, and the WSTRING twin. Every operator, so an ordering that reads past the 0 shows in at least one cell.
  whole("string_compare_tail", "comparing strings that differ only behind the terminator, STRING and WSTRING (transpile-restructure 3.1 M4)",
    `FUNCTION_BLOCK FB_LANG_string_compare_tail
VAR
\ta : STRING(10);
\tb : STRING(10);
\tc : STRING(20);
\twa : WSTRING(10);
\twb : WSTRING(10);
\teqAB : BOOL;
\tneAB : BOOL;
\tltAB : BOOL;
\tgtAB : BOOL;
\tleAB : BOOL;
\tgeAB : BOOL;
\teqAC : BOOL;
\tltAC : BOOL;
\tgtAC : BOOL;
\teqLit : BOOL;
\tweqAB : BOOL;
\twltAB : BOOL;
\twgtAB : BOOL;
END_VAR
a := 'abcdef';
b := 'abcxyz';
c := 'abcqrstuvw';
a[3] := 0;
b[3] := 0;
c[3] := 0;
wa := "abcdef";
wb := "abcxyz";
wa[3] := 0;
wb[3] := 0;
eqAB := a = b;
neAB := a <> b;
ltAB := a < b;
gtAB := a > b;
leAB := a <= b;
geAB := a >= b;
eqAC := a = c;
ltAC := a < c;
gtAC := a > c;
eqLit := a = 'abc';
weqAB := wa = wb;
wltAB := wa < wb;
wgtAB := wa > wb;
END_FUNCTION_BLOCK
`),

  // M5 conversions: the capacity of a STRING<->WSTRING result. `n200`/`n300` are 200 / 300 'x', `w300` 300 'y', filled by
  // index; every result lands in a 400-unit destination and its length is counted up to the first 0 (`lengths`), so a cut at 80, at 255 or at
  // the source's capacity each reads as a different number.
  { ...whole("string_conversion_result_capacity", "the capacity of a STRING_TO_WSTRING / WSTRING_TO_STRING result of a 200- and 300-unit operand (transpile-restructure 3.1 M5)",
    `FUNCTION_BLOCK FB_LANG_string_conversion_result_capacity
VAR
\ti : INT;
\tn200 : STRING(200);
\tn300 : STRING(300);
\tw300 : WSTRING(300);
\ttoWide200 : WSTRING(400);
\ttoWide300 : WSTRING(400);
\tbareWide300 : WSTRING(400);
\ttoNarrow300 : STRING(400);
\tbareNarrow300 : STRING(400);
\tlenToWide200 : INT;
\tlenToWide300 : INT;
\tlenBareWide300 : INT;
\tlenToNarrow300 : INT;
\tlenBareNarrow300 : INT;
END_VAR
FOR i := 0 TO 199 DO
\tn200[i] := 120;
END_FOR
n200[200] := 0;
FOR i := 0 TO 299 DO
\tn300[i] := 120;
\tw300[i] := 121;
END_FOR
n300[300] := 0;
w300[300] := 0;
toWide200 := STRING_TO_WSTRING(n200);
toWide300 := STRING_TO_WSTRING(n300);
bareWide300 := TO_WSTRING(n300);
toNarrow300 := WSTRING_TO_STRING(w300);
bareNarrow300 := TO_STRING(w300);
${lengths([["toWide200", "lenToWide200"], ["toWide300", "lenToWide300"], ["bareWide300", "lenBareWide300"], ["toNarrow300", "lenToNarrow300"], ["bareNarrow300", "lenBareNarrow300"]])}
END_FUNCTION_BLOCK
`) },

  // M5 Standard functions: CONCAT of two 150-unit STRING(200)s, and LEFT / RIGHT / MID / INSERT / DELETE / REPLACE / FIND /
  // LEN of a 300-unit STRING(300) ('x', with a 'Q' at [280]), each into a STRING(400) counted up to the first 0 (`lengths`) — a cut inside the
  // library body (255) reads as 255, none as the full length.
  whole("concat_result_capacity", "the capacity of CONCAT and the Standard string functions' results past 255 characters (transpile-restructure 3.1 M5)",
    `FUNCTION_BLOCK FB_LANG_concat_result_capacity
VAR
\ti : INT;
\tleft150 : STRING(200);
\tright150 : STRING(200);
\tsrc300 : STRING(300);
\tcat : STRING(400);
\tleftR : STRING(400);
\trightR : STRING(400);
\tmidR : STRING(400);
\tinsertR : STRING(400);
\tdeleteR : STRING(400);
\treplaceR : STRING(400);
\tlenCat : INT;
\tlenLeft : INT;
\tlenRight : INT;
\tlenMid : INT;
\tlenInsert : INT;
\tlenDelete : INT;
\tlenReplace : INT;
\tlenSrc : INT;
\tfindQ : INT;
\tlenCatStd : INT;
END_VAR
FOR i := 0 TO 149 DO
\tleft150[i] := 120;
\tright150[i] := 121;
END_FOR
left150[150] := 0;
right150[150] := 0;
FOR i := 0 TO 299 DO
\tsrc300[i] := 120;
END_FOR
src300[280] := 81;
src300[300] := 0;
cat := CONCAT(left150, right150);
leftR := LEFT(src300, 290);
rightR := RIGHT(src300, 290);
midR := MID(src300, 290, 2);
insertR := INSERT(src300, 'AB', 150);
deleteR := DELETE(src300, 2, 150);
replaceR := REPLACE(src300, 'AB', 2, 150);
findQ := FIND(src300, 'Q');
lenSrc := LEN(src300);
lenCatStd := LEN(cat);
${lengths([["cat", "lenCat"], ["leftR", "lenLeft"], ["rightR", "lenRight"], ["midR", "lenMid"], ["insertR", "lenInsert"], ["deleteR", "lenDelete"], ["replaceR", "lenReplace"]])}
END_FUNCTION_BLOCK
`),

  // The units behind a CONVERSION RESULT's terminator (gate 3a). The first M5 recording counted every non-zero unit of a
  // zero-initialised WSTRING(400) after `:= STRING_TO_WSTRING(n200)` and read 211, not 200: the store brought units from
  // behind the result's terminator. This keeps that observation: the units [199..262] of the same store into a zero
  // destination and into a 'Z'-filled one (and the WSTRING_TO_STRING twin), the non-zero count, and how many 'Z' survive
  // behind [262] — so whether the result is a buffer of its own capacity, and what sits in it, is read, not assumed. Dumps
  // are 16 units per array (`run-paths` reads at most 16 elements of one).
  { ...whole("string_conversion_result_tail", "the units behind the terminator of a STRING_TO_WSTRING / WSTRING_TO_STRING result, stored into a zero and a 'Z'-filled destination (transpile-restructure gate 3a)",
    `FUNCTION_BLOCK FB_LANG_string_conversion_result_tail
VAR
\ti : INT;
\tn200 : STRING(200);
\tw200 : WSTRING(200);
\tzeroWide : WSTRING(400);
\tzWide : WSTRING(400);
\tzNarrow : STRING(400);
${tailArrays("zeroWide", "WORD")}${tailArrays("zWide", "WORD")}${tailArrays("zNarrow", "BYTE")}\tzeroWideNonZero : INT;
\tzWideKept : INT;
\tzNarrowKept : INT;
END_VAR
FOR i := 0 TO 199 DO
\tn200[i] := 120;
\tw200[i] := 121;
END_FOR
n200[200] := 0;
w200[200] := 0;
FOR i := 0 TO 399 DO
\tzWide[i] := 90;
\tzNarrow[i] := 90;
END_FOR
zWide[400] := 0;
zNarrow[400] := 0;
zeroWide := STRING_TO_WSTRING(n200);
zWide := STRING_TO_WSTRING(n200);
zNarrow := WSTRING_TO_STRING(w200);
${tailDumps("zeroWide")}${tailDumps("zWide")}${tailDumps("zNarrow")}zeroWideNonZero := 0;
FOR i := 0 TO 400 DO
\tIF zeroWide[i] <> 0 THEN
\t\tzeroWideNonZero := zeroWideNonZero + 1;
\tEND_IF
END_FOR
zWideKept := 0;
zNarrowKept := 0;
FOR i := 263 TO 399 DO
\tIF zWide[i] = 90 THEN
\t\tzWideKept := zWideKept + 1;
\tEND_IF
\tIF zNarrow[i] = 90 THEN
\t\tzNarrowKept := zNarrowKept + 1;
\tEND_IF
END_FOR
END_FUNCTION_BLOCK
`), residue: [...tailPaths("zeroWide", 201, 254), ...tailPaths("zWide", 201, 254), ...tailPaths("zNarrow", 201, 254), "inst.zeroWideNonZero"] },

  // M2 from a FUNCTION RESULT (gate 3a): CONCAT, LEFT, a conversion and a user FUNCTION whose result holds 'efghij' behind
  // a 0 at [3], each stored into a 'Z'-filled STRING(20) and dumped [0..20] — sources M2's rule was not measured on.
  { ...whole("string_store_function_result_tail", "a string store whose source is a function result (CONCAT, LEFT, WSTRING_TO_STRING, a user FUNCTION) into a 'Z'-filled destination (transpile-restructure gate 3a)",
    `FUNCTION F_StrTail10 : STRING(10)
F_StrTail10 := 'abcdefghij';
F_StrTail10[3] := 0;
END_FUNCTION

FUNCTION_BLOCK FB_LANG_string_store_function_result_tail
VAR
\ti : INT;
\ta : STRING(10);
\tb : STRING(10);
\tsrc : STRING(10);
\tw : WSTRING(10);
\tdCat : STRING(20);
\tdLeft : STRING(20);
\tdUser : STRING(20);
\tdConv : STRING(20);
${dumpArrays(["cat", "left", "user", "conv"])}END_VAR
a := 'ab';
b := 'cd';
src := 'abcdefghij';
w := "abc";
dCat := 'ZZZZZZZZZZZZZZZZZZZZ';
dLeft := 'ZZZZZZZZZZZZZZZZZZZZ';
dUser := 'ZZZZZZZZZZZZZZZZZZZZ';
dConv := 'ZZZZZZZZZZZZZZZZZZZZ';
dCat := CONCAT(a, b);
dLeft := LEFT(src, 3);
dUser := F_StrTail10();
dConv := WSTRING_TO_STRING(w);
${dumps([["cat", "dCat"], ["left", "dLeft"], ["user", "dUser"], ["conv", "dConv"]])}END_FUNCTION_BLOCK
`), residue: [...dumpPaths("cat", 5, 19), ...dumpPaths("left", 4, 19), ...dumpPaths("conv", 4, 19)] },

  // M2 into other DESTINATIONS (gate 3a): an ARRAY element, a STRUCT member, a VAR_IN_OUT (the store inside a FUNCTION, both
  // sides by reference), an FB's VAR_INPUT (the call's pass is the store) and — gate 3c — an FB's VAR_OUTPUT STRING(10) copied
  // out by `=>` into a wider variable, each 'Z'-filled before and dumped [0..20]; the source holds 'efghij' behind a 0 at
  // [3]. No name is `s` or `st`: S and ST are IL operators CODESYS refuses as names.
  { ...whole("string_store_destination_kinds_tail", "a string store into an ARRAY element, a STRUCT member, a VAR_IN_OUT, an FB VAR_INPUT and an FB VAR_OUTPUT's => copy-out, each 'Z'-filled (transpile-restructure gate 3a, 3c)",
    `TYPE ST_StrTailHolder :
STRUCT
\ttext : STRING(20);
END_STRUCT
END_TYPE

FUNCTION F_StrTailInOut : BOOL
VAR_IN_OUT
\tdest : STRING(20);
\tsource : STRING(10);
END_VAR
dest := source;
F_StrTailInOut := TRUE;
END_FUNCTION

FUNCTION_BLOCK FB_StrTailIn
VAR_INPUT
\tp : STRING(20);
END_VAR
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_StrTailOut
VAR_OUTPUT
\to : STRING(10);
END_VAR
o := 'abcdefghij';
o[3] := 0;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_LANG_string_store_destination_kinds_tail
VAR
\ti : INT;
\tsrc : STRING(10);
\tarr : ARRAY[0..1] OF STRING(20);
\trec : ST_StrTailHolder;
\tviaInOut : STRING(20);
\tok : BOOL;
\tfbIn : FB_StrTailIn;
\tviaOut : STRING(20);
\tfbOut : FB_StrTailOut;
${dumpArrays(["arr", "rec", "inOut", "input", "out"])}END_VAR
src := 'abcdefghij';
src[3] := 0;
arr[0] := 'ZZZZZZZZZZZZZZZZZZZZ';
rec.text := 'ZZZZZZZZZZZZZZZZZZZZ';
viaInOut := 'ZZZZZZZZZZZZZZZZZZZZ';
fbIn.p := 'ZZZZZZZZZZZZZZZZZZZZ';
viaOut := 'ZZZZZZZZZZZZZZZZZZZZ';
arr[0] := src;
rec.text := src;
ok := F_StrTailInOut(dest := viaInOut, source := src);
fbIn(p := src);
fbOut(o => viaOut);
${dumps([["arr", "arr[0]"], ["rec", "rec.text"], ["inOut", "viaInOut"], ["input", "fbIn.p"], ["out", "viaOut"]])}END_FUNCTION_BLOCK
`), pouName: "FB_LANG_string_store_destination_kinds_tail", plcPrgVar: "inst : FB_LANG_string_store_destination_kinds_tail;" },
  // M2 into a FUNCTION's VAR_INPUT (transpile-restructure 3.6, design §3.2): the pass is a store into a STACK buffer with no
  // prior value of its own. The same FUNCTION is called twice — first with a 20-'Y' literal (`dirty*`), then with a STRING(10)
  // holding 'abc' + 0 + 'efghij' (`p*`) — and `p[0..20]` is dumped through `p[i]` into VAR_IN_OUT arrays each time.
  // RECORDED (CODESYS 3.5.21.40, 2026-10-08): `p` is 'abc' + 0 + 'efghij' + 0 at [0..10] — the pass is M2's store, eleven
  // units — and [11..19] are the units the FIRST call left in the same stack frame. Recorded twice with a 20-'Z' first call
  // (90, identical) and then, gate 3c, with a 20-'Y' one (89): the units FOLLOW the previous call, so they are a
  // carry-over of the function's frame. `string_input_tail_interleaved` (8.2) then showed the frame is the vendor's shared
  // stack — another call between the two overwrote part of it — so the model, which starts a function's VAR_INPUT at
  // zeros, diverges here by an accepted loss (design.md §7.2, `FUNCTION_FRAME_RESIDUE_DIVERGENCES`).
  { ...whole("string_store_function_input_tail", "a STRING(10) with units behind its terminator passed to a FUNCTION's VAR_INPUT STRING(20): what stands behind the stored units (transpile-restructure 3.6)",
    `FUNCTION F_StrTailInput : BOOL
VAR_INPUT
\tp : STRING(20);
END_VAR
VAR_IN_OUT
\tlo : ARRAY[0..15] OF BYTE;
\thi : ARRAY[16..20] OF BYTE;
END_VAR
VAR
\ti : INT;
END_VAR
FOR i := 0 TO 15 DO
\tlo[i] := p[i];
END_FOR
FOR i := 16 TO 20 DO
\thi[i] := p[i];
END_FOR
F_StrTailInput := TRUE;
END_FUNCTION

FUNCTION_BLOCK FB_LANG_string_store_function_input_tail
VAR
\tsrc : STRING(10);
\tokDirty : BOOL;
\tokP : BOOL;
${dumpArrays(["dirty", "p"])}END_VAR
src := 'abcdefghij';
src[3] := 0;
okDirty := F_StrTailInput(p := 'YYYYYYYYYYYYYYYYYYYY', lo := dirtyLo, hi := dirtyHi);
okP := F_StrTailInput(p := src, lo := pLo, hi := pHi);
END_FUNCTION_BLOCK
`), deferred: { transpile: FUNCTION_FRAME_RESIDUE_DIVERGENCES.string_store_function_input_tail } },

  // 3.8's two unmeasured neighbours of M5 (design §3.2 Decision step 3d), recorded before their rule is written.
  // SAME-width: TO_STRING of a STRING and TO_WSTRING of a WSTRING of 300, 255 and 100 units ('x' / 'y', filled by index),
  // each into a 400-unit destination and counted up to the first 0 (`lengths`) — the operand's own length means it is
  // kept, 255 the cross-width conversions' cut, 80 the default capacity. 100 and 255 separate 80 from "cut to 80 only
  // above 255" and "kept up to 255" (gate 3d review). RECORDED (CODESYS 3.5.21.40, 2026-10-08): 80 for all six — the
  // result is the named type at its default capacity, whatever the operand.
  whole("string_conversion_same_width_255", "a same-width TO_STRING / TO_WSTRING of a 300-, 255- and 100-unit operand: cut at 255, kept, or 80 (transpile-restructure 3.8)",
    `FUNCTION_BLOCK FB_LANG_string_conversion_same_width_255
VAR
\ti : INT;
\tn300 : STRING(300);
\tw300 : WSTRING(300);
\tnarrow : STRING(400);
\twide : WSTRING(400);
\tlenNarrow : INT;
\tlenWide : INT;
\tn100 : STRING(120);
\tw100 : WSTRING(120);
\tn255 : STRING(300);
\tw255 : WSTRING(300);
\tnarrow100 : STRING(400);
\twide100 : WSTRING(400);
\tnarrow255 : STRING(400);
\twide255 : WSTRING(400);
\tlenNarrow100 : INT;
\tlenWide100 : INT;
\tlenNarrow255 : INT;
\tlenWide255 : INT;
END_VAR
FOR i := 0 TO 299 DO
\tn300[i] := 120;
\tw300[i] := 121;
END_FOR
n300[300] := 0;
w300[300] := 0;
FOR i := 0 TO 99 DO
\tn100[i] := 120;
\tw100[i] := 121;
END_FOR
n100[100] := 0;
w100[100] := 0;
FOR i := 0 TO 254 DO
\tn255[i] := 120;
\tw255[i] := 121;
END_FOR
n255[255] := 0;
w255[255] := 0;
narrow := TO_STRING(n300);
wide := TO_WSTRING(w300);
narrow100 := TO_STRING(n100);
wide100 := TO_WSTRING(w100);
narrow255 := TO_STRING(n255);
wide255 := TO_WSTRING(w255);
${lengths([["narrow", "lenNarrow"], ["wide", "lenWide"], ["narrow100", "lenNarrow100"], ["wide100", "lenWide100"], ["narrow255", "lenNarrow255"], ["wide255", "lenWide255"]])}END_FUNCTION_BLOCK
`),

  // A string -> number PARSE of an operand longer than 255, as a STRING(300) and a WSTRING(300) filled by index, through
  // STRING_TO_INT / WSTRING_TO_INT and the bare TO_INT: 290 spaces then '5' (and 250 spaces then '5', inside 255) — a cut
  // at 255 parses only spaces (0), the operand's own capacity 5; and, separating the cut from "an operand longer than 255
  // parses 0" (gate 3d review), '5' then 290 spaces (narrow: a number wholly inside the first 255 units) and 253 spaces
  // then '12345' (a number across unit 255). `tr_11_string_conversion_beyond_80` measured 90 units. RECORDED (CODESYS
  // 3.5.21.40, 2026-10-08): 290 → 0, 250 → 5, '5' + 290 spaces → 5, 253 spaces + '12345' → 12 — the parse reads the first
  // 255 units. The WIDE '5' + 290 spaces is `wstring_parse_trailing_spaces`'s: a WSTRING parse refuses trailing spaces.
  whole("string_parse_beyond_255", "STRING_TO_INT / WSTRING_TO_INT / TO_INT of operands longer than 255 with the number before, across and after unit 255: does the parse cut at 255 (transpile-restructure 3.8)",
    `FUNCTION_BLOCK FB_LANG_string_parse_beyond_255
VAR
\ti : INT;
\tn290 : STRING(300);
\tw290 : WSTRING(300);
\tn250 : STRING(300);
\tw250 : WSTRING(300);
\tnamed290 : INT;
\tbare290 : INT;
\twideNamed290 : INT;
\twideBare290 : INT;
\tnamed250 : INT;
\tbare250 : INT;
\twideNamed250 : INT;
\twideBare250 : INT;
\tnLead : STRING(300);
\tnSpan : STRING(300);
\twSpan : WSTRING(300);
\tnamedLead : INT;
\tbareLead : INT;
\tnamedSpan : INT;
\tbareSpan : INT;
\twideNamedSpan : INT;
\twideBareSpan : INT;
END_VAR
FOR i := 0 TO 289 DO
\tn290[i] := 32;
\tw290[i] := 32;
END_FOR
n290[290] := 53;
w290[290] := 53;
n290[291] := 0;
w290[291] := 0;
FOR i := 0 TO 249 DO
\tn250[i] := 32;
\tw250[i] := 32;
END_FOR
n250[250] := 53;
w250[250] := 53;
n250[251] := 0;
w250[251] := 0;
named290 := STRING_TO_INT(n290);
bare290 := TO_INT(n290);
wideNamed290 := WSTRING_TO_INT(w290);
wideBare290 := TO_INT(w290);
named250 := STRING_TO_INT(n250);
bare250 := TO_INT(n250);
wideNamed250 := WSTRING_TO_INT(w250);
wideBare250 := TO_INT(w250);
nLead[0] := 53;
FOR i := 1 TO 290 DO
\tnLead[i] := 32;
END_FOR
nLead[291] := 0;
FOR i := 0 TO 252 DO
\tnSpan[i] := 32;
\twSpan[i] := 32;
END_FOR
nSpan[253] := 49;
wSpan[253] := 49;
nSpan[254] := 50;
wSpan[254] := 50;
nSpan[255] := 51;
wSpan[255] := 51;
nSpan[256] := 52;
wSpan[256] := 52;
nSpan[257] := 53;
wSpan[257] := 53;
nSpan[258] := 0;
wSpan[258] := 0;
namedLead := STRING_TO_INT(nLead);
bareLead := TO_INT(nLead);
namedSpan := STRING_TO_INT(nSpan);
bareSpan := TO_INT(nSpan);
wideNamedSpan := WSTRING_TO_INT(wSpan);
wideBareSpan := TO_INT(wSpan);
END_FUNCTION_BLOCK
`),

  // A WSTRING parse of a number followed by SPACES (found by string_parse_beyond_255's first wide '5' + 290 spaces, gate 3d
  // review): "5   " in a WSTRING(20), and '5' then 254 / 255 / 290 spaces in a WSTRING(300), through WSTRING_TO_INT and
  // TO_INT, beside the same "5   " as a STRING(20). RECORDED (CODESYS 3.5.21.40, 2026-10-08): every wide one parses 0,
  // the narrow one 5 — a WSTRING parse refuses trailing spaces where a STRING parse stops at them; inside 255 as much as
  // past it, so it is not the cut. `wstring_parse_grammar` (8.2) found the rule: a WSTRING parse answers only when it reads
  // the whole text (`semantics/parse.ts` `parseIntegerWide`).
  whole("wstring_parse_trailing_spaces", "WSTRING_TO_INT / TO_INT of a WSTRING number followed by spaces (\"5   \", '5' + 254/255/290 spaces) beside STRING_TO_INT of '5   ' (transpile-restructure 3.8)",
    `FUNCTION_BLOCK FB_LANG_wstring_parse_trailing_spaces
VAR
\ti : INT;
\tnTrail : STRING(20);
\twTrail : WSTRING(20);
\twLead : WSTRING(300);
\twLead255 : WSTRING(300);
\twLead256 : WSTRING(300);
\tnamedTrail : INT;
\twideNamedTrail : INT;
\twideBareTrail : INT;
\twideNamedLead : INT;
\twideBareLead : INT;
\twideNamedLead255 : INT;
\twideNamedLead256 : INT;
END_VAR
nTrail := '5   ';
wTrail := "5   ";
namedTrail := STRING_TO_INT(nTrail);
wideNamedTrail := WSTRING_TO_INT(wTrail);
wideBareTrail := TO_INT(wTrail);
wLead[0] := 53;
wLead255[0] := 53;
wLead256[0] := 53;
FOR i := 1 TO 290 DO
\twLead[i] := 32;
END_FOR
wLead[291] := 0;
FOR i := 1 TO 254 DO
\twLead255[i] := 32;
\twLead256[i] := 32;
END_FOR
wLead255[255] := 0;
wLead256[255] := 32;
wLead256[256] := 0;
wideNamedLead := WSTRING_TO_INT(wLead);
wideBareLead := TO_INT(wLead);
wideNamedLead255 := WSTRING_TO_INT(wLead255);
wideNamedLead256 := WSTRING_TO_INT(wLead256);
END_FUNCTION_BLOCK
`),

  // 3.10 (design §3.2 Decision step 3d): a WHOLE-string store through a POINTER TO STRING(20) aimed at a STRING(5) — through
  // a local pointer and through a FUNCTION's pointer input (a cursor) — of a STRING(10) 'abcdefghij'. The STRING(5) sits in
  // a STRUCT in front of a 'Z'-filled STRING(10); both are dumped through `[i]`, so a store cut at the variable's capacity
  // leaves the neighbour 'ZZZZZZZZZZ' and a store at the pointer's capacity writes into it. RECORDED (CODESYS 3.5.21.40,
  // 2026-10-08), both forms alike: `head` holds 'abcdef' in its six bytes (no terminator — its value is unreadable) and
  // `after` 'ghij' + 0, then 'Z' — eleven bytes written, past the variable. Lowering refuses it (`cursor-overrun`; the local
  // pointer is refused `pointer-type` before that).
  { ...whole("cursor_whole_store_capacity", "p^ := STRING(10) through a POINTER TO STRING(20) aimed at a STRING(5) in front of a 'Z'-filled neighbour, by a local pointer and a function's pointer input (transpile-restructure 3.10)",
    `TYPE ST_CursorStoreHolder :
STRUCT
\thead : STRING(5);
\tafter : STRING(10);
END_STRUCT
END_TYPE

FUNCTION F_CursorWholeStore : BOOL
VAR_INPUT
\tp : POINTER TO STRING(20);
\tsource : STRING(10);
END_VAR
p^ := source;
F_CursorWholeStore := TRUE;
END_FUNCTION

FUNCTION_BLOCK FB_LANG_cursor_whole_store_capacity
VAR
\ti : INT;
\tten : STRING(10);
\tviaLocal : ST_CursorStoreHolder;
\tviaInput : ST_CursorStoreHolder;
\tp : POINTER TO STRING(20);
\tok : BOOL;
\tlocalHead : ARRAY[0..5] OF BYTE;
\tlocalAfter : ARRAY[0..10] OF BYTE;
\tinputHead : ARRAY[0..5] OF BYTE;
\tinputAfter : ARRAY[0..10] OF BYTE;
END_VAR
ten := 'abcdefghij';
viaLocal.after := 'ZZZZZZZZZZ';
viaInput.after := 'ZZZZZZZZZZ';
p := ADR(viaLocal.head);
p^ := ten;
ok := F_CursorWholeStore(p := ADR(viaInput.head), source := ten);
FOR i := 0 TO 5 DO
\tlocalHead[i] := viaLocal.head[i];
\tinputHead[i] := viaInput.head[i];
END_FOR
FOR i := 0 TO 10 DO
\tlocalAfter[i] := viaLocal.after[i];
\tinputAfter[i] := viaInput.after[i];
END_FOR
END_FUNCTION_BLOCK
`), pouName: "FB_LANG_cursor_whole_store_capacity", plcPrgVar: "inst : FB_LANG_cursor_whole_store_capacity;" },

  // 7.4.6 gate 7.4c (review): a Standard string FUNCTION's STRING(255) VAR_INPUT is lent where it lies
  // (`lower/calls/string-inputs.ts`), so where the call READS its string is no longer where an input copy was taken. Each
  // call here has a later argument that changes the string: a FUNCTION writing it through its VAR_IN_OUT, a METHOD of the
  // FB writing it — and the last with its arguments named in reverse order, the METHOD written FIRST. The string is reset
  // before each; `txtAfter` is what the last call left.
  { ...whole("string_input_lent_later_call_changes", "a Standard string function given a variable a later argument's call changes: LEFT(txt, Cut(t := txt)), MID(txt, 2, Shrink()), CONCAT(txt, Grow()), MID(POS := Shrink(), STR := txt, LEN := 2) (transpile-restructure 7.4.6)",
    `FUNCTION F_LentLaterCut : INT
VAR_IN_OUT
	t : STRING(10);
END_VAR
t[1] := 0;
F_LentLaterCut := 3;
END_FUNCTION

FUNCTION_BLOCK FB_LANG_string_input_lent_later_call
VAR
	txt : STRING(10);
	viaFunction : STRING(255);
	viaMethodMid : STRING(255);
	viaMethodConcat : STRING(255);
	namedReversed : STRING(255);
	txtAfter : STRING(10);
END_VAR
txt := 'hello';
viaFunction := LEFT(txt, F_LentLaterCut(t := txt));
txt := 'hello';
viaMethodMid := MID(txt, 2, Shrink());
txt := 'hello';
viaMethodConcat := CONCAT(txt, Grow());
txt := 'hello';
namedReversed := MID(POS := Shrink(), STR := txt, LEN := 2);
txtAfter := txt;
END_FUNCTION_BLOCK

METHOD Shrink : INT
txt := 'x';
Shrink := 1;
END_METHOD

METHOD Grow : STRING(10)
txt := 'q';
Grow := 'Y';
END_METHOD
`), pouName: "FB_LANG_string_input_lent_later_call", plcPrgVar: "inst : FB_LANG_string_input_lent_later_call;" },

  // The same, the string a VAR_IN_OUT: a FUNCTION's, changed by another FUNCTION it is lent to in a later argument, and an
  // FB's, changed by a METHOD of that FB — the lent string is the CALLER's variable, read through the in-out.
  { ...whole("string_input_lent_inout_later_call", "a Standard string function given a STRING VAR_IN_OUT a later argument's call changes: MID(io, Cut(t := io), 1) in a FUNCTION, CONCAT(io, Get()) and MID(io, Shrink(), 1) in an FB (transpile-restructure 7.4.6)",
    `FUNCTION F_LentInoutCut : INT
VAR_IN_OUT
	t : STRING(10);
END_VAR
t := 'x';
F_LentInoutCut := 1;
END_FUNCTION

FUNCTION F_LentInoutMid : STRING(255)
VAR_IN_OUT
	io : STRING(10);
END_VAR
F_LentInoutMid := MID(io, F_LentInoutCut(t := io), 1);
END_FUNCTION

FUNCTION_BLOCK FB_LANG_string_input_lent_inout
VAR
	v : STRING(10);
	inner : FB_LentInoutInner;
	viaFunction : STRING(255);
	viaMethodConcat : STRING(255);
	viaMethodMid : STRING(255);
	vAfter : STRING(10);
END_VAR
v := 'abc';
viaFunction := F_LentInoutMid(io := v);
v := 'abc';
inner(mode := 0, io := v);
viaMethodConcat := inner.res;
v := 'abc';
inner(mode := 1, io := v);
viaMethodMid := inner.res;
vAfter := v;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_LentInoutInner
VAR_INPUT
	mode : INT;
END_VAR
VAR_OUTPUT
	res : STRING(255);
END_VAR
VAR_IN_OUT
	io : STRING(10);
END_VAR
IF mode = 0 THEN
	res := CONCAT(io, Get());
ELSE
	res := MID(io, Shrink(), 1);
END_IF
END_FUNCTION_BLOCK

METHOD Get : STRING(10)
io := 'x';
Get := 'Y';
END_METHOD

METHOD Shrink : INT
io := 'x';
Shrink := 1;
END_METHOD
`), pouName: "FB_LANG_string_input_lent_inout", plcPrgVar: "inst : FB_LANG_string_input_lent_inout;" },

  // A STRING(12) bound to a VAR_IN_OUT STRING(10) — the in-out is bound at its CALLER's capacity, wider than the one it
  // declares — handed on to LEN, to LEFT for more than 10 units, and lent with a later argument's call on the in-out
  // (taken where it is written).
  { ...whole("string_input_lent_inout_wider", "a STRING(12) bound to a VAR_IN_OUT STRING(10), then LEN(io), LEFT(io, 20), CONCAT(io, INT_TO_STRING(Touch(t := io))) (transpile-restructure 7.4.6)",
    `FUNCTION F_LentWiderLen : INT
VAR_IN_OUT
\tio : STRING(10);
END_VAR
F_LentWiderLen := LEN(io);
END_FUNCTION

FUNCTION F_LentWiderLeft : STRING(255)
VAR_IN_OUT
\tio : STRING(10);
END_VAR
F_LentWiderLeft := LEFT(io, 20);
END_FUNCTION

FUNCTION F_LentWiderTouch : INT
VAR_IN_OUT
\tt : STRING(10);
END_VAR
F_LentWiderTouch := 1;
END_FUNCTION

FUNCTION F_LentWiderFrozen : STRING(255)
VAR_IN_OUT
\tio : STRING(10);
END_VAR
F_LentWiderFrozen := CONCAT(io, INT_TO_STRING(F_LentWiderTouch(t := io)));
END_FUNCTION

FUNCTION_BLOCK FB_LANG_string_input_lent_inout_wider
VAR
\tv : STRING(12) := 'abcdefghijkl';
\tlength : INT;
\tleft20 : STRING(255);
\tfrozen : STRING(255);
END_VAR
length := F_LentWiderLen(io := v);
left20 := F_LentWiderLeft(io := v);
frozen := F_LentWiderFrozen(io := v);
END_FUNCTION_BLOCK
`), pouName: "FB_LANG_string_input_lent_inout_wider", plcPrgVar: "inst : FB_LANG_string_input_lent_inout_wider;" },

  // Found beside 7.4.6 (gate 7.4c), a question of its own: a STRING VAR_IN_OUT bound at a WIDER capacity than it declares,
  // read without a Standard function — a unit past the declared capacity through a runtime index (`io[k]`, k = 11)…
  // (both answered by the one model of design.md §7.2 Decision (step 8e), `lower/calls/string-inouts.ts`: the caller's buffer
  // seen through the declared capacity — marked `niche: accepted loss` by the 7.4c gate, confirmed since step 8e)
  { ...whole("string_inout_wider_unit_read", "a STRING(12) bound to a VAR_IN_OUT STRING(10), its unit 11 read through a runtime index",
    `FUNCTION F_WiderUnit : BYTE
VAR_INPUT
\tk : INT;
END_VAR
VAR_IN_OUT
\tio : STRING(10);
END_VAR
F_WiderUnit := io[k];
END_FUNCTION

FUNCTION_BLOCK FB_LANG_string_inout_wider_unit_read
VAR
\tv : STRING(12) := 'abcdefghijkl';
\tk : INT := 11;
\tunit11 : BYTE;
END_VAR
unit11 := F_WiderUnit(k := k, io := v);
END_FUNCTION_BLOCK
`), pouName: "FB_LANG_string_inout_wider_unit_read", plcPrgVar: "inst : FB_LANG_string_inout_wider_unit_read;" },

  // …and copied whole: into a project FUNCTION's STRING(255) VAR_INPUT, and stored into a local STRING(20).
  { ...whole("string_inout_wider_copies", "a STRING(12) bound to a VAR_IN_OUT STRING(10), copied into a project FUNCTION's STRING(255) VAR_INPUT and stored into a STRING(20)",
    `FUNCTION F_WiderInputLen : INT
VAR_INPUT
\ttext : STRING(255);
END_VAR
F_WiderInputLen := LEN(text);
END_FUNCTION

FUNCTION F_WiderPassOn : INT
VAR_IN_OUT
\tio : STRING(10);
END_VAR
F_WiderPassOn := F_WiderInputLen(text := io);
END_FUNCTION

FUNCTION F_WiderStored : STRING(20)
VAR_IN_OUT
\tio : STRING(10);
END_VAR
VAR
\tlocal : STRING(20);
END_VAR
local := io;
F_WiderStored := local;
END_FUNCTION

FUNCTION_BLOCK FB_LANG_string_inout_wider_copies
VAR
\tv : STRING(12) := 'abcdefghijkl';
\tviaInput : INT;
\tstored : STRING(20);
END_VAR
viaInput := F_WiderPassOn(io := v);
stored := F_WiderStored(io := v);
END_FUNCTION_BLOCK
`), pouName: "FB_LANG_string_inout_wider_copies", plcPrgVar: "inst : FB_LANG_string_inout_wider_copies;" },
  // transpile-restructure 8.2 (step 8e, review R10: the two 7.4c marks above) — the rest of what a STRING VAR_IN_OUT bound
  // at a WIDER capacity than it declares does, asked before one model is written for both backends: stored whole (a
  // 15-unit literal, a 2-unit one, a STRING(20) variable), a unit past its declared capacity written through a runtime
  // index, compared whole, measured by SIZEOF, and passed on to another FUNCTION's STRING(10) in-out that reads its unit 11.
  // The caller reads back each buffer — its visible text and the units behind it (`[10]`, `[11]`, `[2]`, `[3]`) by index.
  // (Passing it on to a STRING(12) in-out does not build: "String variable 'io' too short for the VAR_IN_OUT parameter
  // 'io' of 'F_…'" — CODESYS judges the in-out by the capacity it DECLARES, as `string_inout_narrower_*` below.)
  whole("string_inout_wider_stores", "a STRING(12) bound to a VAR_IN_OUT STRING(10): stored whole three ways, a unit past 10 written, compared, SIZEOF, passed on to a STRING(10) in-out that reads unit 11 (transpile-restructure 8.2, R10)",
    `FUNCTION F_InoutWiderStoreLong : BOOL
VAR_IN_OUT
\tio : STRING(10);
END_VAR
io := 'XYZXYZXYZXYZXYZ';
F_InoutWiderStoreLong := TRUE;
END_FUNCTION

FUNCTION F_InoutWiderStoreShort : BOOL
VAR_IN_OUT
\tio : STRING(10);
END_VAR
io := 'pq';
F_InoutWiderStoreShort := TRUE;
END_FUNCTION

FUNCTION F_InoutWiderStoreVar : BOOL
VAR_INPUT
\tsrc : STRING(20);
END_VAR
VAR_IN_OUT
\tio : STRING(10);
END_VAR
io := src;
F_InoutWiderStoreVar := TRUE;
END_FUNCTION

FUNCTION F_InoutWiderSetUnit : BOOL
VAR_INPUT
\tk : INT;
END_VAR
VAR_IN_OUT
\tio : STRING(10);
END_VAR
io[k] := 81;
F_InoutWiderSetUnit := TRUE;
END_FUNCTION

FUNCTION F_InoutWiderEquals : BOOL
VAR_IN_OUT
\tio : STRING(10);
END_VAR
F_InoutWiderEquals := io = 'abcdefghij';
END_FUNCTION

FUNCTION F_InoutWiderSize : DINT
VAR_IN_OUT
\tio : STRING(10);
END_VAR
F_InoutWiderSize := SIZEOF(io);
END_FUNCTION

FUNCTION F_InoutWiderInnerUnit : BYTE
VAR_INPUT
\tk : INT;
END_VAR
VAR_IN_OUT
\tio : STRING(10);
END_VAR
F_InoutWiderInnerUnit := io[k];
END_FUNCTION

FUNCTION F_InoutWiderPassOn : BYTE
VAR_INPUT
\tk : INT;
END_VAR
VAR_IN_OUT
\tio : STRING(10);
END_VAR
F_InoutWiderPassOn := F_InoutWiderInnerUnit(k := k, io := io);
END_FUNCTION

FUNCTION_BLOCK FB_LANG_string_inout_wider_stores
VAR
\tlong : STRING(12) := 'abcdefghijkl';
\tshort : STRING(12) := 'abcdefghijkl';
\tfromVar : STRING(12) := 'abcdefghijkl';
\tsrc : STRING(20) := 'ABCDEFGHIJKLMNOPQRST';
\tunitSet : STRING(12) := 'abcdefghijkl';
\tread : STRING(12) := 'abcdefghijkl';
\tk : INT := 11;
\tlong10 : BYTE;
\tlong11 : BYTE;
\tshort2 : BYTE;
\tshort3 : BYTE;
\tfromVar10 : BYTE;
\tfromVar11 : BYTE;
\tequal : BOOL;
\tsize : DINT;
\tpassedOn : BYTE;
\tok : BOOL;
END_VAR
ok := F_InoutWiderStoreLong(io := long);
ok := F_InoutWiderStoreShort(io := short);
ok := F_InoutWiderStoreVar(src := src, io := fromVar);
ok := F_InoutWiderSetUnit(k := k, io := unitSet);
equal := F_InoutWiderEquals(io := read);
size := F_InoutWiderSize(io := read);
passedOn := F_InoutWiderPassOn(k := k, io := read);
long10 := long[10];
long11 := long[11];
short2 := short[2];
short3 := short[3];
fromVar10 := fromVar[10];
fromVar11 := fromVar[11];
END_FUNCTION_BLOCK
`),

  // …and read whole other than by a copy: `string_inout_wider_stores` recorded `io = 'abcdefghij'` FALSE — a comparison
  // reads the caller's 12 units in place, where every COPY (a store, an input, a result) takes the declared 10. So each
  // other whole read is asked which it is: two more comparisons, a conversion to an integer (12 digits: in place they
  // overflow a DINT, cut they do not) and to a WSTRING, MOVE, and SEL.
  whole("string_inout_wider_reads", "a STRING(12) bound to a VAR_IN_OUT STRING(10), read whole by > and <>, STRING_TO_LINT, STRING_TO_WSTRING, MOVE and SEL (transpile-restructure 8.2, R10)",
    `FUNCTION F_InoutWiderGreater : BOOL
VAR_IN_OUT
\tio : STRING(10);
END_VAR
F_InoutWiderGreater := io > 'abcdefghij';
END_FUNCTION

FUNCTION F_InoutWiderDiffers : BOOL
VAR_IN_OUT
\tio : STRING(10);
END_VAR
F_InoutWiderDiffers := io <> 'abcdefghij';
END_FUNCTION

FUNCTION F_InoutWiderToLint : LINT
VAR_IN_OUT
\tio : STRING(10);
END_VAR
F_InoutWiderToLint := STRING_TO_LINT(io);
END_FUNCTION

FUNCTION F_InoutWiderToWide : WSTRING(20)
VAR_IN_OUT
\tio : STRING(10);
END_VAR
F_InoutWiderToWide := STRING_TO_WSTRING(io);
END_FUNCTION

FUNCTION F_InoutWiderMoved : STRING(20)
VAR_IN_OUT
\tio : STRING(10);
END_VAR
F_InoutWiderMoved := MOVE(io);
END_FUNCTION

FUNCTION F_InoutWiderSelected : STRING(20)
VAR_INPUT
\tg : BOOL;
END_VAR
VAR_IN_OUT
\tio : STRING(10);
END_VAR
F_InoutWiderSelected := SEL(g, 'x', io);
END_FUNCTION

FUNCTION_BLOCK FB_LANG_string_inout_wider_reads
VAR
\tv : STRING(12) := 'abcdefghijkl';
\tdigits : STRING(12) := '123456789012';
\tg : BOOL := TRUE;
\tgreater : BOOL;
\tdiffers : BOOL;
\tasLint : LINT;
\tasWide : WSTRING(20);
\tmoved : STRING(20);
\tselected : STRING(20);
END_VAR
greater := F_InoutWiderGreater(io := v);
differs := F_InoutWiderDiffers(io := v);
asLint := F_InoutWiderToLint(io := digits);
asWide := F_InoutWiderToWide(io := v);
moved := F_InoutWiderMoved(io := v);
selected := F_InoutWiderSelected(g := g, io := v);
END_FUNCTION_BLOCK
`),

  // …and its WSTRING twin: a WSTRING(12) bound to a VAR_IN_OUT WSTRING(10) — its unit 11 read through a runtime index,
  // copied whole into a WSTRING(20), and stored whole (a 15-unit literal), the caller reading back units 10 and 11.
  whole("wstring_inout_wider", "a WSTRING(12) bound to a VAR_IN_OUT WSTRING(10): unit 11 read, copied whole into a WSTRING(20), stored whole from 15 units (transpile-restructure 8.2, R10)",
    `FUNCTION F_InoutWiderWideUnit : WORD
VAR_INPUT
\tk : INT;
END_VAR
VAR_IN_OUT
\tio : WSTRING(10);
END_VAR
F_InoutWiderWideUnit := io[k];
END_FUNCTION

FUNCTION F_InoutWiderWideCopy : WSTRING(20)
VAR_IN_OUT
\tio : WSTRING(10);
END_VAR
F_InoutWiderWideCopy := io;
END_FUNCTION

FUNCTION F_InoutWiderWideStore : BOOL
VAR_IN_OUT
\tio : WSTRING(10);
END_VAR
io := "XYZXYZXYZXYZXYZ";
F_InoutWiderWideStore := TRUE;
END_FUNCTION

FUNCTION_BLOCK FB_LANG_wstring_inout_wider
VAR
\tv : WSTRING(12) := "abcdefghijkl";
\tstored : WSTRING(12) := "abcdefghijkl";
\tk : INT := 11;
\tunit11 : WORD;
\tcopied : WSTRING(20);
\tstored10 : WORD;
\tstored11 : WORD;
\tok : BOOL;
END_VAR
unit11 := F_InoutWiderWideUnit(k := k, io := v);
copied := F_InoutWiderWideCopy(io := v);
ok := F_InoutWiderWideStore(io := stored);
stored10 := stored[10];
stored11 := stored[11];
END_FUNCTION_BLOCK
`),

  // …and bound at a NARROWER capacity — a STRING(4) variable to a VAR_IN_OUT STRING(10), and a STRING(10) in-out passed on
  // to one that declares STRING(12). RECORDED (CODESYS 3.5.21.40, 2026-10-11): neither builds — "String variable 'v' too
  // short for the VAR_IN_OUT parameter 'io' of 'F_InoutNarrowerCopy'" — so a STRING in-out is only ever bound at its
  // declared capacity or wider, and the transpiler is never asked the narrower one (it is outside its input contract).
  whole("string_inout_narrower", "a STRING(4) bound to a VAR_IN_OUT STRING(10), and a STRING(10) in-out passed on to a STRING(12) one: refused (transpile-restructure 8.2, R10)",
    `FUNCTION F_InoutNarrowerCopy : STRING(20)
VAR_IN_OUT
\tio : STRING(10);
END_VAR
F_InoutNarrowerCopy := io;
END_FUNCTION

FUNCTION F_InoutNarrowerInner : STRING(20)
VAR_IN_OUT
\tio : STRING(12);
END_VAR
F_InoutNarrowerInner := io;
END_FUNCTION

FUNCTION F_InoutNarrowerPassOn : STRING(20)
VAR_IN_OUT
\tio : STRING(10);
END_VAR
F_InoutNarrowerPassOn := F_InoutNarrowerInner(io := io);
END_FUNCTION

FUNCTION_BLOCK FB_LANG_string_inout_narrower
VAR
\tv : STRING(4) := 'abcd';
\tw : STRING(10) := 'abcdefghij';
\tcopied : STRING(20);
\tpassed : STRING(20);
END_VAR
copied := F_InoutNarrowerCopy(io := v);
passed := F_InoutNarrowerPassOn(io := w);
END_FUNCTION_BLOCK
`),

  // …and its WSTRING twin: a WSTRING(4) bound to a VAR_IN_OUT WSTRING(10), stored into whole.
  whole("wstring_inout_narrower", "a WSTRING(4) bound to a VAR_IN_OUT WSTRING(10), stored into whole (transpile-restructure 8.2, R10)",
    `FUNCTION F_InoutNarrowerWide : BOOL
VAR_IN_OUT
\tio : WSTRING(10);
END_VAR
io := "zz";
F_InoutNarrowerWide := TRUE;
END_FUNCTION

FUNCTION_BLOCK FB_LANG_wstring_inout_narrower
VAR
\tw : WSTRING(4) := "ab";
\tok : BOOL;
END_VAR
ok := F_InoutNarrowerWide(io := w);
END_FUNCTION_BLOCK
`),

  // transpile-restructure 8.2 (design.md §7.2 Decision step 8c), recorded before the wide parse is written: the WIDE twin
  // of every STRING → integer cell `semantics/parse.cases.ts` holds (the `tr_a10_*` forms, edges and signs), plain decimals
  // with a sign, a space, a tab or a letter before or after them, an empty text, into a DINT (no width cuts); and the REAL
  // parse's cells (`string_to_real_parse`) with a trailing space, tab or letter, into a REAL, beside two STRING twins.
  // RECORDED (CODESYS 3.5.21.40, record:exec 2026-10-11): into a DINT a WSTRING reads what a STRING reads, and answers it
  // only when that is the WHOLE text ('12abc', '1 0', '5 ', '16#1FZ', '8#19', '-16#F' are 0) — `semantics/parse.ts`
  // `parseIntegerWide`, the cells `parse.cases.ts` `WIDE_PARSE_INT_CASES`; into a REAL it reads the STRING's prefix ("1.5x" 1.5).
  whole("wstring_parse_grammar", "WSTRING_TO_DINT and WSTRING_TO_REAL over every recorded STRING parse form, plus trailing space / tab / letter (transpile-restructure 8.2)",
    `FUNCTION_BLOCK FB_LANG_wstring_parse_grammar
VAR
${WIDE_PARSE_INT.map(([n, text]) => `\tw${n} : WSTRING := "${text}";\n\td${n} : DINT;\n`).join("")}${WIDE_PARSE_REAL.map(([n, text]) => `\tw${n} : WSTRING := "${text}";\n\tr${n} : REAL;\n`).join("")}\tnTrailSpaceR : STRING := '1.5 ';
\tnTrailLetterR : STRING := '1.5x';
\trNarrowTrailSpace : REAL;
\trNarrowTrailLetter : REAL;
END_VAR
${WIDE_PARSE_INT.map(([n]) => `d${n} := WSTRING_TO_DINT(w${n});\n`).join("")}${WIDE_PARSE_REAL.map(([n]) => `r${n} := WSTRING_TO_REAL(w${n});\n`).join("")}rNarrowTrailSpace := STRING_TO_REAL(nTrailSpaceR);
rNarrowTrailLetter := STRING_TO_REAL(nTrailLetterR);
END_FUNCTION_BLOCK
`),

  // gate 8c (review of step 8c): `wstring_parse_grammar` recorded the wide parse into a DINT only. Into every other integer
  // type, and for texts past 32 / 64 bits or negative into an unsigned type, the answer is asked here — the WSTRING and the
  // STRING parse of the same text side by side — before lowering answers it.
  whole("wstring_parse_widths", "WSTRING_TO_<every integer type> beside STRING_TO_<type> of texts past 32 and 64 bits, negative, and past INT / SINT (transpile-restructure 8.2, gate 8c)",
    `FUNCTION_BLOCK FB_LANG_wstring_parse_widths
VAR
${WIDE_WIDTH_TEXTS.map(([n, text]) => `\tw${n} : WSTRING := "${text}";\n\ts${n} : STRING := '${text}';\n`).join("")}${WIDE_WIDTH_TEXTS.flatMap(([n]) => WIDE_WIDTH_TYPES.map((t) => `\twide${n}${t} : ${t};\n\tnarrow${n}${t} : ${t};\n`)).join("")}END_VAR
${WIDE_WIDTH_TEXTS.flatMap(([n]) => WIDE_WIDTH_TYPES.map((t) => `wide${n}${t} := WSTRING_TO_${t}(w${n});\nnarrow${n}${t} := STRING_TO_${t}(s${n});\n`)).join("")}END_FUNCTION_BLOCK
`),

  // transpile-restructure 8.2 (design.md §7.2 Decision step 8c): whose units stand behind a FUNCTION's STRING input's
  // terminator (`string_store_function_input_tail`: the previous call's 'Y')? F is called with 20 'Y', then G — another
  // FUNCTION, called from the same body at the same depth, whose local 256 bytes it fills with 'Q' (81) — then F with a
  // STRING(10) 'abc' + 0 + 'efghij'. 'Y' behind the pass says F's input buffer persists per function; 'Q' that it is the
  // vendor's shared stack, which G's frame overwrote. RECORDED (CODESYS 3.5.21.40, 2026-10-11): neither — 'Y' at p[11..15]
  // and an address's bytes at p[16..20] (176, 250, 63, 25, 178: stack residue, `residue`), which G's frame wrote: the stack,
  // so a named loss (design.md §7.2, `FUNCTION_FRAME_RESIDUE_DIVERGENCES`).
  { ...whole("string_input_tail_interleaved", "a FUNCTION's VAR_INPUT STRING(20) passed 20 'Y', then another FUNCTION filling 256 local bytes with 'Q', then the first passed a short STRING: what stands behind the stored units (transpile-restructure 8.2)",
    `FUNCTION F_StrTailInter : BOOL
VAR_INPUT
\tp : STRING(20);
END_VAR
VAR_IN_OUT
\tlo : ARRAY[0..15] OF BYTE;
\thi : ARRAY[16..20] OF BYTE;
END_VAR
VAR
\ti : INT;
END_VAR
FOR i := 0 TO 15 DO
\tlo[i] := p[i];
END_FOR
FOR i := 16 TO 20 DO
\thi[i] := p[i];
END_FOR
F_StrTailInter := TRUE;
END_FUNCTION

FUNCTION G_StrTailQ : BOOL
VAR
\tq : ARRAY[0..255] OF BYTE;
\ti : INT;
END_VAR
FOR i := 0 TO 255 DO
\tq[i] := 81;
END_FOR
G_StrTailQ := q[255] = 81;
END_FUNCTION

FUNCTION_BLOCK FB_LANG_string_input_tail_interleaved
VAR
\tsrc : STRING(10);
\tokDirty : BOOL;
\tokQ : BOOL;
\tokP : BOOL;
${dumpArrays(["dirty", "p"])}END_VAR
src := 'abcdefghij';
src[3] := 0;
okDirty := F_StrTailInter(p := 'YYYYYYYYYYYYYYYYYYYY', lo := dirtyLo, hi := dirtyHi);
okQ := G_StrTailQ();
okP := F_StrTailInter(p := src, lo := pLo, hi := pHi);
END_FUNCTION_BLOCK
`), pouName: "FB_LANG_string_input_tail_interleaved", plcPrgVar: "inst : FB_LANG_string_input_tail_interleaved;",
    residue: dumpPaths("pHi", 16, 20), deferred: { transpile: FUNCTION_FRAME_RESIDUE_DIVERGENCES.string_input_tail_interleaved } },
]
