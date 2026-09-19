/**
 * Semantic diagnostic coverage tests.
 *
 * Each entry exercises one of the LSP's named semantic checks that
 * isn't naturally covered by the pragma / lifecycle / etc. catalogs.
 * From `volt-lsp-iec/src/semantic/diagnostics.ts`:
 *   - duplicateDeclaration: two declarations with the same name in one scope
 *   - unresolvedIdentifier: body reference doesn't resolve
 *   - wrongVendorPragma: pragma known but belongs to the OTHER vendor
 *   - pragmaConflict: two mutually-exclusive pragmas on the same target
 *
 * Same LanguageTest shape as pragmas — see pragma-tests.ts for field docs.
 */
import type { LanguageTest } from "../../types.js"

export const SEMANTIC_TESTS: readonly LanguageTest[] = [
  // ========================================================================
  // Category: semantic checks (cross-section LSP-rule coverage)
  // ========================================================================

  {
    name: "duplicate_declaration",
    pouName: "FB_LANG_duplicate_declaration",
    kind: "function_block",
    feature: "Same identifier declared twice in one VAR scope",
    fromDoc: "08-identifiers.md#hard-rules",
    note: "Per docs §6 'cannot be declared twice in the same local scope'. TC should error; LSP duplicateDeclaration check.",
    plcPrgVar: "fb_dd : FB_LANG_duplicate_declaration;",
    plcPrgBody: "fb_dd();",
    source: `FUNCTION_BLOCK FB_LANG_duplicate_declaration
VAR
	iCounter : INT;
	iCounter : INT;
END_VAR

END_FUNCTION_BLOCK
`,
  },

  {
    name: "unresolved_identifier_in_body",
    pouName: "FB_LANG_unresolved_identifier_in_body",
    kind: "function_block",
    feature: "Body references an identifier that doesn't exist anywhere",
    fromDoc: "09-shadowing.md",
    note: "LSP unresolvedIdentifier check is library-blind by default (warning). Earlier small-batch run showed TC errors; full 69-test batch reports clean. Same bridge-scanner batch-fidelity issue as the conversion tests.",
    plcPrgVar: "fb_ur : FB_LANG_unresolved_identifier_in_body;",
    plcPrgBody: "fb_ur.Compute();",
    source: `FUNCTION_BLOCK FB_LANG_unresolved_identifier_in_body
VAR
	iLocal : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Compute
iLocal := iThisIdentifierDoesNotExistAnywhere;
END_METHOD
`,
  },

  {
    name: "pragma_conflict_hide_plus_monitoring",
    pouName: "FB_LANG_pragma_conflict_hide_plus_monitoring",
    kind: "function_block",
    feature: "Two contradictory pragmas on the same variable",
    fromDoc: "07-pragmas.md#hide",
    note: "{attribute 'hide'} (hide from monitoring) + {attribute 'monitoring_encoding' := 'UTF8'} (configure monitoring) on the same var contradict each other. TC silently accepts; LSP pragmaConflict could flag this.",
    plcPrgVar: "fb_pc : FB_LANG_pragma_conflict_hide_plus_monitoring;",
    plcPrgBody: "fb_pc.sVal := 'x';",
    source: `FUNCTION_BLOCK FB_LANG_pragma_conflict_hide_plus_monitoring
VAR
	{attribute 'hide'}
	{attribute 'monitoring_encoding' := 'UTF8'}
	sVal : STRING;
END_VAR

END_FUNCTION_BLOCK
`,
  },

  // NOTE: wrongVendorPragma intentionally not tested here.
  //   It requires a pragma that's known to ONE vendor catalog only;
  //   we'd need to consult the LSP's vendor-specific catalogs to pick
  //   a CODESYS-only pragma that doesn't exist in the TwinCAT catalog
  //   (or vice versa). The recorder runs against TwinCAT (live bridge),
  //   so the test makes most sense as a pure-LSP unit test rather than
  //   round-trip. Skipping in v1.

  // ─── Coverage extension for check-deref.ts:66-69 (type-label switch) ─

  {
    name: "deref_on_array_type",
    pouName: "FB_LANG_deref_on_array",
    kind: "function_block",
    feature:
      "Dereference (^) applied to an ARRAY-typed variable — exercises array branch of derefOnNonPointer type-label switch",
    fromDoc: "06-data-types.md",
    note: "TC rejects `arr^` where arr is ARRAY. LSP's derefOnNonPointer check should also flag it — and the type-label string used in the diagnostic message comes from the type-kind switch, exercising the 'array_type' case.",
    plcPrgVar: "fb_doa : FB_LANG_deref_on_array;",
    plcPrgBody: "fb_doa.Bad();",
    source: `FUNCTION_BLOCK FB_LANG_deref_on_array
VAR
	arr : ARRAY[0..1] OF INT;
	x   : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Bad
x := arr^;
END_METHOD
`,
  },
  // ─── SHAPES LOWERING REFUSES — DOES THE VENDOR ACCEPT THEM? ────────────────────────────────────────
  // Each of these is a refusal code the reachability gate reported as produced by NOTHING: no fixture and no corpus
  // body makes it fire, so nobody had checked that it fires on the shape it describes, nor what CODESYS does with
  // that shape. A refusal for something the vendor REJECTS is coverage we never need; a refusal for something it
  // COMPILES is a gap with a name. Only a recording tells them apart.
  {
    name: "refuse_method_no_result",
    refused: "Cannot convert type 'Unknown type: 'm.NoRet()'' to type 'INT'",
    pouName: "FB_LANG_refuse_method_no_result",
    kind: "function_block" as const,
    feature: "a METHOD with no return type used as a VALUE — `call-no-result`",
    fromDoc: "03-operators.md",
    plcPrgVar: "inst_refuse_method_no_result : FB_LANG_refuse_method_no_result;",
    plcPrgBody: "inst_refuse_method_no_result();",
    source: "FUNCTION_BLOCK FB_LANG_noresult_target\nEND_FUNCTION_BLOCK\n\nMETHOD NoRet\nEND_METHOD\n\nFUNCTION_BLOCK FB_LANG_refuse_method_no_result\nVAR\n\tm : FB_LANG_noresult_target;\n\ta : INT;\nEND_VAR\na := m.NoRet();\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "refuse_inout_bound_to_bit",
    refused: "Type 'BIT' is not equal to type 'BOOL' of VAR_IN_OUT respectively REFERENCE 'io'",
    pouName: "FB_LANG_refuse_inout_bound_to_bit",
    kind: "function_block" as const,
    feature: "a VAR_IN_OUT bound to a BIT of a word — `call-inout-bit`; a bit is not a place with an address",
    fromDoc: "02-variables.md",
    plcPrgVar: "inst_refuse_inout_bound_to_bit : FB_LANG_refuse_inout_bound_to_bit;",
    plcPrgBody: "inst_refuse_inout_bound_to_bit();",
    source: "FUNCTION_BLOCK FB_LANG_inoutbit_target\nVAR_IN_OUT\n\tio : BOOL;\nEND_VAR\nio := TRUE;\nEND_FUNCTION_BLOCK\n\nFUNCTION_BLOCK FB_LANG_refuse_inout_bound_to_bit\nVAR\n\tw : WORD;\n\tk : FB_LANG_inoutbit_target;\nEND_VAR\nk(io := w.3);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "refuse_inout_not_given",
    refused: "VAR_IN_OUT 'io' must be assigned in call of 'FB_LANG_inoutmissing_target'",
    pouName: "FB_LANG_refuse_inout_not_given",
    kind: "function_block" as const,
    feature: "an FB with a VAR_IN_OUT called WITHOUT binding it — `call-inout-missing`",
    fromDoc: "02-variables.md",
    plcPrgVar: "inst_refuse_inout_not_given : FB_LANG_refuse_inout_not_given;",
    plcPrgBody: "inst_refuse_inout_not_given();",
    source: "FUNCTION_BLOCK FB_LANG_inoutmissing_target\nVAR_IN_OUT\n\tio : INT;\nEND_VAR\nio := io + 1;\nEND_FUNCTION_BLOCK\n\nFUNCTION_BLOCK FB_LANG_refuse_inout_not_given\nVAR\n\tk : FB_LANG_inoutmissing_target;\n\tkept : INT;\nEND_VAR\nk();\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "refuse_var_temp_struct",
    pouName: "FB_LANG_refuse_var_temp_struct",
    kind: "function_block" as const,
    feature: "a VAR_TEMP of a STRUCT type — CODESYS COMPILES it; `var-temp-composite` is our own refusal, not the vendor's",
    fromDoc: "02-variables.md",
    plcPrgVar: "inst_refuse_var_temp_struct : FB_LANG_refuse_var_temp_struct;",
    plcPrgBody: "inst_refuse_var_temp_struct();",
    source: "TYPE DUT_LANG_temp_struct :\nSTRUCT\n\tx : INT;\nEND_STRUCT\nEND_TYPE\n\nFUNCTION_BLOCK FB_LANG_refuse_var_temp_struct\nVAR\n\tkept : INT;\nEND_VAR\nVAR_TEMP\n\tscratch : DUT_LANG_temp_struct;\nEND_VAR\nscratch.x := 1;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "refuse_super_without_base",
    refused: "Program name, function or function block instance expected instead of 'SUPER^'",
    pouName: "FB_LANG_refuse_super_without_base",
    kind: "function_block" as const,
    feature: "SUPER^() in an FB that EXTENDS nothing — `call-super`",
    fromDoc: "03-operators.md",
    plcPrgVar: "inst_refuse_super_without_base : FB_LANG_refuse_super_without_base;",
    plcPrgBody: "inst_refuse_super_without_base();",
    source: "FUNCTION_BLOCK FB_LANG_refuse_super_without_base\nVAR\n\tn : INT;\nEND_VAR\nSUPER^();\nn := 1;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "refuse_pointer_two_targets",
    pouName: "FB_LANG_refuse_pointer_two_targets",
    kind: "function_block" as const,
    feature: "a POINTER given TWO different targets before it is read — `pointer-targets` (design §9 form 1)",
    fromDoc: "05-operands.md",
    plcPrgVar: "inst_refuse_pointer_two_targets : FB_LANG_refuse_pointer_two_targets;",
    plcPrgBody: "inst_refuse_pointer_two_targets();",
    source: "FUNCTION_BLOCK FB_LANG_refuse_pointer_two_targets\nVAR\n\ta : INT := 1;\n\tb : INT := 2;\n\tp : POINTER TO INT;\n\tseen : INT;\nEND_VAR\np := ADR(a);\np := ADR(b);\nseen := p^;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "refuse_sizeof_interface",
    pouName: "FB_LANG_refuse_sizeof_interface",
    kind: "function_block" as const,
    feature: "SIZEOF an INTERFACE variable — `sizeof-unmeasured`; what does a reference to an instance measure?",
    fromDoc: "05-operands.md",
    plcPrgVar: "inst_refuse_sizeof_interface : FB_LANG_refuse_sizeof_interface;",
    plcPrgBody: "inst_refuse_sizeof_interface();",
    source: "INTERFACE I_LANG_sizeof\nMETHOD M : INT\nEND_METHOD\nEND_INTERFACE\n\nFUNCTION_BLOCK FB_LANG_refuse_sizeof_interface\nVAR\n\theld : I_LANG_sizeof;\n\tn : ULINT;\nEND_VAR\nn := SIZEOF(held);\nEND_FUNCTION_BLOCK\n",
  },
  // ─── A UNARY OPERATOR ON A TYPE THAT IS NOT A NUMBER ───────────────────────────────────────────────
  // `-s` on a STRING, `NOT s` on a STRING and `-b` on a BOOL all LOWERED and then threw inside the interpreter
  // ("expected a number, got string") — the `unary-op` refusal existed and never fired, because nothing checked the
  // operand's type. Refused now. These record whether CODESYS compiles them at all, and `-T#2S` asks the one that is
  // genuinely open: TIME is unsigned 32-bit milliseconds, so negating it WRAPS to 4294965296 in both backends, and
  // whether the vendor accepts the expression is unrecorded.
  {
    name: "unary_minus_on_string",
    refused: "Cannot convert type 'INT' to type 'STRING'",
    pouName: "FB_LANG_unary_minus_on_string",
    kind: "function_block" as const,
    feature: "unary minus on a STRING — a type error, or something?",
    fromDoc: "03-operators.md",
    plcPrgVar: "inst_unary_minus_on_string : FB_LANG_unary_minus_on_string;",
    plcPrgBody: "inst_unary_minus_on_string();",
    source: "FUNCTION_BLOCK FB_LANG_unary_minus_on_string\nVAR\n\ttext : STRING := 'abc';\n\tout : STRING;\nEND_VAR\nout := -text;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "unary_not_on_string",
    refused: "Cannot convert type 'STRING' to type 'ANY_BIT'",
    pouName: "FB_LANG_unary_not_on_string",
    kind: "function_block" as const,
    feature: "NOT on a STRING",
    fromDoc: "03-operators.md",
    plcPrgVar: "inst_unary_not_on_string : FB_LANG_unary_not_on_string;",
    plcPrgBody: "inst_unary_not_on_string();",
    source: "FUNCTION_BLOCK FB_LANG_unary_not_on_string\nVAR\n\ttext : STRING := 'abc';\n\tout : STRING;\nEND_VAR\nout := NOT text;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "unary_minus_on_bool",
    refused: "Cannot convert type 'INT' to type 'BOOL'",
    pouName: "FB_LANG_unary_minus_on_bool",
    kind: "function_block" as const,
    feature: "unary minus on a BOOL",
    fromDoc: "03-operators.md",
    plcPrgVar: "inst_unary_minus_on_bool : FB_LANG_unary_minus_on_bool;",
    plcPrgBody: "inst_unary_minus_on_bool();",
    source: "FUNCTION_BLOCK FB_LANG_unary_minus_on_bool\nVAR\n\tb : BOOL := TRUE;\n\tout : BOOL;\nEND_VAR\nout := -b;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "unary_minus_on_time",
    refused: "Cannot convert type 'DINT' to type 'TIME'",
    pouName: "FB_LANG_unary_minus_on_time",
    kind: "function_block" as const,
    feature: "unary minus on a TIME — accepted? and does it wrap, TIME being unsigned 32-bit ms?",
    fromDoc: "03-operators.md",
    plcPrgVar: "inst_unary_minus_on_time : FB_LANG_unary_minus_on_time;",
    plcPrgBody: "inst_unary_minus_on_time();",
    source: "FUNCTION_BLOCK FB_LANG_unary_minus_on_time\nVAR\n\tt1 : TIME := T#2S;\n\tout : TIME;\n\tasDint : DINT;\nEND_VAR\nout := -t1;\nasDint := TIME_TO_DINT(-t1);\nEND_FUNCTION_BLOCK\n",
  },
  // ─── SHAPES THAT LOWER, WHERE A REFUSAL EXISTS FOR THEM ────────────────────────────────────────────
  // The mirror of the block above. Each of these has a refusal code written for it that the shape does NOT trigger —
  // so either the code is unreachable (dead) or the construct takes a different path and the refusal describes
  // something else. Both are worth knowing, and both need the vendor's answer first: if CODESYS rejects the program,
  // lowering it is the defect; if CODESYS compiles it, the answer it gives is what we must match.
  {
    name: "accepts_output_into_other_type",
    refused: "Cannot convert type 'INT' to type 'STRING'",
    pouName: "FB_LANG_accepts_output_into_other_type",
    kind: "function_block" as const,
    feature: "an INT VAR_OUTPUT read out into a STRING variable — `call-output-type` exists, and this does not trigger it",
    fromDoc: "02-variables.md",
    plcPrgVar: "inst_accepts_output_into_other_type : FB_LANG_accepts_output_into_other_type;",
    plcPrgBody: "inst_accepts_output_into_other_type();",
    source: "FUNCTION_BLOCK FB_LANG_outtype_target\nVAR_OUTPUT\n\to : INT;\nEND_VAR\no := 1;\nEND_FUNCTION_BLOCK\n\nFUNCTION_BLOCK FB_LANG_accepts_output_into_other_type\nVAR\n\tw : FB_LANG_outtype_target;\n\ttext : STRING;\nEND_VAR\nw(o => text);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "accepts_method_var_output",
    pouName: "FB_LANG_accepts_method_var_output",
    kind: "function_block" as const,
    feature: "a METHOD declaring VAR_OUTPUT — `routine-var_output` exists, and this lowers",
    fromDoc: "02-variables.md",
    plcPrgVar: "inst_accepts_method_var_output : FB_LANG_accepts_method_var_output;",
    plcPrgBody: "inst_accepts_method_var_output();",
    source: "FUNCTION_BLOCK FB_LANG_routineout_target\nEND_FUNCTION_BLOCK\n\nMETHOD M : INT\nVAR_OUTPUT\n\textra : INT;\nEND_VAR\nM := 1;\nextra := 2;\nEND_METHOD\n\nFUNCTION_BLOCK FB_LANG_accepts_method_var_output\nVAR\n\tv : FB_LANG_routineout_target;\n\ta : INT;\nEND_VAR\na := v.M();\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "accepts_partial_access",
    pouName: "FB_LANG_accepts_partial_access",
    kind: "function_block" as const,
    feature: "a partial access `d.%W0` on a DWORD — `partial-access` exists, and this lowers",
    fromDoc: "05-operands.md",
    plcPrgVar: "inst_accepts_partial_access : FB_LANG_accepts_partial_access;",
    plcPrgBody: "inst_accepts_partial_access();",
    source: "FUNCTION_BLOCK FB_LANG_accepts_partial_access\nVAR\n\td : DWORD := 16#12345678;\n\tword0 : WORD;\n\tbyte0 : BYTE;\nEND_VAR\nword0 := d.%W0;\nbyte0 := d.%B0;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "accepts_interface_in_array",
    pouName: "FB_LANG_accepts_interface_in_array",
    kind: "function_block" as const,
    feature: "an interface stored into an ARRAY element and called through — `interface-store` exists, and this lowers",
    fromDoc: "03-operators.md",
    plcPrgVar: "inst_accepts_interface_in_array : FB_LANG_accepts_interface_in_array;",
    plcPrgBody: "inst_accepts_interface_in_array();",
    source: "INTERFACE I_LANG_arr\nMETHOD M : INT\nEND_METHOD\nEND_INTERFACE\n\nFUNCTION_BLOCK FB_LANG_arr_impl IMPLEMENTS I_LANG_arr\nEND_FUNCTION_BLOCK\n\nMETHOD M : INT\nM := 7;\nEND_METHOD\n\nFUNCTION_BLOCK FB_LANG_accepts_interface_in_array\nVAR\n\theld : FB_LANG_arr_impl;\n\tslots : ARRAY[0..1] OF I_LANG_arr;\n\ta : INT;\nEND_VAR\nslots[0] := held;\na := slots[0].M();\nEND_FUNCTION_BLOCK\n",
  },
  // ─── MORE SHAPES NOTHING EXERCISED (batch two) ─────────────────────────────────────────────────────
  // The same sweep as above, over the refusal codes still reported as reached by nothing. Several of these guard
  // against a WRONG ANSWER rather than an unbuilt construct — an in-out bound to a place the call already holds, a
  // FOR step that calls, a PROGRAM reached while it runs — so what CODESYS does with them is the interesting half:
  // the refusal says "how often this runs, or which write wins, is not recorded", and a recording ends that.
  {
    name: "refuse_inout_aliases_receiver",
    pouName: "FB_LANG_refuse_inout_aliases_receiver",
    kind: "function_block" as const,
    feature: "a VAR_IN_OUT bound to a field of the instance the call runs on — `call-inout-alias`; which write wins?",
    fromDoc: "02-variables.md",
    plcPrgVar: "inst_refuse_inout_aliases_receiver : FB_LANG_refuse_inout_aliases_receiver;",
    plcPrgBody: "inst_refuse_inout_aliases_receiver();",
    source: "FUNCTION_BLOCK FB_LANG_alias_sink\nVAR_IN_OUT\n\tio : INT;\nEND_VAR\nio := io + 1;\nEND_FUNCTION_BLOCK\n\nFUNCTION_BLOCK FB_LANG_refuse_inout_aliases_receiver\nVAR\n\tcount : INT := 10;\n\tsink : FB_LANG_alias_sink;\n\tseen : INT;\nEND_VAR\nsink(io := THIS^.count);\nseen := count;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "refuse_fb_called_positionally",
    refused: "Assignment to input missing for parameter '5' in call of 'FB_LANG_POSITIONAL_TARGET'",
    pouName: "FB_LANG_refuse_fb_called_positionally",
    kind: "function_block" as const,
    feature: "an FB BODY call with a positional argument — `call-positional`; does the vendor take it?",
    fromDoc: "03-operators.md",
    plcPrgVar: "inst_refuse_fb_called_positionally : FB_LANG_refuse_fb_called_positionally;",
    plcPrgBody: "inst_refuse_fb_called_positionally();",
    source: "FUNCTION_BLOCK FB_LANG_positional_target\nVAR_INPUT\n\tn : INT;\nEND_VAR\nVAR_OUTPUT\n\tseen : INT;\nEND_VAR\nseen := n;\nEND_FUNCTION_BLOCK\n\nFUNCTION_BLOCK FB_LANG_refuse_fb_called_positionally\nVAR\n\ttarget : FB_LANG_positional_target;\n\tgot : INT;\nEND_VAR\ntarget(5);\ngot := target.seen;\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "refuse_for_step_calls",
    pouName: "FB_LANG_refuse_for_step_calls",
    kind: "function_block" as const,
    feature: "a FOR STEP that calls a METHOD — `for-bound-call`; how many times does the step run?",
    fromDoc: "01-languages-and-editors.md",
    plcPrgVar: "inst_refuse_for_step_calls : FB_LANG_refuse_for_step_calls;",
    plcPrgBody: "inst_refuse_for_step_calls();",
    source: "FUNCTION_BLOCK FB_LANG_step_source\nVAR\n\tn : INT := 2;\nEND_VAR\nEND_FUNCTION_BLOCK\n\nMETHOD Step : INT\nn := n + 1;\nStep := n;\nEND_METHOD\n\nFUNCTION_BLOCK FB_LANG_refuse_for_step_calls\nVAR\n\tstepper : FB_LANG_step_source;\n\ti : INT;\n\tpasses : INT;\n\tstepsRun : INT;\nEND_VAR\nFOR i := 0 TO 6 BY stepper.Step() DO\n\tpasses := passes + 1;\nEND_FOR\nstepsRun := stepper.Step();\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "refuse_adr_difference",
    pouName: "FB_LANG_refuse_adr_difference",
    kind: "function_block" as const,
    feature: "ADR(a) - ADR(b) on two UNRELATED variables — `adr-offset`; is the gap even defined?",
    fromDoc: "05-operands.md",
    plcPrgVar: "inst_refuse_adr_difference : FB_LANG_refuse_adr_difference;",
    plcPrgBody: "inst_refuse_adr_difference();",
    source: "FUNCTION_BLOCK FB_LANG_refuse_adr_difference\nVAR\n\ta : INT;\n\tb : INT;\n\tgap : DWORD;\nEND_VAR\ngap := ADR(a) - ADR(b);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "refuse_interface_any_input",
    pouName: "FB_LANG_refuse_interface_any_input",
    kind: "function_block" as const,
    feature: "an ANY VAR_INPUT called THROUGH an interface — `interface-any-input`; the size, or the value?",
    fromDoc: "03-operators.md",
    plcPrgVar: "inst_refuse_interface_any_input : FB_LANG_refuse_interface_any_input;",
    plcPrgBody: "inst_refuse_interface_any_input();",
    source: "INTERFACE I_LANG_anyin\nMETHOD Take : DINT\nVAR_INPUT\n\tv : ANY;\nEND_VAR\nEND_METHOD\nEND_INTERFACE\n\nFUNCTION_BLOCK FB_LANG_anyin_impl IMPLEMENTS I_LANG_anyin\nEND_FUNCTION_BLOCK\n\nMETHOD Take : DINT\nVAR_INPUT\n\tv : ANY;\nEND_VAR\nTake := v.diSize;\nEND_METHOD\n\nFUNCTION_BLOCK FB_LANG_refuse_interface_any_input\nVAR\n\timpl : FB_LANG_anyin_impl;\n\tthrough : I_LANG_anyin;\n\tsized : DINT;\n\tbig : LREAL := 42.0;\nEND_VAR\nthrough := impl;\nsized := through.Take(v := big);\nEND_FUNCTION_BLOCK\n",
  },
  {
    name: "accepts_output_bound_twice",
    pouName: "FB_LANG_accepts_output_bound_twice",
    kind: "function_block" as const,
    feature: "the SAME VAR_OUTPUT read out TWICE in one call — lowers today; does the vendor accept it?",
    fromDoc: "02-variables.md",
    plcPrgVar: "inst_accepts_output_bound_twice : FB_LANG_accepts_output_bound_twice;",
    plcPrgBody: "inst_accepts_output_bound_twice();",
    source: "FUNCTION_BLOCK FB_LANG_twice_target\nVAR_OUTPUT\n\to : INT;\nEND_VAR\no := o + 1;\nEND_FUNCTION_BLOCK\n\nFUNCTION_BLOCK FB_LANG_accepts_output_bound_twice\nVAR\n\ttarget : FB_LANG_twice_target;\n\tfirst : INT;\n\tsecond : INT;\nEND_VAR\ntarget(o => first, o => second);\nEND_FUNCTION_BLOCK\n",
  },
]
