/**
 * SCOPES AND LOOKUP, RULE BY RULE — design.md §4 3.1 of openspec `frontend-conformance` (Y1–Y24, and E33's search-order
 * cell; tasks 3.1.1–3.1.5), each rule put to the vendor by fixtures of its own: `record:language` for accept/refuse and
 * the vendor's words, `record:exec` for WHICH declaration a name meant (every FB fixture below that builds copies what
 * its name reads into `out`, so the run recording holds `inst_<name>.out`, and the values are chosen so each candidate
 * declaration gives a different `out`). Rows already decided by a recorded fixture elsewhere keep those fixtures; what is
 * here is the cells that separate a rule's readings: each step of the bare-name search order (`09-shadowing.md`) against
 * the next, each kind of declaration against each other, and the GVL rules per list and per section.
 *
 * GLOBAL NAMES ARE THE FIXTURE'S OWN (`g_<tag>`): the replay binds every fixture into one project, so a global another
 * fixture also declares would be "ambiguous" there and in no recording (`check-coverage-six.ts` says how that went once).
 *
 * ONE QUESTION PER FIXTURE, as in `grammar/declarations.ts` — and so no UNTYPED literal is an operand (`x + INT#100`, not
 * `x + 100`): an untyped literal's type is area 4's question (the first recording of four of these asked it as well, and
 * they were re-recorded typed).
 */
import type { LanguageTest } from "../../types.js"

const doc = "frontend-conformance design.md §4 3.1 (scopes and lookup); docs/codesys-reference/09-shadowing.md"

/** A function block `FB_LANG_<name>` with VAR `vars` and body `body`; `before` (whole units) is written ahead of it and
 *  `after` (its METHOD/PROPERTY/ACTION units) after it. Instanced in PLC_PRG as `inst_<name>` and called. */
function fb(name: string, feature: string, vars: string, body: string, before = "", after = ""): LanguageTest {
  const pouName = `FB_LANG_${name}`
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    plcPrgVar: `inst_${name} : ${pouName};`,
    plcPrgBody: `inst_${name}();`,
    source: `${before}FUNCTION_BLOCK ${pouName}\nVAR\n${vars}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n${after ? `\n${after}` : ""}`,
  }
}

/** `fb` whose whole text is `source` (its own sections and units), not `fb`'s VAR/body shape. */
function fbText(name: string, feature: string, source: string): LanguageTest {
  return { ...fb(name, feature, "", ""), source }
}

/** `fb` with global variable lists ahead of it: each entry of `lists` is one list's text (its pragmas and sections),
 *  pushed as its own object `GVL_LANG_<name>` (one list) or `GVL_LANG_<name>_<a|b|…>` (several). */
function withLists(t: LanguageTest, lists: readonly string[]): LanguageTest {
  const names = lists.length === 1 ? [`GVL_LANG_${t.name}`] : lists.map((_, i) => `GVL_LANG_${t.name}_${"abcd"[i]}`)
  // TWO LISTS ARE KEPT APART BY A UNIT: written back to back, two VAR_GLOBAL blocks are ONE list object with two sections
  // (the parser's reading, and the push's — the first recording of these fixtures measured exactly that), so a STRUCT
  // stands between them, as `grammar/expressions.ts` `twoLists` does
  const sep = (i: number): string => `TYPE DUT_LANG_${t.name}_sep${i} :\nSTRUCT\n\tv : INT;\nEND_STRUCT\nEND_TYPE\n\n`
  return { ...t, source: lists.map((l, i) => `${i > 0 ? sep(i) : ""}${l}\n`).join("") + t.source, gvlNames: names }
}

/** One plain list: `VAR_GLOBAL <decls> END_VAR`. */
const list = (decls: string): string => `VAR_GLOBAL\n${decls}\nEND_VAR\n`

/** `t`, whose push both vendors refuse with `reason` (Volt's own push, before either IDE sees the text). */
function pushRefuses(t: LanguageTest, reason: string): LanguageTest {
  // nothing instances the FB: no IDE holds it, and PLC_PRG would name a type the namespace hides
  const { plcPrgVar: _var, plcPrgBody: _body, ...rest } = t
  return {
    ...rest,
    asSent: "a project holds no namespace object; the namespace is the object's text, pushed as a workspace file holds it",
    vendorRefuses: { codesys: reason, twincat: reason },
    execSkip:
      "NOTHING TO MEASURE: the push refuses a NAMESPACE block on both vendors (a project holds no namespace object — rule U28), so no IDE holds the text and no program runs it",
  }
}

