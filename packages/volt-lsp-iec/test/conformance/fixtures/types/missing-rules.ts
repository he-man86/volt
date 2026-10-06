/**
 * THE MISSING RULES — openspec `analysis-conformance` task 3.11 (the unowned gaps of 0.2's missing-rule class), for the two
 * shapes that get a check of their own; each rule's cells beyond the ones that found it:
 *
 *   duplicate enum value  "The constant <n> is assigned to more than one enumeration" (C0125, a warning both vendors give —
 *                         found by `eninit_explicit_duplicate` and the 0 a refused member leaves, `types/enum-init-values.ts`):
 *                         three members alike, two pairs, an implicit member meeting a written one, a negative value, the
 *                         member after a refused one left implicit, a written base, a global CONSTANT beside its literal,
 *                         another enum's member beside its value, a sibling's name, an inline enum of a variable; and
 *                         (the 3.11 gate review) a LATER sibling's name, a refused member before one written 0, two
 *                         refused members, an inline enum as a STRUCT's component
 *   references to bits    "References to bits are not possible" (found by `ty_reference_to_bit` and CODESYS's
 *                         `bitu_fb_var_in_out`): REFERENCE TO BIT as a STRUCT component and as an FB input, a BIT in an FB's
 *                         VAR_IN_OUT CONSTANT, a BIT in a FUNCTION's VAR_IN_OUT; and (the 3.11 gate review) a BIT in a
 *                         PROGRAM's and a METHOD's VAR_IN_OUT, REFERENCE TO BIT in a GVL, a PROGRAM's VAR, a FUNCTION's
 *                         VAR, as an alias (and its parts apart) and as an array's element (a STRUCT's component, a VAR)
 *
 * GLOBAL NAMES ARE THE FIXTURE'S OWN (`FB_LANG_<name>`, `DUT_LANG_<name>`, `F_LANG_<name>`, `GVL_LANG_<name>`): the replay
 * binds every fixture into one project.
 */
import type { LanguageTest } from "../../types.js"

const doc = "openspec analysis-conformance 3.11 (unowned gaps); docs/codesys-reference/06-data-types.md"

/** A function block `FB_LANG_<name>` declaring `vars`, running `body`; `before` (whole units) ahead of it. */
function fb(name: string, feature: string, vars: string, body: string, before = ""): LanguageTest {
  const pouName = `FB_LANG_${name}`
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    plcPrgVar: `inst_${name} : ${pouName};`,
    plcPrgBody: `inst_${name}();`,
    source: `${before}FUNCTION_BLOCK ${pouName}\n${vars}\n${body}\nEND_FUNCTION_BLOCK\n`,
  }
}

/** The enum `DUT_LANG_<name>` with the member list `members` (and `base` after it), read by an FB through its member `B`. */
function enumFb(name: string, feature: string, members: string, base = "", before = ""): LanguageTest {
  const dut = `DUT_LANG_${name}`
  return fb(name, feature, `VAR\n\te : ${dut} := ${dut}.B;\n\tout : INT;\nEND_VAR`, "out := e;",
    `${before}TYPE ${dut} :\n(\n${members}\n)${base};\nEND_TYPE\n\n`)
}

const DUPLICATE_ENUM_VALUES: LanguageTest[] = [
  enumFb("enumdup_three_alike", "three enum members written 1", "\tA := 1,\n\tB := 1,\n\tC := 1"),
  enumFb("enumdup_two_pairs", "two pairs of enum members alike (1, 1, 2, 2)", "\tA := 1,\n\tB := 1,\n\tC := 2,\n\tD := 2"),
  enumFb("enumdup_implicit_meets_written", "an implicit member (after 1) meeting a member written 2", "\tA := 1,\n\tB,\n\tC := 2"),
  enumFb("enumdup_negative", "two enum members written -1", "\tA := -1,\n\tB := -1"),
  enumFb("enumdup_after_refused_implicit", "an implicit member after a refused one (1, 2.5, implicit)", "\tA := 1,\n\tB := 2.5,\n\tC"),
  enumFb("enumdup_byte_base", "two enum members written 1, the enum's base BYTE", "\tA := 1,\n\tB := 1", " BYTE"),
  {
    ...enumFb("enumdup_constant_and_literal", "a member written as a global CONSTANT (4) beside one written 4", "\tA := g_enumdup_four,\n\tB := 4", "",
      "VAR_GLOBAL CONSTANT\n\tg_enumdup_four : INT := 4;\nEND_VAR\n\n"),
    gvlNames: ["GVL_LANG_enumdup_constant_and_literal"],
  },
  enumFb("enumdup_other_enum_member", "a member written as another enum's member (3) beside one written 3", "\tA := 3,\n\tB := DUT_LANG_enumdup_other_enum_member_src.X", "",
    "TYPE DUT_LANG_enumdup_other_enum_member_src :\n(\n\tX := 3\n);\nEND_TYPE\n\n"),
  enumFb("enumdup_sibling_name", "a member written as its sibling's name (`B := A`)", "\tA := 1,\n\tB := A"),
  fb("enumdup_inline_enum", "an inline enum of a variable with two members written 1", "VAR\n\te : (A := 1, B := 1);\n\tout : INT;\nEND_VAR", "out := e;"),
  // the 3.11 gate review: a LATER sibling's name, a refused member BEFORE a member written 0, two refused members, an
  // inline enum as a STRUCT's component
  enumFb("enumdup_forward_sibling", "a member written as a LATER sibling's name (`A := B, B := 1`)", "\tA := B,\n\tB := 1"),
  enumFb("enumdup_refused_then_zero", "a refused member (2.5) first, a member written 0 after it", "\tA := 2.5,\n\tB := 0"),
  enumFb("enumdup_two_refused", "two refused members (2.5, 3.5)", "\tA := 2.5,\n\tB := 3.5"),
  fb("enumdup_struct_inline_enum", "an inline enum with two members written 1 as a STRUCT's component",
    "VAR\n\ts_ : DUT_LANG_enumdup_struct_inline_enum;\n\tout : INT;\nEND_VAR", "out := s_.e;",
    "TYPE DUT_LANG_enumdup_struct_inline_enum :\nSTRUCT\n\te : (A := 1, B := 1);\nEND_STRUCT\nEND_TYPE\n\n"),
]

