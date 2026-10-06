/**
 * CALL RULES — openspec `analysis-conformance` task 3.8.1 (calls), rule by rule, the builders no recorded fixture fired
 * (0.3) and each rule's unmeasured sides:
 *
 *   call-arguments      a `name => target` naming no output of an FB, a FUNCTION, a METHOD, or naming an INPUT
 *                       (`unknownNamedOutput`, 0 TP); a FUNCTION given too few positional arguments, and none where every
 *                       input has a default; a VAR_IN_OUT left unbound in a METHOD's and a FUNCTION's call; a VAR_IN_OUT
 *                       bound to a VAR CONSTANT, an expression, a call's result, a property
 *   call-result-access  an index on a METHOD call's result
 *   fb-instantiation    an FB type and an INTERFACE type passed as a call's argument
 *   intrinsic-operands  ADR of a BIT field and of a bit access (`adrOnBit`, 0 TP); INI of an INT and of an FB instance
 *                       (`iniNeedsInstance`, 0 TP); __QUERYINTERFACE with an INT first and an INT second operand, and a
 *                       legal one; __QUERYPOINTER with an INT second operand, and a legal one (`queryInterfaceFirst`,
 *                       `queryInterfaceSecond`, `queryPointerSecond`, 0 TP); SQRT of a BOOL
 *   non-callable-call   an enum value, a STRUCT instance and a VAR CONSTANT called
 *   recursive-call      a METHOD calling itself; FUNCTIONs calling each other
 *
 * GLOBAL NAMES ARE THE FIXTURE'S OWN (`FB_LANG_<name>…`, `F_LANG_<name>…`, `ITF_LANG_<name>…`, `DUT_LANG_<name>…`): the
 * replay binds every fixture into one project.
 */
import type { LanguageTest } from "../../types.js"

const doc = "openspec analysis-conformance 3.8.1 (calls); docs/codesys-reference/03-operators.md"

/** A function block `FB_LANG_<name>`, instanced and called from PLC_PRG, its whole text `source` (dependencies first). */
function fb(name: string, feature: string, source: string, plcPrgVar = `inst_${name} : FB_LANG_${name};`, plcPrgBody = `inst_${name}();`): LanguageTest {
  return { name, pouName: `FB_LANG_${name}`, kind: "function_block", feature, fromDoc: doc, plcPrgVar, plcPrgBody, source }
}

/** `FUNCTION_BLOCK FB_LANG_<name>` declaring `vars`, running `body`, then `members`. */
const fbText = (name: string, vars: string, body: string, members = ""): string =>
  `FUNCTION_BLOCK FB_LANG_${name}\nVAR\n${vars}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n${members === "" ? "" : `\n${members}`}`

/** A helper FB `FB_LANG_<name>_t` with `sections`, `body` and `members`, ahead of the fixture's FB. */
const helper = (name: string, sections: string, body = "", members = ""): string =>
  `FUNCTION_BLOCK FB_LANG_${name}_t\n${sections}\n${body}\nEND_FUNCTION_BLOCK\n${members === "" ? "" : `\n${members}`}\n`

/** A helper FUNCTION `F_LANG_<name>_f : <type>` with `sections` and `body`, ahead of the fixture's FB. */
const fn = (name: string, type: string, sections: string, body: string, suffix = "_f"): string =>
  `FUNCTION F_LANG_${name}${suffix} : ${type}\n${sections}\n${body}\nEND_FUNCTION\n\n`

