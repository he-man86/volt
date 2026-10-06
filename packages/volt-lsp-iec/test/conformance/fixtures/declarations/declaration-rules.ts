/**
 * DECLARATION RULES — openspec `analysis-conformance` task 3.3.1 (declarations A), the cells no fixture asked:
 *
 *   bit-usage (C0203–C0206)   a BIT in every FB section that is not VAR_INPUT / VAR_OUTPUT / VAR (VAR_IN_OUT, VAR_TEMP,
 *                             VAR_STAT, VAR CONSTANT), in a FUNCTION, a METHOD and a PROGRAM, and the legal FB sections —
 *                             the census measured `bitInWrongBlock` at 0 TP on both vendors
 *   const-context (C0526)     a VAR_INPUT default that is a variable, in an FB and in a FUNCTION (`defaultNotConstant`, 0 TP)
 *   input-default (C0525)     a FUNCTION input defaulted with a struct list, a METHOD input defaulted with an array
 *   obsolete-usage (C0357)    an obsolete STRUCT as a variable's type, an obsolete FB extended, the attribute with no value
 *
 * GLOBAL NAMES ARE THE FIXTURE'S OWN (`FB_LANG_<name>`, `DUT_LANG_<name>`, `F_LANG_<name>`, `GVL_LANG_<name>`): the replay
 * binds every fixture into one project.
 */
import type { LanguageTest } from "../../types.js"

const doc = "openspec analysis-conformance 3.3.1 (declarations A); docs/codesys-reference/06-data-types.md"

/** A function block `FB_LANG_<name>` with the sections `sections` and body `body`; `before` is written ahead of it. */
function fb(name: string, feature: string, sections: string, body: string, before = ""): LanguageTest {
  const pouName = `FB_LANG_${name}`
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    plcPrgVar: `inst_${name} : ${pouName};`,
    plcPrgBody: `inst_${name}();`,
    source: `${before}FUNCTION_BLOCK ${pouName}\n${sections}\n${body}\nEND_FUNCTION_BLOCK\n`,
  }
}

/** A function `F_LANG_<name>` returning INT, called from PLC_PRG as `F_LANG_<name>(<args>)` — every input passed, so a
 *  default is the only question (a call with NO argument is the call check's, `callarg_no_argument_defaulted_input`). */
function fn(name: string, feature: string, sections: string, body: string, before = "", args = "", argVars = ""): LanguageTest {
  const pouName = `F_LANG_${name}`
  return {
    name,
    pouName,
    kind: "function",
    feature,
    fromDoc: doc,
    plcPrgVar: `r_${name} : INT;${argVars}`,
    plcPrgBody: `r_${name} := ${pouName}(${args});`,
    source: `${before}FUNCTION ${pouName} : INT\n${sections}\n${body}\nEND_FUNCTION\n`,
  }
}

/** A PROGRAM `P_LANG_<name>`, called from PLC_PRG. */
function prg(name: string, feature: string, sections: string, body: string): LanguageTest {
  const pouName = `P_LANG_${name}`
  return {
    name,
    pouName,
    kind: "program",
    feature,
    fromDoc: doc,
    plcPrgBody: `${pouName}();`,
    source: `PROGRAM ${pouName}\n${sections}\n${body}\nEND_PROGRAM\n`,
  }
}

