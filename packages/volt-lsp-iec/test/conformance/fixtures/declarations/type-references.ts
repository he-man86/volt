/**
 * A TYPE NAME THAT NAMES NOTHING, IN EVERY POSITION A TYPE NAME STANDS — openspec `dut-unknown-field-type` (Sim-Assist:
 * a STRUCT field `other : NoSuchType;` got no diagnostic). The class is "a type reference in a declaration position that
 * is not resolved", so each position is its own fixture, and each asks the same thing: does the build say "Unknown type:
 * 'NoSuchType'", and what else? A plain VAR declaration is already measured (`qf_c0077_before`); EXTENDS of an FB and of an
 * INTERFACE and IMPLEMENTS are `inh_unresolved_base`, `inh_interface_extends_unknown` and `cc2_base_and_interface_not_found`.
 *
 * ONE QUESTION PER FIXTURE: one unknown name, in one position. Every object is reached from PLC_PRG — an object nothing
 * uses is not compiled — except `tref_struct_field_unused`, which asks exactly that of a DUT.
 */
import type { LanguageTest } from "../../types.js"

const doc = "openspec dut-unknown-field-type (class sweep: a type reference in a declaration position)"

/** A function block `FB_LANG_<name>` declaring `sections` and an `out`, running `body`, instanced and called from PLC_PRG;
 *  `members` after it. */
function fb(name: string, feature: string, sections: string, members = "", body = ""): LanguageTest {
  const pouName = `FB_LANG_${name}`
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    plcPrgVar: `inst_${name} : ${pouName};`,
    plcPrgBody: `inst_${name}();`,
    source: `FUNCTION_BLOCK ${pouName}\n${sections}\nVAR\n\tout : INT;\nEND_VAR\n${body === "" ? "" : `${body}\n`}out := 1;\nEND_FUNCTION_BLOCK\n${members === "" ? "" : `\n${members}`}`,
  }
}

/** `fb` whose one declaration `decl` stands in a VAR section of its own. */
const inVar = (name: string, feature: string, decl: string): LanguageTest => fb(name, feature, `VAR\n\t${decl}\nEND_VAR`)

/** A DUT `DUT_LANG_<name>` whose text after `TYPE DUT_LANG_<name>` is `rest`, held by a variable of PLC_PRG. */
function dut(name: string, feature: string, rest: string, used = true): LanguageTest {
  const pouName = `DUT_LANG_${name}`
  return {
    name,
    pouName,
    kind: "dut",
    feature,
    fromDoc: doc,
    plcPrgVar: used ? `v_${name} : ${pouName};` : `n_${name} : INT;`,
    source: `TYPE ${pouName}${rest}\nEND_TYPE\n`,
  }
}

