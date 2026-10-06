/**
 * OOP RULES B — openspec `analysis-conformance` task 3.7.1 (oop B), rule by rule, the cells no fixture asked:
 *
 *   method-signature          against an INTERFACE method: another parameter NAME, another SECTION, another result type,
 *                             no result type, a PROPERTY of another type, a method the interface INHERITS, a method the
 *                             implementing FB INHERITS from its base; against a BASE: the base's BASE declaring it, a
 *                             PROPERTY with both accessors of another type, a VAR_OUTPUT of another type
 *   generic-instantiation     two generic constants given one value; an instance declared as a VAR_INPUT (TwinCAT has no
 *                             VAR_GENERIC: there the cells measure its refusal)
 *   abstract-assign           through a VAR_IN_OUT, through a REFERENCE TO (`:=`), a REF= rebind (legal), a pointer's `^`
 *   lifecycle                 FB_Init's inputs swapped, an extra input FIRST, `bInitRetains` of another type; FB_ReInit
 *                             with no result; FB_Exit with an extra input
 *   abstract-instantiation    an ARRAY OF, a POINTER TO, a VAR_INPUT of an ABSTRACT FB
 *   interface-implementation  an interface PROPERTY left out; a method the base provides (legal); a GET-only property
 *                             for the interface's
 *   abstract-output-default   an ABSTRACT method's VAR_OUTPUT default in an FB (measured in an interface and in cc5),
 *                             a concrete method's (legal), a body-less method of an ABSTRACT FB without the keyword
 *
 * GLOBAL NAMES ARE THE FIXTURE'S OWN (`FB_LANG_<name>`, `ITF_LANG_<name>`): the replay binds every fixture into one
 * project.
 */
import type { LanguageTest } from "../../types.js"

const doc = "openspec analysis-conformance 3.7.1 (oop B); docs/codesys-reference/10-oop.md"

/** A function block `FB_LANG_<name>`, instanced and called from PLC_PRG, its whole text `source` (dependencies first). */
function fb(name: string, feature: string, source: string, plcPrgVar = `inst_${name} : FB_LANG_${name};`, plcPrgBody = `inst_${name}();`): LanguageTest {
  return { name, pouName: `FB_LANG_${name}`, kind: "function_block", feature, fromDoc: doc, plcPrgVar, plcPrgBody, source }
}

/** `FUNCTION_BLOCK FB_LANG_<name><header>` declaring `vars`, running `body`, then `members`. */
const fbText = (name: string, header: string, vars: string, body: string, members = ""): string =>
  `FUNCTION_BLOCK FB_LANG_${name}${header}\nVAR\n${vars}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n${members === "" ? "" : `\n${members}`}`

/** An interface `ITF_LANG_<name><suffix>` [EXTENDS `bases`] holding `members`. */
const itf = (name: string, members: string, suffix = "", bases = ""): string =>
  `INTERFACE ITF_LANG_${name}${suffix}${bases === "" ? "" : ` EXTENDS ${bases}`}\n${members}END_INTERFACE\n\n`

/** A function block `FB_LANG_<name><suffix>` with `modifiers`, `header`, VAR `vars` and the units `members` after it. */
const unit = (name: string, suffix: string, vars: string, members = "", header = "", modifiers = ""): string =>
  `FUNCTION_BLOCK ${modifiers}FB_LANG_${name}${suffix}${header}\nVAR\n${vars}\nEND_VAR\nEND_FUNCTION_BLOCK\n\n${members}${members === "" ? "" : "\n"}`

const M_INT_A = "METHOD M : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nEND_METHOD\n"

