/**
 * the fixtures of `section-semantics.ts` — part A.
 *
 * One slice of `section-semantics.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { LanguageTest } from "../../types.js"
import { probe } from "./section-semantics-shared.js"

export const transpileReview_A: LanguageTest[] = [
// Task 24: a VAR_TEMP whose initializer is not constant is deferred to a run-once init and then reset to the type
  // default on every call, so it reads 0. Two calls per scan, each after the global moved, in an FB and in a PROGRAM
  // (the two ways a VAR_TEMP owner is entered); `u` is a computed initializer, not just a bare global read.
  {
    name: "var_temp_dynamic_init",
    pouName: "GVL_LANG_tr24",
    kind: "gvl",
    feature:
      "a VAR_TEMP initialized from a GLOBAL that changes between calls — re-evaluated on every call, in an FB and a PROGRAM (transpile-review task 24)",
    fromDoc: "02-variables.md",
    note: "LIVE (review): the initializer is evaluated on every call — first call sees 7, the next 8, in both the FB and the PROGRAM.",
    cycles: 2,
    source: `VAR_GLOBAL
	gLangTr24Fb : INT := 7;
	gLangTr24Prg : INT := 7;
END_VAR

FUNCTION_BLOCK FB_LANG_tr24
VAR_TEMP
	t : INT := gLangTr24Fb;
	u : INT := gLangTr24Fb * 2 + 1;
END_VAR
VAR
	seen : INT;
	seenExpr : INT;
END_VAR
seen := t;
seenExpr := u;
gLangTr24Fb := gLangTr24Fb + 1;
END_FUNCTION_BLOCK

PROGRAM PRG_LANG_tr24
VAR_TEMP
	t : INT := gLangTr24Prg;
	u : INT := gLangTr24Prg * 2 + 1;
END_VAR
VAR
	seen : INT;
	seenExpr : INT;
END_VAR
seen := t;
seenExpr := u;
gLangTr24Prg := gLangTr24Prg + 1;
END_PROGRAM
`,
    plcPrgVar:
      "inst : FB_LANG_tr24; fbSeen1 : INT; fbSeen2 : INT; fbExpr2 : INT; prgSeen1 : INT; prgSeen2 : INT; prgExpr2 : INT;",
    plcPrgBody: [
      "inst(); fbSeen1 := inst.seen;",
      "inst(); fbSeen2 := inst.seen; fbExpr2 := inst.seenExpr;",
      "PRG_LANG_tr24(); prgSeen1 := PRG_LANG_tr24.seen;",
      "PRG_LANG_tr24(); prgSeen2 := PRG_LANG_tr24.seen; prgExpr2 := PRG_LANG_tr24.seenExpr;",
    ].join("\n"),
  },
  // Task 25: an array element takes its ELEMENT type's default — an enum's first member, an alias's own initializer,
  // an alias-of-array's initializer per element — not the family zero. Edges: an enum whose first member is not the
  // smallest value, a non-zero lower bound, and a PARTIAL initializer whose tail stays at 0 (the half that is right
  // today and must stay right).
  {
    name: "array_element_type_default",
    pouName: "FB_LANG_tr25",
    kind: "function_block",
    feature:
      "arrays of an enum, of an alias with an initializer and of an initialized alias-of-array — each element starts at its type's default (transpile-review task 25)",
    fromDoc: "06-data-types.md",
    note: "LIVE (review): r_ea0=r_ea1=3, r_eb1=1, r_ma0=r_ma1=5, r_aa1_0=8, r_aa1_1=9, r_sz1=5, r_alias_part2=0.",
    source: `TYPE DUT_LANG_tr25_E :
(
	A := 3,
	B := 4
);
END_TYPE

TYPE DUT_LANG_tr25_F :
(
	X := 1,
	Y := 0
);
END_TYPE

TYPE DUT_LANG_tr25_MyInt : INT := 5;
END_TYPE

TYPE DUT_LANG_tr25_MyArr : ARRAY[0..1] OF INT := [8, 9];
END_TYPE

FUNCTION_BLOCK FB_LANG_tr25
VAR
	ea : ARRAY[0..1] OF DUT_LANG_tr25_E;
	eb : ARRAY[0..1] OF DUT_LANG_tr25_F;
	ma : ARRAY[0..1] OF DUT_LANG_tr25_MyInt;
	aa : ARRAY[0..1] OF DUT_LANG_tr25_MyArr;
	sz : ARRAY[1..2] OF DUT_LANG_tr25_MyInt;
	part : ARRAY[0..2] OF DUT_LANG_tr25_MyInt := [7];
	r_ea0 : INT;
	r_ea1 : INT;
	r_eb1 : INT;
	r_ma0 : INT;
	r_ma1 : INT;
	r_aa1_0 : INT;
	r_aa1_1 : INT;
	r_sz1 : INT;
	r_alias_part0 : INT;
	r_alias_part2 : INT;
END_VAR
r_ea0 := ea[0];
r_ea1 := ea[1];
r_eb1 := eb[1];
r_ma0 := ma[0];
r_ma1 := ma[1];
r_aa1_0 := aa[1][0];
r_aa1_1 := aa[1][1];
r_sz1 := sz[1];
r_alias_part0 := part[0];
r_alias_part2 := part[2];
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_LANG_tr25;",
    plcPrgBody: "inst();",
  },
  // openspec transpile-restructure 5.3 (design.md §3.4 step 5c): the two element defaults `array_element_type_default`
  // does not record — a PARTIAL initializer on an ENUM array (its tail at the enum's default 3, or the family zero), and
  // an alias OF an alias (its element at the inner alias's 5, at its own 6, or 0) — asked before the IrInit's `rest` states them.
  {
    name: "array_element_enum_partial_tail",
    pouName: "FB_LANG_aeept",
    kind: "function_block",
    feature: "a partial initializer on an ARRAY OF an enum whose default is not 0 — the tail at the enum's default or the family zero",
    fromDoc: "06-data-types.md",
    source: `TYPE DUT_LANG_aeept_E :
(
	A := 3,
	B := 4
);
END_TYPE

FUNCTION_BLOCK FB_LANG_aeept
VAR
	ep : ARRAY[0..2] OF DUT_LANG_aeept_E := [DUT_LANG_aeept_E.B];
	r_ep0 : INT;
	r_ep1 : INT;
	r_ep2 : INT;
END_VAR
r_ep0 := ep[0];
r_ep1 := ep[1];
r_ep2 := ep[2];
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_LANG_aeept;",
    plcPrgBody: "inst();",
  },
  {
    name: "array_element_alias_of_alias",
    pouName: "FB_LANG_aeaa",
    kind: "function_block",
    feature: "an alias of an initialized alias, with and without its own initializer — as a variable and as an array element",
    fromDoc: "06-data-types.md",
    source: `TYPE DUT_LANG_aeaa_Base : INT := 5;
END_TYPE

TYPE DUT_LANG_aeaa_Plain : DUT_LANG_aeaa_Base;
END_TYPE

TYPE DUT_LANG_aeaa_Own : DUT_LANG_aeaa_Base := 6;
END_TYPE

FUNCTION_BLOCK FB_LANG_aeaa
VAR
	ps : DUT_LANG_aeaa_Plain;
	os : DUT_LANG_aeaa_Own;
	pa : ARRAY[0..1] OF DUT_LANG_aeaa_Plain;
	oa : ARRAY[0..1] OF DUT_LANG_aeaa_Own;
	r_ps : INT;
	r_os : INT;
	r_pa1 : INT;
	r_oa1 : INT;
END_VAR
r_ps := ps;
r_os := os;
r_pa1 := pa[1];
r_oa1 := oa[1];
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_LANG_aeaa;",
    plcPrgBody: "inst();",
  },
  // Task 30: a composite VAR_TEMP is reset on every call, but the Rust reset writes the type's zero instead of the
  // declared initializer. Each call reads, then overwrites the element it read — so the SECOND call of a scan only
  // reads the initializer again if the reset honours it.
  {
    ...probe(
      "decl_temp_array_init_resets",
      "VAR_TEMP",
      "arr : ARRAY[0..2] OF INT := [5, 6, 7];",
      "out := arr[1];\narr[1] := 0;",
      "an initialized ARRAY in VAR_TEMP, read then zeroed, called twice a scan — reset to its initializer each call (transpile-review task 30)",
    ),
    plcPrgVar: "inst : FB_LANG_decl_temp_array_init_resets; first : INT; second : INT;",
    plcPrgBody: "inst(); first := inst.out;\ninst(); second := inst.out;",
  },
  {
    name: "decl_temp_struct_init_resets",
    pouName: "FB_LANG_decl_temp_struct_init_resets",
    kind: "function_block",
    feature:
      "an initialized STRUCT in VAR_TEMP, read then zeroed, called twice a scan — reset to its initializer each call (transpile-review task 30)",
    fromDoc: "02-variables.md",
    cycles: 3,
    source: `TYPE DUT_LANG_tr30_P :
STRUCT
	a : INT;
	b : INT := 4;
END_STRUCT
END_TYPE

FUNCTION_BLOCK FB_LANG_decl_temp_struct_init_resets
VAR_TEMP
	tmp : DUT_LANG_tr30_P := (a := 9);
END_VAR
VAR
	out : INT;
	outB : INT;
END_VAR
out := tmp.a;
outB := tmp.b;
tmp.a := 0;
tmp.b := 0;
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_LANG_decl_temp_struct_init_resets; first : INT; second : INT; secondB : INT;",
    plcPrgBody: "inst(); first := inst.out;\ninst(); second := inst.out; secondB := inst.outB;",
  },
]
