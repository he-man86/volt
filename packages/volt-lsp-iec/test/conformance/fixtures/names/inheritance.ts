/**
 * INHERITANCE, RULE BY RULE — design.md §4 3.2 of openspec `frontend-conformance` (H1–H10; tasks 3.2.1–3.2.4), each rule
 * the recorded fixtures elsewhere left a GAP in put to the vendor by fixtures of its own: `record:language` for
 * accept/refuse and the vendor's words, `record:exec` for WHICH declaration a name meant (every FB below that builds
 * copies what it reads into `out`, so the run recording holds `inst_<name>.out`, and each candidate gives another value).
 *
 *   H4  an INTERFACE's EXTENDS list: a base's member through the derived interface (each base of a list), and the
 *       implementing FB's obligation for what the derived interface inherits
 *   H5  an interface METHOD's parameters: bound by name at a call through the interface, refused when it declares none
 *   H6  SUPER past a base that does not declare the method (the grandparent's)
 *   H7  an EXTENDS base that resolves to nothing: what is said of the members the derived body uses
 *   H8  the base an EXTENDS names when the project and a referenced library both declare the name
 *   H9  EXTENDS cycles: three FBs, one FB on itself, two interfaces, two structs
 *   H10 overrides: a METHOD's signature against its base's and its interface's, cell by cell (a parameter's type, count,
 *       name and section, the result type), a PROPERTY's type, a FINAL method, an ABSTRACT method left unimplemented
 *
 * GLOBAL NAMES ARE THE FIXTURE'S OWN (`…_<name>`): the replay binds every fixture into one project. The one exception is
 * H8's, which must be a library's name: Util's `HYSTERESIS`, which no other fixture names.
 */
import type { LanguageTest } from "../../types.js"

const doc = "frontend-conformance design.md §4 3.2 (inheritance)"

/** A function block `FB_LANG_<name>` with VAR `vars` and body `body`; `before` (whole units) is written ahead of it and
 *  `after` (its METHOD/PROPERTY units) after it. Instanced in PLC_PRG as `inst_<name>` and called. */
function fb(name: string, feature: string, vars: string, body: string, before = "", after = "", header = ""): LanguageTest {
  const pouName = `FB_LANG_${name}`
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    plcPrgVar: `inst_${name} : ${pouName};`,
    plcPrgBody: `inst_${name}();`,
    source: `${before}FUNCTION_BLOCK ${pouName}${header}\nVAR\n${vars}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n${after ? `\n${after}` : ""}`,
  }
}

/** An FB `FB_LANG_<name>_base` with VAR `vars` and the METHOD/PROPERTY units `members`, written ahead of a derived FB. */
const baseFb = (name: string, vars: string, members = "", modifiers = ""): string =>
  `FUNCTION_BLOCK ${modifiers}FB_LANG_${name}_base\nVAR\n${vars}\nEND_VAR\nEND_FUNCTION_BLOCK\n\n${members}${members ? "\n" : ""}`

/** `fb` extending `FB_LANG_<name>_base` (written by `base`, ahead of it). */
const derived = (name: string, feature: string, base: string, vars: string, body: string, after = ""): LanguageTest =>
  fb(name, feature, vars, body, base, after, ` EXTENDS FB_LANG_${name}_base`)

/** An interface `ITF_LANG_<name>_<suffix>` [EXTENDS `bases`] holding the METHOD/PROPERTY declarations `members`. */
const itf = (name: string, suffix: string, members: string, bases = ""): string =>
  `INTERFACE ITF_LANG_${name}_${suffix}${bases ? ` EXTENDS ${bases}` : ""}\n${members}END_INTERFACE\n\n`

/** An FB `FB_LANG_<name>_impl` IMPLEMENTS `iface`, with VAR `vars` and the members `members` after it. */
const impl = (name: string, iface: string, vars: string, members: string): string =>
  `FUNCTION_BLOCK FB_LANG_${name}_impl IMPLEMENTS ${iface}\nVAR\n${vars}\nEND_VAR\nEND_FUNCTION_BLOCK\n\n${members}\n`