const METHOD_SIGNATURE: LanguageTest[] = [
  fb("oopb_itf_param_name_mismatch", "an FB method implementing an interface method with its parameter named otherwise",
    itf("oopb_itf_param_name_mismatch", M_INT_A) +
      fbText("oopb_itf_param_name_mismatch", " IMPLEMENTS ITF_LANG_oopb_itf_param_name_mismatch", "\tout : INT;", "out := M(b := 3);",
        "METHOD M : INT\nVAR_INPUT\n\tb : INT;\nEND_VAR\nM := b;\nEND_METHOD\n")),
  fb("oopb_itf_section_mismatch", "an FB method implementing an interface method's VAR_INPUT as a VAR_IN_OUT",
    itf("oopb_itf_section_mismatch", M_INT_A) +
      fbText("oopb_itf_section_mismatch", " IMPLEMENTS ITF_LANG_oopb_itf_section_mismatch", "\tv : INT := 3;\n\tout : INT;", "out := M(a := v);",
        "METHOD M : INT\nVAR_IN_OUT\n\ta : INT;\nEND_VAR\nM := a;\nEND_METHOD\n")),
  fb("oopb_itf_return_type_mismatch", "an FB method implementing an interface method with another result type (DINT for INT)",
    itf("oopb_itf_return_type_mismatch", M_INT_A) +
      fbText("oopb_itf_return_type_mismatch", " IMPLEMENTS ITF_LANG_oopb_itf_return_type_mismatch", "\tout : DINT;", "out := M(a := 3);",
        "METHOD M : DINT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nM := a;\nEND_METHOD\n")),
  fb("oopb_itf_return_missing", "an FB method implementing an interface method that has a result, with none",
    itf("oopb_itf_return_missing", M_INT_A) +
      fbText("oopb_itf_return_missing", " IMPLEMENTS ITF_LANG_oopb_itf_return_missing", "\tout : INT;", "M(a := 3);\nout := 1;",
        "METHOD M\nVAR_INPUT\n\ta : INT;\nEND_VAR\nEND_METHOD\n")),
  fb("oopb_itf_property_type_mismatch", "an FB property implementing an interface property of another type (DINT for INT)",
    itf("oopb_itf_property_type_mismatch", "PROPERTY P : INT\nEND_PROPERTY\n") +
      fbText("oopb_itf_property_type_mismatch", " IMPLEMENTS ITF_LANG_oopb_itf_property_type_mismatch", "\tstored : DINT;\n\tout : DINT;", "out := P;",
        "PROPERTY P : DINT\nGET\nP := stored;\nEND_GET\nSET\nstored := P;\nEND_SET\nEND_PROPERTY\n")),
  fb("oopb_itf_inherited_method_mismatch", "an FB implementing a derived interface, its method mismatching the BASE interface's",
    itf("oopb_itf_inherited_method_mismatch", M_INT_A, "_a") +
      itf("oopb_itf_inherited_method_mismatch", "", "", "ITF_LANG_oopb_itf_inherited_method_mismatch_a") +
      fbText("oopb_itf_inherited_method_mismatch", " IMPLEMENTS ITF_LANG_oopb_itf_inherited_method_mismatch", "\tout : INT;", "out := M(a := 3);",
        "METHOD M : INT\nVAR_INPUT\n\ta : DINT;\nEND_VAR\nM := DINT_TO_INT(a);\nEND_METHOD\n")),
  fb("oopb_itf_method_in_base_mismatch", "an FB implementing an interface whose method only its BASE declares, with another parameter type",
    itf("oopb_itf_method_in_base_mismatch", M_INT_A) +
      unit("oopb_itf_method_in_base_mismatch", "_base", "\tb : INT;", "METHOD M : INT\nVAR_INPUT\n\ta : DINT;\nEND_VAR\nM := DINT_TO_INT(a);\nEND_METHOD\n") +
      fbText("oopb_itf_method_in_base_mismatch", " EXTENDS FB_LANG_oopb_itf_method_in_base_mismatch_base IMPLEMENTS ITF_LANG_oopb_itf_method_in_base_mismatch",
        "\tout : INT;", "out := M(a := 3);")),
  fb("oopb_base_grandparent_mismatch", "an override mismatching the method of its base's BASE (the base declares none)",
    unit("oopb_base_grandparent_mismatch", "_a", "\tx : INT;", M_INT_A.replace("END_VAR\n", "END_VAR\nM := a;\n")) +
      unit("oopb_base_grandparent_mismatch", "_b", "\ty : INT;", "", " EXTENDS FB_LANG_oopb_base_grandparent_mismatch_a") +
      fbText("oopb_base_grandparent_mismatch", " EXTENDS FB_LANG_oopb_base_grandparent_mismatch_b", "\tout : INT;", "out := M(a := 3);",
        "METHOD M : INT\nVAR_INPUT\n\ta : DINT;\nEND_VAR\nM := DINT_TO_INT(a);\nEND_METHOD\n")),
  fb("oopb_base_property_get_set_mismatch", "an overriding property with GET and SET of another type than the base's GET and SET",
    unit("oopb_base_property_get_set_mismatch", "_base", "\tb : INT;", "PROPERTY P : INT\nGET\nP := b;\nEND_GET\nSET\nb := P;\nEND_SET\nEND_PROPERTY\n") +
      fbText("oopb_base_property_get_set_mismatch", " EXTENDS FB_LANG_oopb_base_property_get_set_mismatch_base", "\tstored : DINT;\n\tout : DINT;", "out := P;",
        "PROPERTY P : DINT\nGET\nP := stored;\nEND_GET\nSET\nstored := P;\nEND_SET\nEND_PROPERTY\n")),
  fb("oopb_base_output_type_mismatch", "an override whose VAR_OUTPUT has another type than the base method's",
    unit("oopb_base_output_type_mismatch", "_base", "\tb : INT;", "METHOD M : INT\nVAR_OUTPUT\n\to : INT;\nEND_VAR\no := 1;\nM := 1;\nEND_METHOD\n") +
      fbText("oopb_base_output_type_mismatch", " EXTENDS FB_LANG_oopb_base_output_type_mismatch_base", "\tres : DINT;\n\tout : INT;", "out := M(o => res);",
        "METHOD M : INT\nVAR_OUTPUT\n\to : DINT;\nEND_VAR\no := 2;\nM := 2;\nEND_METHOD\n")),
]

