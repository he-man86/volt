/**
 * the fixtures of `string-edges.ts` — part B.
 *
 * One slice of `string-edges.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import { FUNCTION_FRAME_RESIDUE_DIVERGENCES } from "../../support/divergences-transpile.js"
import type { LanguageTest } from "../../types.js"
import { dumpArrays, dumpPaths, dumps, lengths, whole } from "./string-edges-shared.js"

export const STRING_MODEL_TESTS_B: readonly LanguageTest[] = [
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
]
