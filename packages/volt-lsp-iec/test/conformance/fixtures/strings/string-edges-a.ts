/**
 * the fixtures of `string-edges.ts` — part A.
 *
 * One slice of `string-edges.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { LanguageTest } from "../../types.js"
import { lengths, tailArrays, tailDumps, tailPaths, whole } from "./string-edges-shared.js"

export const STRING_MODEL_TESTS_A: readonly LanguageTest[] = [
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
]
