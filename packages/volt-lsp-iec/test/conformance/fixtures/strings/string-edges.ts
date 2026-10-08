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

export const STRING_MODEL_TESTS: readonly LanguageTest[] = [
  // M1: the bytes behind a $00 inside a literal. RC 45's LIVE run reported c3 = uc3 = 99 for `STRING(3) := 'ab$00c'`; the
  // committed `tr_45_string_embedded_nul` recording says 0. `three` re-asks that cell exactly; `lit`/`bare` ask it where the
  // capacity holds the whole literal (an initializer), `assigned` where the literal is STORED at run time, `copy` whether an
  // assignment carries the bytes behind the NUL, `wideCopy` the same out of the STRING(3).
  { ...whole("string_literal_nul_tail", "the bytes behind a $00 inside a STRING literal: initializer, run-time store and copy (transpile-restructure 3.1 M1)",
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
`), deferred: { transpile: "2026-10-08 (transpile-restructure 3.1 M1): a string store writes the SOURCE's units — up to the destination's capacity, then the terminator — and leaves the destination's units behind them as they were; both backends rebuild the destination from zeros, so the 'Z' (90) filler CODESYS keeps behind the copy reads 0. Model 2 (§3.2), task 3.6. The literal is a source of its own length: 'ab$00cd' over 'ZZZZZZZZZZ' writes six bytes (the NUL inside it and its terminator among them) and keeps 'ZZZZ' at [6..9]; a STRING(3) copied into a STRING(10) writes four and keeps 'Z' from [4]." } },

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
  { ...whole("string_assign_tail_wide", "STRING(20) := STRING(10) whose bytes behind the terminator are not 0 (transpile-restructure 3.1 M2)",
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
`), deferred: { transpile: "2026-10-08 (transpile-restructure 3.1 M2): a string store writes the SOURCE's units — up to the destination's capacity, then the terminator — and leaves the destination's units behind them as they were; both backends rebuild the destination from zeros, so the 'Z' (90) filler CODESYS keeps behind the copy reads 0. Model 2 (§3.2), task 3.6. STRING(20) := STRING(10) writes the source's eleven bytes ([4..9] 'efghij' behind its 0 included) and keeps 'Z' at [11..19]." } },

  // M3: the WSTRING twins of M1 and M2 — units are WORDs, the escape is four hex digits, the filler "Z" is 90. The literal
  // twin asks every cell the STRING one does: the sizeless `bare` and the three lengths too (counted to the first 0 by
  // `lengths` — LEN takes a STRING).
  { ...whole("wstring_literal_nul_tail", "the units behind a $0000 inside a WSTRING literal: initializer, run-time store and copy (transpile-restructure 3.1 M3)",
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
`), deferred: { transpile: "2026-10-08 (transpile-restructure 3.1 M3): a string store writes the SOURCE's units — up to the destination's capacity, then the terminator — and leaves the destination's units behind them as they were; both backends rebuild the destination from zeros, so the 'Z' (90) filler CODESYS keeps behind the copy reads 0. Model 2 (§3.2), task 3.6. The WSTRING twin of string_literal_nul_tail, unit for unit." } },

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

  { ...whole("wstring_assign_tail_wide", "WSTRING(20) := WSTRING(10) whose units behind the terminator are not 0 (transpile-restructure 3.1 M3)",
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
`), deferred: { transpile: "2026-10-08 (transpile-restructure 3.1 M3): a string store writes the SOURCE's units — up to the destination's capacity, then the terminator — and leaves the destination's units behind them as they were; both backends rebuild the destination from zeros, so the 'Z' (90) filler CODESYS keeps behind the copy reads 0. Model 2 (§3.2), task 3.6. The WSTRING twin of string_assign_tail_wide, unit for unit." } },

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
`), deferred: { transpile: "2026-10-08 (transpile-restructure 3.1 M5): CODESYS cuts a STRING<->WSTRING conversion result at 255 units — 300 in, 255 out, named (STRING_TO_WSTRING, WSTRING_TO_STRING) and bare (TO_WSTRING, TO_STRING) alike; 200 in is 200 out. The lowering sizes the result by its source (RC 11's fix) and gives 300. Model 2 (§3.2), task 3.8." } },

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
`), residue: [...tailPaths("zeroWide", 201, 254), ...tailPaths("zWide", 201, 254), ...tailPaths("zNarrow", 201, 254), "inst.zeroWideNonZero"], deferred: { transpile: "2026-10-08 (transpile-restructure gate 3a): a string store writes the SOURCE's units — up to the destination's capacity, then the terminator — and leaves the destination's units behind them as they were; both backends rebuild the destination from zeros, so the 'Z' (90) filler CODESYS keeps behind the copy reads 0. Model 2 (§3.2), task 3.6. A conversion's result is a 255-unit buffer: the store into a WSTRING(400) / STRING(400) writes 255 units (the 200 converted, the terminator at [200], residue at [201..254] — `residue`, different on every run) and its own terminator at [255], and keeps 'Z' from [256] (137 kept in [263..399]). Task 3.8 too: a result sized by its source (200, RC 11's fix) would keep 'Z' from [201]." } },

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
`), residue: [...dumpPaths("cat", 5, 19), ...dumpPaths("left", 4, 19), ...dumpPaths("conv", 4, 19)], deferred: { transpile: "2026-10-08 (transpile-restructure gate 3a): a string store writes the SOURCE's units — up to the destination's capacity, then the terminator — and leaves the destination's units behind them as they were; both backends rebuild the destination from zeros, so the 'Z' (90) filler CODESYS keeps behind the copy reads 0. Model 2 (§3.2), task 3.6. The user FUNCTION's STRING(10) result carries its eleven bytes ('efghij' behind its 0 included) and keeps 'Z' at [11..19]. CONCAT, LEFT and WSTRING_TO_STRING return a 255-unit buffer, so their store writes all 20 units and the terminator at [20] — residue behind the result's own terminator (`residue`, different on every run), no 'Z' kept." } },

  // M2 into other DESTINATIONS (gate 3a): an ARRAY element, a STRUCT member, a VAR_IN_OUT (the store inside a FUNCTION, both
  // sides by reference) and an FB's VAR_INPUT (the call's pass is the store), each 'Z'-filled before and dumped [0..20];
  // the source holds 'efghij' behind a 0 at [3]. No name is `s` or `st`: S and ST are IL operators CODESYS refuses as names.
  { ...whole("string_store_destination_kinds_tail", "a string store into an ARRAY element, a STRUCT member, a VAR_IN_OUT and an FB VAR_INPUT, each 'Z'-filled (transpile-restructure gate 3a)",
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

FUNCTION_BLOCK FB_LANG_string_store_destination_kinds_tail
VAR
\ti : INT;
\tsrc : STRING(10);
\tarr : ARRAY[0..1] OF STRING(20);
\trec : ST_StrTailHolder;
\tviaInOut : STRING(20);
\tok : BOOL;
\tfbIn : FB_StrTailIn;
${dumpArrays(["arr", "rec", "inOut", "input"])}END_VAR
src := 'abcdefghij';
src[3] := 0;
arr[0] := 'ZZZZZZZZZZZZZZZZZZZZ';
rec.text := 'ZZZZZZZZZZZZZZZZZZZZ';
viaInOut := 'ZZZZZZZZZZZZZZZZZZZZ';
fbIn.p := 'ZZZZZZZZZZZZZZZZZZZZ';
arr[0] := src;
rec.text := src;
ok := F_StrTailInOut(dest := viaInOut, source := src);
fbIn(p := src);
${dumps([["arr", "arr[0]"], ["rec", "rec.text"], ["inOut", "viaInOut"], ["input", "fbIn.p"]])}END_FUNCTION_BLOCK
`), pouName: "FB_LANG_string_store_destination_kinds_tail", plcPrgVar: "inst : FB_LANG_string_store_destination_kinds_tail;", deferred: { transpile: "2026-10-08 (transpile-restructure gate 3a): a string store writes the SOURCE's units — up to the destination's capacity, then the terminator — and leaves the destination's units behind them as they were; both backends rebuild the destination from zeros, so the 'Z' (90) filler CODESYS keeps behind the copy reads 0. Model 2 (§3.2), task 3.6. An ARRAY element, a STRUCT member, a VAR_IN_OUT and an FB VAR_INPUT each take the source's eleven bytes ('efghij' behind its 0 included) and keep 'Z' at [11..19], as a plain variable does (M2)." } },
]