const GENERIC: LanguageTest[] = [
  fb("oopb_generic_two_constants_one_value", "an FB with two VAR_GENERIC constants instanced with one value",
    `FUNCTION_BLOCK FB_LANG_oopb_generic_two_constants_one_value_t\nVAR_GENERIC CONSTANT\n\tN : INT := 4;\n\tK : INT := 2;\nEND_VAR\nVAR\n\tout : INT;\nEND_VAR\nout := N + K;\nEND_FUNCTION_BLOCK\n\n` +
      fbText("oopb_generic_two_constants_one_value", "", "\tt : FB_LANG_oopb_generic_two_constants_one_value_t<6>;\n\tout : INT;", "t();\nout := 1;")),
  fb("oopb_generic_as_input", "a VAR_INPUT of a VAR_GENERIC FB's type, without its value",
    `FUNCTION_BLOCK FB_LANG_oopb_generic_as_input_t\nVAR_GENERIC CONSTANT\n\tN : INT := 4;\nEND_VAR\nVAR\n\tout : INT;\nEND_VAR\nout := N;\nEND_FUNCTION_BLOCK\n\n` +
      `FUNCTION_BLOCK FB_LANG_oopb_generic_as_input\nVAR_INPUT\n\tt : FB_LANG_oopb_generic_as_input_t;\nEND_VAR\nVAR\n\tout : INT;\nEND_VAR\nout := 1;\nEND_FUNCTION_BLOCK\n`),
]

/** An ABSTRACT FB `FB_LANG_<name>_abs` and a concrete `FB_LANG_<name>_c` extending it, ahead of the fixture's FB. */
const abstractPair = (name: string): string =>
  unit(name, "_abs", "\tn : INT;", "", "", "ABSTRACT ") + unit(name, "_c", "\tm : INT;", "", ` EXTENDS FB_LANG_${name}_abs`)

