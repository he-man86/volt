/**
 * the fixtures of `string-edges.ts` — part C.
 *
 * One slice of `string-edges.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { LanguageTest } from "../../types.js"
import { whole } from "./string-edges-shared.js"

export const STRING_MODEL_TESTS_C: readonly LanguageTest[] = [
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
]
