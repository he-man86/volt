/**
 * the fixtures of `string-edges.ts` — part D.
 *
 * One slice of `string-edges.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import { FUNCTION_FRAME_RESIDUE_DIVERGENCES } from "../../support/divergences-transpile.js"
import type { LanguageTest } from "../../types.js"
import { WIDE_PARSE_INT, WIDE_PARSE_REAL, WIDE_WIDTH_TEXTS, WIDE_WIDTH_TYPES, dumpArrays, dumpPaths, whole } from "./string-edges-shared.js"

export const STRING_MODEL_TESTS_D: readonly LanguageTest[] = [
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
  // lsp-transpile-review-gaps 2.6: a literal too long for a FUNCTION's VAR_IN_OUT STRING(10) builds with no warning on
  // either vendor (`string_inout_wider_stores`), where a STRING(10) variable's store warns (C0198). Which targets are left
  // unwarned — an in-out only, or every target reached through a reference? The same 15-unit literal through a REFERENCE
  // TO STRING(10), through a dereferenced POINTER TO STRING(10), and into an FB's VAR_IN_OUT STRING(10).
  whole("string_literal_through_reference_too_long", "a 15-unit literal stored through a REFERENCE TO STRING(10) (lsp-transpile-review-gaps 2.6)",
    `FUNCTION_BLOCK FB_LANG_string_literal_through_reference
VAR
\tbuf : STRING(10);
\trf : REFERENCE TO STRING(10);
END_VAR
rf REF= buf;
rf := 'XYZXYZXYZXYZXYZ';
END_FUNCTION_BLOCK
`),
  whole("string_literal_through_pointer_too_long", "a 15-unit literal stored through a dereferenced POINTER TO STRING(10) (lsp-transpile-review-gaps 2.6)",
    `FUNCTION_BLOCK FB_LANG_string_literal_through_pointer
VAR
\tbuf : STRING(10);
\tp : POINTER TO STRING(10);
END_VAR
p := ADR(buf);
p^ := 'XYZXYZXYZXYZXYZ';
END_FUNCTION_BLOCK
`),
  {
    ...whole("string_literal_into_fb_inout_too_long", "a 15-unit literal stored into an FB's VAR_IN_OUT STRING(10) (lsp-transpile-review-gaps 2.6)",
      `FUNCTION_BLOCK FB_LANG_string_literal_into_fb_inout
VAR_IN_OUT
\tio : STRING(10);
END_VAR
io := 'XYZXYZXYZXYZXYZ';
END_FUNCTION_BLOCK
`),
    plcPrgVar: "inst : FB_LANG_string_literal_into_fb_inout; buf : STRING(10);",
    plcPrgBody: "inst(io := buf);",
  },
  // lsp-transpile-review-gaps 2.7: the TYPE SEL / MUX / LIMIT / MIN / MAX answer over STRINGs of different capacities
  // (`string_inout_wider_reads`' `SEL(g, 'x', io)`). Each result is stored into an INT, so the build NAMES the type it
  // inferred ("Cannot convert type 'STRING(…)' to type 'INT'") — the meet's capacity, measured rather than chosen.
  whole("sel_string_meet_type", "the type SEL and MUX answer over STRINGs / WSTRINGs of different capacities, named by a store into an INT (lsp-transpile-review-gaps 2.7)",
    `FUNCTION_BLOCK FB_LANG_sel_string_meet_type
VAR
\tg : BOOL := TRUE;
\ts4 : STRING(4);
\ts12 : STRING(12);
\tsDef : STRING;
\tw4 : WSTRING(4);
\tw12 : WSTRING(12);
\ti1 : INT;
\ti2 : INT;
\ti3 : INT;
\ti4 : INT;
\ti5 : INT;
\ti6 : INT;
END_VAR
i1 := SEL(g, s4, s12);
i2 := SEL(g, 'x', s12);
i3 := SEL(g, s12, 'abcdefghijklmnopqrst');
i4 := MUX(1, s4, s12, sDef);
i5 := SEL(g, w4, w12);
i6 := SEL(g, s4, s4);
END_FUNCTION_BLOCK
`),
  whole("limit_string_meet_type", "the type LIMIT, MIN and MAX answer over STRINGs of different capacities, named by a store into an INT (lsp-transpile-review-gaps 2.7)",
    `FUNCTION_BLOCK FB_LANG_limit_string_meet_type
VAR
\ts4 : STRING(4);
\ts12 : STRING(12);
\tsDef : STRING;
\ti1 : INT;
\ti2 : INT;
\ti3 : INT;
END_VAR
i1 := LIMIT(s4, s12, sDef);
i2 := MIN(s4, s12);
i3 := MAX(s12, 'abcdefghijklmnopqrst');
END_FUNCTION_BLOCK
`),
  // …LIMIT(s4, s12, sDef) is STRING(12) (CODESYS 2026-10-11): IN's type, or the wider of MN and IN? IN narrower than MN,
  // and IN as wide as MN with a wider MX.
  whole("limit_string_meet_type_in", "the type LIMIT answers over STRINGs when IN is the narrowest, and when MX is the widest (lsp-transpile-review-gaps 2.7)",
    `FUNCTION_BLOCK FB_LANG_limit_string_meet_type_in
VAR
\ts4 : STRING(4);
\ts12 : STRING(12);
\tsDef : STRING;
\ti1 : INT;
\ti2 : INT;
\ti3 : INT;
END_VAR
i1 := LIMIT(s12, s4, sDef);
i2 := LIMIT(s4, s4, s12);
i3 := LIMIT(sDef, s4, s12);
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
