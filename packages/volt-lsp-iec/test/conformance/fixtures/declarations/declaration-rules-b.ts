/**
 * DECLARATION RULES B — openspec `analysis-conformance` task 3.4.1 (declarations B), rule by rule, the cells no fixture
 * asked:
 *
 *   header-rules           a FUNCTION_BLOCK with a return type (C0182 is measured on a PROGRAM only), three bases in one
 *                          EXTENDS, an INTERFACE extending two (legal: interfaces inherit from several), PRIVATE on a
 *                          FUNCTION and PROTECTED on a PROGRAM (`accessOnlyOnMethods` measured on FBs and interface
 *                          members only), an FB PROPERTY with neither accessor (measured on an interface's only), a
 *                          VAR_OUTPUT section in an INTERFACE an FB implements (C0149 measured with VAR_INPUT / VAR)
 *   var-section-placement  VAR_GLOBAL in an FB and in a PROGRAM (no fixture), RETAIN in a FUNCTION's VAR and VAR_INPUT
 *                          (measured on a METHOD only), VAR_CONFIG in a FUNCTION (measured in an FB), VAR_OUTPUT RETAIN in
 *                          an FB (the legal side)
 *   inout-initializer      an FB instance initialized with a literal for its VAR_IN_OUT (`cc5_fb_init_inout` names a
 *                          variable), a VAR_IN_OUT read inside an ARRAY and a STRUCT initializer (the check skips
 *                          aggregates)
 *   signature-name         an ENUM, an ALIAS and a UNION whose signature names another object, each reached from PLC_PRG
 *                          (a STRUCT's is measured only through another fixture), and an FB whose signature differs from
 *                          its object in letter case alone
 *   attribute-placement    `pack_mode` on a FUNCTION and on a PROGRAM (measured on a METHOD, and legal on an FB)
 *
 * GLOBAL NAMES ARE THE FIXTURE'S OWN (`FB_LANG_<name>`, `DUT_LANG_<name>`, `F_LANG_<name>`, `P_LANG_<name>`): the replay
 * binds every fixture into one project.
 */
import type { LanguageTest } from "../../types.js"

const doc = "openspec analysis-conformance 3.4.1 (declarations B); docs/codesys-reference/03-pous.md"

/** A function block `FB_LANG_<name>`, instanced and called from PLC_PRG; `source` overrides the whole text. */
function fb(name: string, feature: string, source: string, plcPrgVar = `inst_${name} : FB_LANG_${name};`, plcPrgBody = `inst_${name}();`): LanguageTest {
  return { name, pouName: `FB_LANG_${name}`, kind: "function_block", feature, fromDoc: doc, plcPrgVar, plcPrgBody, source }
}

/** A function `F_LANG_<name>` returning INT, called from PLC_PRG with `args`. */
function fn(name: string, feature: string, source: string, args = ""): LanguageTest {
  return {
    name,
    pouName: `F_LANG_${name}`,
    kind: "function",
    feature,
    fromDoc: doc,
    plcPrgVar: `r_${name} : INT;`,
    plcPrgBody: `r_${name} := F_LANG_${name}(${args});`,
    source,
  }
}

/** A PROGRAM `P_LANG_<name>`, called from PLC_PRG. */
function prg(name: string, feature: string, source: string): LanguageTest {
  return { name, pouName: `P_LANG_${name}`, kind: "program", feature, fromDoc: doc, plcPrgBody: `P_LANG_${name}();`, source }
}

/** A DUT held in the object `pouName`, its signature naming `signature`, reached from PLC_PRG through `plcPrgVar`. */
function dut(name: string, feature: string, pouName: string, source: string, plcPrgVar: string, plcPrgBody: string): LanguageTest {
  return { name, pouName, kind: "dut", feature, fromDoc: doc, plcPrgVar, plcPrgBody, source }
}

/** `t` pushed AS SENT — its header is one the parser misreads, so its split would not carry the question; the source states
 *  its own `IMPLEMENTATION ST` line, as a workspace file does. */