const BIT_USAGE: LanguageTest[] = [
  fb("bitu_fb_var_in_out", "a BIT declared in an FB's VAR_IN_OUT", "VAR_IN_OUT\n\tb : BIT;\nEND_VAR\nVAR\n\tout : BOOL;\nEND_VAR", "out := b;"),
  fb("bitu_fb_var_temp", "a BIT declared in an FB's VAR_TEMP", "VAR_TEMP\n\tb : BIT;\nEND_VAR\nVAR\n\tout : BOOL;\nEND_VAR", "b := TRUE;\nout := b;"),
  fb("bitu_fb_var_stat", "a BIT declared in an FB's VAR_STAT", "VAR_STAT\n\tb : BIT;\nEND_VAR\nVAR\n\tout : BOOL;\nEND_VAR", "b := TRUE;\nout := b;"),
  {
    ...fb("bitu_fb_var_constant", "a BIT declared in an FB's VAR CONSTANT", "VAR CONSTANT\n\tb : BIT := 1;\nEND_VAR\nVAR\n\tout : BOOL;\nEND_VAR", "out := b;"),
    execSkip: "the online read answers \"Invalid value\" for a BIT constant (record:exec 2026-10-06) — no value comes back; the build is the question",
  },
  fb("bitu_fb_legal_sections", "a BIT in an FB's VAR_INPUT, VAR_OUTPUT and VAR",
    "VAR_INPUT\n\tbi : BIT;\nEND_VAR\nVAR_OUTPUT\n\tbo : BIT;\nEND_VAR\nVAR\n\tbv : BIT;\n\tout : BOOL;\nEND_VAR", "bv := bi;\nbo := bv;\nout := bo;"),
  fn("bitu_function_var", "a BIT declared in a FUNCTION's VAR", "VAR\n\tb : BIT;\nEND_VAR", "b := TRUE;\nF_LANG_bitu_function_var := 1;"),
  {
    ...fb("bitu_method_var", "a BIT declared in a METHOD's VAR", "VAR\n\tout : INT;\nEND_VAR", "out := M();"),
    source:
      "FUNCTION_BLOCK FB_LANG_bitu_method_var\nVAR\n\tout : INT;\nEND_VAR\nout := M();\nEND_FUNCTION_BLOCK\n" +
      "METHOD M : INT\nVAR\n\tb : BIT;\nEND_VAR\nb := TRUE;\nM := 1;\nEND_METHOD\n",
  },
  prg("bitu_program_var", "a BIT declared in a PROGRAM's VAR", "VAR\n\tb : BIT;\n\tout : BOOL;\nEND_VAR", "b := TRUE;\nout := b;"),
]