/** Why the LSP does not refuse an alias of REFERENCE TO BIT (divergences.ts REFERENCE_TO_BIT_ALIAS). */
const ALIAS_DEFERRED =
  "REFERENCE_TO_BIT_ALIAS (niche: accepted loss, 0 REFERENCE TO BIT in the corpora): the vendors refuse the alias only once a variable of it exists — the rule needs the alias's uses across objects, and CODESYS's three copies have no position"

const REFERENCES_TO_BITS: LanguageTest[] = [
  fb("refbit_struct_field", "REFERENCE TO BIT as a STRUCT component",
    "VAR\n\tsrb : DUT_LANG_refbit_struct_field;\n\tout : BOOL;\nEND_VAR", "out := __ISVALIDREF(srb.rbit);",
    "TYPE DUT_LANG_refbit_struct_field :\nSTRUCT\n\trbit : REFERENCE TO BIT;\nEND_STRUCT\nEND_TYPE\n\n"),
  fb("refbit_var_input", "REFERENCE TO BIT as an FB's VAR_INPUT", "VAR_INPUT\n\trbit : REFERENCE TO BIT;\nEND_VAR\nVAR\n\tout : BOOL;\nEND_VAR", "out := __ISVALIDREF(rbit);"),
  fb("refbit_inout_constant_bit", "a BIT in an FB's VAR_IN_OUT CONSTANT", "VAR_IN_OUT CONSTANT\n\tb : BIT;\nEND_VAR\nVAR\n\tout : BOOL;\nEND_VAR", "out := b;"),
  {
    name: "refbit_function_inout_bit",
    pouName: "F_LANG_refbit_function_inout_bit",
    kind: "function",
    feature: "a BIT in a FUNCTION's VAR_IN_OUT",
    fromDoc: doc,
    plcPrgVar: "r_refbit_function_inout_bit : INT;",
    plcPrgBody: "r_refbit_function_inout_bit := F_LANG_refbit_function_inout_bit();",
    source: "FUNCTION F_LANG_refbit_function_inout_bit : INT\nVAR_IN_OUT\n\tb : BIT;\nEND_VAR\nF_LANG_refbit_function_inout_bit := 1;\nEND_FUNCTION\n",
  },
  // the 3.11 gate review: a BIT in a PROGRAM's and a METHOD's VAR_IN_OUT; REFERENCE TO BIT in a GVL, a PROGRAM's VAR, a
  // FUNCTION's VAR, as an alias, as a STRUCT's array component
  {
    name: "refbit_program_inout_bit",
    pouName: "PRG_LANG_refbit_program_inout_bit",
    kind: "program",
    feature: "a BIT in a PROGRAM's VAR_IN_OUT, the PROGRAM called with a STRUCT's BIT component (an uncalled PROGRAM is not compiled)",
    fromDoc: doc,
    plcPrgVar: "s_refbit_program_inout_bit : DUT_LANG_refbit_program_inout_bit;",
    plcPrgBody: "PRG_LANG_refbit_program_inout_bit(b := s_refbit_program_inout_bit.b);",
    source:
      "TYPE DUT_LANG_refbit_program_inout_bit :\nSTRUCT\n\tb : BIT;\nEND_STRUCT\nEND_TYPE\n\n" +
      "PROGRAM PRG_LANG_refbit_program_inout_bit\nVAR_IN_OUT\n\tb : BIT;\nEND_VAR\nVAR\n\tout : BOOL;\nEND_VAR\nout := b;\nEND_PROGRAM\n",
  },
  {
    ...fb("refbit_method_inout_bit", "a BIT in a METHOD's VAR_IN_OUT", "VAR\n\tout : INT;\nEND_VAR", "out := 1;"),
    source: "FUNCTION_BLOCK FB_LANG_refbit_method_inout_bit\nVAR\n\tout : INT;\nEND_VAR\nout := 1;\nEND_FUNCTION_BLOCK\n\nMETHOD M : INT\nVAR_IN_OUT\n\tb : BIT;\nEND_VAR\nM := 1;\nEND_METHOD\n",
  },
  {
    name: "refbit_gvl_reference",
    pouName: "GVL_LANG_refbit_gvl_reference",
    kind: "gvl",
    feature: "REFERENCE TO BIT in a GVL",
    fromDoc: doc,
    plcPrgVar: "v_refbit_gvl_reference : BOOL;",
    plcPrgBody: "v_refbit_gvl_reference := __ISVALIDREF(GVL_LANG_refbit_gvl_reference.g_refbit_gvl_reference);",
    source: "VAR_GLOBAL\n\tg_refbit_gvl_reference : REFERENCE TO BIT;\nEND_VAR\n",
  },
  {
    name: "refbit_program_var_reference",
    pouName: "PRG_LANG_refbit_program_var_reference",
    kind: "program",
    feature: "REFERENCE TO BIT in a PROGRAM's VAR",
    fromDoc: doc,
    plcPrgBody: "PRG_LANG_refbit_program_var_reference();",
    source: "PROGRAM PRG_LANG_refbit_program_var_reference\nVAR\n\trbit : REFERENCE TO BIT;\n\tout : BOOL;\nEND_VAR\nout := __ISVALIDREF(rbit);\nEND_PROGRAM\n",
  },
  {
    name: "refbit_function_var_reference",
    pouName: "F_LANG_refbit_function_var_reference",
    kind: "function",
    feature: "REFERENCE TO BIT in a FUNCTION's VAR",
    fromDoc: doc,
    plcPrgVar: "r_refbit_function_var_reference : BOOL;",
    plcPrgBody: "r_refbit_function_var_reference := F_LANG_refbit_function_var_reference();",
    source: "FUNCTION F_LANG_refbit_function_var_reference : BOOL\nVAR\n\trbit : REFERENCE TO BIT;\nEND_VAR\nF_LANG_refbit_function_var_reference := __ISVALIDREF(rbit);\nEND_FUNCTION\n",
  },
  {
    ...fb("refbit_alias", "an alias of REFERENCE TO BIT (`TYPE R : REFERENCE TO BIT`) and a variable of it",
      "VAR\n\trbit : DUT_LANG_refbit_alias;\n\tout : BOOL;\nEND_VAR", "out := __ISVALIDREF(rbit);",
      "TYPE DUT_LANG_refbit_alias : REFERENCE TO BIT;\nEND_TYPE\n\n"),
    deferred: { lsp: ALIAS_DEFERRED },
  },
  // …and the alias's parts apart (CODESYS says the sentence three times for `refbit_alias`, no position): the alias with
  // nothing declared of it, and a variable of it that nothing reads
  fb("refbit_alias_unused", "an alias of REFERENCE TO BIT that nothing declares a variable of",
    "VAR\n\tout : BOOL;\nEND_VAR", "out := TRUE;",
    "TYPE DUT_LANG_refbit_alias_unused : REFERENCE TO BIT;\nEND_TYPE\n\n"),
  {
    ...fb("refbit_alias_variable_unread", "an alias of REFERENCE TO BIT and a variable of it that nothing reads",
      "VAR\n\trbit : DUT_LANG_refbit_alias_variable_unread;\n\tout : BOOL;\nEND_VAR", "out := TRUE;",
      "TYPE DUT_LANG_refbit_alias_variable_unread : REFERENCE TO BIT;\nEND_TYPE\n\n"),
    deferred: { lsp: ALIAS_DEFERRED },
  },
  fb("refbit_struct_array_component", "ARRAY OF REFERENCE TO BIT as a STRUCT's component",
    "VAR\n\tsrb : DUT_LANG_refbit_struct_array_component;\n\tout : BOOL;\nEND_VAR", "out := __ISVALIDREF(srb.rbits[0]);",
    "TYPE DUT_LANG_refbit_struct_array_component :\nSTRUCT\n\trbits : ARRAY[0..1] OF REFERENCE TO BIT;\nEND_STRUCT\nEND_TYPE\n\n"),
  fb("refbit_var_array_reference", "ARRAY OF REFERENCE TO BIT in an FB's VAR",
    "VAR\n\trbits : ARRAY[0..1] OF REFERENCE TO BIT;\n\tout : BOOL;\nEND_VAR", "out := __ISVALIDREF(rbits[0]);"),
]

export const MISSING_RULE_TESTS: readonly LanguageTest[] = [...DUPLICATE_ENUM_VALUES, ...REFERENCES_TO_BITS]
