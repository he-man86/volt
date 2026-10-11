/**
 * POINTER, REFERENCE, ADDRESS AND LAYOUT SHAPES A REFUSAL CODE WAS UNDECIDED ABOUT — openspec
 * `transpile-refusal-classification` 2.2. Each fixture reaches one refusal site of `lower/diagnostics/codes.ts` that no
 * recording and no corpus POU reached (1.1's table): the vendor says whether the ST is valid and, when it runs, what it
 * does. One question per fixture; the site it asks is in its `feature`.
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
  rk_ref_assign_in_chain: "Reference assign needs variable with write access",
  rk_pointer_stepped_by_struct: "Cannot convert type 'DUT_LANG_rk_psbs' to type 'LWORD'",
  rk_open_array_assigned_whole: "Cannot convert type 'POINTER TO INT' to type 'ARRAY [1..3] OF INT'",
  rk_string_indexed_two_dims: "Variable of type 'STRING(10)' requires exactly 1 Index",
}

function withLspGap(t: LanguageTest): LanguageTest {
  const said = LSP_GAPS[t.name]
  return said === undefined ? t : { ...t, deferred: { lsp: `niche: accepted loss (0 occurrences in the corpora) — the LSP says nothing where CODESYS says "${said}"` } }
}

export const MEMORY_REFUSAL_KIND_TESTS: readonly LanguageTest[] = [
  fb("rk_ref_assign_in_chain", "`assign-op` (assign.ts) — `REF=` as a link of an assignment chain: `r1 REF= r2 REF= x`",
    `FUNCTION_BLOCK FB_LANG_rk_ref_assign_in_chain
VAR
	x : INT := 4;
	r1 : REFERENCE TO INT;
	r2 : REFERENCE TO INT;
	v1 : INT;
	v2 : INT;
END_VAR
r1 REF= r2 REF= x;
v1 := r1;
v2 := r2;
END_FUNCTION_BLOCK
`),
  fb("rk_pointer_index_on_local_scalar", "`pointer-index` (deref.ts:69) — inside a FUNCTION, `p[0]` on a POINTER TO INT that holds the address of one local INT",
    `FUNCTION F_LANG_rk_pils : INT
VAR
	x : INT := 33;
	p : POINTER TO INT;
END_VAR
p := ADR(x);
F_LANG_rk_pils := p[0];
END_FUNCTION

FUNCTION_BLOCK FB_LANG_rk_pointer_index_on_local_scalar
VAR
	v : INT;
END_VAR
v := F_LANG_rk_pils();
END_FUNCTION_BLOCK
`),
  fb("rk_adr_local_runtime_index_before_last", "`pointer-runtime-index` (address.ts) — inside a FUNCTION, ADR of `arr[k].a[0]` of a local array, a runtime index before the last step",
    `TYPE DUT_LANG_rk_alrib :
STRUCT
	a : ARRAY[0..1] OF INT;
END_STRUCT
END_TYPE

FUNCTION F_LANG_rk_alrib : INT
VAR
	arr : ARRAY[0..1] OF DUT_LANG_rk_alrib;
	k : INT := 1;
	p : POINTER TO INT;
END_VAR
arr[1].a[0] := 23;
p := ADR(arr[k].a[0]);
k := 0;
F_LANG_rk_alrib := p^;
END_FUNCTION

FUNCTION_BLOCK FB_LANG_rk_adr_local_runtime_index_before_last
VAR
	v : INT;
END_VAR
v := F_LANG_rk_alrib();
END_FUNCTION_BLOCK
`),
  fb("rk_pointer_to_local_scalar_stepped", "`pointer-step` (address.ts:135) — inside a FUNCTION, a POINTER TO WORD over one local WORD, stepped by bytes and back, then dereferenced",
    `FUNCTION F_LANG_rk_ptlss : WORD
VAR
	w : WORD := 16#1234;
	p : POINTER TO WORD;
END_VAR
p := ADR(w);
p := p + 2;
p := p - 2;
F_LANG_rk_ptlss := p^;
END_FUNCTION

FUNCTION_BLOCK FB_LANG_rk_pointer_to_local_scalar_stepped
VAR
	v : WORD;
END_VAR
v := F_LANG_rk_ptlss();
END_FUNCTION_BLOCK
`),
  fb("rk_pointer_stepped_local_partial_element", "`pointer-step` (address.ts:142) — inside a FUNCTION, a POINTER TO INT over a local ARRAY OF INT stepped by ONE byte twice, then dereferenced",
    `FUNCTION F_LANG_rk_pslpe : INT
VAR
	arr : ARRAY[0..2] OF INT := [11, 22, 33];
	p : POINTER TO INT;
END_VAR
p := ADR(arr[0]);
p := p + 1;
p := p + 1;
F_LANG_rk_pslpe := p^;
END_FUNCTION

FUNCTION_BLOCK FB_LANG_rk_pointer_stepped_local_partial_element
VAR
	v : INT;
END_VAR
v := F_LANG_rk_pslpe();
END_FUNCTION_BLOCK
`),
  fb("rk_pointer_to_inout_kept_in_field", "`pointer-outlives` — an FB keeps ADR of its VAR_IN_OUT in a field; a METHOD called after the body dereferences it",
    `FUNCTION_BLOCK FB_LANG_rk_ptik_keeper
VAR_IN_OUT
	io : INT;
END_VAR
VAR
	p : POINTER TO INT;
END_VAR
p := ADR(io);
END_FUNCTION_BLOCK

METHOD Read : INT
Read := p^;
END_METHOD

FUNCTION_BLOCK FB_LANG_rk_pointer_to_inout_kept_in_field
VAR
	x : INT := 41;
	keeper : FB_LANG_rk_ptik_keeper;
	res : INT;
END_VAR
keeper(io := x);
x := 42;
res := keeper.Read();
END_FUNCTION_BLOCK
`),
  fb("rk_pointer_stepped_by_struct", "`pointer-value` (address.ts:183) — a pointer that holds an address stepped by a STRUCT value",
    `TYPE DUT_LANG_rk_psbs :
STRUCT
	n : INT;
END_STRUCT
END_TYPE

FUNCTION_BLOCK FB_LANG_rk_pointer_stepped_by_struct
VAR
	arr : ARRAY[0..2] OF INT;
	rec : DUT_LANG_rk_psbs;
	p : POINTER TO INT;
END_VAR
p := ADR(arr[0]);
p := p + rec;
END_FUNCTION_BLOCK
`),
  fb("rk_union_member_initial_value", "`layout-union` (layout.ts, the initial value) — a UNION one of whose members is declared with an initial value",
    `TYPE DUT_LANG_rk_umiv :
UNION
	w : WORD := 16#0102;
	b : BYTE;
END_UNION
END_TYPE

FUNCTION_BLOCK FB_LANG_rk_union_member_initial_value
VAR
	u : DUT_LANG_rk_umiv;
	lo : BYTE;
END_VAR
lo := u.b;
END_FUNCTION_BLOCK
`),
  fb("rk_adr_of_union_member", "`union-write` (unions.ts:53) — ADR of a member of a UNION of a WORD and two BYTEs, written through and read back",
    `TYPE DUT_LANG_rk_aum :
UNION
	w : WORD;
	b : ARRAY[0..1] OF BYTE;
END_UNION
END_TYPE

FUNCTION_BLOCK FB_LANG_rk_adr_of_union_member
VAR
	u : DUT_LANG_rk_aum;
	p : POINTER TO WORD;
	lo : BYTE;
END_VAR
p := ADR(u.w);
p^ := 16#0A0B;
lo := u.b[0];
END_FUNCTION_BLOCK
`),
  fb("rk_open_array_assigned_whole", "`open-array-value` (bounds.ts) — a FUNCTION's ARRAY[*] VAR_IN_OUT assigned whole into a sized local array",
    `FUNCTION F_LANG_rk_oaaw_first : INT
VAR_IN_OUT
	a : ARRAY[*] OF INT;
END_VAR
VAR
	tmp : ARRAY[1..3] OF INT;
END_VAR
tmp := a;
F_LANG_rk_oaaw_first := tmp[1];
END_FUNCTION

FUNCTION_BLOCK FB_LANG_rk_open_array_assigned_whole
VAR
	nums : ARRAY[1..3] OF INT := [4, 5, 6];
	res : INT;
END_VAR
res := F_LANG_rk_oaaw_first(a := nums);
END_FUNCTION_BLOCK
`),
  fb("rk_at_in_fb_two_instances", "`var-at-instances` (lower-unit.ts) — an FB declaring a variable AT %MW, instantiated twice: one instance writes, the other reads",
    `FUNCTION_BLOCK FB_LANG_rk_aiti_cell
VAR_INPUT
	write : BOOL;
END_VAR
VAR
	shared AT %MW120 : INT;
	seen : INT;
END_VAR
IF write THEN
	shared := 55;
END_IF
seen := shared;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_LANG_rk_at_in_fb_two_instances
VAR
	a : FB_LANG_rk_aiti_cell;
	b : FB_LANG_rk_aiti_cell;
END_VAR
a(write := TRUE);
b(write := FALSE);
END_FUNCTION_BLOCK
`),
  fb("rk_adr_of_string_character", "`place-shape` (places.ts:44) — ADR of one character of a STRING, `ADR(rec[1])`, dereferenced as a BYTE",
    `FUNCTION_BLOCK FB_LANG_rk_adr_of_string_character
VAR
	rec : STRING(10) := 'abc';
	p : POINTER TO BYTE;
	v : BYTE;
END_VAR
p := ADR(rec[1]);
v := p^;
END_FUNCTION_BLOCK
`),
  fb("rk_string_indexed_two_dims", "`place-shape` (places.ts:98) — a STRING indexed with TWO indices, `rec[0, 1]`",
    `FUNCTION_BLOCK FB_LANG_rk_string_indexed_two_dims
VAR
	rec : STRING(10) := 'abc';
	v : BYTE;
END_VAR
v := rec[0, 1];
END_FUNCTION_BLOCK
`),
].map(withLspGap)