const CALL_ARGUMENTS: LanguageTest[] = [
  fb("calls_unknown_output_fb", "an FB call binding `nope => r`, no output of the FB",
    helper("calls_unknown_output_fb", "VAR_OUTPUT\n\to : INT;\nEND_VAR", "o := 1;") +
      fbText("calls_unknown_output_fb", "\tt : FB_LANG_calls_unknown_output_fb_t;\n\tres : INT;", "t(nope => res);")),
  fb("calls_unknown_output_function", "a FUNCTION call binding `nope => r`, no output of the function",
    fn("calls_unknown_output_function", "INT", "VAR_INPUT\n\ta : INT;\nEND_VAR\nVAR_OUTPUT\n\to : INT;\nEND_VAR", "o := a;\nF_LANG_calls_unknown_output_function_f := a;") +
      fbText("calls_unknown_output_function", "\tres : INT;\n\tout : INT;", "out := F_LANG_calls_unknown_output_function_f(a := 1, nope => res);")),
  fb("calls_unknown_output_method", "a METHOD call binding `nope => r`, no output of the method",
    fbText("calls_unknown_output_method", "\tres : INT;\n\tout : INT;", "out := M(nope => res);",
      "METHOD M : INT\nVAR_OUTPUT\n\to : INT;\nEND_VAR\no := 1;\nM := 2;\nEND_METHOD\n")),
  fb("calls_output_names_input", "an FB call binding `i => r` where `i` is the FB's VAR_INPUT",
    helper("calls_output_names_input", "VAR_INPUT\n\ti : INT;\nEND_VAR\nVAR_OUTPUT\n\to : INT;\nEND_VAR", "o := i;") +
      fbText("calls_output_names_input", "\tt : FB_LANG_calls_output_names_input_t;\n\tres : INT;", "t(i => res);")),
  fb("calls_function_too_few_positional", "a two-input FUNCTION called with one positional argument",
    fn("calls_function_too_few_positional", "INT", "VAR_INPUT\n\ta : INT;\n\tb : INT;\nEND_VAR", "F_LANG_calls_function_too_few_positional_f := a + b;") +
      fbText("calls_function_too_few_positional", "\tout : INT;", "out := F_LANG_calls_function_too_few_positional_f(1);")),
  fb("calls_function_defaults_none_given", "a FUNCTION whose every input has a constant default, called with none",
    fn("calls_function_defaults_none_given", "INT", "VAR_INPUT\n\ta : INT := 1;\n\tb : INT := 2;\nEND_VAR", "F_LANG_calls_function_defaults_none_given_f := a + b;") +
      fbText("calls_function_defaults_none_given", "\tout : INT;", "out := F_LANG_calls_function_defaults_none_given_f();")),
  fb("calls_inout_unbound_method", "a METHOD with a VAR_IN_OUT called without binding it",
    fbText("calls_inout_unbound_method", "\tout : INT;", "out := M();",
      "METHOD M : INT\nVAR_IN_OUT\n\tio : INT;\nEND_VAR\nM := io;\nEND_METHOD\n")),
  fb("calls_inout_unbound_function", "a FUNCTION with a VAR_INPUT and a VAR_IN_OUT called with the input only",
    fn("calls_inout_unbound_function", "INT", "VAR_INPUT\n\ta : INT;\nEND_VAR\nVAR_IN_OUT\n\tio : INT;\nEND_VAR", "F_LANG_calls_inout_unbound_function_f := a + io;") +
      fbText("calls_inout_unbound_function", "\tout : INT;", "out := F_LANG_calls_inout_unbound_function_f(a := 1);")),
  fb("calls_inout_bound_to_constant", "a VAR_IN_OUT bound to a VAR CONSTANT",
    helper("calls_inout_bound_to_constant", "VAR_IN_OUT\n\tio : INT;\nEND_VAR", "io := io + 1;") +
      `FUNCTION_BLOCK FB_LANG_calls_inout_bound_to_constant\nVAR CONSTANT\n\tc : INT := 4;\nEND_VAR\nVAR\n\tt : FB_LANG_calls_inout_bound_to_constant_t;\nEND_VAR\nt(io := c);\nEND_FUNCTION_BLOCK\n`),
  fb("calls_inout_bound_to_expression", "a VAR_IN_OUT bound to an expression",
    helper("calls_inout_bound_to_expression", "VAR_IN_OUT\n\tio : INT;\nEND_VAR", "io := io + 1;") +
      fbText("calls_inout_bound_to_expression", "\tt : FB_LANG_calls_inout_bound_to_expression_t;\n\tv : INT;", "t(io := v + 1);")),
  fb("calls_inout_bound_to_call_result", "a VAR_IN_OUT bound to a FUNCTION call's result",
    fn("calls_inout_bound_to_call_result", "INT", "VAR_INPUT\n\ta : INT;\nEND_VAR", "F_LANG_calls_inout_bound_to_call_result_f := a;") +
      helper("calls_inout_bound_to_call_result", "VAR_IN_OUT\n\tio : INT;\nEND_VAR", "io := io + 1;") +
      fbText("calls_inout_bound_to_call_result", "\tt : FB_LANG_calls_inout_bound_to_call_result_t;", "t(io := F_LANG_calls_inout_bound_to_call_result_f(a := 2));")),
  fb("calls_inout_bound_to_property", "a VAR_IN_OUT bound to another instance's property",
    helper("calls_inout_bound_to_property", "VAR_IN_OUT\n\tio : INT;\nEND_VAR", "io := io + 1;") +
      `FUNCTION_BLOCK FB_LANG_calls_inout_bound_to_property_p\nVAR\n\tstored : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\nPROPERTY P : INT\nGET\nP := stored;\nEND_GET\nSET\nstored := P;\nEND_SET\nEND_PROPERTY\n\n` +
      fbText("calls_inout_bound_to_property", "\tt : FB_LANG_calls_inout_bound_to_property_t;\n\towner : FB_LANG_calls_inout_bound_to_property_p;", "t(io := owner.P);")),
]

