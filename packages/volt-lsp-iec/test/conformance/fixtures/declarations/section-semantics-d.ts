/**
 * the fixtures of `section-semantics.ts` — part D.
 *
 * One slice of `section-semantics.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { LanguageTest } from "../../types.js"

export const tempReview_D: LanguageTest[] = [
{
    name: "var_temp_base_redeclared_as_var",
    pouName: "FB_LANG_vtrv",
    kind: "function_block",
    feature: "a derived FB declares a VAR named like its base's VAR_TEMP — a duplicate, or two variables?",
    fromDoc: "02-variables.md",
    source: `FUNCTION_BLOCK FB_LANG_vtrv_base
VAR_TEMP
	sv : INT := 3;
END_VAR
VAR
	bs : INT;
END_VAR
sv := sv + 1;
bs := sv;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_LANG_vtrv EXTENDS FB_LANG_vtrv_base
VAR
	sv : INT;
END_VAR
sv := sv + 10;
SUPER^();
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_LANG_vtrv; outSv : INT; outBs : INT;",
    plcPrgBody: "inst(); outSv := inst.sv; outBs := inst.bs;",
    cycles: 2,
  },
  {
    name: "var_temp_base_redeclared_as_temp",
    pouName: "FB_LANG_vtrt",
    kind: "function_block",
    feature: "a derived FB declares a VAR_TEMP named like its base's VAR_TEMP — a duplicate, or two temps?",
    fromDoc: "02-variables.md",
    source: `FUNCTION_BLOCK FB_LANG_vtrt_base
VAR_TEMP
	sv : INT := 3;
END_VAR
VAR
	bs : INT;
END_VAR
sv := sv + 1;
bs := sv;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_LANG_vtrt EXTENDS FB_LANG_vtrt_base
VAR_TEMP
	sv : INT := 100;
END_VAR
VAR
	ds : INT;
END_VAR
sv := sv + 10;
ds := sv;
SUPER^();
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_LANG_vtrt; outDs : INT; outBs : INT;",
    plcPrgBody: "inst(); outDs := inst.ds; outBs := inst.bs;",
    cycles: 2,
  },
  {
    name: "var_temp_base_run_by_super_constant_init",
    pouName: "FB_LANG_vtsc",
    kind: "function_block",
    feature: "a base FB's VAR_TEMP with a constant initializer, its body run by SUPER^() — started over each run?",
    fromDoc: "02-variables.md",
    source: `FUNCTION_BLOCK FB_LANG_vtsc_base
VAR_TEMP
	a : INT := 7;
END_VAR
VAR
	g : INT;
	bo : INT;
END_VAR
a := a + g;
bo := a;
g := g + 1;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_LANG_vtsc EXTENDS FB_LANG_vtsc_base
SUPER^();
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_LANG_vtsc; out : INT;",
    plcPrgBody: "inst(); out := inst.bo;",
    cycles: 2,
  },
  {
    name: "var_temp_base_run_by_super_dynamic_init",
    pouName: "FB_LANG_vtsy",
    kind: "function_block",
    feature: "a base FB's VAR_TEMP initialized from a field, its body run by SUPER^() — evaluated each run?",
    fromDoc: "02-variables.md",
    source: `FUNCTION_BLOCK FB_LANG_vtsy_base
VAR
	g : INT := 3;
	bo : INT;
END_VAR
VAR_TEMP
	a : INT := g * 10;
END_VAR
bo := a;
g := g + 1;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_LANG_vtsy EXTENDS FB_LANG_vtsy_base
SUPER^();
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_LANG_vtsy; out : INT;",
    plcPrgBody: "inst(); out := inst.bo;",
    cycles: 2,
  },
  {
    name: "var_temp_address_kept_in_pointer_field",
    pouName: "FB_LANG_vtap",
    kind: "function_block",
    feature: "the address of a VAR_TEMP stored into a POINTER field and dereferenced in the same run",
    fromDoc: "02-variables.md",
    source: `FUNCTION_BLOCK FB_LANG_vtap
VAR
	p : POINTER TO INT;
	seen : INT;
END_VAR
VAR_TEMP
	t : INT;
END_VAR
t := 3;
p := ADR(t);
seen := p^;
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_LANG_vtap; out : INT;",
    plcPrgBody: "inst(); out := inst.seen;",
  },
  {
    name: "var_temp_reference_kept_in_field",
    pouName: "FB_LANG_vtar",
    kind: "function_block",
    feature: "a REFERENCE field bound to a VAR_TEMP and read in the same run",
    fromDoc: "02-variables.md",
    source: `FUNCTION_BLOCK FB_LANG_vtar
VAR
	rf : REFERENCE TO INT;
	seen : INT;
END_VAR
VAR_TEMP
	t : INT;
END_VAR
t := 3;
rf REF= t;
seen := rf;
END_FUNCTION_BLOCK
`,
    plcPrgVar: "inst : FB_LANG_vtar; out : INT;",
    plcPrgBody: "inst(); out := inst.seen;",
  },
  {
    name: "var_temp_named_in_method_beside_global",
    pouName: "FB_LANG_vtgm",
    kind: "function_block",
    feature: "an FB's VAR_TEMP named in its METHOD, a VAR_GLOBAL of the same name declared — the global, or not declared?",
    fromDoc: "02-variables.md",
    source: `VAR_GLOBAL
	vtgm : INT := 40;
END_VAR

FUNCTION_BLOCK FB_LANG_vtgm
VAR_TEMP
	vtgm : INT;
END_VAR
VAR
	seen : INT;
END_VAR
vtgm := 5;
Probe();
END_FUNCTION_BLOCK

METHOD Probe
seen := vtgm + 1;
END_METHOD
`,
    gvlNames: ["GVL_LANG_var_temp_named_in_method_beside_global"],
    plcPrgVar: "inst : FB_LANG_vtgm; out : INT; g : INT;",
    plcPrgBody: "inst(); out := inst.seen; g := vtgm;",
  },
  {
    name: "var_temp_named_in_derived_body_beside_global",
    pouName: "FB_LANG_vtgd",
    kind: "function_block",
    feature: "a base FB's VAR_TEMP named in the derived FB's body, a VAR_GLOBAL of the same name declared — the global, or not declared?",
    fromDoc: "02-variables.md",
    source: `VAR_GLOBAL
	vtgd : INT := 40;
END_VAR

FUNCTION_BLOCK FB_LANG_vtgd_base
VAR_TEMP
	vtgd : INT;
END_VAR
VAR
	seen : INT;
END_VAR
vtgd := 1;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_LANG_vtgd EXTENDS FB_LANG_vtgd_base
seen := vtgd + 1;
END_FUNCTION_BLOCK
`,
    gvlNames: ["GVL_LANG_var_temp_named_in_derived_body_beside_global"],
    plcPrgVar: "inst : FB_LANG_vtgd; out : INT; g : INT;",
    plcPrgBody: "inst(); out := inst.seen; g := vtgd;",
  },
]