export const TYPE_REFERENCE_TESTS: readonly LanguageTest[] = [
  // ─── a DUT's own text ─────────────────────────────────────────────────────────────────────────────────────────────
  // Sim-Assist's repro: a STRUCT field of a type nothing declares, the struct used and a known field written
  {
    ...dut("tref_struct_field", "a STRUCT field of an unknown type: `other : NoSuchType;`",
      " :\nSTRUCT\n\tvalue : INT;\n\tother : NoSuchType;\nEND_STRUCT"),
    plcPrgBody: "v_tref_struct_field.value := 1;",
  },
  dut("tref_struct_field_unused", "a STRUCT field of an unknown type, the STRUCT used by nothing",
    " :\nSTRUCT\n\tvalue : INT;\n\tother : NoSuchType;\nEND_STRUCT", false),
  dut("tref_union_field", "a UNION field of an unknown type", " :\nUNION\n\tvalue : INT;\n\tother : NoSuchType;\nEND_UNION"),
  dut("tref_alias", "an alias of an unknown type: `TYPE A : NoSuchType;`", " : NoSuchType;"),
  dut("tref_struct_extends", "a STRUCT EXTENDS an unknown type", " EXTENDS NoSuchType :\nSTRUCT\n\tvalue : INT;\nEND_STRUCT"),
  dut("tref_enum_base", "an enumeration's base type unknown: `(a, b) NoSuchType`", " :\n(\n\ta,\n\tb\n) NoSuchType;"),
  // …and a base the project DOES declare, an alias of INT: is the refusal of a name the parser's or the type's?
  {
    ...dut("tref_enum_base_alias", "an enumeration's base type an alias of INT the project declares",
      " :\n(\n\ta,\n\tb\n) DUT_LANG_tref_enum_base_alias_int;"),
    source: "TYPE DUT_LANG_tref_enum_base_alias_int : INT;\nEND_TYPE\n\nTYPE DUT_LANG_tref_enum_base_alias :\n(\n\ta,\n\tb\n) DUT_LANG_tref_enum_base_alias_int;\nEND_TYPE\n",
  },
  dut("tref_struct_field_array", "a STRUCT field of an ARRAY OF an unknown type",
    " :\nSTRUCT\n\tvalue : INT;\n\tother : ARRAY[0..1] OF NoSuchType;\nEND_STRUCT"),
  dut("tref_struct_field_pointer", "a STRUCT field of a POINTER TO an unknown type",
    " :\nSTRUCT\n\tvalue : INT;\n\tother : POINTER TO NoSuchType;\nEND_STRUCT"),

  // ─── every VAR section of a function block ────────────────────────────────────────────────────────────────────────
  fb("tref_var_input", "a VAR_INPUT of an unknown type", "VAR_INPUT\n\tv : NoSuchType;\nEND_VAR"),
  fb("tref_var_output", "a VAR_OUTPUT of an unknown type", "VAR_OUTPUT\n\tv : NoSuchType;\nEND_VAR"),
  fb("tref_var_in_out", "a VAR_IN_OUT of an unknown type", "VAR_IN_OUT\n\tv : NoSuchType;\nEND_VAR"),
  fb("tref_var_temp", "a VAR_TEMP of an unknown type", "VAR_TEMP\n\tv : NoSuchType;\nEND_VAR"),
  fb("tref_var_stat", "a VAR_STAT of an unknown type", "VAR_STAT\n\tv : NoSuchType;\nEND_VAR"),
  fb("tref_var_external", "a VAR_EXTERNAL of an unknown type (no such global either)", "VAR_EXTERNAL\n\tgTrefMissing : NoSuchType;\nEND_VAR"),
  inVar("tref_var_two_names", "two names declared of one unknown type: `a, b : NoSuchType;`", "a, b : NoSuchType;"),
  fb("tref_var_inst", "a METHOD's VAR_INST of an unknown type", "", "METHOD M\nVAR_INST\n\tv : NoSuchType;\nEND_VAR\n;\nEND_METHOD\n"),
  {
    name: "tref_var_global",
    pouName: "GVL_LANG_tref_var_global",
    kind: "gvl",
    feature: "a VAR_GLOBAL of an unknown type, the list's other global read",
    fromDoc: doc,
    source: "VAR_GLOBAL\n\tgTrefUnknown : NoSuchType;\n\tgTrefKnown : INT := 3;\nEND_VAR\n",
    plcPrgVar: "seen_tref_var_global : INT;",
    plcPrgBody: "seen_tref_var_global := GVL_LANG_tref_var_global.gTrefKnown;",
  },
  {
    name: "tref_var_config",
    pouName: "GVL_LANG_tref_var_config",
    kind: "gvl",
    feature: "a VAR_CONFIG entry of an unknown type, for a PLC_PRG variable AT %I*",
    fromDoc: doc,
    source: "VAR_CONFIG\n\tPLC_PRG.trefCfg AT %IX0.0 : NoSuchType;\nEND_VAR\n",
    plcPrgVar: "trefCfg AT %I* : BOOL;",
  },

  // ─── the type expressions that wrap a type name ───────────────────────────────────────────────────────────────────
  inVar("tref_array_element", "an ARRAY OF an unknown type", "v : ARRAY[0..1] OF NoSuchType;"),
  inVar("tref_array_two_dims", "a two-dimensional ARRAY OF an unknown type", "v : ARRAY[0..1, 0..2] OF NoSuchType;"),
  inVar("tref_array_nested", "an ARRAY OF ARRAY OF an unknown type", "v : ARRAY[0..1] OF ARRAY[0..2] OF NoSuchType;"),
  inVar("tref_pointer_to", "a POINTER TO an unknown type", "v : POINTER TO NoSuchType;"),
  inVar("tref_reference_to", "a REFERENCE TO an unknown type", "v : REFERENCE TO NoSuchType;"),
  inVar("tref_pointer_to_array", "a POINTER TO ARRAY OF an unknown type", "v : POINTER TO ARRAY[0..1] OF NoSuchType;"),
  inVar("tref_subrange_base", "a subrange of an unknown type: `NoSuchType(0..5)`", "v : NoSuchType(0..5);"),
  inVar("tref_implicit_enum_base", "an implicit enumeration's base type unknown: `(a, b) NoSuchType`", "v : (trefA, trefB) NoSuchType;"),
  inVar("tref_string_length_name", "a STRING whose length is a name nothing declares: `STRING(NoSuchLength)`", "v : STRING(NoSuchLength);"),
  // …the other constant a type expression holds: an ARRAY's bound, a subrange's bound
  inVar("tref_array_bound_name", "an ARRAY whose upper bound is a name nothing declares: `ARRAY[0..NoSuchBound] OF INT`",
    "v : ARRAY[0..NoSuchBound] OF INT;"),
  inVar("tref_subrange_bound_name", "a subrange whose upper bound is a name nothing declares: `INT(0..NoSuchBound)`",
    "v : INT(0..NoSuchBound);"),
  fb("tref_subrange_bound_variable", "a subrange whose upper bound is a VARIABLE: `INT(0..hi)`", "VAR\n\thi : INT := 5;\n\tv : INT(0..hi);\nEND_VAR"),

  // ─── a routine's result, a property's type ────────────────────────────────────────────────────────────────────────
  {
    name: "tref_function_return",
    pouName: "F_LANG_tref_function_return",
    kind: "function",
    feature: "a FUNCTION whose result type is unknown",
    fromDoc: doc,
    source: "FUNCTION F_LANG_tref_function_return : NoSuchType\nVAR_INPUT\n\tx : INT;\nEND_VAR\n;\nEND_FUNCTION\n",
    plcPrgVar: "n_tref_function_return : INT;",
    plcPrgBody: "F_LANG_tref_function_return(x := 1);",
  },
  fb("tref_method_return", "a METHOD whose result type is unknown", "", "METHOD M : NoSuchType\n;\nEND_METHOD\n"),
  // (a GET's implementation adds a pair the LSP does not give — `support/divergences.ts`, `tref_property_type`)
  fb("tref_property_type", "a PROPERTY whose type is unknown", "", "PROPERTY P : NoSuchType\nGET\n;\nEND_GET\nEND_PROPERTY\n"),
  // …how many messages per accessor: SET alone, both
  fb("tref_property_type_set", "a PROPERTY whose type is unknown, SET only", "", "PROPERTY P : NoSuchType\nSET\n;\nEND_SET\nEND_PROPERTY\n"),
  fb("tref_property_type_get_set", "a PROPERTY whose type is unknown, GET and SET", "",
    "PROPERTY P : NoSuchType\nGET\n;\nEND_GET\nSET\n;\nEND_SET\nEND_PROPERTY\n"),
  fb("tref_property_get_local", "a PROPERTY's GET declaring a local of an unknown type", "",
    "PROPERTY P : INT\nGET\nVAR\n\tv : NoSuchType;\nEND_VAR\nP := 1;\nEND_GET\nEND_PROPERTY\n"),

  // ─── an interface's members ───────────────────────────────────────────────────────────────────────────────────────
  {
    name: "tref_interface_method_return",
    pouName: "ITF_LANG_tref_interface_method_return",
    kind: "interface",
    feature: "an INTERFACE METHOD whose result type is unknown, the interface held by a variable",
    fromDoc: doc,
    source: "INTERFACE ITF_LANG_tref_interface_method_return\nMETHOD M : NoSuchType\nEND_METHOD\nEND_INTERFACE\n",
    plcPrgVar: "i_tref_interface_method_return : ITF_LANG_tref_interface_method_return;",
  },
  {
    name: "tref_interface_method_input",
    pouName: "ITF_LANG_tref_interface_method_input",
    kind: "interface",
    feature: "an INTERFACE METHOD's VAR_INPUT of an unknown type, the interface held by a variable",
    fromDoc: doc,
    source: "INTERFACE ITF_LANG_tref_interface_method_input\nMETHOD M : BOOL\nVAR_INPUT\n\tx : NoSuchType;\nEND_VAR\nEND_METHOD\nEND_INTERFACE\n",
    plcPrgVar: "i_tref_interface_method_input : ITF_LANG_tref_interface_method_input;",
  },
  {
    name: "tref_interface_property_type",
    pouName: "ITF_LANG_tref_interface_property_type",
    kind: "interface",
    feature: "an INTERFACE PROPERTY whose type is unknown, the interface held by a variable",
    fromDoc: doc,
    source: "INTERFACE ITF_LANG_tref_interface_property_type\nPROPERTY P : NoSuchType\nEND_PROPERTY\nEND_INTERFACE\n",
    plcPrgVar: "i_tref_interface_property_type : ITF_LANG_tref_interface_property_type;",
  },
  {
    name: "tref_interface_property_get",
    pouName: "ITF_LANG_tref_interface_property_get",
    kind: "interface",
    feature: "an INTERFACE PROPERTY with a GET whose type is unknown, the interface held by a variable",
    fromDoc: doc,
    source: "INTERFACE ITF_LANG_tref_interface_property_get\nPROPERTY P : NoSuchType\nGET\nEND_GET\nEND_PROPERTY\nEND_INTERFACE\n",
    plcPrgVar: "i_tref_interface_property_get : ITF_LANG_tref_interface_property_get;",
  },

  // ─── operators that take a type ───────────────────────────────────────────────────────────────────────────────────
  fb("tref_sizeof", "SIZEOF of an unknown type name: `SIZEOF(NoSuchType)`", "VAR\n\tn : DINT;\nEND_VAR", "", "n := SIZEOF(NoSuchType);"),
  fb("tref_new", "__NEW of an unknown type: `__NEW(NoSuchType)`", "VAR\n\tp : POINTER TO INT;\nEND_VAR", "", "p := __NEW(NoSuchType);"),
  fb("tref_to_conversion", "a TO_<type> conversion of an unknown type: `TO_NoSuchType(1)`", "VAR\n\tn : DINT;\nEND_VAR", "", "n := TO_NoSuchType(1);"),
]