const RESULT_AND_INSTANTIATION: LanguageTest[] = [
  fb("calls_index_on_method_result", "an index straight on a METHOD call's ARRAY result",
    fbText("calls_index_on_method_result", "\tout : INT;", "out := Values()[1];",
      "METHOD Values : ARRAY[1..2] OF INT\nValues[1] := 3;\nValues[2] := 4;\nEND_METHOD\n")),
  fb("calls_fb_type_as_argument", "an FB's TYPE name passed as a FUNCTION's argument",
    fn("calls_fb_type_as_argument", "INT", "VAR_INPUT\n\tsrc : FB_LANG_calls_fb_type_as_argument_t;\nEND_VAR", "F_LANG_calls_fb_type_as_argument_f := 1;") +
      helper("calls_fb_type_as_argument", "VAR\n\tn : INT;\nEND_VAR") +
      fbText("calls_fb_type_as_argument", "\tout : INT;", "out := F_LANG_calls_fb_type_as_argument_f(src := FB_LANG_calls_fb_type_as_argument_t);")),
  fb("calls_itf_type_as_argument", "an INTERFACE's TYPE name passed as a FUNCTION's argument",
    `INTERFACE ITF_LANG_calls_itf_type_as_argument\nMETHOD M : INT\nEND_METHOD\nEND_INTERFACE\n\n` +
      fn("calls_itf_type_as_argument", "INT", "VAR_INPUT\n\tsrc : ITF_LANG_calls_itf_type_as_argument;\nEND_VAR", "F_LANG_calls_itf_type_as_argument_f := 1;") +
      fbText("calls_itf_type_as_argument", "\tout : INT;", "out := F_LANG_calls_itf_type_as_argument_f(src := ITF_LANG_calls_itf_type_as_argument);")),
]

/** An interface `ITF_LANG_<name>` extending __SYSTEM.IQueryInterface with one method, and an FB `FB_LANG_<name>_impl`
 *  implementing it, ahead of the fixture's FB. */
const queryable = (name: string): string =>
  `INTERFACE ITF_LANG_${name} EXTENDS __SYSTEM.IQueryInterface\nMETHOD Get : INT\nEND_METHOD\nEND_INTERFACE\n\n` +
  `FUNCTION_BLOCK FB_LANG_${name}_impl IMPLEMENTS ITF_LANG_${name}\nVAR\n\tn : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\nMETHOD Get : INT\nGet := 1;\nEND_METHOD\n\n`