/** `t`, whose refusal the LSP does not make — the reason, dated (`deferred.lsp`). */
function deferLsp(t: LanguageTest, reason: string): LanguageTest {
  return { ...t, deferred: { lsp: reason } }
}

const NO_CODE_NUMBER =
  "niche: accepted loss (0 occurrences in the corpora: they build, holding 7 FINAL and 11 ABSTRACT methods) (2026-10-02) — both vendors' words are recorded; not trivial: a wire diagnostic is a catalog `Cnnnn` (`server/diagnostic-codes.ts` admits no new slug) which no build message carries (`support/divergences.ts` `INHERITANCE_DIVERGENCES`)"

/** `t` with PLC_PRG holding `plcPrgVar`/`plcPrgBody` in place of an instance of the fixture's FB — WHICH FB the vendor
 *  checks, asked by leaving it uninstanced, instancing it only where nothing is compiled, or reaching it only through a
 *  POINTER or a REFERENCE TO it. (A `__NEW`-only cell was recorded and dropped: CODESYS answers the override mismatch
 *  there too, beside "No memory for dynamic object creation defined for application", a setting of the fixture
 *  project's application, not of the code.) */
function notInstanced(t: LanguageTest, plcPrgVar?: string, plcPrgBody?: string): LanguageTest {
  return { ...t, plcPrgVar, plcPrgBody }
}

/** The override of `inh_override_signature_mismatch` (a parameter DINT for INT) as fixture `name`, followed by `after`
 *  (whole units). */
const mismatchingOverride = (name: string, feature: string, after = ""): LanguageTest => {
  const t = derived(name, feature,
    baseFb(name, "\tb : INT;", "METHOD M : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nM := a;\nEND_METHOD\n"),
    "\tout : INT;", "out := M(a := 3);", "METHOD M : INT\nVAR_INPUT\n\ta : DINT;\nEND_VAR\nM := DINT_TO_INT(a);\nEND_METHOD\n")
  return { ...t, source: `${t.source}${after ? `\n${after}` : ""}` }
}

/** `fb` whose instance lives in `PLC_PRG` but whose whole text is `source`. */
function fbText(name: string, feature: string, source: string): LanguageTest {
  return { ...fb(name, feature, "", ""), source }
}

