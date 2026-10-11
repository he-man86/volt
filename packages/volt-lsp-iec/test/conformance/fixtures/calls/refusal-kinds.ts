/**
 * CALL SHAPES A REFUSAL CODE WAS UNDECIDED ABOUT — openspec `transpile-refusal-classification` 2.2. Each fixture reaches one
 * refusal site of `lower/diagnostics/codes.ts` that no recording and no corpus POU reached (1.1's table), so the vendor
 * says whether the ST is valid (the code cannot be `invalid`) and, when it runs, what it does (the behaviour is recorded:
 * the code is `not-modelled`, not `not-measured`). One question per fixture; the site it asks is in its `feature`.
 */
import type { LanguageTest } from "../../types.js"

const doc = "openspec transpile-refusal-classification 2.2"

function fb(name: string, feature: string, source: string): LanguageTest {
  return {
    name,
    pouName: `FB_LANG_${name}`,
    kind: "function_block",
    feature,
    fromDoc: doc,
    source,
    plcPrgVar: `inst_${name} : FB_LANG_${name};`,
    plcPrgBody: `inst_${name}();`,
  }
}

/**
 * THE LSP GAPS THESE ASKS FOUND (transpile-refusal-classification 2.2): invalid ST CODESYS refuses and the LSP says nothing
 * about, its first error named. Each is niche: accepted loss (0 occurrences in the corpora — every corpus project builds,
 * so none holds invalid ST), each its `deferred.lsp`.
 */
const LSP_GAPS: Readonly<Record<string, string>> = {
  rk_inout_other_struct: "Type 'DUT_LANG_rk_ios_b' is not equal to type 'DUT_LANG_rk_ios_a' of VAR_IN_OUT respectively REFERENCE 'rec'",
  rk_builtin_named_args: "Cannot convert type 'Unknown type: 'LIMIT(MN := 0, IN := 7, MX := 5)'' to type 'INT'",
  rk_function_output_bound_with_assign: "Function 'F_LANG_rk_fob_twice' requires exactly '1' inputs",
  rk_program_instance_property_written: "'cell' is no input of 'PRG_LANG_rk_pipw_holder'",
}

function withLspGap(t: LanguageTest): LanguageTest {
  const said = LSP_GAPS[t.name]
  return said === undefined ? t : { ...t, deferred: { lsp: `niche: accepted loss (0 occurrences in the corpora) — the LSP says nothing where CODESYS says "${said}"` } }
}