const DEFAULTS: LanguageTest[] = [
  {
    ...fb("dflt_fb_input_from_variable", "an FB's VAR_INPUT defaulted with a global VARIABLE",
      "VAR_INPUT\n\ti : INT := g_dflt_fb;\nEND_VAR\nVAR\n\tout : INT;\nEND_VAR", "out := i;", "VAR_GLOBAL\n\tg_dflt_fb : INT := 3;\nEND_VAR\n\n"),
    gvlNames: ["GVL_LANG_dflt_fb_input_from_variable"],
  },
  {
    ...fn("dflt_function_input_from_variable", "a FUNCTION's VAR_INPUT defaulted with a global VARIABLE",
      "VAR_INPUT\n\ti : INT := g_dflt_fn;\nEND_VAR", "F_LANG_dflt_function_input_from_variable := i;", "VAR_GLOBAL\n\tg_dflt_fn : INT := 3;\nEND_VAR\n\n", "i := 1"),
    gvlNames: ["GVL_LANG_dflt_function_input_from_variable"],
  },
  // 3.1+3.3 gate review: the two POU kinds the FB / FUNCTION cells left unasked
  {
    ...prg("dflt_program_input_from_variable", "a PROGRAM's VAR_INPUT defaulted with a global VARIABLE",
      "VAR_INPUT\n\ti : INT := g_dflt_prg;\nEND_VAR\nVAR\n\tout : INT;\nEND_VAR", "out := i;"),
    source: "VAR_GLOBAL\n\tg_dflt_prg : INT := 3;\nEND_VAR\n\n" +
      "PROGRAM P_LANG_dflt_program_input_from_variable\nVAR_INPUT\n\ti : INT := g_dflt_prg;\nEND_VAR\nVAR\n\tout : INT;\nEND_VAR\nout := i;\nEND_PROGRAM\n",
    gvlNames: ["GVL_LANG_dflt_program_input_from_variable"],
  },
  {
    ...fb("dflt_method_input_from_variable", "a METHOD's VAR_INPUT defaulted with a global VARIABLE", "VAR\n\tout : INT;\nEND_VAR", "out := M(i := 1);"),
    source: "VAR_GLOBAL\n\tg_dflt_meth : INT := 3;\nEND_VAR\n\n" +
      "FUNCTION_BLOCK FB_LANG_dflt_method_input_from_variable\nVAR\n\tout : INT;\nEND_VAR\nout := M(i := 1);\nEND_FUNCTION_BLOCK\n" +
      "METHOD M : INT\nVAR_INPUT\n\ti : INT := g_dflt_meth;\nEND_VAR\nM := i;\nEND_METHOD\n",
    gvlNames: ["GVL_LANG_dflt_method_input_from_variable"],
  },
  fn("indf_function_input_struct_default", "a FUNCTION's struct VAR_INPUT defaulted with a struct list",
    "VAR_INPUT\n\ts1 : DUT_LANG_indf_function_input_struct_default := (x := 1);\nEND_VAR", "F_LANG_indf_function_input_struct_default := s1.x;",
    "TYPE DUT_LANG_indf_function_input_struct_default :\nSTRUCT\n\tx : INT;\nEND_STRUCT\nEND_TYPE\n\n", "s1 := sArg_indf",
    " sArg_indf : DUT_LANG_indf_function_input_struct_default;"),
  {
    ...fb("indf_method_input_array_default", "a METHOD's ARRAY VAR_INPUT defaulted with an array list", "VAR\n\tout : INT;\nEND_VAR", "out := M();"),
    source:
      "FUNCTION_BLOCK FB_LANG_indf_method_input_array_default\nVAR\n\tout : INT;\n\targ : ARRAY[0..1] OF INT;\nEND_VAR\nout := M(a := arg);\nEND_FUNCTION_BLOCK\n" +
      "METHOD M : INT\nVAR_INPUT\n\ta : ARRAY[0..1] OF INT := [1, 2];\nEND_VAR\nM := a[1];\nEND_METHOD\n",
  },
]

const OBSOLETE: LanguageTest[] = [
  fb("obs_struct_as_type", "a variable whose type is a STRUCT marked obsolete", "VAR\n\ts1 : DUT_LANG_obs_struct_as_type;\n\tout : INT;\nEND_VAR", "out := s1.x;",
    "{attribute 'obsolete' := 'use another'}\nTYPE DUT_LANG_obs_struct_as_type :\nSTRUCT\n\tx : INT;\nEND_STRUCT\nEND_TYPE\n\n"),
  {
    ...fb("obs_fb_extended", "an FB that EXTENDS an FB marked obsolete", "VAR\n\tout : INT;\nEND_VAR", "out := 1;"),
    source:
      "{attribute 'obsolete' := 'do not extend'}\nFUNCTION_BLOCK FB_LANG_obs_fb_extended_base\nVAR\n\tv : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n" +
      "FUNCTION_BLOCK FB_LANG_obs_fb_extended EXTENDS FB_LANG_obs_fb_extended_base\nVAR\n\tout : INT;\nEND_VAR\nout := v;\nEND_FUNCTION_BLOCK\n",
  },
  fb("obs_attribute_without_value", "an FB instance whose FB carries the obsolete attribute with no value", "VAR\n\tinner : FB_LANG_obs_attribute_without_value_old;\n\tout : INT;\nEND_VAR", "inner();\nout := 1;",
    "{attribute 'obsolete'}\nFUNCTION_BLOCK FB_LANG_obs_attribute_without_value_old\nVAR\n\tv : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n"),
]

export const DECLARATION_CHECK_TESTS: readonly LanguageTest[] = [...BIT_USAGE, ...DEFAULTS, ...OBSOLETE]