const INTRINSICS: LanguageTest[] = [
  fb("calls_adr_on_bit_field", "ADR of a STRUCT's BIT field",
    `TYPE DUT_LANG_calls_adr_on_bit_field :\nSTRUCT\n\tb0 : BIT;\n\tb1 : BIT;\nEND_STRUCT\nEND_TYPE\n\n` +
      fbText("calls_adr_on_bit_field", "\trec : DUT_LANG_calls_adr_on_bit_field;\n\tp : POINTER TO BYTE;", "p := ADR(rec.b1);")),
  fb("calls_adr_on_bit_access", "ADR of a WORD's bit access `w.3`",
    fbText("calls_adr_on_bit_access", "\tw : WORD;\n\tp : POINTER TO BYTE;", "p := ADR(w.3);")),
  fb("calls_ini_on_int", "INI of an INT variable",
    fbText("calls_ini_on_int", "\tn : INT;\n\tok : BOOL;", "ok := INI(n, TRUE);")),
  fb("calls_ini_on_fb_instance", "INI of an FB instance",
    helper("calls_ini_on_fb_instance", "VAR\n\tn : INT := 3;\nEND_VAR") +
      fbText("calls_ini_on_fb_instance", "\tt : FB_LANG_calls_ini_on_fb_instance_t;\n\tok : BOOL;", "ok := INI(t, TRUE);")),
  fb("calls_queryinterface_int_first", "__QUERYINTERFACE with an INT first operand",
    queryable("calls_queryinterface_int_first") +
      fbText("calls_queryinterface_int_first", "\tn : INT;\n\tdst : ITF_LANG_calls_queryinterface_int_first;\n\tok : BOOL;", "ok := __QUERYINTERFACE(n, dst);")),
  fb("calls_queryinterface_int_second", "__QUERYINTERFACE with an INT second operand",
    queryable("calls_queryinterface_int_second") +
      fbText("calls_queryinterface_int_second", "\timpl : FB_LANG_calls_queryinterface_int_second_impl;\n\tsrc : ITF_LANG_calls_queryinterface_int_second;\n\tn : INT;\n\tok : BOOL;",
        "src := impl;\nok := __QUERYINTERFACE(src, n);")),
  fb("calls_queryinterface_legal", "__QUERYINTERFACE from one interface reference into another",
    queryable("calls_queryinterface_legal") +
      fbText("calls_queryinterface_legal", "\timpl : FB_LANG_calls_queryinterface_legal_impl;\n\tsrc : ITF_LANG_calls_queryinterface_legal;\n\tdst : ITF_LANG_calls_queryinterface_legal;\n\tok : BOOL;",
        "src := impl;\nok := __QUERYINTERFACE(src, dst);")),
  fb("calls_querypointer_int_second", "__QUERYPOINTER with an INT second operand",
    queryable("calls_querypointer_int_second") +
      fbText("calls_querypointer_int_second", "\timpl : FB_LANG_calls_querypointer_int_second_impl;\n\tsrc : ITF_LANG_calls_querypointer_int_second;\n\tn : INT;\n\tok : BOOL;",
        "src := impl;\nok := __QUERYPOINTER(src, n);")),
  fb("calls_querypointer_legal", "__QUERYPOINTER from an interface reference into a POINTER TO the FB",
    queryable("calls_querypointer_legal") +
      fbText("calls_querypointer_legal", "\timpl : FB_LANG_calls_querypointer_legal_impl;\n\tsrc : ITF_LANG_calls_querypointer_legal;\n\tp : POINTER TO FB_LANG_calls_querypointer_legal_impl;\n\tok : BOOL;",
        "src := impl;\nok := __QUERYPOINTER(src, p);")),
  fb("calls_sqrt_of_bool", "SQRT of a BOOL variable",
    fbText("calls_sqrt_of_bool", "\tflag : BOOL;\n\tres : REAL;", "res := SQRT(flag);")),
]

const NON_CALLABLE_AND_RECURSION: LanguageTest[] = [
  fb("calls_enum_value_called", "an enum value called",
    `TYPE DUT_LANG_calls_enum_value_called :\n(\n\tIdle := 0,\n\tBusy := 1\n);\nEND_TYPE\n\n` +
      fbText("calls_enum_value_called", "\tstate : DUT_LANG_calls_enum_value_called;", "DUT_LANG_calls_enum_value_called.Busy();\nstate := DUT_LANG_calls_enum_value_called.Idle;")),
  fb("calls_struct_instance_called", "a STRUCT instance called",
    `TYPE DUT_LANG_calls_struct_instance_called :\nSTRUCT\n\tx : INT;\nEND_STRUCT\nEND_TYPE\n\n` +
      fbText("calls_struct_instance_called", "\trec : DUT_LANG_calls_struct_instance_called;", "rec();")),
  fb("calls_constant_called", "a VAR CONSTANT called",
    `FUNCTION_BLOCK FB_LANG_calls_constant_called\nVAR CONSTANT\n\tc : INT := 4;\nEND_VAR\nVAR\n\tout : INT;\nEND_VAR\nout := c();\nEND_FUNCTION_BLOCK\n`),
  fb("calls_method_recursive", "a METHOD calling itself",
    fbText("calls_method_recursive", "\tout : INT;", "out := M(n := 2);",
      "METHOD M : INT\nVAR_INPUT\n\tn : INT;\nEND_VAR\nIF n > 0 THEN\n\tM := M(n := n - 1) + 1;\nELSE\n\tM := 0;\nEND_IF\nEND_METHOD\n")),
  fb("calls_functions_mutually_recursive", "two FUNCTIONs calling each other",
    fn("calls_functions_mutually_recursive", "INT", "VAR_INPUT\n\tn : INT;\nEND_VAR", "IF n > 0 THEN\n\tF_LANG_calls_functions_mutually_recursive_a := F_LANG_calls_functions_mutually_recursive_b(n - 1);\nEND_IF", "_a") +
      fn("calls_functions_mutually_recursive", "INT", "VAR_INPUT\n\tn : INT;\nEND_VAR", "IF n > 0 THEN\n\tF_LANG_calls_functions_mutually_recursive_b := F_LANG_calls_functions_mutually_recursive_a(n - 1);\nEND_IF", "_b") +
      fbText("calls_functions_mutually_recursive", "\tout : INT;", "out := F_LANG_calls_functions_mutually_recursive_a(3);")),
]

