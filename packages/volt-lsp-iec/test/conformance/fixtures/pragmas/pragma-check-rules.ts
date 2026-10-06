/**
 * THE PRAGMA CHECK, RULE BY RULE — openspec `analysis-conformance` task 3.10.1 (pragmas). `analysis/checks/pragmas` holds
 * seven rules; each was measured where it was written, on one placement and one spelling. These are the cells that
 * separate each rule's readings — the placements and spellings no recorded fixture put to either vendor (several of the
 * rules are CODESYS-only by measurement: TwinCAT builds an unknown attribute, a misplaced `pingroup` and the old
 * `abstract` spelling clean, so each cell here asks the TwinCAT side as well):
 *
 *   abstract-keyword-missing  `{attribute 'abstract'}` above a PROPERTY, a FUNCTION, a PROGRAM and an INTERFACE's METHOD
 *                             (measured: METHOD, FB; an ACTION cannot carry it: the push refuses an attribute above
 *                             `ACTION`, which has no declaration the IDE stores)
 *   attribute placement       `{attribute 'pingroup'}` above a METHOD, a FUNCTION, a STRUCT (measured: an FB)
 *   symbol value              a QUOTED value outside the set (`'noe'`), the set's word in upper case (`'READ'`), the bad
 *                             value above a unit (measured: an UNQUOTED value, `cc4_attribute_value_string`)
 *   closed value sets         `monitoring_encoding` with the set's value in lower case (`'utf-8'`), its other legal value
 *                             (measured: `'UTF8'`)
 *   unknown attribute         above a METHOD, a FUNCTION, an INTERFACE, a METHOD's variable, a GVL's variable, as a
 *                             statement in a body, and the `ATTRIBUTE` word in upper case (measured: FB variables, DUTs,
 *                             a GVL as a whole); the word in upper case on two KNOWN attributes (`qualified_only`, `hide`)
 *   message pragmas           `{warning}` / `{error}` in lower case among a VAR section's declarations, above the unit, in
 *                             a GVL and in a STRUCT (measured: in a body; `{WARNING}` in a declaration, which is no message)
 *
 * GLOBAL NAMES ARE THE FIXTURE'S OWN (`FB_LANG_<name>…`, `DUT_LANG_<name>…`, `F_LANG_<name>…`, `GVL_LANG_<name>`): the replay
 * binds every fixture into one project. Every unknown attribute is `volt_bogus`, a name neither vendor's catalog holds.
 */
import type { LanguageTest } from "../../types.js"

const doc = "openspec analysis-conformance 3.10.1 (pragmas); docs/codesys-reference/07-pragmas.md"

/** A function block `FB_LANG_<name>` declaring `vars`, running `body`, then `members`; `before` (whole units) ahead of it. */
function fb(name: string, feature: string, vars: string, body: string, members = "", before = "", header = ""): LanguageTest {
  const pouName = `FB_LANG_${name}`
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    plcPrgVar: `inst_${name} : ${pouName};`,
    plcPrgBody: `inst_${name}();`,
    source: `${before}${header}FUNCTION_BLOCK ${pouName}\nVAR\n${vars}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n${members === "" ? "" : `\n${members}`}`,
  }
}

/** A FUNCTION `F_LANG_<name> : INT` with `pragma` written above it, called from PLC_PRG. */
function fn(name: string, feature: string, pragma: string): LanguageTest {
  const pouName = `F_LANG_${name}`
  return {
    name,
    pouName,
    kind: "function",
    feature,
    fromDoc: doc,
    plcPrgVar: `v_${name} : INT;`,
    plcPrgBody: `v_${name} := ${pouName}(1);`,
    source: `${pragma}\nFUNCTION ${pouName} : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\n${pouName} := a;\nEND_FUNCTION\n`,
  }
}

/** A global variable list `GVL_LANG_<name>` declaring `g_<name>` with `pragma` above it, read from PLC_PRG (a name of its
 *  own: the replay binds a list into every fixture naming one of its globals). */
function gvl(name: string, feature: string, pragma: string): LanguageTest {
  const pouName = `GVL_LANG_${name}`
  return {
    name,
    pouName,
    kind: "gvl",
    feature,
    fromDoc: doc,
    plcPrgVar: `v_${name} : INT;`,
    plcPrgBody: `v_${name} := ${pouName}.g_${name};`,
    source: `VAR_GLOBAL\n${pragma}\n\tg_${name} : INT;\nEND_VAR\n`,
  }
}

const OUT = "\tout : INT;"