function asSent(t: LanguageTest): LanguageTest {
  return { ...t, asSent: "the parser misreads this header; its text is pushed as a workspace file holds it" }
}

const HEADER_RULES: LanguageTest[] = [
  asSent(fb("hdr_fb_return_type", "a FUNCTION_BLOCK header with a return type",
    "FUNCTION_BLOCK FB_LANG_hdr_fb_return_type : INT\nVAR\n\tout : INT;\nEND_VAR\nIMPLEMENTATION ST\nout := 1;\nEND_FUNCTION_BLOCK\n")),
  fb("hdr_fb_extends_three", "an FB EXTENDS naming three bases",
    "FUNCTION_BLOCK FB_LANG_hdr_fb_extends_three_a\nVAR\n\ta : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n" +
      "FUNCTION_BLOCK FB_LANG_hdr_fb_extends_three_b\nVAR\n\tb : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n" +
      "FUNCTION_BLOCK FB_LANG_hdr_fb_extends_three_c\nVAR\n\tc : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n" +
      "FUNCTION_BLOCK FB_LANG_hdr_fb_extends_three EXTENDS FB_LANG_hdr_fb_extends_three_a, FB_LANG_hdr_fb_extends_three_b, FB_LANG_hdr_fb_extends_three_c\n" +
      "VAR\n\tout : INT;\nEND_VAR\nout := 1;\nEND_FUNCTION_BLOCK\n"),
  fb("hdr_interface_extends_two", "an INTERFACE extending two interfaces, implemented by an FB (legal)",
    "INTERFACE ITF_LANG_hdr_interface_extends_two_a\nMETHOD Ma : INT\nEND_METHOD\nEND_INTERFACE\n\n" +
      "INTERFACE ITF_LANG_hdr_interface_extends_two_b\nMETHOD Mb : INT\nEND_METHOD\nEND_INTERFACE\n\n" +
      "INTERFACE ITF_LANG_hdr_interface_extends_two_ab EXTENDS ITF_LANG_hdr_interface_extends_two_a, ITF_LANG_hdr_interface_extends_two_b\nEND_INTERFACE\n\n" +
      "FUNCTION_BLOCK FB_LANG_hdr_interface_extends_two IMPLEMENTS ITF_LANG_hdr_interface_extends_two_ab\nVAR\n\tout : INT;\nEND_VAR\nout := Ma() + Mb();\nEND_FUNCTION_BLOCK\n\n" +
      "METHOD Ma : INT\nMa := 1;\nEND_METHOD\n\nMETHOD Mb : INT\nMb := 2;\nEND_METHOD\n"),
  asSent(fn("hdr_function_private", "PRIVATE on a FUNCTION",
    "FUNCTION PRIVATE F_LANG_hdr_function_private : INT\nVAR\nEND_VAR\nIMPLEMENTATION ST\nF_LANG_hdr_function_private := 1;\nEND_FUNCTION\n")),
  asSent(prg("hdr_program_protected", "PROTECTED on a PROGRAM",
    "PROGRAM PROTECTED P_LANG_hdr_program_protected\nVAR\n\tout : INT;\nEND_VAR\nIMPLEMENTATION ST\nout := 1;\nEND_PROGRAM\n")),
  fb("hdr_fb_property_no_accessor", "an FB PROPERTY declaring neither GET nor SET",
    "FUNCTION_BLOCK FB_LANG_hdr_fb_property_no_accessor\nVAR\n\tout : INT;\nEND_VAR\nout := 1;\nEND_FUNCTION_BLOCK\n\nPROPERTY P : INT\nEND_PROPERTY\n"),
  fb("hdr_interface_var_output_used", "a VAR_OUTPUT section in an INTERFACE an FB implements",
    "INTERFACE ITF_LANG_hdr_interface_var_output_used\nVAR_OUTPUT\n\to : INT;\nEND_VAR\nEND_INTERFACE\n\n" +
      "FUNCTION_BLOCK FB_LANG_hdr_interface_var_output_used IMPLEMENTS ITF_LANG_hdr_interface_var_output_used\nVAR\n\tout : INT;\nEND_VAR\nout := 1;\nEND_FUNCTION_BLOCK\n"),
]

