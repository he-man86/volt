/**
 * THE STANDARD STRING FUNCTIONS AT THEIR EDGES — position 0, position past the end, a negative count, an empty
 * string, and a result too long for where it is going.
 *
 * `ir/values.ts` states the rules and sources them from `string_*` and `string_positions_*`: positions are
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