const ABSTRACT_ASSIGN: LanguageTest[] = [
  fb("oopb_abstract_assign_inout", "a VAR_IN_OUT of an ABSTRACT FB's type, assigned another",
    abstractPair("oopb_abstract_assign_inout") +
      `FUNCTION_BLOCK FB_LANG_oopb_abstract_assign_inout\nVAR_IN_OUT\n\ta : FB_LANG_oopb_abstract_assign_inout_abs;\n\tb : FB_LANG_oopb_abstract_assign_inout_abs;\nEND_VAR\na := b;\nEND_FUNCTION_BLOCK\n`,
    "inst_oopb_abstract_assign_inout : FB_LANG_oopb_abstract_assign_inout;\n\tc1_oopb_aai : FB_LANG_oopb_abstract_assign_inout_c;\n\tc2_oopb_aai : FB_LANG_oopb_abstract_assign_inout_c;",
    "inst_oopb_abstract_assign_inout(a := c1_oopb_aai, b := c2_oopb_aai);"),
  fb("oopb_abstract_assign_reference", "a REFERENCE TO an ABSTRACT FB, value-assigned (`:=`) a concrete instance",
    abstractPair("oopb_abstract_assign_reference") +
      fbText("oopb_abstract_assign_reference", "",
        "\tc1 : FB_LANG_oopb_abstract_assign_reference_c;\n\tc2 : FB_LANG_oopb_abstract_assign_reference_c;\n\tres : REFERENCE TO FB_LANG_oopb_abstract_assign_reference_abs;",
        "res REF= c1;\nres := c2;")),
  fb("oopb_abstract_ref_rebind", "a REFERENCE TO an ABSTRACT FB rebound (REF=) to a concrete instance",
    abstractPair("oopb_abstract_ref_rebind") +
      fbText("oopb_abstract_ref_rebind", "",
        "\tc1 : FB_LANG_oopb_abstract_ref_rebind_c;\n\tres : REFERENCE TO FB_LANG_oopb_abstract_ref_rebind_abs;\n\tout : INT;",
        "res REF= c1;\nout := 1;")),
  {
    ...fb("oopb_abstract_pointer_deref_assign", "a POINTER TO an ABSTRACT FB, its `^` value-assigned a concrete instance",
      abstractPair("oopb_abstract_pointer_deref_assign") +
        fbText("oopb_abstract_pointer_deref_assign", "",
          "\tc1 : FB_LANG_oopb_abstract_pointer_deref_assign_c;\n\tc2 : FB_LANG_oopb_abstract_pointer_deref_assign_c;\n\tp : POINTER TO FB_LANG_oopb_abstract_pointer_deref_assign_abs;",
          "p := ADR(c1);\np^ := c2;")),
    deferred: {
      lsp: "2026-10-06 niche: accepted loss (0 FB instances copied through a pointer in the corpora): both vendors warn \"The instance p^ points to will be reinitialized for virtual function calls. Make sure p^ doesn't point to a type derived from <FB>\", CODESYS also refuses the ABSTRACT target; abstract-assign reads a plain name as the target only, and whether the warning holds for every FB copied through a pointer is unmeasured",
    },
  },
]

/** An FB `FB_LANG_<name>` declaring the lifecycle method `method`, instanced from PLC_PRG. */
const lifecycle = (name: string, feature: string, method: string): LanguageTest =>
  fb(name, feature, fbText(name, "", "\tout : INT;", "out := 1;", method))

const LIFECYCLE: LanguageTest[] = [
  lifecycle("oopb_fb_init_swapped_inputs", "FB_Init declaring bInCopyCode before bInitRetains",
    "METHOD FB_Init : BOOL\nVAR_INPUT\n\tbInCopyCode : BOOL;\n\tbInitRetains : BOOL;\nEND_VAR\nEND_METHOD\n"),
  lifecycle("oopb_fb_init_extra_input_first", "FB_Init declaring an extra input BEFORE bInitRetains and bInCopyCode",
    "METHOD FB_Init : BOOL\nVAR_INPUT\n\tstartValue : INT;\n\tbInitRetains : BOOL;\n\tbInCopyCode : BOOL;\nEND_VAR\nEND_METHOD\n"),
  lifecycle("oopb_fb_init_input_wrong_type", "FB_Init declaring bInitRetains as an INT",
    "METHOD FB_Init : BOOL\nVAR_INPUT\n\tbInitRetains : INT;\n\tbInCopyCode : BOOL;\nEND_VAR\nEND_METHOD\n"),
  lifecycle("oopb_fb_reinit_no_return", "FB_ReInit with no inputs and no result type",
    "METHOD FB_ReInit\nEND_METHOD\n"),
  lifecycle("oopb_fb_exit_extra_input", "FB_Exit declaring an input after bInCopyCode",
    "METHOD FB_Exit : BOOL\nVAR_INPUT\n\tbInCopyCode : BOOL;\n\textra : INT;\nEND_VAR\nEND_METHOD\n"),
]

const ABSTRACT_INSTANTIATION: LanguageTest[] = [
  fb("oopb_abstract_array", "an ARRAY OF an ABSTRACT FB",
    abstractPair("oopb_abstract_array") +
      fbText("oopb_abstract_array", "", "\tarr : ARRAY[1..2] OF FB_LANG_oopb_abstract_array_abs;\n\tout : INT;", "out := 1;")),
  fb("oopb_abstract_pointer", "a POINTER TO an ABSTRACT FB, set to a concrete instance",
    abstractPair("oopb_abstract_pointer") +
      fbText("oopb_abstract_pointer", "", "\tc1 : FB_LANG_oopb_abstract_pointer_c;\n\tp : POINTER TO FB_LANG_oopb_abstract_pointer_abs;\n\tout : INT;", "p := ADR(c1);\nout := 1;")),
  fb("oopb_abstract_as_input", "a VAR_INPUT of an ABSTRACT FB's type",
    abstractPair("oopb_abstract_as_input") +
      `FUNCTION_BLOCK FB_LANG_oopb_abstract_as_input\nVAR_INPUT\n\tsrc : FB_LANG_oopb_abstract_as_input_abs;\nEND_VAR\nVAR\n\tout : INT;\nEND_VAR\nout := 1;\nEND_FUNCTION_BLOCK\n`),
]