const ABSTRACT: LanguageTest[] = [
  fb("prag_rule_abstract_attribute_on_property", "{attribute 'abstract'} above a PROPERTY of an FB, no ABSTRACT keyword", OUT, "out := P;",
    "{attribute 'abstract'}\nPROPERTY P : INT\nGET\nP := 1;\nEND_GET\nEND_PROPERTY\n"),
  fn("prag_rule_abstract_attribute_on_function", "{attribute 'abstract'} above a FUNCTION", "{attribute 'abstract'}"),
  // the 3.10 gate review: the kinds the rule had not been asked
  {
    name: "prag_rule_abstract_attribute_on_program",
    pouName: "PRG_LANG_prag_rule_abstract_attribute_on_program",
    kind: "program",
    feature: "{attribute 'abstract'} above a PROGRAM",
    fromDoc: doc,
    plcPrgBody: "PRG_LANG_prag_rule_abstract_attribute_on_program();",
    source: "{attribute 'abstract'}\nPROGRAM PRG_LANG_prag_rule_abstract_attribute_on_program\nVAR\n\tout : INT;\nEND_VAR\nout := 1;\nEND_PROGRAM\n",
  },
  {
    ...fb("prag_rule_abstract_attribute_on_interface_method", "{attribute 'abstract'} above a METHOD of an INTERFACE the FB implements", OUT, "out := M();"),
    source:
      "INTERFACE ITF_LANG_prag_rule_abstract_attribute_on_interface_method\n{attribute 'abstract'}\nMETHOD M : INT\nEND_METHOD\nEND_INTERFACE\n\n" +
      `FUNCTION_BLOCK FB_LANG_prag_rule_abstract_attribute_on_interface_method IMPLEMENTS ITF_LANG_prag_rule_abstract_attribute_on_interface_method\nVAR\n${OUT}\nEND_VAR\nout := M();\nEND_FUNCTION_BLOCK\n\nMETHOD M : INT\nM := 1;\nEND_METHOD\n`,
  },
]

const PLACEMENT: LanguageTest[] = [
  fb("prag_rule_pingroup_on_method", "{attribute 'pingroup'} above a METHOD", OUT, "out := M();",
    "{attribute 'pingroup' := 'volt group'}\nMETHOD M : INT\nM := 1;\nEND_METHOD\n"),
  fn("prag_rule_pingroup_on_function", "{attribute 'pingroup'} above a FUNCTION", "{attribute 'pingroup' := 'volt group'}"),
  fb("prag_rule_pingroup_on_struct", "{attribute 'pingroup'} above a STRUCT DUT the FB uses",
    `\td : DUT_LANG_prag_rule_pingroup_on_struct;\n${OUT}`, "out := d.v;", "",
    "{attribute 'pingroup' := 'volt group'}\nTYPE DUT_LANG_prag_rule_pingroup_on_struct :\nSTRUCT\n\tv : INT;\nEND_STRUCT\nEND_TYPE\n\n"),
]

const SYMBOL: LanguageTest[] = [
  fb("prag_rule_symbol_value_typo", "{attribute 'symbol' := 'noe'} (a quoted value outside the set) on a variable",
    `\t{attribute 'symbol' := 'noe'}\n\tv : INT;\n${OUT}`, "out := v;"),
  fb("prag_rule_symbol_value_upper_case", "{attribute 'symbol' := 'READ'} (the set's word in upper case) on a variable",
    `\t{attribute 'symbol' := 'READ'}\n\tv : INT;\n${OUT}`, "out := v;"),
  fb("prag_rule_symbol_value_typo_on_fb", "{attribute 'symbol' := 'noe'} above the FUNCTION_BLOCK", OUT, "out := 1;", "", "",
    "{attribute 'symbol' := 'noe'}\n"),
]

const CLOSED_SETS: LanguageTest[] = [
  fb("prag_rule_monitoring_encoding_lower_case", "{attribute 'monitoring_encoding' := 'utf-8'} (the set's value in lower case) on a STRING",
    `\t{attribute 'monitoring_encoding' := 'utf-8'}\n\ts_ : STRING;\n${OUT}`, "s_ := 'a';\nout := 1;"),
  fb("prag_rule_monitoring_encoding_unicode", "{attribute 'monitoring_encoding' := 'UnicodeCharacter'} (the set's other value) on a WSTRING",
    `\t{attribute 'monitoring_encoding' := 'UnicodeCharacter'}\n\tw_ : WSTRING;\n${OUT}`, "w_ := \"a\";\nout := 1;"),
]

