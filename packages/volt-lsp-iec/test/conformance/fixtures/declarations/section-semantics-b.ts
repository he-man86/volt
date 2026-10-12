/**
 * the fixtures of `section-semantics.ts` — part B.
 *
 * One slice of `section-semantics.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { LanguageTest } from "../../types.js"

export const initModel_B: LanguageTest[] = [
{
    name: "var_temp_dynamic_init_method",
    pouName: "GVL_LANG_vtdm",
    kind: "gvl",
    feature: "a METHOD's VAR initialized from a GLOBAL that changes between calls — re-evaluated on every call? (RC 24 in a METHOD)",
    fromDoc: "02-variables.md",
    cycles: 2,
    source: `VAR_GLOBAL
	gLangVtdm : INT := 7;
END_VAR

FUNCTION_BLOCK FB_LANG_vtdm
VAR
	seen : INT;
	seenExpr : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD Probe
VAR
	t : INT := gLangVtdm;
	u : INT := gLangVtdm * 2 + 1;
END_VAR
seen := t;
seenExpr := u;
t := 0;
u := 0;
gLangVtdm := gLangVtdm + 1;
END_METHOD
`,
    plcPrgVar: "inst : FB_LANG_vtdm; seen1 : INT; expr1 : INT; seen2 : INT; expr2 : INT;",
    plcPrgBody: "inst.Probe(); seen1 := inst.seen; expr1 := inst.seenExpr;\ninst.Probe(); seen2 := inst.seen; expr2 := inst.seenExpr;",
  },
  {
    name: "var_temp_dynamic_init_function",
    pouName: "GVL_LANG_vtdf",
    kind: "gvl",
    feature: "a FUNCTION's VAR initialized from a GLOBAL that changes between calls, and from an input — re-evaluated on every call? (RC 24 in a FUNCTION)",
    fromDoc: "02-variables.md",
    cycles: 2,
    source: `VAR_GLOBAL
	gLangVtdf : INT := 7;
END_VAR

FUNCTION F_LANG_vtdf : INT
VAR_INPUT
	k : INT;
END_VAR
VAR_OUTPUT
	outU : INT;
	outIn : INT;
END_VAR
VAR
	t : INT := gLangVtdf;
	u : INT := gLangVtdf * 2 + 1;
	viaInput : INT := k * 3;
END_VAR
F_LANG_vtdf := t;
outU := u;
outIn := viaInput;
gLangVtdf := gLangVtdf + 1;
END_FUNCTION
`,
    plcPrgVar: "t1 : INT; u1 : INT; in1 : INT; t2 : INT; u2 : INT; in2 : INT;",
    plcPrgBody: "t1 := F_LANG_vtdf(k := 2, outU => u1, outIn => in1);\nt2 := F_LANG_vtdf(k := 5, outU => u2, outIn => in2);",
  },
  {
    name: "var_temp_dynamic_aggregate_init",
    pouName: "GVL_LANG_vtda",
    kind: "gvl",
    feature: "a VAR_TEMP ARRAY and STRUCT whose initializers read an input, call a FUNCTION and read a moving global — re-evaluated on every call?",
    fromDoc: "02-variables.md",
    cycles: 2,
    source: `VAR_GLOBAL
	gLangVtda : INT := 7;
END_VAR

TYPE DUT_LANG_vtda :
STRUCT
	a : INT;
	b : INT := 4;
	c : INT;
END_STRUCT
END_TYPE

FUNCTION F_LANG_vtda_twice : INT
VAR_INPUT
	n : INT;
END_VAR
F_LANG_vtda_twice := n * 2;
END_FUNCTION

FUNCTION_BLOCK FB_LANG_vtda
VAR_INPUT
	k : INT;
END_VAR
VAR_TEMP
	arr : ARRAY[0..2] OF INT := [k, 0 + F_LANG_vtda_twice(k), gLangVtda];
	rec : DUT_LANG_vtda := (a := k, c := F_LANG_vtda_twice(gLangVtda));
END_VAR
VAR
	r0 : INT;
	r1 : INT;
	r2 : INT;
	sa : INT;
	sb : INT;
	sc : INT;
END_VAR
r0 := arr[0];
r1 := arr[1];
r2 := arr[2];
sa := rec.a;
sb := rec.b;
sc := rec.c;
arr[0] := 0;
arr[1] := 0;
arr[2] := 0;
rec.a := 0;
rec.b := 0;
rec.c := 0;
gLangVtda := gLangVtda + 1;
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_LANG_vtda; first0 : INT; first1 : INT; first2 : INT; firstA : INT; firstB : INT; firstC : INT;",
    plcPrgBody:
      "inst(k := 3); first0 := inst.r0; first1 := inst.r1; first2 := inst.r2; firstA := inst.sa; firstB := inst.sb; firstC := inst.sc;\ninst(k := 5);",
  },
]