export const CALL_REFUSAL_KIND_TESTS: readonly LanguageTest[] = [
  fb("rk_inout_derived_fb", "`call-inout-derived` (binding.ts) — an FB VAR_IN_OUT of the BASE type bound to an instance of a DERIVED FB",
    `FUNCTION_BLOCK FB_LANG_rk_idf_base
VAR
	n : INT;
END_VAR
n := n + 1;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_LANG_rk_idf_derived EXTENDS FB_LANG_rk_idf_base
END_FUNCTION_BLOCK

FUNCTION F_LANG_rk_idf_bump : INT
VAR_IN_OUT
	io : FB_LANG_rk_idf_base;
END_VAR
io();
F_LANG_rk_idf_bump := io.n;
END_FUNCTION

FUNCTION_BLOCK FB_LANG_rk_inout_derived_fb
VAR
	d : FB_LANG_rk_idf_derived;
	res : INT;
	seen : INT;
END_VAR
res := F_LANG_rk_idf_bump(io := d);
seen := d.n;
END_FUNCTION_BLOCK
`),
  fb("rk_inout_other_struct", "`call-inout-derived` (binding.ts) — a STRUCT VAR_IN_OUT bound to a variable of ANOTHER struct type with the same fields",
    `TYPE DUT_LANG_rk_ios_a :
STRUCT
	v : INT;
END_STRUCT
END_TYPE

TYPE DUT_LANG_rk_ios_b :
STRUCT
	v : INT;
END_STRUCT
END_TYPE

FUNCTION F_LANG_rk_ios_read : INT
VAR_IN_OUT
	rec : DUT_LANG_rk_ios_a;
END_VAR
F_LANG_rk_ios_read := rec.v;
END_FUNCTION

FUNCTION_BLOCK FB_LANG_rk_inout_other_struct
VAR
	other : DUT_LANG_rk_ios_b;
	res : INT;
END_VAR
other.v := 3;
res := F_LANG_rk_ios_read(rec := other);
END_FUNCTION_BLOCK
`),
  fb("rk_inout_shadowed_by_local", "`call-inout-shadowed` (invoke.ts) — a METHOD whose local hides the FB's VAR_IN_OUT calls another METHOD of the FB that reads that VAR_IN_OUT",
    `FUNCTION_BLOCK FB_LANG_rk_isl_holder
VAR_IN_OUT
	io : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD Inner : INT
Inner := io;
END_METHOD

METHOD Outer : INT
VAR
	io : INT := 5;
END_VAR
Outer := Inner() * 10 + io;
END_METHOD

FUNCTION_BLOCK FB_LANG_rk_inout_shadowed_by_local
VAR
	x : INT := 3;
	holder : FB_LANG_rk_isl_holder;
	res : INT;
END_VAR
holder(io := x);
res := holder.Outer();
END_FUNCTION_BLOCK
`),
  fb("rk_builtin_named_args", "`call-named-args` (builtins.ts) — a standard FUNCTION (LIMIT) called with its parameters NAMED",
    `FUNCTION_BLOCK FB_LANG_rk_builtin_named_args
VAR
	res : INT;
END_VAR
res := LIMIT(MN := 0, IN := 7, MX := 5);
END_FUNCTION_BLOCK
`),
  fb("rk_function_empty_argument", "`call-output` (invoke.ts, the empty argument) — a FUNCTION called with `a :=` and no value",
    `FUNCTION F_LANG_rk_fea_add : INT
VAR_INPUT
	a : INT := 4;
	b : INT;
END_VAR
F_LANG_rk_fea_add := a + b;
END_FUNCTION

FUNCTION_BLOCK FB_LANG_rk_function_empty_argument
VAR
	res : INT;
END_VAR
res := F_LANG_rk_fea_add(a := , b := 2);
END_FUNCTION_BLOCK
`),
  fb("rk_function_output_bound_with_assign", "`call-output` (invoke.ts, `:=` on an output) — a FUNCTION's VAR_OUTPUT given with `:=` instead of `=>`",
    `FUNCTION F_LANG_rk_fob_twice : INT
VAR_INPUT
	i : INT;
END_VAR
VAR_OUTPUT
	o : INT;
END_VAR
o := i * 2;
F_LANG_rk_fob_twice := i;
END_FUNCTION

FUNCTION_BLOCK FB_LANG_rk_function_output_bound_with_assign
VAR
	v : INT;
	res : INT;
END_VAR
res := F_LANG_rk_fob_twice(i := 3, o := v);
END_FUNCTION_BLOCK
`),
  fb("rk_super_call_output_argument", "`call-positional` (super.ts, the output argument) — a derived FB's body calls `SUPER^(o => got)`, reading the base body's VAR_OUTPUT",
    `FUNCTION_BLOCK FB_LANG_rk_sco_base
VAR_OUTPUT
	o : INT;
END_VAR
o := o + 7;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_LANG_rk_sco_derived EXTENDS FB_LANG_rk_sco_base
VAR
	got : INT;
END_VAR
SUPER^(o => got);
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_LANG_rk_super_call_output_argument
VAR
	d : FB_LANG_rk_sco_derived;
END_VAR
d();
END_FUNCTION_BLOCK
`),
  fb("rk_program_member_runtime_index", "`call-program-member` (fb-call.ts) — an FB instance in a PROGRAM's array, called from outside the program at a runtime index",
    `FUNCTION_BLOCK FB_LANG_rk_pmr_cell
VAR
	calls : INT;
END_VAR
calls := calls + 1;
END_FUNCTION_BLOCK

PROGRAM PRG_LANG_rk_pmr_holder
VAR
	cells : ARRAY[0..1] OF FB_LANG_rk_pmr_cell;
END_VAR
END_PROGRAM

FUNCTION_BLOCK FB_LANG_rk_program_member_runtime_index
VAR
	k : INT := 1;
	seen : INT;
END_VAR
PRG_LANG_rk_pmr_holder.cells[k]();
seen := PRG_LANG_rk_pmr_holder.cells[1].calls;
END_FUNCTION_BLOCK
`),
  fb("rk_program_method_runtime_index", "`call-program-method` (invoke.ts) — a METHOD of an FB instance in a PROGRAM's array, called from outside the program at a runtime index",
    `FUNCTION_BLOCK FB_LANG_rk_pmm_cell
VAR
	calls : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD Bump : INT
calls := calls + 1;
Bump := calls;
END_METHOD

PROGRAM PRG_LANG_rk_pmm_holder
VAR
	cells : ARRAY[0..1] OF FB_LANG_rk_pmm_cell;
END_VAR
END_PROGRAM

FUNCTION_BLOCK FB_LANG_rk_program_method_runtime_index
VAR
	k : INT := 1;
	res : INT;
END_VAR
res := PRG_LANG_rk_pmm_holder.cells[k].Bump();
END_FUNCTION_BLOCK
`),
  fb("rk_program_property_runtime_index", "`call-program-property` (property.ts, the read) — a PROPERTY of an FB instance in a PROGRAM's array, read from outside the program at a runtime index",
    `FUNCTION_BLOCK FB_LANG_rk_ppr_cell
VAR
	lvl : INT := 6;
END_VAR
END_FUNCTION_BLOCK

PROPERTY Level : INT
GET
Level := lvl;
END_GET
END_PROPERTY

PROGRAM PRG_LANG_rk_ppr_holder
VAR
	cells : ARRAY[0..1] OF FB_LANG_rk_ppr_cell;
END_VAR
END_PROGRAM

FUNCTION_BLOCK FB_LANG_rk_program_property_runtime_index
VAR
	k : INT := 1;
	res : INT;
END_VAR
res := PRG_LANG_rk_ppr_holder.cells[k].Level;
END_FUNCTION_BLOCK
`),
  fb("rk_program_instance_property_written", "`call-program-property` (property.ts, the write) — a PROPERTY of an FB instance inside a PROGRAM, written from outside the program",
    `FUNCTION_BLOCK FB_LANG_rk_pipw_cell
VAR
	lvl : INT;
END_VAR
END_FUNCTION_BLOCK

PROPERTY Level : INT
GET
Level := lvl;
END_GET
SET
lvl := Level;
END_SET
END_PROPERTY

PROGRAM PRG_LANG_rk_pipw_holder
VAR
	cell : FB_LANG_rk_pipw_cell;
END_VAR
END_PROGRAM

FUNCTION_BLOCK FB_LANG_rk_program_instance_property_written
VAR
	res : INT;
END_VAR
PRG_LANG_rk_pipw_holder.cell.Level := 8;
res := PRG_LANG_rk_pipw_holder.cell.Level;
END_FUNCTION_BLOCK
`),
  fb("rk_program_reentrant_method", "`call-program-reentrant` (invoke.ts) — a METHOD of an FB instance inside a PROGRAM, called from outside it, that reads a variable of that PROGRAM",
    `FUNCTION_BLOCK FB_LANG_rk_prm_cell
END_FUNCTION_BLOCK

METHOD ReadOwner : INT
ReadOwner := PRG_LANG_rk_prm_holder.x;
END_METHOD

PROGRAM PRG_LANG_rk_prm_holder
VAR
	x : INT := 9;
	cell : FB_LANG_rk_prm_cell;
END_VAR
END_PROGRAM

FUNCTION_BLOCK FB_LANG_rk_program_reentrant_method
VAR
	res : INT;
END_VAR
res := PRG_LANG_rk_prm_holder.cell.ReadOwner();
END_FUNCTION_BLOCK
`),
  fb("rk_nested_method_in_argument", "`call-nested` (invoke.ts) — a METHOD that writes cnt, called inside an INTERFACE call's arguments after `a := cnt`: does `a` see the old cnt?",
    `INTERFACE ITF_LANG_rk_nma
METHOD Pair : INT
VAR_INPUT
	a : INT;
	b : INT;
END_VAR
END_METHOD
END_INTERFACE

FUNCTION_BLOCK FB_LANG_rk_nma_impl IMPLEMENTS ITF_LANG_rk_nma
END_FUNCTION_BLOCK

METHOD Pair : INT
VAR_INPUT
	a : INT;
	b : INT;
END_VAR
Pair := a * 100 + b;
END_METHOD

FUNCTION_BLOCK FB_LANG_rk_nested_method_in_argument
VAR
	impl : FB_LANG_rk_nma_impl;
	itf : ITF_LANG_rk_nma;
	cnt : INT := 1;
	res : INT;
END_VAR
itf := impl;
res := itf.Pair(a := cnt, b := Bump());
END_FUNCTION_BLOCK

METHOD Bump : INT
cnt := cnt + 10;
Bump := cnt;
END_METHOD
`),
  fb("rk_nested_property_in_argument", "`call-nested` (property.ts) — a PROPERTY read inside an INTERFACE call's arguments",
    `INTERFACE ITF_LANG_rk_npa
METHOD Twice : INT
VAR_INPUT
	a : INT;
END_VAR
END_METHOD
END_INTERFACE

FUNCTION_BLOCK FB_LANG_rk_npa_impl IMPLEMENTS ITF_LANG_rk_npa
END_FUNCTION_BLOCK

METHOD Twice : INT
VAR_INPUT
	a : INT;
END_VAR
Twice := a * 2;
END_METHOD

FUNCTION_BLOCK FB_LANG_rk_npa_src
VAR
	lvl : INT := 21;
END_VAR
END_FUNCTION_BLOCK

PROPERTY Level : INT
GET
Level := lvl;
END_GET
END_PROPERTY

FUNCTION_BLOCK FB_LANG_rk_nested_property_in_argument
VAR
	impl : FB_LANG_rk_npa_impl;
	itf : ITF_LANG_rk_npa;
	src : FB_LANG_rk_npa_src;
	res : INT;
END_VAR
itf := impl;
res := itf.Twice(a := src.Level);
END_FUNCTION_BLOCK
`),
  fb("rk_method_call_on_struct", "`call-method` (invoke.ts:159) — `rec.M()` on a STRUCT variable, which has no METHOD",
    `TYPE DUT_LANG_rk_mcs :
STRUCT
	M : INT;
END_STRUCT
END_TYPE

FUNCTION_BLOCK FB_LANG_rk_method_call_on_struct
VAR
	rec : DUT_LANG_rk_mcs;
	res : INT;
END_VAR
res := rec.M();
END_FUNCTION_BLOCK
`),
  fb("rk_property_set_by_s", "`property-store` (property.ts) — a BOOL PROPERTY written by `S=`",
    `FUNCTION_BLOCK FB_LANG_rk_psbs_lamp
VAR
	on : BOOL;
	sets : INT;
END_VAR
END_FUNCTION_BLOCK

PROPERTY Lit : BOOL
GET
Lit := on;
END_GET
SET
on := Lit;
sets := sets + 1;
END_SET
END_PROPERTY

FUNCTION_BLOCK FB_LANG_rk_property_set_by_s
VAR
	lamp : FB_LANG_rk_psbs_lamp;
	go : BOOL := TRUE;
END_VAR
lamp.Lit S= go;
END_FUNCTION_BLOCK
`),
].map(withLspGap)

/** A PROGRAM's fixture: PLC_PRG calls it, and its own body is the question. */
export const CALL_REFUSAL_KIND_PROGRAM_TESTS: readonly LanguageTest[] = [
  {
    name: "rk_program_calls_itself",
    pouName: "PRG_LANG_rk_program_calls_itself",
    kind: "program",
    feature: "`call-program` (fb-call.ts) — a PROGRAM whose body calls the PROGRAM itself by name, while a counter is below 3",
    fromDoc: doc,
    plcPrgVar: "seen : INT;",
    plcPrgBody: "PRG_LANG_rk_program_calls_itself();\nseen := PRG_LANG_rk_program_calls_itself.n;",
    source: `PROGRAM PRG_LANG_rk_program_calls_itself
VAR
	n : INT;
END_VAR
n := n + 1;
IF n < 3 THEN
	PRG_LANG_rk_program_calls_itself();
END_IF
END_PROGRAM
`,
  },
]
