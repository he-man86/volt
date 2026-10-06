/**
 * OOP RULES A — openspec `analysis-conformance` task 3.6.1 (oop A), rule by rule, the cells no fixture asked. No oop-A
 * builder is at 0 TP (0.3), so the cells are the rules' unmeasured sides:
 *
 *   inheritance            an FB EXTENDS an INTERFACE and a STRUCT (a base that exists and is no FB), IMPLEMENTS a STRUCT
 *                          (measured with an FB), IMPLEMENTS a list with one unknown name
 *   property-access        a set-only property read in a condition and as an argument; a get-only property WRITTEN
 *   method-reference       a method named without its call as an OPERAND (measured as an assignment's source)
 *   inherited-variable     a grandparent's variable redeclared; a base's VAR_INPUT redeclared as a VAR
 *   external-write         an instance's VAR read from outside, its VAR_TEMP written, its VAR_OUTPUT written
 *   inout-access           an instance's VAR_IN_OUT READ from outside alone; a property accessor touching the FB's VAR_IN_OUT
 *   fb-init-inout          an FB instance's VAR_IN_OUT initialized with a variable of another type
 *   fb-init-instantiation  an FB_Init's extra input given two arguments; an ARRAY of such an FB
 *
 * GLOBAL NAMES ARE THE FIXTURE'S OWN (`FB_LANG_<name>`, `ITF_LANG_<name>`, `DUT_LANG_<name>`): the replay binds every
 * fixture into one project.
 */
import type { LanguageTest } from "../../types.js"

const doc = "openspec analysis-conformance 3.6.1 (oop A); docs/codesys-reference/10-oop.md"

/** A function block `FB_LANG_<name>`, instanced and called from PLC_PRG, its whole text `source` (dependencies first). */
function fb(name: string, feature: string, source: string, plcPrgVar = `inst_${name} : FB_LANG_${name};`, plcPrgBody = `inst_${name}();`): LanguageTest {
  return { name, pouName: `FB_LANG_${name}`, kind: "function_block", feature, fromDoc: doc, plcPrgVar, plcPrgBody, source }
}

/** `FUNCTION_BLOCK FB_LANG_<name><header>` declaring `vars`, running `body`, then `members`. */
const fbText = (name: string, header: string, vars: string, body: string, members = ""): string =>
  `FUNCTION_BLOCK FB_LANG_${name}${header}\nVAR\n${vars}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n${members === "" ? "" : `\n${members}`}`

/** A helper FB `FB_LANG_<name>_t` with `sections` and `members`, ahead of the fixture's FB. */
const helper = (name: string, sections: string, members = "", body = ""): string =>
  `FUNCTION_BLOCK FB_LANG_${name}_t\n${sections}\n${body}\nEND_FUNCTION_BLOCK\n${members === "" ? "" : `\n${members}`}\n`

const INHERITANCE: LanguageTest[] = [
  fb("oopa_extends_interface", "an FB EXTENDS an INTERFACE",
    `INTERFACE ITF_LANG_oopa_extends_interface\nEND_INTERFACE\n\n` + fbText("oopa_extends_interface", " EXTENDS ITF_LANG_oopa_extends_interface", "\tout : INT;", "out := 1;")),
  fb("oopa_extends_struct", "an FB EXTENDS a STRUCT",
    `TYPE DUT_LANG_oopa_extends_struct :\nSTRUCT\n\tx : INT;\nEND_STRUCT\nEND_TYPE\n\n` + fbText("oopa_extends_struct", " EXTENDS DUT_LANG_oopa_extends_struct", "\tout : INT;", "out := 1;")),
  fb("oopa_implements_struct", "an FB IMPLEMENTS a STRUCT",
    `TYPE DUT_LANG_oopa_implements_struct :\nSTRUCT\n\tx : INT;\nEND_STRUCT\nEND_TYPE\n\n` + fbText("oopa_implements_struct", " IMPLEMENTS DUT_LANG_oopa_implements_struct", "\tout : INT;", "out := 1;")),
  fb("oopa_implements_one_unknown", "an FB IMPLEMENTS two interfaces, the second declared nowhere",
    `INTERFACE ITF_LANG_oopa_implements_one_unknown\nEND_INTERFACE\n\n` +
      fbText("oopa_implements_one_unknown", " IMPLEMENTS ITF_LANG_oopa_implements_one_unknown, ITF_LANG_oopa_implements_nowhere", "\tout : INT;", "out := 1;")),
]

