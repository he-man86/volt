/**
 * OOP SHAPES A REFUSAL CODE WAS UNDECIDED ABOUT — openspec `transpile-refusal-classification` 2.2: FB_Init and the init
 * step's attributes, interfaces, inheritance. Each fixture reaches one refusal site of `lower/diagnostics/codes.ts` that no
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
  rk_init_slot_method_with_input: "A signature decorated with the 'call_after_global_init_slot' attribute must either have no arguments or a single input named 'bInitRetains'.",
  rk_interface_given_fb_not_implementing: "Cannot convert type 'FB_LANG_rk_igfn_plain' to type 'ITF_LANG_rk_igfn'",
  rk_interface_given_integer: "Cannot convert type 'INT' to type 'ITF_LANG_rk_igi'",
}

function withLspGap(t: LanguageTest): LanguageTest {
  const said = LSP_GAPS[t.name]
  return said === undefined ? t : { ...t, deferred: { lsp: `niche: accepted loss (0 occurrences in the corpora) — the LSP says nothing where CODESYS says "${said}"` } }
}

export const OOP_REFUSAL_KIND_TESTS: readonly LanguageTest[] = [
  fb("rk_fb_init_array_elements", "`attr-init-unreached` (fb-init.ts) — an ARRAY of an FB whose FB_Init writes a field: does each element's FB_Init run?",
    `FUNCTION_BLOCK FB_LANG_rk_fiae_cell
VAR
	n : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD FB_Init : BOOL
VAR_INPUT
	bInitRetains : BOOL;
	bInCopyCode : BOOL;
END_VAR
n := 7;
END_METHOD

FUNCTION_BLOCK FB_LANG_rk_fb_init_array_elements
VAR
	cells : ARRAY[0..1] OF FB_LANG_rk_fiae_cell;
	first : INT;
	second : INT;
END_VAR
first := cells[0].n;
second := cells[1].n;
END_FUNCTION_BLOCK
`),
  fb("rk_init_slot_method_with_input", "`attr-init-inputs` (attributes.ts) — a `call_after_global_init_slot` METHOD that declares a VAR_INPUT",
    `FUNCTION_BLOCK FB_LANG_rk_ismi_cell
VAR
	inits : INT;
END_VAR
END_FUNCTION_BLOCK

{attribute 'call_after_global_init_slot' := '50000'}
METHOD AfterInit
VAR_INPUT
	step : INT;
END_VAR
inits := inits + 1 + step;
END_METHOD

FUNCTION_BLOCK FB_LANG_rk_init_slot_method_with_input
VAR
	cell : FB_LANG_rk_ismi_cell;
	seen : INT;
END_VAR
seen := cell.inits;
END_FUNCTION_BLOCK
`),
  fb("rk_init_slot_method_binitretains", "`attr-init-inputs` (attributes.ts) — a `call_after_global_init_slot` METHOD whose one input is `bInitRetains : BOOL`, the shape the vendor names as allowed",
    `FUNCTION_BLOCK FB_LANG_rk_isbr_cell
VAR
	inits : INT;
	retains : BOOL := TRUE;
END_VAR
END_FUNCTION_BLOCK

{attribute 'call_after_global_init_slot' := '50000'}
METHOD AfterInit
VAR_INPUT
	bInitRetains : BOOL;
END_VAR
inits := inits + 1;
retains := bInitRetains;
END_METHOD

FUNCTION_BLOCK FB_LANG_rk_init_slot_method_binitretains
VAR
	cell : FB_LANG_rk_isbr_cell;
	seen : INT;
	seenRetains : BOOL;
END_VAR
seen := cell.inits;
seenRetains := cell.retains;
END_FUNCTION_BLOCK
`),
  fb("rk_instance_path_not_string", "`attr-instance-path` (attributes.ts:53) — `{attribute 'instance-path'}` on a field that is an INT, not a STRING",
    `FUNCTION_BLOCK FB_LANG_rk_ipns_cell
VAR
	{attribute 'instance-path'}
	{attribute 'noinit'}
	path : INT;
END_VAR
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_LANG_rk_instance_path_not_string
VAR
	cell : FB_LANG_rk_ipns_cell;
	seen : INT;
END_VAR
seen := cell.path;
END_FUNCTION_BLOCK
`),
  fb("rk_fb_init_positional_argument", "`fb-init-argument` (fb-init.ts:157) — an FB_Init argument given POSITIONALLY in the declaration, `cell : FB(5)`",
    `FUNCTION_BLOCK FB_LANG_rk_fipa_cell
VAR
	start : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD FB_Init : BOOL
VAR_INPUT
	bInitRetains : BOOL;
	bInCopyCode : BOOL;
	startValue : INT;
END_VAR
start := startValue;
END_METHOD

FUNCTION_BLOCK FB_LANG_rk_fb_init_positional_argument
VAR
	cell : FB_LANG_rk_fipa_cell(5);
	seen : INT;
END_VAR
seen := cell.start;
END_FUNCTION_BLOCK
`),
  fb("rk_fb_init_with_inout", "`fb-init-argument` (fb-init.ts:163) — an FB_Init that declares a VAR_IN_OUT, bound in the instance's declaration",
    `FUNCTION_BLOCK FB_LANG_rk_fiwi_cell
VAR
	got : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD FB_Init : BOOL
VAR_INPUT
	bInitRetains : BOOL;
	bInCopyCode : BOOL;
END_VAR
VAR_IN_OUT
	io : INT;
END_VAR
got := io;
io := io + 1;
END_METHOD

FUNCTION_BLOCK FB_LANG_rk_fb_init_with_inout
VAR
	src : INT := 3;
	cell : FB_LANG_rk_fiwi_cell(io := src);
	seen : INT;
END_VAR
seen := cell.got;
END_FUNCTION_BLOCK
`),
  fb("rk_super_base_library", "`call-super` (super.ts:32, the base with no body) — `SUPER^()` in an FB that EXTENDS a library FB, Standard.TON",
    `FUNCTION_BLOCK FB_LANG_rk_sbl_timer EXTENDS Standard.TON
VAR
	calls : INT;
END_VAR
calls := calls + 1;
SUPER^(IN := TRUE, PT := T#1H);
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_LANG_rk_super_base_library
VAR
	t : FB_LANG_rk_sbl_timer;
	seen : INT;
END_VAR
t();
seen := t.calls;
END_FUNCTION_BLOCK
`),
  fb("rk_interface_impl_method_inout", "`interface-call-shape` (dispatch.ts:90) — an FB implements an interface METHOD with an extra VAR_IN_OUT the interface's declaration has not",
    `INTERFACE ITF_LANG_rk_iimi
METHOD M : INT
VAR_INPUT
	a : INT;
END_VAR
END_METHOD
END_INTERFACE

FUNCTION_BLOCK FB_LANG_rk_iimi_impl IMPLEMENTS ITF_LANG_rk_iimi
END_FUNCTION_BLOCK

METHOD M : INT
VAR_INPUT
	a : INT;
END_VAR
VAR_IN_OUT
	io : INT;
END_VAR
M := a + io;
END_METHOD

FUNCTION_BLOCK FB_LANG_rk_interface_impl_method_inout
VAR
	impl : FB_LANG_rk_iimi_impl;
	itf : ITF_LANG_rk_iimi;
	res : INT;
END_VAR
itf := impl;
res := itf.M(a := 2);
END_FUNCTION_BLOCK
`),
  fb("rk_interface_given_fb_not_implementing", "`interface-type` (tags.ts:146) — an interface variable given an instance of a project FB that does not IMPLEMENT it",
    `INTERFACE ITF_LANG_rk_igfn
METHOD M : INT
END_METHOD
END_INTERFACE

FUNCTION_BLOCK FB_LANG_rk_igfn_plain
END_FUNCTION_BLOCK

METHOD M : INT
M := 1;
END_METHOD

FUNCTION_BLOCK FB_LANG_rk_interface_given_fb_not_implementing
VAR
	plain : FB_LANG_rk_igfn_plain;
	itf : ITF_LANG_rk_igfn;
	res : INT;
END_VAR
itf := plain;
res := itf.M();
END_FUNCTION_BLOCK
`),
  fb("rk_interface_given_integer", "`interface-value` (tags.ts:158) — an interface variable given an INT variable",
    `INTERFACE ITF_LANG_rk_igi
METHOD M : INT
END_METHOD
END_INTERFACE

FUNCTION_BLOCK FB_LANG_rk_interface_given_integer
VAR
	n : INT := 1;
	itf : ITF_LANG_rk_igi;
	ok : BOOL;
END_VAR
itf := n;
ok := itf <> 0;
END_FUNCTION_BLOCK
`),
  fb("rk_interface_set_by_ref", "`interface-store` (access-guards.ts) — an interface variable bound by `REF=` to an FB instance",
    `INTERFACE ITF_LANG_rk_isbr
METHOD M : INT
END_METHOD
END_INTERFACE

FUNCTION_BLOCK FB_LANG_rk_isbr_impl IMPLEMENTS ITF_LANG_rk_isbr
END_FUNCTION_BLOCK

METHOD M : INT
M := 2;
END_METHOD

FUNCTION_BLOCK FB_LANG_rk_interface_set_by_ref
VAR
	impl : FB_LANG_rk_isbr_impl;
	itf : ITF_LANG_rk_isbr;
	res : INT;
END_VAR
itf REF= impl;
res := itf.M();
END_FUNCTION_BLOCK
`),
  fb("rk_interface_input_through_interface", "`interface-input` (dispatch.ts:60) — an interface METHOD called THROUGH an interface with another interface as its input",
    `INTERFACE ITF_LANG_rk_iiti_value
METHOD Get : INT
END_METHOD
END_INTERFACE

INTERFACE ITF_LANG_rk_iiti_reader
METHOD Read : INT
VAR_INPUT
	src : ITF_LANG_rk_iiti_value;
END_VAR
END_METHOD
END_INTERFACE

FUNCTION_BLOCK FB_LANG_rk_iiti_value IMPLEMENTS ITF_LANG_rk_iiti_value
END_FUNCTION_BLOCK

METHOD Get : INT
Get := 31;
END_METHOD

FUNCTION_BLOCK FB_LANG_rk_iiti_reader IMPLEMENTS ITF_LANG_rk_iiti_reader
END_FUNCTION_BLOCK

METHOD Read : INT
VAR_INPUT
	src : ITF_LANG_rk_iiti_value;
END_VAR
Read := src.Get() + 1;
END_METHOD

FUNCTION_BLOCK FB_LANG_rk_interface_input_through_interface
VAR
	value : FB_LANG_rk_iiti_value;
	reader : FB_LANG_rk_iiti_reader;
	itfValue : ITF_LANG_rk_iiti_value;
	itfReader : ITF_LANG_rk_iiti_reader;
	res : INT;
END_VAR
itfValue := value;
itfReader := reader;
res := itfReader.Read(src := itfValue);
END_FUNCTION_BLOCK
`),
  fb("rk_interface_from_runtime_indexed_element", "`interface-instance` (tags.ts:62) — an interface variable given an element of an FB array at a runtime index",
    `INTERFACE ITF_LANG_rk_ifrie
METHOD Id : INT
END_METHOD
END_INTERFACE

FUNCTION_BLOCK FB_LANG_rk_ifrie_cell IMPLEMENTS ITF_LANG_rk_ifrie
VAR_INPUT
	ident : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD Id : INT
Id := ident;
END_METHOD

FUNCTION_BLOCK FB_LANG_rk_interface_from_runtime_indexed_element
VAR
	cells : ARRAY[0..1] OF FB_LANG_rk_ifrie_cell;
	k : INT := 1;
	itf : ITF_LANG_rk_ifrie;
	res : INT;
END_VAR
cells[1].ident := 8;
itf := cells[k];
res := itf.Id();
END_FUNCTION_BLOCK
`),
  fb("rk_interface_read_from_other_instance_field", "`interface-place` (lend.ts:23) — an interface held in a field of ANOTHER FB instance, called through from outside it",
    `INTERFACE ITF_LANG_rk_iroif
METHOD Id : INT
END_METHOD
END_INTERFACE

FUNCTION_BLOCK FB_LANG_rk_iroif_impl IMPLEMENTS ITF_LANG_rk_iroif
END_FUNCTION_BLOCK

METHOD Id : INT
Id := 13;
END_METHOD

FUNCTION_BLOCK FB_LANG_rk_iroif_holder
VAR
	impl : FB_LANG_rk_iroif_impl;
	held : ITF_LANG_rk_iroif;
END_VAR
held := impl;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_LANG_rk_interface_read_from_other_instance_field
VAR
	holder : FB_LANG_rk_iroif_holder;
	itf : ITF_LANG_rk_iroif;
	res : INT;
END_VAR
holder();
itf := holder.held;
res := itf.Id();
END_FUNCTION_BLOCK
`),
  fb("rk_interface_property_not_implemented", "`property-accessor` (dispatch.ts:108) — an FB IMPLEMENTS an interface whose PROPERTY it does not declare",
    `INTERFACE ITF_LANG_rk_ipni
PROPERTY Level : INT
GET
END_GET
END_PROPERTY
END_INTERFACE

FUNCTION_BLOCK FB_LANG_rk_ipni_impl IMPLEMENTS ITF_LANG_rk_ipni
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_LANG_rk_interface_property_not_implemented
VAR
	impl : FB_LANG_rk_ipni_impl;
	itf : ITF_LANG_rk_ipni;
	res : INT;
END_VAR
itf := impl;
res := itf.Level;
END_FUNCTION_BLOCK
`),
  fb("rk_interface_bound_to_inout", "`interface-store` (access-guards.ts) — an interface variable bound to a FUNCTION's interface VAR_IN_OUT, called through there",
    `INTERFACE ITF_LANG_rk_ibti
METHOD Id : INT
END_METHOD
END_INTERFACE

FUNCTION_BLOCK FB_LANG_rk_ibti_impl IMPLEMENTS ITF_LANG_rk_ibti
END_FUNCTION_BLOCK

METHOD Id : INT
Id := 6;
END_METHOD

FUNCTION F_LANG_rk_ibti_read : INT
VAR_IN_OUT
	io : ITF_LANG_rk_ibti;
END_VAR
F_LANG_rk_ibti_read := io.Id();
END_FUNCTION

FUNCTION_BLOCK FB_LANG_rk_interface_bound_to_inout
VAR
	impl : FB_LANG_rk_ibti_impl;
	itf : ITF_LANG_rk_ibti;
	res : INT;
END_VAR
itf := impl;
res := F_LANG_rk_ibti_read(io := itf);
END_FUNCTION_BLOCK
`),
  fb("rk_queryinterface_from_instance", "`interface-query` (query.ts:43) — `__QUERYINTERFACE` whose FIRST operand is an FB instance, not an interface",
    `INTERFACE ITF_LANG_rk_qfi EXTENDS __SYSTEM.IQueryInterface
METHOD Id : INT
END_METHOD
END_INTERFACE

FUNCTION_BLOCK FB_LANG_rk_qfi_impl IMPLEMENTS ITF_LANG_rk_qfi
END_FUNCTION_BLOCK

METHOD Id : INT
Id := 4;
END_METHOD

FUNCTION_BLOCK FB_LANG_rk_queryinterface_from_instance
VAR
	impl : FB_LANG_rk_qfi_impl;
	itf : ITF_LANG_rk_qfi;
	found : BOOL;
	res : INT;
END_VAR
found := __QUERYINTERFACE(impl, itf);
IF found THEN
	res := itf.Id();
END_IF
END_FUNCTION_BLOCK
`),
].map(withLspGap)