const UNKNOWN: LanguageTest[] = [
  fb("prag_rule_unknown_attribute_on_method", "an unknown attribute above a METHOD", OUT, "out := M();",
    "{attribute 'volt_bogus'}\nMETHOD M : INT\nM := 1;\nEND_METHOD\n"),
  fn("prag_rule_unknown_attribute_on_function", "an unknown attribute above a FUNCTION", "{attribute 'volt_bogus'}"),
  {
    ...fb("prag_rule_unknown_attribute_on_interface", "an unknown attribute above an INTERFACE the FB implements", OUT, "out := M();"),
    source:
      "{attribute 'volt_bogus'}\nINTERFACE ITF_LANG_prag_rule_unknown_attribute_on_interface\nMETHOD M : INT\nEND_METHOD\nEND_INTERFACE\n\n" +
      `FUNCTION_BLOCK FB_LANG_prag_rule_unknown_attribute_on_interface IMPLEMENTS ITF_LANG_prag_rule_unknown_attribute_on_interface\nVAR\n${OUT}\nEND_VAR\nout := M();\nEND_FUNCTION_BLOCK\n\nMETHOD M : INT\nM := 1;\nEND_METHOD\n`,
  },
  fb("prag_rule_unknown_attribute_on_method_variable", "an unknown attribute above a METHOD's local variable", OUT, "out := M();",
    "METHOD M : INT\nVAR\n\t{attribute 'volt_bogus'}\n\tk : INT := 1;\nEND_VAR\nM := k;\nEND_METHOD\n"),
  gvl("prag_rule_unknown_attribute_on_gvl_variable", "an unknown attribute above one variable of a GVL", "\t{attribute 'volt_bogus'}"),
  fb("prag_rule_unknown_attribute_in_body", "an unknown attribute written as a statement in a body", OUT, "{attribute 'volt_bogus'}\nout := 1;"),
  // the 3.10 gate review: a KNOWN attribute with the word in upper case — does it still take effect (qualified_only
  // refuses the bare global; hide silences monitoring_encoding's value check)
  {
    ...fb("prag_rule_qualified_only_upper_case", "`{ATTRIBUTE 'qualified_only'}` above a GVL, its global read bare", OUT, "out := g_prag_rule_qualified_only_upper_case;", "",
      "{ATTRIBUTE 'qualified_only'}\nVAR_GLOBAL\n\tg_prag_rule_qualified_only_upper_case : INT;\nEND_VAR\n\n"),
    gvlNames: ["GVL_LANG_prag_rule_qualified_only_upper_case"],
  },
  fb("prag_rule_hide_upper_case", "`{ATTRIBUTE 'hide'}` beside `{attribute 'monitoring_encoding' := 'UTF8'}` (a value outside the set, warned on its own) on a STRING",
    `\t{ATTRIBUTE 'hide'}\n\t{attribute 'monitoring_encoding' := 'UTF8'}\n\ts_ : STRING;\n${OUT}`, "s_ := 'a';\nout := 1;"),
  fb("prag_rule_unknown_attribute_upper_case", "`{ATTRIBUTE 'volt_bogus'}` (the word in upper case) above a variable",
    `\t{ATTRIBUTE 'volt_bogus'}\n\tv : INT;\n${OUT}`, "out := v;"),
]

const MESSAGES: LanguageTest[] = [
  fb("prag_rule_warning_in_var_section", "`{warning 'x'}` between a VAR section's declarations",
    `\tv : INT;\n{warning 'volt warning in a VAR section'}\n${OUT}`, "out := v;"),
  fb("prag_rule_error_in_var_section", "`{error 'x'}` between a VAR section's declarations: does the build fail",
    `\tv : INT;\n{error 'volt error in a VAR section'}\n${OUT}`, "out := v;"),
  fb("prag_rule_warning_above_unit", "`{warning 'x'}` above the FUNCTION_BLOCK keyword", OUT, "out := 1;", "", "",
    "{warning 'volt warning above the unit'}\n"),
  gvl("prag_rule_warning_in_gvl", "`{warning 'x'}` in a GVL's VAR_GLOBAL section", "{warning 'volt warning in a GVL'}"),
  fb("prag_rule_warning_in_struct", "`{warning 'x'}` among a STRUCT's components",
    `\td : DUT_LANG_prag_rule_warning_in_struct;\n${OUT}`, "out := d.v;", "",
    "TYPE DUT_LANG_prag_rule_warning_in_struct :\nSTRUCT\n{warning 'volt warning in a STRUCT'}\n\tv : INT;\nEND_STRUCT\nEND_TYPE\n\n"),
]

export const PRAGMA_CHECK_RULE_TESTS: readonly LanguageTest[] = [...ABSTRACT, ...PLACEMENT, ...SYMBOL, ...CLOSED_SETS, ...UNKNOWN, ...MESSAGES]