const PROPERTIES: LanguageTest[] = [
  fb("oopa_setonly_in_condition", "a set-only property read in an IF condition through the instance",
    helper("oopa_setonly_in_condition", "VAR\n\tstored : BOOL;\nEND_VAR", "PROPERTY P : BOOL\nSET\nstored := P;\nEND_SET\nEND_PROPERTY") +
      fbText("oopa_setonly_in_condition", "", "\tt : FB_LANG_oopa_setonly_in_condition_t;\n\tout : INT;", "IF t.P THEN\n\tout := 1;\nEND_IF")),
  fb("oopa_setonly_as_argument", "a set-only property passed as a call argument",
    helper("oopa_setonly_as_argument", "VAR\n\tstored : INT;\nEND_VAR", "PROPERTY P : INT\nSET\nstored := P;\nEND_SET\nEND_PROPERTY") +
      fbText("oopa_setonly_as_argument", "", "\tt : FB_LANG_oopa_setonly_as_argument_t;\n\tout : INT;", "out := ABS(t.P);")),
  fb("oopa_getonly_written", "a get-only property written through the instance",
    helper("oopa_getonly_written", "VAR\n\tstored : INT := 4;\nEND_VAR", "PROPERTY P : INT\nGET\nP := stored;\nEND_GET\nEND_PROPERTY") +
      fbText("oopa_getonly_written", "", "\tt : FB_LANG_oopa_getonly_written_t;\n\tout : INT;", "t.P := 3;\nout := 1;")),
]

const METHODS_AND_VARIABLES: LanguageTest[] = [
  {
    ...fb("oopa_method_ref_in_operand", "a METHOD named without its call, as an operand",
      helper("oopa_method_ref_in_operand", "VAR\n\tn : INT;\nEND_VAR", "METHOD Value : INT\nValue := 5;\nEND_METHOD") +
        fbText("oopa_method_ref_in_operand", "", "\tt : FB_LANG_oopa_method_ref_in_operand_t;\n\tout : INT;", "out := t.Value + 1;")),
    deferred: {
      lsp: "2026-10-06 niche: accepted loss (0 occurrences in the corpora, which build): both vendors type a method named without its call as a type of its own name — \"Operation 'Plus' is not possible on type 'VALUE'\" and \"Cannot convert type 'VALUE' to type 'USINT'\"; method-reference words it for an assignment's source alone, and the front-end has no value type for it as an operand (as for a type's name, `tav_type_as_operand`)",
    },
  },
  fb("oopa_inherited_var_grandparent", "a variable of the base's base redeclared",
    `FUNCTION_BLOCK FB_LANG_oopa_inherited_var_grandparent_a\nVAR\n\tshared : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n` +
      `FUNCTION_BLOCK FB_LANG_oopa_inherited_var_grandparent_b EXTENDS FB_LANG_oopa_inherited_var_grandparent_a\nVAR\n\tb : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n` +
      fbText("oopa_inherited_var_grandparent", " EXTENDS FB_LANG_oopa_inherited_var_grandparent_b", "\tshared : INT;\n\tout : INT;", "out := 1;")),
  fb("oopa_inherited_input_as_var", "a base's VAR_INPUT redeclared as a VAR",
    `FUNCTION_BLOCK FB_LANG_oopa_inherited_input_as_var_base\nVAR_INPUT\n\tmaxCount : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n` +
      fbText("oopa_inherited_input_as_var", " EXTENDS FB_LANG_oopa_inherited_input_as_var_base", "\tmaxCount : INT;\n\tout : INT;", "out := 1;")),
]

