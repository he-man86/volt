/**
 * NAME RULES — openspec `analysis-conformance` task 3.5.1 (names), rule by rule, the cells no fixture asked:
 *
 *   ambiguous-global       a global TWO lists declare, written bare: read, written, in a declaration's initializer, in a
 *                          METHOD, in a condition, called as an FB instance, of two different types — and the legal
 *                          sides: qualified by its list, shadowed by a local (one fixture asked it so far,
 *                          `expr_global_namespace_ambiguous_bare`)
 *   duplicate-declaration  two METHODs of one name, a METHOD named as a variable and as an ACTION (`duplicateMethod`
 *                          never fired), a name twice in one GVL, in one STRUCT, in one declaration's name list
 *   type-as-value          an ALIAS type's name as a value and as a target, a type name as an operand and as a
 *                          condition, an FB type's name as a value
 *   reserved-keyword       CHAR / USING as a STRUCT field and a METHOD's input (measured in an FB's VAR only). Not as a
 *                          GLOBAL: the replay binds every fixture into one project and the recorder pushes every fixture
 *                          whose names another fixture's text mentions, so a global named CHAR / WCHAR / USING would
 *                          become a dependency of every fixture using the word as a local (`cc5_reserved_keyword_names`)
 *
 * GLOBAL NAMES ARE THE FIXTURE'S OWN (`FB_LANG_<name>`, `DUT_LANG_<name>`, `GVL_LANG_<name>_<a|b>`): the replay binds
 * every fixture into one project.
 */
import type { LanguageTest } from "../../types.js"

const doc = "openspec analysis-conformance 3.5.1 (names); docs/codesys-reference/09-shadowing.md"

/** A function block `FB_LANG_<name>` declaring `vars`, running `body`, with `members` after it and `before` ahead of it. */
function fb(name: string, feature: string, vars: string, body: string, members = "", before = ""): LanguageTest {
  const pouName = `FB_LANG_${name}`
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    plcPrgVar: `inst_${name} : ${pouName};`,
    plcPrgBody: `inst_${name}();`,
    source: `${before}FUNCTION_BLOCK ${pouName}\nVAR\n${vars}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n${members === "" ? "" : `\n${members}`}`,
  }
}

/**
 * `t` with two global lists ahead of it, each declaring `decls` (`GVL_LANG_<name>_a`, `_b`). Two VAR_GLOBAL blocks back to
 * back are ONE list object with two sections, so a STRUCT stands between them (`names/scopes.ts` `withLists`).
 */
function twoLists(t: LanguageTest, a: string, b: string): LanguageTest {
  const sep = `TYPE DUT_LANG_${t.name}_sep :\nSTRUCT\n\tv : INT;\nEND_STRUCT\nEND_TYPE\n\n`
  return {
    ...t,
    source: `VAR_GLOBAL\n${a}\nEND_VAR\n\n${sep}VAR_GLOBAL\n${b}\nEND_VAR\n\n${t.source}`,
    gvlNames: [`GVL_LANG_${t.name}_a`, `GVL_LANG_${t.name}_b`],
  }
}

const AMBIGUOUS_GLOBAL: LanguageTest[] = [
  twoLists(fb("ambg_read_bare", "a global two lists declare, read bare", "\tout : INT;", "out := g_ambr;"), "\tg_ambr : INT := 3;", "\tg_ambr : INT := 5;"),
  twoLists(fb("ambg_write_bare", "a global two lists declare, written bare", "\tout : INT;", "g_ambw := 4;\nout := 1;"), "\tg_ambw : INT;", "\tg_ambw : INT;"),
  twoLists(fb("ambg_initializer", "a global two lists declare, read bare in a declaration's initializer", "\tx : INT := g_ambi;\n\tout : INT;", "out := x;"),
    "\tg_ambi : INT := 3;", "\tg_ambi : INT := 5;"),
  twoLists(fb("ambg_in_method", "a global two lists declare, read bare in a METHOD", "\tout : INT;", "out := M();", "METHOD M : INT\nM := g_ambm;\nEND_METHOD\n"),
    "\tg_ambm : INT := 3;", "\tg_ambm : INT := 5;"),
  twoLists(fb("ambg_in_condition", "a global two lists declare, read bare in an IF condition", "\tout : INT;", "IF g_ambc > 0 THEN\n\tout := 1;\nEND_IF"),
    "\tg_ambc : INT := 3;", "\tg_ambc : INT := 5;"),
  twoLists(fb("ambg_fb_instance_call", "an FB instance two lists declare, called bare", "\tout : INT;", "g_ambf();\nout := 1;", "",
    "FUNCTION_BLOCK FB_LANG_ambg_fb_instance_call_t\nVAR\n\tn : INT;\nEND_VAR\nn := n + 1;\nEND_FUNCTION_BLOCK\n\n"),
    "\tg_ambf : FB_LANG_ambg_fb_instance_call_t;", "\tg_ambf : FB_LANG_ambg_fb_instance_call_t;"),
  twoLists(fb("ambg_different_types", "a name two lists declare with different types (INT, BOOL), read bare", "\tout : INT;", "out := g_ambt;"),
    "\tg_ambt : INT := 3;", "\tg_ambt : BOOL;"),
  twoLists(fb("ambg_qualified_read", "a global two lists declare, read qualified by its list (legal)", "\tout : INT;", "out := GVL_LANG_ambg_qualified_read_b.g_ambq;"),
    "\tg_ambq : INT := 3;", "\tg_ambq : INT := 5;"),
  twoLists(fb("ambg_local_shadow", "a global two lists declare, shadowed by the FB's own variable of that name (legal)", "\tg_ambs : INT := 7;\n\tout : INT;", "out := g_ambs;"),
    "\tg_ambs : INT := 3;", "\tg_ambs : INT := 5;"),
]