const SECTION_PLACEMENT: LanguageTest[] = [
  fb("vsp_var_global_in_fb", "a VAR_GLOBAL section in a FUNCTION_BLOCK",
    "FUNCTION_BLOCK FB_LANG_vsp_var_global_in_fb\nVAR_GLOBAL\n\tg_vsp_fb : INT;\nEND_VAR\nVAR\n\tout : INT;\nEND_VAR\nout := 1;\nEND_FUNCTION_BLOCK\n"),
  prg("vsp_var_global_in_program", "a VAR_GLOBAL section in a PROGRAM",
    "PROGRAM P_LANG_vsp_var_global_in_program\nVAR_GLOBAL\n\tg_vsp_prg : INT;\nEND_VAR\nVAR\n\tout : INT;\nEND_VAR\nout := 1;\nEND_PROGRAM\n"),
  fn("vsp_retain_in_function", "a VAR RETAIN section in a FUNCTION",
    "FUNCTION F_LANG_vsp_retain_in_function : INT\nVAR RETAIN\n\tkept : INT;\nEND_VAR\nkept := kept + 1;\nF_LANG_vsp_retain_in_function := kept;\nEND_FUNCTION\n"),
  fn("vsp_retain_input_in_function", "a VAR_INPUT RETAIN section in a FUNCTION",
    "FUNCTION F_LANG_vsp_retain_input_in_function : INT\nVAR_INPUT RETAIN\n\ti : INT;\nEND_VAR\nF_LANG_vsp_retain_input_in_function := i;\nEND_FUNCTION\n", "i := 1"),
  fn("vsp_var_config_in_function", "a VAR_CONFIG section in a FUNCTION",
    "FUNCTION F_LANG_vsp_var_config_in_function : INT\nVAR_CONFIG\n\tmisplaced : INT;\nEND_VAR\nF_LANG_vsp_var_config_in_function := 1;\nEND_FUNCTION\n"),
  fb("vsp_retain_output_in_fb", "a VAR_OUTPUT RETAIN section in a FUNCTION_BLOCK (the legal side)",
    "FUNCTION_BLOCK FB_LANG_vsp_retain_output_in_fb\nVAR_OUTPUT RETAIN\n\tkept : INT;\nEND_VAR\nkept := kept + 1;\nEND_FUNCTION_BLOCK\n"),
]

/** An FB_INIT that reads an unbound VAR_IN_OUT: it builds (two warnings) and the application never starts. */
const LOGIN_FAILS =
  "NOTHING TO MEASURE — recorded alone, each, as \"Login failed...\" (CODESYS record:exec 2026-10-06): the initializer reads a VAR_IN_OUT nothing has bound, in FB_INIT, and the application does not start; its one question is what the build says"