const MEMBER_ACCESS: LanguageTest[] = [
  fb("oopa_read_internal_var", "an instance's VAR read from outside",
    helper("oopa_read_internal_var", "VAR\n\thidden : INT := 6;\nEND_VAR") +
      fbText("oopa_read_internal_var", "", "\tt : FB_LANG_oopa_read_internal_var_t;\n\tout : INT;", "out := t.hidden;")),
  fb("oopa_write_var_temp", "an instance's VAR_TEMP written from outside",
    helper("oopa_write_var_temp", "VAR_TEMP\n\tscratch : INT;\nEND_VAR", "", "scratch := 1;") +
      fbText("oopa_write_var_temp", "", "\tt : FB_LANG_oopa_write_var_temp_t;\n\tout : INT;", "t.scratch := 2;\nout := 1;")),
  fb("oopa_write_output", "an instance's VAR_OUTPUT written from outside",
    helper("oopa_write_output", "VAR_OUTPUT\n\to : INT;\nEND_VAR") +
      fbText("oopa_write_output", "", "\tt : FB_LANG_oopa_write_output_t;\n\tout : INT;", "t.o := 2;\nout := t.o;")),
  fb("oopa_inout_read_external", "an instance's VAR_IN_OUT read from outside, nothing written",
    helper("oopa_inout_read_external", "VAR_IN_OUT\n\tio : INT;\nEND_VAR", "", "io := io + 1;") +
      fbText("oopa_inout_read_external", "", "\tt : FB_LANG_oopa_inout_read_external_t;\n\town : INT;\n\tout : INT;", "t(io := own);\nout := t.io;")),
  fb("oopa_inout_in_property", "a property's GET reading its FB's VAR_IN_OUT",
    `FUNCTION_BLOCK FB_LANG_oopa_inout_in_property\nVAR_IN_OUT\n\tio : INT;\nEND_VAR\nVAR\n\tout : INT;\nEND_VAR\nout := P;\nEND_FUNCTION_BLOCK\n\n` +
      `PROPERTY P : INT\nGET\nP := io;\nEND_GET\nEND_PROPERTY\n`,
    "inst_oopa_inout_in_property : FB_LANG_oopa_inout_in_property;\n\tv_oopa_iip : INT;", "inst_oopa_inout_in_property(io := v_oopa_iip);"),
]

const FB_INIT: LanguageTest[] = [
  fb("oopa_fb_init_inout_other_type", "an FB instance's VAR_IN_OUT initialized with a BOOL variable",
    helper("oopa_fb_init_inout_other_type", "VAR_IN_OUT\n\ttarget : INT;\nEND_VAR", "", "target := target + 1;") +
      fbText("oopa_fb_init_inout_other_type", "", "\tflag : BOOL;\n\town : INT;\n\tworker : FB_LANG_oopa_fb_init_inout_other_type_t := (target := flag);", "worker(target := own);")),
  fb("oopa_fb_init_two_arguments", "an FB_Init with one extra input given two arguments",
    `FUNCTION_BLOCK FB_LANG_oopa_fb_init_two_arguments_t\nVAR\n\tstarted : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n` +
      `METHOD FB_Init : BOOL\nVAR_INPUT\n\tbInitRetains : BOOL;\n\tbInCopyCode : BOOL;\n\tstartValue : INT;\nEND_VAR\nstarted := startValue;\nEND_METHOD\n\n` +
      fbText("oopa_fb_init_two_arguments", "", "\tt : FB_LANG_oopa_fb_init_two_arguments_t(3, 4);\n\tout : INT;", "out := 1;")),
  fb("oopa_fb_init_array_left_out", "an ARRAY of an FB whose FB_Init takes an extra input, no arguments",
    `FUNCTION_BLOCK FB_LANG_oopa_fb_init_array_left_out_t\nVAR\n\tstarted : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n` +
      `METHOD FB_Init : BOOL\nVAR_INPUT\n\tbInitRetains : BOOL;\n\tbInCopyCode : BOOL;\n\tstartValue : INT;\nEND_VAR\nstarted := startValue;\nEND_METHOD\n\n` +
      fbText("oopa_fb_init_array_left_out", "", "\tts : ARRAY[1..2] OF FB_LANG_oopa_fb_init_array_left_out_t;\n\tout : INT;", "out := 1;")),
]

export const OOP_RULE_A_TESTS: readonly LanguageTest[] = [...INHERITANCE, ...PROPERTIES, ...METHODS_AND_VARIABLES, ...MEMBER_ACCESS, ...FB_INIT]