/** The gate review of 3.7+3.9 (2026-10-06): the in-out count's unmeasured sides — beside an unknown named input, in a mixed
 *  positional+named call, given with an input left out, through an INTERFACE method — a default naming a callee-local
 *  CONSTANT that shadows a global VARIABLE, and SQRT of a STRING. */
const GATE: LanguageTest[] = [
  fb("calls_inout_unbound_unknown_named", "a FUNCTION with a VAR_INPUT and a VAR_IN_OUT called with the input and an unknown named input",
    fn("calls_inout_unbound_unknown_named", "INT", "VAR_INPUT\n\ta : INT;\nEND_VAR\nVAR_IN_OUT\n\tio : INT;\nEND_VAR", "F_LANG_calls_inout_unbound_unknown_named_f := a + io;") +
      fbText("calls_inout_unbound_unknown_named", "\tout : INT;", "out := F_LANG_calls_inout_unbound_unknown_named_f(a := 1, zz := 2);")),
  fb("calls_inout_unbound_mixed", "a FUNCTION with two VAR_INPUTs and a VAR_IN_OUT called `F(1, b := 2)`, the in-out left out",
    fn("calls_inout_unbound_mixed", "INT", "VAR_INPUT\n\ta : INT;\n\tb : INT;\nEND_VAR\nVAR_IN_OUT\n\tio : INT;\nEND_VAR", "F_LANG_calls_inout_unbound_mixed_f := a + b + io;") +
      fbText("calls_inout_unbound_mixed", "\tout : INT;", "out := F_LANG_calls_inout_unbound_mixed_f(1, b := 2);")),
  fb("calls_inout_given_input_missing", "a FUNCTION with a VAR_INPUT and a VAR_IN_OUT called with the in-out only",
    fn("calls_inout_given_input_missing", "INT", "VAR_INPUT\n\ta : INT;\nEND_VAR\nVAR_IN_OUT\n\tio : INT;\nEND_VAR", "F_LANG_calls_inout_given_input_missing_f := a + io;") +
      fbText("calls_inout_given_input_missing", "\tv : INT;\n\tout : INT;", "out := F_LANG_calls_inout_given_input_missing_f(io := v);")),
  fb("calls_inout_unbound_interface_method", "an INTERFACE method with a VAR_IN_OUT called through a reference without binding it",
    `INTERFACE ITF_LANG_calls_inout_unbound_interface_method\nMETHOD M : INT\nVAR_IN_OUT\n\tio : INT;\nEND_VAR\nEND_METHOD\nEND_INTERFACE\n\n` +
      fbText("calls_inout_unbound_interface_method", "\tref1 : ITF_LANG_calls_inout_unbound_interface_method;\n\tout : INT;", "out := ref1.M();")),
  {
    name: "calls_default_local_constant_shadows_global",
    pouName: "FB_LANG_calls_default_local_constant_shadows_global",
    kind: "function_block",
    feature: "a FUNCTION whose input defaults to its own VAR CONSTANT, shadowing a global VARIABLE of that name, called with none",
    fromDoc: doc,
    plcPrgVar: "inst_calls_default_local_constant_shadows_global : FB_LANG_calls_default_local_constant_shadows_global;",
    plcPrgBody: "inst_calls_default_local_constant_shadows_global();",
    gvlNames: ["GVL_LANG_calls_default_local_constant_shadows_global"],
    source:
      "VAR_GLOBAL\n\tg_calls_shadow : INT := 3;\nEND_VAR\n\n" +
      fn("calls_default_local_constant_shadows_global", "INT", "VAR CONSTANT\n\tg_calls_shadow : INT := 1;\nEND_VAR\nVAR_INPUT\n\ti : INT := g_calls_shadow;\nEND_VAR", "F_LANG_calls_default_local_constant_shadows_global_f := i;") +
      fbText("calls_default_local_constant_shadows_global", "\tout : INT;", "out := F_LANG_calls_default_local_constant_shadows_global_f();"),
  },
  fb("calls_sqrt_of_string", "SQRT of a STRING variable",
    fbText("calls_sqrt_of_string", "\ttext : STRING;\n\tres : LREAL;", "res := SQRT(text);")),
]

export const CALL_RULE_TESTS: readonly LanguageTest[] = [...CALL_ARGUMENTS, ...RESULT_AND_INSTANTIATION, ...INTRINSICS, ...NON_CALLABLE_AND_RECURSION, ...GATE]