const INOUT_INITIALIZER: LanguageTest[] = [
  fb("ioinit_fb_instance_literal", "an FB instance whose initializer gives its VAR_IN_OUT a literal",
    "FUNCTION_BLOCK FB_LANG_ioinit_fb_instance_literal_bound\nVAR_IN_OUT\n\ttarget : INT;\nEND_VAR\ntarget := target + 1;\nEND_FUNCTION_BLOCK\n\n" +
      "FUNCTION_BLOCK FB_LANG_ioinit_fb_instance_literal\nVAR\n\town : INT;\n\tworker : FB_LANG_ioinit_fb_instance_literal_bound := (target := 5);\nEND_VAR\nworker(target := own);\nEND_FUNCTION_BLOCK\n"),
  {
    ...fb("ioinit_array_initializer", "a VAR_IN_OUT read inside another variable's ARRAY initializer",
    "FUNCTION_BLOCK FB_LANG_ioinit_array_initializer\nVAR_IN_OUT\n\tsource : INT;\nEND_VAR\nVAR\n\tcopies : ARRAY[0..1] OF INT := [source, 1];\nEND_VAR\ncopies[1] := source;\nEND_FUNCTION_BLOCK\n",
    "inst_ioinit_array_initializer : FB_LANG_ioinit_array_initializer;\n\tv_ioinit_array : INT;", "inst_ioinit_array_initializer(source := v_ioinit_array);"),
    execSkip: LOGIN_FAILS,
  },
  {
    ...fb("ioinit_struct_initializer", "a VAR_IN_OUT read inside another variable's STRUCT initializer",
    "TYPE DUT_LANG_ioinit_struct_initializer :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE\n\n" +
      "FUNCTION_BLOCK FB_LANG_ioinit_struct_initializer\nVAR_IN_OUT\n\tsource : INT;\nEND_VAR\nVAR\n\ts1 : DUT_LANG_ioinit_struct_initializer := (a := source);\nEND_VAR\ns1.a := source;\nEND_FUNCTION_BLOCK\n",
    "inst_ioinit_struct_initializer : FB_LANG_ioinit_struct_initializer;\n\tv_ioinit_struct : INT;", "inst_ioinit_struct_initializer(source := v_ioinit_struct);"),
    execSkip: LOGIN_FAILS,
  },
]

const SIGNATURE_NAME: LanguageTest[] = [
  dut("sn_enum_mismatch_used", "an ENUM whose signature names another object, used by PLC_PRG", "DUT_SN_enumObject",
    "TYPE DUT_SN_enumSignature :\n(\n\tsne_a,\n\tsne_b\n);\nEND_TYPE\n", "e_sn_enum : DUT_SN_enumSignature;", "e_sn_enum := DUT_SN_enumSignature.sne_b;"),
  dut("sn_alias_mismatch_used", "an ALIAS whose signature names another object, used by PLC_PRG", "DUT_SN_aliasObject",
    "TYPE DUT_SN_aliasSignature : INT;\nEND_TYPE\n", "a_sn_alias : DUT_SN_aliasSignature;", "a_sn_alias := 3;"),
  dut("sn_union_mismatch_used", "a UNION whose signature names another object, used by PLC_PRG", "DUT_SN_unionObject",
    "TYPE DUT_SN_unionSignature :\nUNION\n\ti : INT;\n\tw : WORD;\nEND_UNION\nEND_TYPE\n", "u_sn_union : DUT_SN_unionSignature;", "u_sn_union.i := 3;"),
  {
    ...fb("sn_fb_case_only", "an FB whose signature differs from its object name in letter case alone",
      "FUNCTION_BLOCK FB_SN_caseonly\nVAR\n\tout : INT;\nEND_VAR\nout := 1;\nEND_FUNCTION_BLOCK\n", "inst_sn_case : FB_SN_CaseOnly;", "inst_sn_case();"),
    pouName: "FB_SN_CaseOnly",
  },
]

const ATTRIBUTE_PLACEMENT: LanguageTest[] = [
  fn("attrp_pack_mode_on_function", "{attribute 'pack_mode'} on a FUNCTION",
    "{attribute 'pack_mode' := '1'}\nFUNCTION F_LANG_attrp_pack_mode_on_function : INT\nF_LANG_attrp_pack_mode_on_function := 1;\nEND_FUNCTION\n"),
  prg("attrp_pack_mode_on_program", "{attribute 'pack_mode'} on a PROGRAM",
    "{attribute 'pack_mode' := '1'}\nPROGRAM P_LANG_attrp_pack_mode_on_program\nVAR\n\tout : INT;\nEND_VAR\nout := 1;\nEND_PROGRAM\n"),
]

export const DECLARATION_B_TESTS: readonly LanguageTest[] = [...HEADER_RULES, ...SECTION_PLACEMENT, ...INOUT_INITIALIZER, ...SIGNATURE_NAME, ...ATTRIBUTE_PLACEMENT]