/** `t`, whose refusal the LSP does not make — the reason, dated (`deferred.lsp`). */
function deferLsp(t: LanguageTest, reason: string): LanguageTest {
  return { ...t, deferred: { lsp: reason } }
}

export const SCOPE_RULE_TESTS: readonly LanguageTest[] = [
  // ─── Y1 identifiers are case-insensitive: a local, a type name and a method, each written in another case ────────
  fb("sym_case_local_ref", "Y1 — a local declared `Counter` read as `COUNTER` and `counter`", "\tCounter : INT := 4;\n\tout : INT;",
    "out := COUNTER + counter;"),
  fb("sym_case_type_name", "Y1 — a STRUCT type named in another case than its declaration",
    "\tbx : dut_lang_SYM_CASE_TYPE_NAME;\n\tout : INT;", "out := bx.V;",
    "TYPE DUT_LANG_sym_case_type_name :\nSTRUCT\n\tv : INT := 6;\nEND_STRUCT\nEND_TYPE\n\n"),
  fb("sym_case_method_call", "Y1 — a METHOD `Get` called as `GET()`", "\tout : INT;", "out := GET();", "",
    "METHOD Get : INT\nGet := 7;\nEND_METHOD\n"),

  // ─── Y2 the innermost declaration shadows: each POU-level kind over a global of the same name ───────────────────
  withLists(fb("sym_fb_var_shadows_global", "Y2 — an FB's VAR over a global of the same name: the FB's (5) or the global (3)?",
    "\tg_fvsg : INT := 5;\n\tout : INT;", "out := g_fvsg;"), [list("\tg_fvsg : INT := 3;")]),
  withLists(fb("sym_method_local_shadows_global", "Y2 — a METHOD's VAR over a global of the same name: the local (8) or the global (3)?",
    "\tout : INT;", "out := M();", "",
    "METHOD M : INT\nVAR\n\tg_mlsg : INT := 8;\nEND_VAR\nM := g_mlsg;\nEND_METHOD\n"), [list("\tg_mlsg : INT := 3;")]),
  withLists(fb("sym_method_param_shadows_global", "Y2 — a METHOD's VAR_INPUT over a global of the same name: the argument (9) or the global (3)?",
    "\tout : INT;", "out := M(g_mpsg := 9);", "",
    "METHOD M : INT\nVAR_INPUT\n\tg_mpsg : INT;\nEND_VAR\nM := g_mpsg;\nEND_METHOD\n"), [list("\tg_mpsg : INT := 3;")]),

  // ─── Y3 VAR_IN_OUT vs FB field vs VAR_STAT (transpile-review 19) ─────────────────────────────────────────────────
  // field x = 5; Io's in-out x (v = 1) + 100 = 101; Stat's VAR_STAT x = 50 + 1 = 51; the FB's x after both = 5 → 157
  fb("sym_inout_vs_field_vs_stat", "Y3 — one name three ways: an FB field, a METHOD's VAR_IN_OUT, another METHOD's VAR_STAT — each body reads its own",
    "\tx : INT := 5;\n\tv : INT := 1;\n\tout : INT;", "out := Io(x := v) + Stat() + x;", "",
    "METHOD Io : INT\nVAR_IN_OUT\n\tx : INT;\nEND_VAR\nx := x + INT#100;\nIo := x;\nEND_METHOD\n\n" +
      "METHOD Stat : INT\nVAR_STAT\n\tx : INT := 50;\nEND_VAR\nx := x + INT#1;\nStat := x;\nEND_METHOD\n"),
  fb("sym_inout_and_stat_same_method", "Y3 — a METHOD declaring one name as VAR_IN_OUT and as VAR_STAT", "\tv : INT := 1;\n\tout : INT;",
    "out := M(x := v);", "", "METHOD M : INT\nVAR_IN_OUT\n\tx : INT;\nEND_VAR\nVAR_STAT\n\tx : INT;\nEND_VAR\nM := x;\nEND_METHOD\n"),

  // ─── Y4 a standalone METHOD parents to the PRECEDING POU, not the first one ──────────────────────────────────────
  fb("sym_method_after_two_fbs", "Y4 — FB A, then this FB, then METHOD M reading `a`: M is this FB's (2), not A's (1)",
    "\ta : INT := 2;\n\tout : INT;", "out := M();",
    "FUNCTION_BLOCK FB_LANG_sym_method_after_two_fbs_a\nVAR\n\ta : INT := 1;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n",
    "METHOD M : INT\nM := a;\nEND_METHOD\n"),

  // ─── Y5 a method's VAR_OUTPUT is a parameter ────────────────────────────────────────────────────────────────────
  fb("sym_method_output_param_bound", "Y5 — a METHOD's VAR_OUTPUT bound at the call as `o => out`", "\tout : INT;", "M(o => out);", "",
    "METHOD M\nVAR_OUTPUT\n\to : INT;\nEND_VAR\no := 12;\nEND_METHOD\n"),

  // ─── Y7 getter and setter locals of one name do not collide; neither sees the other's ──────────────────────────
  // P := 3 → the setter's tmp = 3, field = 6; out := P → the getter's tmp = 6 → 6
  fb("sym_getter_setter_same_local", "Y7 — a PROPERTY whose GET and SET each declare a local `tmp`",
    "\tfield : INT;\n\tout : INT;", "P := 3;\nout := P;", "",
    "PROPERTY P : INT\nGET\nVAR\n\ttmp : INT;\nEND_VAR\ntmp := field;\nP := tmp;\nEND_GET\nSET\nVAR\n\ttmp : INT;\nEND_VAR\ntmp := P;\nfield := tmp * INT#2;\nEND_SET\nEND_PROPERTY\n"),
  fb("sym_setter_reads_getter_local", "Y7 — a PROPERTY's SET reading a local only its GET declares",
    "\tfield : INT;\n\tout : INT;", "P := 3;\nout := P;", "",
    "PROPERTY P : INT\nGET\nVAR\n\tonlyGet : INT;\nEND_VAR\nonlyGet := field;\nP := onlyGet;\nEND_GET\nSET\nfield := P + onlyGet;\nEND_SET\nEND_PROPERTY\n"),

  // ─── Y8 a program's members from outside: read, and written ─────────────────────────────────────────────────────
  fb("sym_program_var_write_from_outside", "Y8 — an FB writing a PROGRAM's VAR as `PRG.v := 4`, then reading it back",
    "\tout : INT;", "PRG_LANG_sym_program_var_write_from_outside.v := 4;\nout := PRG_LANG_sym_program_var_write_from_outside.v;",
    "PROGRAM PRG_LANG_sym_program_var_write_from_outside\nVAR\n\tv : INT := 1;\nEND_VAR\n;\nEND_PROGRAM\n\n"),
  //   …which CODESYS refuses ("'v' is no input of …", 2026-10-02) — so the same write to a VAR_INPUT
  fb("sym_program_input_write_from_outside", "Y8 — an FB writing a PROGRAM's VAR_INPUT as `PRG.v := 4`, then reading it back",
    "\tout : INT;", "PRG_LANG_sym_program_input_write_from_outside.v := 4;\nout := PRG_LANG_sym_program_input_write_from_outside.v;",
    "PROGRAM PRG_LANG_sym_program_input_write_from_outside\nVAR_INPUT\n\tv : INT := 1;\nEND_VAR\n;\nEND_PROGRAM\n\n"),

  // ─── Y20 a function's name is its result variable, read back in its own body; a method's the same ──────────────
  fb("sym_function_result_read_in_body", "Y20 — a FUNCTION reading its own name as the result so far (3 + 4), not calling itself",
    "\tout : INT;", "out := FUN_LANG_sym_function_result_read_in_body();",
    "FUNCTION FUN_LANG_sym_function_result_read_in_body : INT\nFUN_LANG_sym_function_result_read_in_body := 3;\nFUN_LANG_sym_function_result_read_in_body := FUN_LANG_sym_function_result_read_in_body + INT#4;\nEND_FUNCTION\n\n"),
  fb("sym_method_result_read_in_body", "Y20 — a METHOD reading its own name as the result so far (3 * 2)", "\tout : INT;", "out := M();", "",
    "METHOD M : INT\nM := 3;\nM := M * INT#2;\nEND_METHOD\n"),
  fb("sym_function_local_named_as_function", "Y20 — a FUNCTION declaring a local of its own name", "\tout : INT;",
    "out := FUN_LANG_sym_function_local_named_as_function();",
    "FUNCTION FUN_LANG_sym_function_local_named_as_function : INT\nVAR\n\tFUN_LANG_sym_function_local_named_as_function : INT;\nEND_VAR\nFUN_LANG_sym_function_local_named_as_function := 3;\nEND_FUNCTION\n\n"),

  // Y20 asked of its other three shapes (frontend-conformance 3.1 review): a FUNCTION's VAR_INPUT of its own name, and a
  // METHOD's local and VAR_INPUT of the method's name — the method's name is its result variable as a function's is
  fb("sym_function_input_named_as_function", "Y20 — a FUNCTION declaring a VAR_INPUT of its own name", "\tout : INT;",
    "out := FUN_LANG_sym_function_input_named_as_function(1);",
    "FUNCTION FUN_LANG_sym_function_input_named_as_function : INT\nVAR_INPUT\n\tFUN_LANG_sym_function_input_named_as_function : INT;\nEND_VAR\nFUN_LANG_sym_function_input_named_as_function := 3;\nEND_FUNCTION\n\n"),
  fb("sym_method_local_named_as_method", "Y20 — a METHOD declaring a local of its own name", "\tout : INT;", "out := M_Same();", "",
    "METHOD M_Same : INT\nVAR\n\tM_Same : INT;\nEND_VAR\nM_Same := 3;\nEND_METHOD\n"),
  fb("sym_method_input_named_as_method", "Y20 — a METHOD declaring a VAR_INPUT of its own name", "\tout : INT;", "out := M_Same(1);", "",
    "METHOD M_Same : INT\nVAR_INPUT\n\tM_Same : INT;\nEND_VAR\nM_Same := 3;\nEND_METHOD\n"),

  // ─── Y16 a duplicate across the sections of one scope ───────────────────────────────────────────────────────────
  fbText("sym_duplicate_input_and_var", "Y16 — one name declared in an FB's VAR_INPUT and its VAR",
    "FUNCTION_BLOCK FB_LANG_sym_duplicate_input_and_var\nVAR_INPUT\n\tdup : INT;\nEND_VAR\nVAR\n\tdup : INT;\n\tout : INT;\nEND_VAR\nout := dup;\nEND_FUNCTION_BLOCK\n"),
  fb("sym_duplicate_method_param_and_local", "Y16 — one name declared as a METHOD's VAR_INPUT and its VAR", "\tout : INT;", "out := M(p := 1);", "",
    "METHOD M : INT\nVAR_INPUT\n\tp : INT;\nEND_VAR\nVAR\n\tp : INT;\nEND_VAR\nM := p;\nEND_METHOD\n"),

  // ─── Y17/Y18 a source NAMESPACE block (task 3.1.2) ──────────────────────────────────────────────────────────────
  // No vendor holds one: a project has no namespace object and Volt's push refuses END_NAMESPACE in a POU's text on both
  // (rule U28, `unit_namespace_*`). The LSP's answer on a workspace text that holds one is unit-tested
  // (`symbols/binder.test.ts`, `symbols/scoped-bodies.test.ts`); these two state the question and the push's refusal.
  pushRefuses({
    ...fb("sym_namespace_block_unit_checked", "Y17 — an FB inside `NAMESPACE N … END_NAMESPACE` whose body reads its own field: scoped and analysed as one outside",
      "\tf : INT := 4;\n\tout : INT;", "out := f;"),
    source: "NAMESPACE NS_LANG_sym_namespace_block_unit_checked\nFUNCTION_BLOCK FB_LANG_sym_namespace_block_unit_checked\nVAR\n\tf : INT := 4;\n\tout : INT;\nEND_VAR\nIMPLEMENTATION ST\nout := f;\nEND_FUNCTION_BLOCK\nEND_NAMESPACE\n",
  }, "'FB_LANG_sym_namespace_block_unit_checked', line 10: expected METHOD/ACTION/PROPERTY, got: END_NAMESPACE"),
  pushRefuses({
    ...fb("sym_namespace_method_parents_to_fb", "Y18 — an FB and its METHOD inside one NAMESPACE: the METHOD reads the FB's field",
      "\tout : INT;", "out := M();"),
    source: "NAMESPACE NS_LANG_sym_namespace_method_parents_to_fb\nFUNCTION_BLOCK FB_LANG_sym_namespace_method_parents_to_fb\nVAR\n\tf : INT := 4;\n\tout : INT;\nEND_VAR\nIMPLEMENTATION ST\nout := M();\nEND_FUNCTION_BLOCK\n\nMETHOD M : INT\nIMPLEMENTATION ST\nM := f;\nEND_METHOD\nEND_NAMESPACE\n",
  }, "'FB_LANG_sym_namespace_method_parents_to_fb', line 15: expected METHOD/ACTION/PROPERTY, got: END_NAMESPACE"),

  // ─── Y9–Y14 global variable lists (task 3.1.3) ──────────────────────────────────────────────────────────────────
  // Y12 qualified_only is the list's, per object: of two lists, only the attributed one needs its name
  withLists(fb("sym_qualified_only_one_of_two_gvls_in_file", "Y12 — two lists, the first `qualified_only`: `GVL_a.g` qualified, the second's bare",
    "\tout : INT;", "out := GVL_LANG_sym_qualified_only_one_of_two_gvls_in_file_a.g_qoa + g_qob;"),
    ["{attribute 'qualified_only'}\n" + list("\tg_qoa : INT := 3;"), list("\tg_qob : INT := 4;")]),
  withLists(fb("sym_qualified_only_other_list_bare", "Y12 — two lists, the first `qualified_only`: its variable read BARE",
    "\tout : INT;", "out := g_qobare;"),
    ["{attribute 'qualified_only'}\n" + list("\tg_qobare : INT := 3;"), list("\tg_qobare_b : INT := 4;")]),
  // …and within one list object: does the attribute above the first section cover the second?
  withLists(fb("sym_qualified_only_second_section", "Y12 — a `qualified_only` list object with two sections: the second section's variable read bare",
    "\tout : INT;", "out := g_qo2b;"),
    ["{attribute 'qualified_only'}\nVAR_GLOBAL\n\tg_qo2a : INT := 3;\nEND_VAR\nVAR_GLOBAL CONSTANT\n\tg_qo2b : INT := 4;\nEND_VAR\n"]),
  // Y9 a member the list does not declare
  withLists(fb("sym_gvl_unknown_member", "Y9 — `GVL.nope`, a name the list does not declare", "\tout : INT;",
    "out := GVL_LANG_sym_gvl_unknown_member.nope;"), [list("\tg_gum : INT := 3;")]),
  // Y13 VAR_EXTERNAL binds the global of its name — a qualified_only one too? — and in a METHOD?
  withLists(fbText("sym_var_external_qualified_only_global", "Y13 — VAR_EXTERNAL naming a `qualified_only` list's variable",
    "FUNCTION_BLOCK FB_LANG_sym_var_external_qualified_only_global\nVAR_EXTERNAL\n\tg_veqo : INT;\nEND_VAR\nVAR\n\tout : INT;\nEND_VAR\nout := g_veqo;\nEND_FUNCTION_BLOCK\n"),
    ["{attribute 'qualified_only'}\n" + list("\tg_veqo : INT := 3;")]),
  withLists(fb("sym_var_external_in_method", "Y13 — VAR_EXTERNAL declared in a METHOD", "\tout : INT;", "out := M();", "",
    "METHOD M : INT\nVAR_EXTERNAL\n\tg_vem : INT;\nEND_VAR\nM := g_vem;\nEND_METHOD\n"), [list("\tg_vem : INT := 5;")]),
  // Y14 two lists declaring one name: VAR_EXTERNAL does not make it unambiguous… or does it?
  deferLsp(withLists(fbText("sym_var_external_of_ambiguous_global", "Y14 — VAR_EXTERNAL naming a global two lists declare",
    "FUNCTION_BLOCK FB_LANG_sym_var_external_of_ambiguous_global\nVAR_EXTERNAL\n\tg_veag : INT;\nEND_VAR\nVAR\n\tout : INT;\nEND_VAR\nout := g_veag;\nEND_FUNCTION_BLOCK\n"),
    [list("\tg_veag : INT := 3;"), list("\tg_veag : INT := 4;")]),
    "2026-10-02 niche: accepted loss (0 occurrences in the corpora — no VAR_EXTERNAL at all): both vendors say \"Ambiguous use of name\" at the declaration and the use, CODESYS adds \"No global definition found for VAR_EXTERNAL\"; the LSP binds the first list's (`support/divergences.ts` `SCOPE_DIVERGENCES`)"),

  // ─── Y19 binding is order-independent: one pair, the same units in two orders (task 3.1.4) ─────────────────────
  fbText("sym_order_independent_use_first", "Y19 — an FB using a FUNCTION and a STRUCT written AFTER it in the same text",
    "FUNCTION_BLOCK FB_LANG_sym_order_independent_use_first\nVAR\n\tbx : DUT_LANG_sym_order_independent_use_first;\n\tout : INT;\nEND_VAR\nout := FUN_LANG_sym_order_independent_use_first() + bx.v;\nEND_FUNCTION_BLOCK\n\n" +
      "FUNCTION FUN_LANG_sym_order_independent_use_first : INT\nFUN_LANG_sym_order_independent_use_first := 3;\nEND_FUNCTION\n\n" +
      "TYPE DUT_LANG_sym_order_independent_use_first :\nSTRUCT\n\tv : INT := 4;\nEND_STRUCT\nEND_TYPE\n"),
  fb("sym_order_independent_use_last", "Y19 — the same three units, the FUNCTION and the STRUCT written BEFORE the FB",
    "\tbx : DUT_LANG_sym_order_independent_use_last;\n\tout : INT;", "out := FUN_LANG_sym_order_independent_use_last() + bx.v;",
    "TYPE DUT_LANG_sym_order_independent_use_last :\nSTRUCT\n\tv : INT := 4;\nEND_STRUCT\nEND_TYPE\n\n" +
      "FUNCTION FUN_LANG_sym_order_independent_use_last : INT\nFUN_LANG_sym_order_independent_use_last := 3;\nEND_FUNCTION\n\n"),

  // ─── Y23 the bare-name search order, step against step (task 3.1.5) ─────────────────────────────────────────────
  // step 3 (the FB's and its bases' variables) before step 5 (globals): an INHERITED field over a global
  withLists(fbText("sym_inherited_member_before_global", "Y23 — a base FB's field over a global of the same name: the field (5) or the global (3)?",
    "FUNCTION_BLOCK FB_LANG_sym_inherited_member_before_global_base\nVAR\n\tg_imbg : INT := 5;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n" +
      "FUNCTION_BLOCK FB_LANG_sym_inherited_member_before_global EXTENDS FB_LANG_sym_inherited_member_before_global_base\nVAR\n\tout : INT;\nEND_VAR\nout := g_imbg;\nEND_FUNCTION_BLOCK\n"),
    [list("\tg_imbg : INT := 3;")]),
  // step 4 (the POU's methods) before step 5 (globals): a call names the METHOD, not the global of its name
  withLists(fb("sym_method_before_global", "Y23 — `M_mbg()` in an FB whose METHOD and a global share the name: the method (7)?",
    "\tout : INT;", "out := M_mbg();", "", "METHOD M_mbg : INT\nM_mbg := 7;\nEND_METHOD\n"), [list("\tM_mbg : INT := 3;")]),
  // step 5 (globals) before step 8 (POU names): a READ names the global, not the FUNCTION of its name
  withLists(fb("sym_global_before_pou_name", "Y23 — a global and a FUNCTION of one name, read bare: the global (3) or the function?",
    "\tout : INT;", "out := FUN_LANG_sym_gbpn;",
    "FUNCTION FUN_LANG_sym_gbpn : INT\nFUN_LANG_sym_gbpn := 9;\nEND_FUNCTION\n\n"), [list("\tFUN_LANG_sym_gbpn : INT := 3;")]),
  //   …and CALLED: if the global wins, the call is of an INT
  withLists(fb("sym_global_before_pou_name_called", "Y23 — a global and a FUNCTION of one name, CALLED bare",
    "\tout : INT;", "out := FUN_LANG_sym_gbpnc();",
    "FUNCTION FUN_LANG_sym_gbpnc : INT\nFUN_LANG_sym_gbpnc := 9;\nEND_FUNCTION\n\n"), [list("\tFUN_LANG_sym_gbpnc : INT := 3;")]),
  // a NAMED ARGUMENT's parameter beside a global two lists declare: the parameter is the callee's, no bare reference
  withLists(fb("sym_named_argument_beside_ambiguous_global", "Y14 — `F(g := 4)` where two lists declare `g` and F's VAR_INPUT is `g`: the argument (out 8) or ambiguous?",
    "\tout : INT;", "out := FUN_LANG_sym_naag(g_naag := 4);",
    "FUNCTION FUN_LANG_sym_naag : INT\nVAR_INPUT\n\tg_naag : INT;\nEND_VAR\nFUN_LANG_sym_naag := g_naag + g_naag;\nEND_FUNCTION\n\n"),
    [list("\tg_naag : INT := 3;"), list("\tg_naag : INT := 5;")]),
  // step 4 (the POU's methods) before step 8 (POU names): a METHOD and a FUNCTION of one name
  fb("sym_method_before_pou_name", "Y23 — `FUN_LANG_sym_mbpn()` in an FB with a METHOD of that name and a FUNCTION of it: the method (7) or the function (9)?",
    "\tout : INT;", "out := FUN_LANG_sym_mbpn();",
    "FUNCTION FUN_LANG_sym_mbpn : INT\nFUN_LANG_sym_mbpn := 9;\nEND_FUNCTION\n\n",
    "METHOD FUN_LANG_sym_mbpn : INT\nFUN_LANG_sym_mbpn := 7;\nEND_METHOD\n"),
  // step 7: a library's global — StringUtils (namespace Stu) declares HALFSHIFT : INT := 10 in its list GVL_UTF8
  deferLsp(fb("sym_library_gvl_needs_qualification", "Y23 — a referenced library's global read BARE (StringUtils' `HALFSHIFT`)",
    "\tout : INT;", "out := HALFSHIFT;"),
    "2026-10-02 niche: accepted loss (0 occurrences in the corpora): StringUtils requires qualified access, which its manifest does not say — a bridge fact, never guessed per library (`support/divergences.ts` `CODESYS_SCOPE_DIVERGENCES`)"),
  deferLsp(fb("sym_library_gvl_qualified_by_namespace", "Y23 — a referenced library's global read as `Stu.HALFSHIFT`", "\tout : INT;",
    "out := Stu.HALFSHIFT;"),
    "2026-10-02 niche: accepted loss (0 occurrences in the corpora): a library namespace reaches its lists, not their variables — \"'STRINGUTILS, 3.5.20.0 (SYSTEM)' contains no definition for 'HALFSHIFT'\" (`support/divergences.ts` `CODESYS_SCOPE_DIVERGENCES`)"),
  fb("sym_library_gvl_qualified_by_list", "Y23 — a referenced library's global read as `GVL_UTF8.HALFSHIFT`", "\tout : INT;",
    "out := GVL_UTF8.HALFSHIFT;"),
  fb("sym_library_gvl_qualified_fully", "Y23 — a referenced library's global read as `Stu.GVL_UTF8.HALFSHIFT`", "\tout : INT;",
    "out := Stu.GVL_UTF8.HALFSHIFT;"),
  // E33 the global-namespace dot skips steps 1–4: past a METHOD's local AND its FB's field
  withLists(fb("sym_global_namespace_dot_skips_local", "E33/Y23 — `.g` in a METHOD whose local and whose FB's field share the global's name: the global (3)?",
    "\tg_gnds : INT := 5;\n\tout : INT;", "out := M();", "",
    "METHOD M : INT\nVAR\n\tg_gnds : INT := 8;\nEND_VAR\nM := .g_gnds;\nEND_METHOD\n"), [list("\tg_gnds : INT := 3;")]),

  // ─── Y24 a device-tree instance name, read bare: the fixture project's one device is `Device` (the PLC) ────────
  fb("sym_device_instance_bare", "Y24 — the device tree's PLC instance `Device` named bare in ST", "\tout : INT;\n\tp : POINTER TO BYTE;",
    "p := ADR(Device);\nout := 1;"),
]