const INTERFACE_IMPLEMENTATION: LanguageTest[] = [
  fb("oopb_itf_property_missing", "an FB implementing an interface without its PROPERTY",
    itf("oopb_itf_property_missing", "PROPERTY P : INT\nEND_PROPERTY\n") +
      fbText("oopb_itf_property_missing", " IMPLEMENTS ITF_LANG_oopb_itf_property_missing", "\tout : INT;", "out := 1;")),
  fb("oopb_itf_method_from_base", "an FB implementing an interface whose method its BASE provides, matching",
    itf("oopb_itf_method_from_base", M_INT_A) +
      unit("oopb_itf_method_from_base", "_base", "\tb : INT;", "METHOD M : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nM := a;\nEND_METHOD\n") +
      fbText("oopb_itf_method_from_base", " EXTENDS FB_LANG_oopb_itf_method_from_base_base IMPLEMENTS ITF_LANG_oopb_itf_method_from_base",
        "\tout : INT;", "out := M(a := 3);")),
  fb("oopb_itf_property_getter_only", "an FB implementing an interface property (GET and SET) with a GET only",
    itf("oopb_itf_property_getter_only", "PROPERTY P : INT\nEND_PROPERTY\n") +
      fbText("oopb_itf_property_getter_only", " IMPLEMENTS ITF_LANG_oopb_itf_property_getter_only", "\tstored : INT := 2;\n\tout : INT;", "out := P;",
        "PROPERTY P : INT\nGET\nP := stored;\nEND_GET\nEND_PROPERTY\n")),
]

const ABSTRACT_OUTPUT_DEFAULT: LanguageTest[] = [
  fb("oopb_abstract_method_output_default", "an ABSTRACT method of an ABSTRACT FB giving its VAR_OUTPUT a default",
    unit("oopb_abstract_method_output_default", "_abs", "\tn : INT;", "METHOD ABSTRACT M : INT\nVAR_OUTPUT\n\to : INT := 7;\nEND_VAR\nEND_METHOD\n", "", "ABSTRACT ") +
      fbText("oopb_abstract_method_output_default", " EXTENDS FB_LANG_oopb_abstract_method_output_default_abs", "\tres : INT;\n\tout : INT;", "out := M(o => res);",
        "METHOD M : INT\nVAR_OUTPUT\n\to : INT;\nEND_VAR\no := 1;\nM := 2;\nEND_METHOD\n")),
  fb("oopb_concrete_method_output_default", "a concrete method giving its VAR_OUTPUT a default",
    fbText("oopb_concrete_method_output_default", "", "\tres : INT;\n\tout : INT;", "out := M(o => res);",
      "METHOD M : INT\nVAR_OUTPUT\n\to : INT := 7;\nEND_VAR\nM := 2;\nEND_METHOD\n")),
  fb("oopb_implicit_abstract_output_default", "a body-less method WITHOUT the ABSTRACT keyword in an ABSTRACT FB, its VAR_OUTPUT given a default",
    unit("oopb_implicit_abstract_output_default", "_abs", "\tn : INT;", "METHOD M : INT\nVAR_OUTPUT\n\to : INT := 7;\nEND_VAR\nEND_METHOD\n", "", "ABSTRACT ") +
      fbText("oopb_implicit_abstract_output_default", " EXTENDS FB_LANG_oopb_implicit_abstract_output_default_abs", "\tres : INT;\n\tout : INT;", "out := M(o => res);")),
]

export const OOP_RULE_B_TESTS: readonly LanguageTest[] = [
  ...METHOD_SIGNATURE,
  ...GENERIC,
  ...ABSTRACT_ASSIGN,
  ...LIFECYCLE,
  ...ABSTRACT_INSTANTIATION,
  ...INTERFACE_IMPLEMENTATION,
  ...ABSTRACT_OUTPUT_DEFAULT,
]