export const INHERITANCE_RULE_TESTS: readonly LanguageTest[] = [
  // ─── H4 INTERFACE EXTENDS: a base's member through the derived interface ────────────────────────────────────────
  // Mb is the base interface's alone; the FB answers 7 from it
  fb("inh_interface_extends_member", "H4 — a METHOD the base interface declares, called through a variable of the derived interface",
    "\timp : FB_LANG_inh_interface_extends_member_impl;\n\titfRef : ITF_LANG_inh_interface_extends_member_d;\n\tout : INT;",
    "itfRef := imp;\nout := itfRef.Mb();",
    itf("inh_interface_extends_member", "b", "METHOD Mb : INT\nEND_METHOD\n") +
      itf("inh_interface_extends_member", "d", "METHOD Md : INT\nEND_METHOD\n", "ITF_LANG_inh_interface_extends_member_b") +
      impl("inh_interface_extends_member", "ITF_LANG_inh_interface_extends_member_d", "\tk : INT;",
        "METHOD Mb : INT\nMb := 7;\nEND_METHOD\n\nMETHOD Md : INT\nMd := 9;\nEND_METHOD\n")),
  //   …each base of a LIST: the second base's method through the derived interface (11)
  fb("inh_interface_extends_second_base_member", "H4 — `EXTENDS I_a, I_b`: a METHOD of the SECOND base, called through the derived interface",
    "\timp : FB_LANG_inh_interface_extends_second_base_member_impl;\n\titfRef : ITF_LANG_inh_interface_extends_second_base_member_d;\n\tout : INT;",
    "itfRef := imp;\nout := itfRef.Mb();",
    itf("inh_interface_extends_second_base_member", "a", "METHOD Ma : INT\nEND_METHOD\n") +
      itf("inh_interface_extends_second_base_member", "b", "METHOD Mb : INT\nEND_METHOD\n") +
      itf("inh_interface_extends_second_base_member", "d", "",
        "ITF_LANG_inh_interface_extends_second_base_member_a, ITF_LANG_inh_interface_extends_second_base_member_b") +
      impl("inh_interface_extends_second_base_member", "ITF_LANG_inh_interface_extends_second_base_member_d", "\tk : INT;",
        "METHOD Ma : INT\nMa := 3;\nEND_METHOD\n\nMETHOD Mb : INT\nMb := 11;\nEND_METHOD\n")),
  //   …a PROPERTY of the base interface, read through the derived one (5)
  fb("inh_interface_extends_property", "H4 — a PROPERTY the base interface declares, read through a variable of the derived interface",
    "\timp : FB_LANG_inh_interface_extends_property_impl;\n\titfRef : ITF_LANG_inh_interface_extends_property_d;\n\tout : INT;",
    "itfRef := imp;\nout := itfRef.P;",
    itf("inh_interface_extends_property", "b", "PROPERTY P : INT\nGET\nEND_GET\nEND_PROPERTY\n") +
      itf("inh_interface_extends_property", "d", "METHOD Md : INT\nEND_METHOD\n", "ITF_LANG_inh_interface_extends_property_b") +
      impl("inh_interface_extends_property", "ITF_LANG_inh_interface_extends_property_d", "\tk : INT := 5;",
        "PROPERTY P : INT\nGET\nP := k;\nEND_GET\nEND_PROPERTY\n\nMETHOD Md : INT\nMd := 9;\nEND_METHOD\n")),
  //   …the implementing FB owes what the derived interface INHERITS: an FB implementing I_d, without the base's Mb
  fb("inh_implements_derived_missing_base_method", "H4 — an FB IMPLEMENTS the derived interface and declares only its own METHOD, not the base interface's",
    "\tout : INT;", "out := Md();",
    itf("inh_implements_derived_missing_base_method", "b", "METHOD Mb : INT\nEND_METHOD\n") +
      itf("inh_implements_derived_missing_base_method", "d", "METHOD Md : INT\nEND_METHOD\n", "ITF_LANG_inh_implements_derived_missing_base_method_b"),
    "METHOD Md : INT\nMd := 9;\nEND_METHOD\n", " IMPLEMENTS ITF_LANG_inh_implements_derived_missing_base_method_d"),
  //   …an interface whose base resolves to nothing
  fbText("inh_interface_extends_unknown", "H4/H7 — an INTERFACE EXTENDS a name nothing declares, implemented by the FB",
    itf("inh_interface_extends_unknown", "d", "METHOD Md : INT\nEND_METHOD\n", "ITF_LANG_inh_interface_extends_unknown_missing") +
      "FUNCTION_BLOCK FB_LANG_inh_interface_extends_unknown IMPLEMENTS ITF_LANG_inh_interface_extends_unknown_d\nVAR\n\tout : INT;\nEND_VAR\nout := Md();\nEND_FUNCTION_BLOCK\n\nMETHOD Md : INT\nMd := 9;\nEND_METHOD\n"),

  // ─── H5 an interface METHOD's parameters ───────────────────────────────────────────────────────────────────────
  // bound by NAME at a call through the interface: the FB answers a * 10 + b = 52
  fb("inh_interface_method_param_resolves", "H5 — `itfRef.M(b := 2, a := 5)` through an interface: each argument bound to the interface method's parameter of its name",
    "\timp : FB_LANG_inh_interface_method_param_resolves_impl;\n\titfRef : ITF_LANG_inh_interface_method_param_resolves_i;\n\tout : INT;",
    "itfRef := imp;\nout := itfRef.M(b := 2, a := 5);",
    itf("inh_interface_method_param_resolves", "i", "METHOD M : INT\nVAR_INPUT\n\ta : INT;\n\tb : INT;\nEND_VAR\nEND_METHOD\n") +
      impl("inh_interface_method_param_resolves", "ITF_LANG_inh_interface_method_param_resolves_i", "\tk : INT;",
        "METHOD M : INT\nVAR_INPUT\n\ta : INT;\n\tb : INT;\nEND_VAR\nM := a * INT#10 + b;\nEND_METHOD\n")),
  //   …a name the interface method declares no parameter of
  fb("inh_interface_method_unknown_param", "H5 — `itfRef.M(zz := 5)` through an interface whose METHOD has no parameter `zz`",
    "\timp : FB_LANG_inh_interface_method_unknown_param_impl;\n\titfRef : ITF_LANG_inh_interface_method_unknown_param_i;\n\tout : INT;",
    "itfRef := imp;\nout := itfRef.M(zz := 5);",
    itf("inh_interface_method_unknown_param", "i", "METHOD M : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nEND_METHOD\n") +
      impl("inh_interface_method_unknown_param", "ITF_LANG_inh_interface_method_unknown_param_i", "\tk : INT;",
        "METHOD M : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nM := a;\nEND_METHOD\n")),
  //   …a VAR_OUTPUT of the interface method, bound at the call as `o => out` (6)
  fb("inh_interface_method_output_param", "H5 — `itfRef.M(o => out)` through an interface: the interface method's VAR_OUTPUT bound at the call",
    "\timp : FB_LANG_inh_interface_method_output_param_impl;\n\titfRef : ITF_LANG_inh_interface_method_output_param_i;\n\tout : INT;",
    "itfRef := imp;\nitfRef.M(o => out);",
    itf("inh_interface_method_output_param", "i", "METHOD M\nVAR_OUTPUT\n\to : INT;\nEND_VAR\nEND_METHOD\n") +
      impl("inh_interface_method_output_param", "ITF_LANG_inh_interface_method_output_param_i", "\tk : INT;",
        "METHOD M\nVAR_OUTPUT\n\to : INT;\nEND_VAR\no := 6;\nEND_METHOD\n")),

  // ─── H6 SUPER past a base that does not override: the grandparent's METHOD (4), not the derived one's (40) ────────
  fb("inh_super_reaches_grandparent_method", "H6 — `SUPER^.M()` in an FB whose base inherits M from ITS base: the grandparent's body runs",
    "\tout : INT;", "out := SUPER^.M();",
    "FUNCTION_BLOCK FB_LANG_inh_super_reaches_grandparent_method_g\nVAR\n\tg : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\nMETHOD M : INT\nM := 4;\nEND_METHOD\n\n" +
      "FUNCTION_BLOCK FB_LANG_inh_super_reaches_grandparent_method_p EXTENDS FB_LANG_inh_super_reaches_grandparent_method_g\nVAR\n\tp : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n",
    "METHOD M : INT\nM := 40;\nEND_METHOD\n", " EXTENDS FB_LANG_inh_super_reaches_grandparent_method_p"),

  // ─── H7 an EXTENDS base that resolves to nothing ───────────────────────────────────────────────────────────────
  // the body reads a name it does not declare, which only the missing base could
  fb("inh_unresolved_base", "H7 — an FB EXTENDS a name nothing declares, and its body reads a name only that base could declare",
    "\tout : INT;", "out := inheritedField;", "", "", " EXTENDS FB_LANG_inh_unresolved_base_missing"),
  //   …and calls a METHOD only that base could declare
  fb("inh_unresolved_base_method_call", "H7 — an FB EXTENDS a name nothing declares, and its body calls a METHOD only that base could declare",
    "\tout : INT;", "out := InheritedMethod();", "", "", " EXTENDS FB_LANG_inh_unresolved_base_method_call_missing"),

  // ─── H8 the project and a referenced library both declare the base's name (Util's HYSTERESIS) ──────────────────
  // the project's HYSTERESIS has `v := 42`, Util's no `v`: the project's (42), or an undefined `v`?
  fb("inh_extends_ambiguous_library_base", "H8 — `EXTENDS HYSTERESIS` where the project and Util both declare HYSTERESIS: which base",
    "\tout : INT;", "out := v;",
    "FUNCTION_BLOCK HYSTERESIS\nVAR\n\tv : INT := 42;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n", "", " EXTENDS HYSTERESIS"),

  // ─── H9 EXTENDS cycles ──────────────────────────────────────────────────────────────────────────────────────────
  fbText("inh_extends_cycle", "H9 — three FBs extending each other in a ring (a → b → c → a)",
    "FUNCTION_BLOCK FB_LANG_inh_extends_cycle EXTENDS FB_LANG_inh_extends_cycle_b\nVAR\n\tout : INT;\nEND_VAR\nout := 1;\nEND_FUNCTION_BLOCK\n\n" +
      "FUNCTION_BLOCK FB_LANG_inh_extends_cycle_b EXTENDS FB_LANG_inh_extends_cycle_c\nVAR\n\tb : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n" +
      "FUNCTION_BLOCK FB_LANG_inh_extends_cycle_c EXTENDS FB_LANG_inh_extends_cycle\nVAR\n\tc : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n"),
  fb("inh_extends_self", "H9 — an FB that EXTENDS itself", "\tout : INT;", "out := 1;", "", "", " EXTENDS FB_LANG_inh_extends_self"),
  fbText("inh_interface_extends_cycle", "H9 — two INTERFACEs extending each other, one implemented by the FB",
    itf("inh_interface_extends_cycle", "a", "METHOD Ma : INT\nEND_METHOD\n", "ITF_LANG_inh_interface_extends_cycle_b") +
      itf("inh_interface_extends_cycle", "b", "METHOD Mb : INT\nEND_METHOD\n", "ITF_LANG_inh_interface_extends_cycle_a") +
      "FUNCTION_BLOCK FB_LANG_inh_interface_extends_cycle IMPLEMENTS ITF_LANG_inh_interface_extends_cycle_a\nVAR\n\tout : INT;\nEND_VAR\nout := Ma();\nEND_FUNCTION_BLOCK\n\nMETHOD Ma : INT\nMa := 1;\nEND_METHOD\n\nMETHOD Mb : INT\nMb := 2;\nEND_METHOD\n"),
  fb("inh_struct_extends_cycle", "H9 — two STRUCTs extending each other, one declared in the FB",
    "\tbx : DUT_LANG_inh_struct_extends_cycle_a;\n\tout : INT;", "out := bx.a;",
    "TYPE DUT_LANG_inh_struct_extends_cycle_a EXTENDS DUT_LANG_inh_struct_extends_cycle_b :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE\n\n" +
      "TYPE DUT_LANG_inh_struct_extends_cycle_b EXTENDS DUT_LANG_inh_struct_extends_cycle_a :\nSTRUCT\n\tb : INT;\nEND_STRUCT\nEND_TYPE\n\n"),

  // ─── H10 overrides: a METHOD's signature against its base's, one cell each ─────────────────────────────────────
  derived("inh_override_signature_mismatch", "H10 — an override whose parameter has another TYPE than the base method's (DINT for INT)",
    baseFb("inh_override_signature_mismatch", "\tb : INT;", "METHOD M : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nM := a;\nEND_METHOD\n"),
    "\tout : INT;", "out := M(a := 3);", "METHOD M : INT\nVAR_INPUT\n\ta : DINT;\nEND_VAR\nM := DINT_TO_INT(a);\nEND_METHOD\n"),
  derived("inh_override_param_count_mismatch", "H10 — an override with one VAR_INPUT more than the base method",
    baseFb("inh_override_param_count_mismatch", "\tb : INT;", "METHOD M : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nM := a;\nEND_METHOD\n"),
    "\tout : INT;", "out := M(a := 3, c := 4);", "METHOD M : INT\nVAR_INPUT\n\ta : INT;\n\tc : INT;\nEND_VAR\nM := a + c;\nEND_METHOD\n"),
  derived("inh_override_param_name_mismatch", "H10 — an override whose parameter has another NAME than the base method's (same type)",
    baseFb("inh_override_param_name_mismatch", "\tb : INT;", "METHOD M : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nM := a;\nEND_METHOD\n"),
    "\tout : INT;", "out := M(3);", "METHOD M : INT\nVAR_INPUT\n\tx : INT;\nEND_VAR\nM := x * INT#2;\nEND_METHOD\n"),
  derived("inh_override_section_mismatch", "H10 — an override declaring the base method's VAR_INPUT as a VAR_IN_OUT",
    baseFb("inh_override_section_mismatch", "\tb : INT;", "METHOD M : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nM := a;\nEND_METHOD\n"),
    "\tv : INT := 3;\n\tout : INT;", "out := M(a := v);", "METHOD M : INT\nVAR_IN_OUT\n\ta : INT;\nEND_VAR\nM := a;\nEND_METHOD\n"),
  derived("inh_override_return_type_mismatch", "H10 — an override whose RESULT type differs from the base method's (DINT for INT)",
    baseFb("inh_override_return_type_mismatch", "\tb : INT;", "METHOD Fetch : INT\nFetch := 1;\nEND_METHOD\n"),
    "\tout : DINT;", "out := Fetch();", "METHOD Fetch : DINT\nFetch := 2;\nEND_METHOD\n"),
  derived("inh_override_property_type_mismatch", "H10 — an overriding PROPERTY of another type than the base's (DINT for INT)",
    baseFb("inh_override_property_type_mismatch", "\tb : INT;", "PROPERTY P : INT\nGET\nP := 1;\nEND_GET\nEND_PROPERTY\n"),
    "\tout : DINT;", "out := P;", "PROPERTY P : DINT\nGET\nP := 2;\nEND_GET\nEND_PROPERTY\n"),
  deferLsp(derived("inh_override_final_method", "H10 — an override of a base METHOD declared FINAL",
    baseFb("inh_override_final_method", "\tb : INT;", "METHOD FINAL M : INT\nM := 1;\nEND_METHOD\n"),
    "\tout : INT;", "out := M();", "METHOD M : INT\nM := 2;\nEND_METHOD\n"), NO_CODE_NUMBER),
  deferLsp(derived("inh_abstract_method_not_implemented", "H10 — a concrete FB extending an ABSTRACT FB without implementing its ABSTRACT METHOD, instanced",
    baseFb("inh_abstract_method_not_implemented", "\tb : INT;", "METHOD ABSTRACT M : INT\nEND_METHOD\n", "ABSTRACT "),
    "\tout : INT;", "out := 1;"), NO_CODE_NUMBER),
  //   …and against the INTERFACE method it implements: a parameter of another type (DINT for INT)
  fb("inh_interface_method_signature_mismatch", "H10 — an FB's METHOD implementing an interface METHOD with a parameter of another type (DINT for INT)",
    "\tout : INT;", "out := M(a := 3);",
    itf("inh_interface_method_signature_mismatch", "i", "METHOD M : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nEND_METHOD\n"),
    "METHOD M : INT\nVAR_INPUT\n\ta : DINT;\nEND_VAR\nM := DINT_TO_INT(a);\nEND_METHOD\n", " IMPLEMENTS ITF_LANG_inh_interface_method_signature_mismatch_i"),
  //   …and its parameter COUNT (one VAR_INPUT more)
  fb("inh_interface_method_param_count_mismatch", "H10 — an FB's METHOD implementing an interface METHOD with one VAR_INPUT more",
    "\tout : INT;", "out := Fetch(a := 3, c := 4);",
    itf("inh_interface_method_param_count_mismatch", "i", "METHOD Fetch : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nEND_METHOD\n"),
    "METHOD Fetch : INT\nVAR_INPUT\n\ta : INT;\n\tc : INT;\nEND_VAR\nFetch := a + c;\nEND_METHOD\n", " IMPLEMENTS ITF_LANG_inh_interface_method_param_count_mismatch_i"),
  //   …another SECTION of the same type, neither a VAR_IN_OUT: the base's VAR_INPUT declared VAR_OUTPUT
  derived("inh_override_input_as_output", "H10 — an override declaring the base method's VAR_INPUT as a VAR_OUTPUT of the same type",
    baseFb("inh_override_input_as_output", "\tb : INT;", "METHOD M : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nM := a;\nEND_METHOD\n"),
    "\tout : INT;", "out := M();", "METHOD M : INT\nVAR_OUTPUT\n\ta : INT;\nEND_VAR\nM := 2;\nEND_METHOD\n"),
  //   …the reverse of `_section_mismatch`: the base's VAR_IN_OUT declared VAR_INPUT
  derived("inh_override_inout_as_input", "H10 — an override declaring the base method's VAR_IN_OUT as a VAR_INPUT",
    baseFb("inh_override_inout_as_input", "\tb : INT;", "METHOD M : INT\nVAR_IN_OUT\n\ta : INT;\nEND_VAR\nM := a;\nEND_METHOD\n"),
    "\tv : INT := 3;\n\tout : INT;", "out := M(a := v);", "METHOD M : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nM := a;\nEND_METHOD\n"),

  // ─── H4/H10 WHICH FBs the vendor checks: the FB's own declaration against its bases' and interfaces' ───────────
  // nothing instances it
  notInstanced(mismatchingOverride("inh_override_uninstanced", "H10 — an override of another parameter type (DINT for INT) in an FB NOTHING instances")),
  //   …reached only through a POINTER TO it (no instance anywhere)
  notInstanced(mismatchingOverride("inh_override_pointer_only", "H10 — an override of another parameter type in an FB reached only through a POINTER TO it"),
    "p_inh_override_pointer_only : POINTER TO FB_LANG_inh_override_pointer_only;\no_inh_override_pointer_only : INT;",
    "IF p_inh_override_pointer_only <> 0 THEN\n\to_inh_override_pointer_only := p_inh_override_pointer_only^.M(a := 1);\nEND_IF"),
  //   …through a REFERENCE TO it
  notInstanced(mismatchingOverride("inh_override_reference_only", "H10 — an override of another parameter type in an FB reached only through a REFERENCE TO it"),
    "r_inh_override_reference_only : REFERENCE TO FB_LANG_inh_override_reference_only;\no_inh_override_reference_only : INT;",
    "IF __ISVALIDREF(r_inh_override_reference_only) THEN\n\to_inh_override_reference_only := r_inh_override_reference_only.M(a := 1);\nEND_IF"),
  //   …instanced only inside another FB that nothing instances
  notInstanced(mismatchingOverride("inh_override_instanced_in_uninstanced_fb", "H10 — an override of another parameter type in an FB instanced only inside an FB nothing instances",
    "FUNCTION_BLOCK FB_LANG_inh_override_instanced_in_uninstanced_fb_holder\nVAR\n\td : FB_LANG_inh_override_instanced_in_uninstanced_fb;\nEND_VAR\nd();\nEND_FUNCTION_BLOCK\n")),
  //   …an FB nothing instances whose METHOD differs from its INTERFACE's
  notInstanced(fb("inh_interface_method_signature_mismatch_uninstanced", "H10 — an FB NOTHING instances whose METHOD implements an interface METHOD with a parameter of another type",
    "\tout : INT;", "out := M(a := 3);",
    itf("inh_interface_method_signature_mismatch_uninstanced", "i", "METHOD M : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nEND_METHOD\n"),
    "METHOD M : INT\nVAR_INPUT\n\ta : DINT;\nEND_VAR\nM := DINT_TO_INT(a);\nEND_METHOD\n", " IMPLEMENTS ITF_LANG_inh_interface_method_signature_mismatch_uninstanced_i")),
  //   …an FB nothing instances that leaves out the method its derived interface INHERITS (H4's obligation)
  notInstanced(fb("inh_implements_derived_missing_base_method_uninstanced", "H4 — an FB NOTHING instances IMPLEMENTS the derived interface and declares only its own METHOD",
    "\tout : INT;", "out := Md();",
    itf("inh_implements_derived_missing_base_method_uninstanced", "b", "METHOD Mb : INT\nEND_METHOD\n") +
      itf("inh_implements_derived_missing_base_method_uninstanced", "d", "METHOD Md : INT\nEND_METHOD\n", "ITF_LANG_inh_implements_derived_missing_base_method_uninstanced_b"),
    "METHOD Md : INT\nMd := 9;\nEND_METHOD\n", " IMPLEMENTS ITF_LANG_inh_implements_derived_missing_base_method_uninstanced_d")),
]