/** Volt's push refuses a POU holding two children of one name — the IDE keys children by name, so the second would overwrite the first. */
const DUPLICATE_CHILD =
  "the push refuses it before either IDE sees it (DUPLICATE_CHILD: the IDE keys a POU's children by name — record:language 2026-10-06)"
const pushRefuses = (t: LanguageTest): LanguageTest => ({
  ...t,
  vendorRefuses: { codesys: DUPLICATE_CHILD, twincat: DUPLICATE_CHILD },
  execSkip: "NOTHING TO MEASURE — the push refuses the POU (DUPLICATE_CHILD), so no IDE holds the text, and record:exec would load the parser's own split",
})

const DUPLICATES: LanguageTest[] = [
  pushRefuses(fb("dupn_two_methods", "two METHODs of one name in an FB", "\tout : INT;", "out := M();", "METHOD M : INT\nM := 1;\nEND_METHOD\n\nMETHOD M : INT\nM := 2;\nEND_METHOD\n")),
  fb("dupn_method_named_as_variable", "a METHOD named as the FB's variable", "\tM : INT;\n\tout : INT;", "out := M;", "METHOD M : INT\nM := 1;\nEND_METHOD\n"),
  pushRefuses(fb("dupn_method_named_as_action", "a METHOD and an ACTION of one name", "\tout : INT;", "out := 1;", "METHOD Act : INT\nAct := 1;\nEND_METHOD\n\nACTION Act\nout := 2;\nEND_ACTION\n")),
  {
    ...fb("dupn_gvl_variable_twice", "a name declared twice in one global list", "\tout : INT;", "out := g_dupn;", "", "VAR_GLOBAL\n\tg_dupn : INT;\n\tg_dupn : BOOL;\nEND_VAR\n\n"),
    gvlNames: ["GVL_LANG_dupn_gvl_variable_twice"],
  },
  fb("dupn_struct_field_twice", "a field declared twice in one STRUCT", "\trec : DUT_LANG_dupn_struct_field_twice;\n\tout : INT;", "out := rec.a;", "",
    "TYPE DUT_LANG_dupn_struct_field_twice :\nSTRUCT\n\ta : INT;\n\ta : BOOL;\nEND_STRUCT\nEND_TYPE\n\n"),
  fb("dupn_name_list_twice", "a name twice in one declaration's name list (`a, a : INT`)", "\ta, a : INT;\n\tout : INT;", "out := a;"),
]

const TYPE_AS_VALUE: LanguageTest[] = [
  fb("tav_alias_as_value", "an ALIAS type's name stored as a value", "\tout : INT;", "out := DUT_LANG_tav_alias_as_value;", "",
    "TYPE DUT_LANG_tav_alias_as_value : INT;\nEND_TYPE\n\n"),
  fb("tav_alias_as_target", "an ALIAS type's name as an assignment target", "\tout : INT;", "DUT_LANG_tav_alias_as_target := 3;\nout := 1;", "",
    "TYPE DUT_LANG_tav_alias_as_target : INT;\nEND_TYPE\n\n"),
  fb("tav_type_as_operand", "an ALIAS type's name as an operand (`T + 1`)", "\tout : INT;", "out := DUT_LANG_tav_type_as_operand + 1;", "",
    "TYPE DUT_LANG_tav_type_as_operand : INT;\nEND_TYPE\n\n"),
  fb("tav_type_as_condition", "an ENUM type's name as an IF condition", "\tout : INT;", "IF DUT_LANG_tav_type_as_condition THEN\n\tout := 1;\nEND_IF", "",
    "TYPE DUT_LANG_tav_type_as_condition :\n(\n\ttavc_a,\n\ttavc_b\n);\nEND_TYPE\n\n"),
  fb("tav_fb_type_as_value", "an FB type's name stored as a value", "\tout : INT;", "out := FB_LANG_tav_fb_type_as_value_t;", "",
    "FUNCTION_BLOCK FB_LANG_tav_fb_type_as_value_t\nVAR\n\tn : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n"),
]

const RESERVED_KEYWORDS: LanguageTest[] = [
  fb("rkw_struct_field_char", "CHAR as a STRUCT field's name", "\trec : DUT_LANG_rkw_struct_field_char;\n\tout : INT;", "out := rec.CHAR;", "",
    "TYPE DUT_LANG_rkw_struct_field_char :\nSTRUCT\n\tCHAR : INT;\nEND_STRUCT\nEND_TYPE\n\n"),
  fb("rkw_method_input_using", "USING as a METHOD's input", "\tout : INT;", "out := M(USING := 2);", "METHOD M : INT\nVAR_INPUT\n\tUSING : INT;\nEND_VAR\nM := USING;\nEND_METHOD\n"),
]

export const NAME_RULE_CHECK_TESTS: readonly LanguageTest[] = [...AMBIGUOUS_GLOBAL, ...DUPLICATES, ...TYPE_AS_VALUE, ...RESERVED_KEYWORDS]
