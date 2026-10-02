/**
 * ENUMS, RULE BY RULE — design.md §4 3.3 of openspec `frontend-conformance` (EN1–EN6; task 3.3), each rule put to the
 * vendor by fixtures of its own: `record:language` for accept/refuse and the vendor's words, `record:exec` for WHICH
 * declaration a bare name meant (every FB below that builds writes into `out` a value that differs per candidate).
 *
 *   EN1 a `qualified_only` enum: its member bare, and beside a non-qualified enum declaring the same member
 *   EN2 a non-qualified enum's member bare (recorded elsewhere: type_dut_enum_simple, xo2_*)
 *   EN3 two enums declaring one bare member: in a store to one of them, a store to an INT, a comparison, a CASE label,
 *       and qualified
 *   EN4 an implicit enum's values: in a METHOD of the POU that declares it, in another POU, beside a DUT enum's
 *   EN5 an enum member against an FB's variable, a METHOD's local, a global and a FUNCTION of the same name
 *   EN6 a library enum (Util's GEN_MODE and WEEKDAY, CommFB's IO_SYSTEM_TYPE): bare, by its type, by its namespace, a
 *       member two libraries' enums declare, a member a project enum also declares — and bare in an FB nothing instances
 *
 * NO CONVERSION IS ASKED: which member a name meant is read back by comparing with the QUALIFIED member
 * (`IF e = DUT.m THEN out := …`), never through `TO_INT` or an enum stored into an INT (area 4's questions), except the
 * one cell whose question IS the INT context.
 *
 * MEMBER NAMES ARE THE FIXTURE'S OWN (`<tag>_<m>`): the replay binds every fixture into one project, so a member another
 * fixture's enum also declares would be ambiguous there and in no recording. The exceptions are EN6's, which must be
 * a library's: Util's GEN_MODE members and CommFB's `PROFINET_IO`, which no other fixture names.
 */
import type { LanguageTest } from "../../types.js"

const doc = "frontend-conformance design.md §4 3.3 (enums); docs/codesys-reference/06-data-types.md#ENUM"

/** A function block `FB_LANG_<name>` with VAR `vars` and body `body`; `before` (whole units) is written ahead of it and
 *  `after` (its METHOD units) after it. Instanced in PLC_PRG as `inst_<name>` and called. */
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

/** An enum type `DUT_LANG_<name>_<suffix>` of `members` (`m := v` each), `qualified_only` when asked. */
const enumType = (name: string, suffix: string, members: readonly string[], qualifiedOnly = false): string =>
  `${qualifiedOnly ? "{attribute 'qualified_only'}\n" : ""}TYPE DUT_LANG_${name}_${suffix} :\n(\n${members.map((m) => `\t${m}`).join(",\n")}\n);\nEND_TYPE\n\n`

/** One global variable list ahead of the FB, its object named `GVL_LANG_<name>`. */
function withList(t: LanguageTest, decls: string): LanguageTest {
  return { ...t, source: `VAR_GLOBAL\n${decls}\nEND_VAR\n\n${t.source}`, gvlNames: [`GVL_LANG_${t.name}`] }
}

/** `t` with nothing instancing its FB: PLC_PRG leaves it out — what the vendor says of a body it does not compile. */
const uninstanced = (t: LanguageTest): LanguageTest => {
  const { plcPrgVar: _var, plcPrgBody: _body, ...rest } = t
  return rest
}

/** `t`, whose refusal the LSP does not make — the reason, dated (`deferred.lsp`). */
function deferLsp(t: LanguageTest, reason: string): LanguageTest {
  return { ...t, deferred: { lsp: reason } }
}

/** The A/B pair EN3 asks about: `DUT_LANG_<name>_a` (`<tag>_x := 3`, `<tag>_y := 4`) and `_b` (`<tag>_x := 5`, `<tag>_z := 6`). */
const twoEnums = (name: string, tag: string, aQualifiedOnly = false): string =>
  enumType(name, "a", [`${tag}_x := 3`, `${tag}_y := 4`], aQualifiedOnly) + enumType(name, "b", [`${tag}_x := 5`, `${tag}_z := 6`])

export const ENUM_RULE_TESTS: readonly LanguageTest[] = [
  // ─── EN1 a qualified_only enum's member is reached only as Enum.Member ───────────────────────────────────────────
  fb("enum_qualified_only_bare", "EN1 — a `qualified_only` enum's member written bare in a store to that enum",
    "\te : DUT_LANG_enum_qualified_only_bare_a;\n\tout : INT;",
    "e := eqob_y;\nIF e = DUT_LANG_enum_qualified_only_bare_a.eqob_y THEN\n\tout := INT#4;\nEND_IF",
    enumType("enum_qualified_only_bare", "a", ["eqob_x := 3", "eqob_y := 4"], true)),
  fb("enum_qualified_only_qualified", "EN1 — a `qualified_only` enum's member written `Enum.Member`",
    "\te : DUT_LANG_enum_qualified_only_qualified_a;\n\tout : INT;",
    "e := DUT_LANG_enum_qualified_only_qualified_a.eqoq_y;\nIF e = DUT_LANG_enum_qualified_only_qualified_a.eqoq_y THEN\n\tout := INT#4;\nEND_IF",
    enumType("enum_qualified_only_qualified", "a", ["eqoq_x := 3", "eqoq_y := 4"], true)),
  // EN1 × EN3: A is qualified_only, B is not, both declare `x` — the bare name is B's alone (5), or ambiguous?
  fb("enum_same_member_one_qualified_only", "EN1/EN3 — `x` bare where a `qualified_only` enum A and an enum B both declare it, stored to B: B's (out 5)?",
    "\te : DUT_LANG_enum_same_member_one_qualified_only_b;\n\tout : INT;",
    "e := esmq_x;\nIF e = DUT_LANG_enum_same_member_one_qualified_only_b.esmq_x THEN\n\tout := INT#5;\nEND_IF",
    twoEnums("enum_same_member_one_qualified_only", "esmq", true)),

  // ─── EN3 two enums declaring one bare member ──────────────────────────────────────────────────────────────────────
  fb("enum_same_member_two_enums", "EN3 — `x` bare where enums A (x := 3) and B (x := 5) both declare it, stored to an A: A's (out 3), B's (out 5), or ambiguous?",
    "\te : DUT_LANG_enum_same_member_two_enums_a;\n\tout : INT;",
    "e := esm2_x;\nIF e = DUT_LANG_enum_same_member_two_enums_a.esm2_x THEN\n\tout := INT#3;\nELSE\n\tout := INT#5;\nEND_IF",
    twoEnums("enum_same_member_two_enums", "esm2")),
  fb("enum_same_member_two_enums_into_b", "EN3 — the same, stored to a B: B's (out 5), A's (out 3), or ambiguous?",
    "\te : DUT_LANG_enum_same_member_two_enums_into_b_b;\n\tout : INT;",
    "e := esmb_x;\nIF e = DUT_LANG_enum_same_member_two_enums_into_b_b.esmb_x THEN\n\tout := INT#5;\nELSE\n\tout := INT#3;\nEND_IF",
    twoEnums("enum_same_member_two_enums_into_b", "esmb")),
  fb("enum_same_member_into_int", "EN3 — `x` bare, two enums declaring it, stored to an INT (no enum to take it from): 3, 5, or ambiguous?",
    "\tout : INT;", "out := esmi_x;", twoEnums("enum_same_member_into_int", "esmi")),
  fb("enum_same_member_comparison", "EN3 — `e = x` with e a B and two enums declaring `x`: B's (out 5) or ambiguous?",
    "\te : DUT_LANG_enum_same_member_comparison_b := DUT_LANG_enum_same_member_comparison_b.esmc_x;\n\tout : INT;",
    "IF e = esmc_x THEN\n\tout := INT#5;\nELSE\n\tout := INT#3;\nEND_IF", twoEnums("enum_same_member_comparison", "esmc")),
  fb("enum_same_member_case_label", "EN3 — `x:` as a CASE label over a B, two enums declaring `x`: B's (out 5) or ambiguous?",
    "\te : DUT_LANG_enum_same_member_case_label_b := DUT_LANG_enum_same_member_case_label_b.esml_x;\n\tout : INT;",
    "CASE e OF\n\tesml_x:\n\t\tout := INT#5;\nELSE\n\tout := INT#1;\nEND_CASE", twoEnums("enum_same_member_case_label", "esml")),
  fb("enum_same_member_qualified", "EN3 — `B.x` written qualified, two enums declaring `x`: B's (out 5)",
    "\te : DUT_LANG_enum_same_member_qualified_b;\n\tout : INT;",
    "e := DUT_LANG_enum_same_member_qualified_b.esmz_x;\nIF e = DUT_LANG_enum_same_member_qualified_b.esmz_x THEN\n\tout := INT#5;\nEND_IF",
    twoEnums("enum_same_member_qualified", "esmz")),
  fb("enum_member_unique_beside_shared", "EN3 — `y`, which only A declares, bare beside the shared `x`: A's (out 4)",
    "\te : DUT_LANG_enum_member_unique_beside_shared_a;\n\tout : INT;",
    "e := emub_y;\nIF e = DUT_LANG_enum_member_unique_beside_shared_a.emub_y THEN\n\tout := INT#4;\nEND_IF",
    twoEnums("enum_member_unique_beside_shared", "emub")),
  // …in the contexts a store, a comparison and a CASE label do not cover (step 3.3 review, 2026-10-02)
  fb("enum_same_member_var_initializer", "EN3 — `x` bare as the VAR initializer of an A, two enums declaring it: A's (out 3) or ambiguous?",
    "\te : DUT_LANG_enum_same_member_var_initializer_a := esmv_x;\n\tout : INT;",
    "IF e = DUT_LANG_enum_same_member_var_initializer_a.esmv_x THEN\n\tout := INT#3;\nELSE\n\tout := INT#5;\nEND_IF",
    twoEnums("enum_same_member_var_initializer", "esmv")),
  fb("enum_same_member_call_argument", "EN3 — `x` bare as a named argument to a FUNCTION's A input, two enums declaring it: A's (out 3) or ambiguous?",
    "\tout : INT;", "out := FUN_LANG_esma(a := esma_x);",
    twoEnums("enum_same_member_call_argument", "esma") +
      "FUNCTION FUN_LANG_esma : INT\nVAR_INPUT\n\ta : DUT_LANG_enum_same_member_call_argument_a;\nEND_VAR\nIF a = DUT_LANG_enum_same_member_call_argument_a.esma_x THEN\n\tFUN_LANG_esma := 3;\nELSE\n\tFUN_LANG_esma := 5;\nEND_IF\nEND_FUNCTION\n\n"),
  fb("enum_same_member_array_index", "EN3 — `x` bare as an array index, two enums declaring it: 3, 5, or ambiguous?",
    "\tarr : ARRAY[0..9] OF INT := [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];\n\tout : INT;", "out := arr[esmx_x];",
    twoEnums("enum_same_member_array_index", "esmx")),

  // ─── EN4 an implicit enum's values ────────────────────────────────────────────────────────────────────────────────
  fb("enum_implicit_member_in_method", "EN4 — an implicit enum declared in the FB's VAR, its value read bare in a METHOD of the FB",
    "\tstate : (eimm_a, eimm_b, eimm_c);\n\tout : INT;", "out := M();", "",
    "METHOD M : INT\nstate := eimm_c;\nIF state = eimm_c THEN\n\tM := INT#7;\nEND_IF\nEND_METHOD\n"),
  fb("enum_implicit_member_in_other_pou", "EN4 — an implicit enum's value read bare in ANOTHER FB than the one declaring it",
    "\tout : BOOL;", "out := TRUE;\nIF eimo_b = eimo_b THEN\n\tout := FALSE;\nEND_IF",
    "FUNCTION_BLOCK FB_LANG_enum_implicit_member_in_other_pou_owner\nVAR\n\tstate : (eimo_a, eimo_b);\nEND_VAR\nEND_FUNCTION_BLOCK\n\n"),
  fb("enum_implicit_vs_type_enum", "EN4/EN3 — `x` bare where the FB's implicit enum and a DUT enum both declare it, stored to the implicit one",
    "\tstate : (eivt_w, eivt_x);\n\tout : INT;", "state := eivt_x;\nIF state = eivt_x THEN\n\tout := INT#1;\nEND_IF",
    enumType("enum_implicit_vs_type_enum", "a", ["eivt_x := 3", "eivt_y := 4"])),

  // ─── EN5 an enum member against a variable of the same name ──────────────────────────────────────────────────────
  fb("enum_member_vs_variable", "EN5 — `x` bare where the FB declares a VAR `x : INT := 5` and an enum declares member `x := 3`: the variable (out 5)?",
    "\temvv_x : INT := 5;\n\tout : INT;", "out := emvv_x;", enumType("enum_member_vs_variable", "a", ["emvv_x := 3", "emvv_y := 4"])),
  deferLsp(withList(fb("enum_member_vs_global", "EN5 — `x` bare where a global `x : INT := 5` and an enum member `x := 3` share the name: the global (out 5)?",
    "\tout : INT;", "out := emvg_x;", enumType("enum_member_vs_global", "a", ["emvg_x := 3", "emvg_y := 4"])), "\temvg_x : INT := 5;"),
    "2026-10-02 niche: accepted loss (0 occurrences in the corpora): a project global and a project enum member of one name are \"Ambiguous use of name\" on both vendors — the members sit at the globals' step of the search order; the LSP's lookup answers the global (`support/divergences.ts` `ENUM_DIVERGENCES`)"),
  fb("enum_member_vs_variable_enum_store", "EN5 — `x` bare stored to an enum-typed variable, where a local INT `x` and the enum's member `x` share the name",
    "\temve_x : INT := 4;\n\te : DUT_LANG_enum_member_vs_variable_enum_store_a;\n\tout : INT;",
    "e := emve_x;\nIF e = DUT_LANG_enum_member_vs_variable_enum_store_a.emve_x THEN\n\tout := INT#3;\nELSE\n\tout := INT#4;\nEND_IF",
    enumType("enum_member_vs_variable_enum_store", "a", ["emve_x := 3", "emve_y := 4"])),
  deferLsp(fb("enum_member_vs_function_name", "EN5 — `F()` where a FUNCTION `F` and an enum member `F := 3` share the name: the function (out 7)?",
    "\tout : INT;", "out := FUN_LANG_emvf();",
    enumType("enum_member_vs_function_name", "a", ["FUN_LANG_emvf := 3", "emvf_y := 4"]) +
      "FUNCTION FUN_LANG_emvf : INT\nFUN_LANG_emvf := 7;\nEND_FUNCTION\n\n"),
    "2026-10-02 niche: accepted loss (0 occurrences in the corpora): the enum member is what the name means — \"Program name, function or function block instance expected instead of 'F'\" on both vendors, a member before a POU name; the LSP calls the FUNCTION (`support/divergences.ts` `ENUM_DIVERGENCES`)"),
  fb("enum_member_vs_method_local", "EN5 — `x` bare in a METHOD declaring a local `x : INT := 6` beside an enum member `x := 3`: the local (out 6)?",
    "\tout : INT;", "out := M();", enumType("enum_member_vs_method_local", "a", ["emvm_x := 3", "emvm_y := 4"]),
    "METHOD M : INT\nVAR\n\temvm_x : INT := 6;\nEND_VAR\nM := emvm_x;\nEND_METHOD\n"),

  // ─── EN6 a library enum's members — the application's DIRECT references only (Util, StringUtils: a transitive one is
  // LB's question, 3.4 — CommFB's `IO_SYSTEM_TYPE` is "Unknown type" bare). Util's GEN_MODE (TRIANGLE := 0 …
  // SAWTOOTH_RISE := 2, SAWTOOTH_FALL := 3 … COSINUS := 6) bare, its WEEKDAY qualified ────────────────────────────────
  fb("enum_library_bare", "EN6 — a library enum's member bare: Util's `SAWTOOTH_RISE` stored to a GEN_MODE",
    "\tg : GEN_MODE;\n\tout : INT;", "g := SAWTOOTH_RISE;\nIF g = GEN_MODE.SAWTOOTH_RISE THEN\n\tout := INT#2;\nEND_IF"),
  fb("enum_library_qualified", "EN6 — a library enum's member by its type: `WEEKDAY.WEDNESDAY`",
    "\tw : WEEKDAY;\n\tout : INT;", "w := WEEKDAY.WEDNESDAY;\nIF w = WEEKDAY.WEDNESDAY THEN\n\tout := INT#3;\nEND_IF"),
  fb("enum_library_namespace_qualified", "EN6 — a library enum's member by namespace and type: `Util.WEEKDAY.THURSDAY`",
    "\tw : Util.WEEKDAY;\n\tout : INT;", "w := Util.WEEKDAY.THURSDAY;\nIF w = Util.WEEKDAY.THURSDAY THEN\n\tout := INT#4;\nEND_IF"),
  fb("enum_library_bare_into_int", "EN6 — a library enum's member bare where no enum is expected: Util's `SAWTOOTH_FALL` stored to an INT",
    "\tout : INT;", "out := SAWTOOTH_FALL;"),
  // DONE: Util's _STATE (DONE = 5) and StringUtils' EPLACEHOLDERANALYZATIONSTATE (DONE := 16#10) both declare it
  fb("enum_library_same_member_two_libraries", "EN6/EN3 — `DONE` bare, which Util's _STATE (5) and StringUtils' EPLACEHOLDERANALYZATIONSTATE (16) both declare, stored to a _STATE",
    "\te : Util._STATE;\n\tout : INT;", "e := DONE;\nIF e = Util._STATE.DONE THEN\n\tout := INT#5;\nELSE\n\tout := INT#16;\nEND_IF"),
  // UNKNOWN: Util's WEEKDAY, PERIOD and _STATE all declare it (= 0)
  fb("enum_library_same_member_one_library", "EN6/EN3 — `UNKNOWN` bare, which three enums of Util declare, stored to a WEEKDAY",
    "\tw : WEEKDAY := WEEKDAY.MONDAY;\n\tout : INT;", "w := UNKNOWN;\nIF w = WEEKDAY.UNKNOWN THEN\n\tout := INT#1;\nEND_IF"),
  // TUESDAY: Util's WEEKDAY member (2) and its list DAY_FLAGS' global (TUESDAY : DAYS := 2)
  deferLsp(fb("enum_library_member_vs_library_global", "EN6/EN5 — `TUESDAY` bare, Util's WEEKDAY member and a global of Util's list DAY_FLAGS, stored to a WEEKDAY",
    "\tw : WEEKDAY;\n\tout : INT;", "w := TUESDAY;\nIF w = WEEKDAY.TUESDAY THEN\n\tout := INT#2;\nEND_IF"),
    "2026-10-02 niche: accepted loss (0 occurrences in the corpora): \"Identifier 'TUESDAY' not defined\" — a library's global beside its enum member, or a list that requires qualified access, which the manifest does not say (3.1's `sym_library_gvl_needs_qualification`); the LSP's lookup answers the global (`support/divergences.ts` `ENUM_DIVERGENCES`)"),
  fb("enum_library_member_vs_project_enum", "EN6/EN3 — `COSINUS` bare where Util's GEN_MODE (COSINUS := 6) and a project enum (COSINUS := 9) both declare it, stored to the project's",
    "\te : DUT_LANG_enum_library_member_vs_project_enum_a;\n\tout : INT;",
    "e := COSINUS;\nIF e = DUT_LANG_enum_library_member_vs_project_enum_a.COSINUS THEN\n\tout := INT#9;\nELSE\n\tout := INT#6;\nEND_IF",
    enumType("enum_library_member_vs_project_enum", "a", ["COSINUS := 9", "elmp_y := 10"])),

  // EN5 ACROSS THE LIBRARY BOUNDARY — a project POU named like a referenced library's enum member: pro2193's PROGRAM `HMI`
  // (CAA Device Diagnosis' DEVICE_TYPE.HMI, 85 uses) and FUNCTION `Round` (2). Util's GEN_MODE SINE := 7, RECTANGLE := 4.
  // Measured (CODESYS 2026-10-02): the open library's MEMBER is what the name means, before the project POU — "Program
  // name, function or function block instance expected instead of 'SINE'", as `enum_member_vs_function_name` is for a
  // project enum. pro2193 builds clean with 87 such names, so those libraries' members are no candidates there (CAA
  // Device Diagnosis, a Lenze library — qualified access, unmeasured) — a fact the manifest does not carry (LB2, 3.4.2). Implementing the
  // member-first rule without it would refuse all 87 (`fixtures.test.ts` `MEASURED_SILENT`, `support/divergences.ts`
  // `CODESYS_ENUM_DIVERGENCES`; TwinCAT, which references no Util, builds both).
  fb("enum_library_member_vs_project_function", "EN5/EN6 — `SINE()` where a project FUNCTION `SINE` and Util's GEN_MODE member `SINE` share the name: the function (out 11)?",
    "\tout : INT;", "out := SINE();", "FUNCTION SINE : INT\nSINE := 11;\nEND_FUNCTION\n\n"),
  fb("enum_library_member_vs_project_program", "EN5/EN6 — `RECTANGLE.v` where a project PROGRAM `RECTANGLE` and Util's GEN_MODE member `RECTANGLE` share the name: the program's variable (out 12)?",
    "\tout : INT;", "RECTANGLE();\nout := RECTANGLE.v;", "PROGRAM RECTANGLE\nVAR\n\tv : INT := 12;\nEND_VAR\nEND_PROGRAM\n\n"),
  // A member a DIRECT open library's enum declares (Util's _STATE) and a CAA one too (CAA Device Diagnosis' PROC_STATE):
  // whether a CAA library's members are candidates at all, and which libraries are direct, is LB2's (3.4.2). The first
  // recording asked `NO_ERROR` (Util's ERROR, CAA Device Diagnosis' and the dependency-only CAA Types'): CODESYS said
  // "Identifier 'NO_ERROR' not defined" — but a fixture's project enum (`DUT_CS_kernelError`) declares it too, so the
  // replay could not ask it; `ABORTED` is no fixture's
  fb("enum_library_member_direct_vs_caa", "EN6/LB2 — `ABORTED` bare stored to a Util._STATE, where CAA Device Diagnosis' PROC_STATE declares it too: Util's (out 1) or not defined?",
    "\te : Util._STATE := Util._STATE.DONE;\n\tout : INT;", "e := ABORTED;\nIF e = Util._STATE.ABORTED THEN\n\tout := INT#1;\nEND_IF"),

  // A body the vendor does not compile: pro2193's uninstanced `Magazine_BeursFB` reads an `i` its methods do not declare
  // (a Lenze library enum's member `I` is the one candidate) and the project builds. Neither cell says anything on
  // CODESYS — nothing instances the FB, so nothing of it is checked (as `compiled.ts` measured for overrides)
  uninstanced(fb("enum_library_bare_uninstanced", "EN6 — Util's `SAWTOOTH_RISE` bare in an FB NOTHING instances",
    "\tg : GEN_MODE;\n\tout : INT;", "g := SAWTOOTH_RISE;\nIF g = GEN_MODE.SAWTOOTH_RISE THEN\n\tout := INT#2;\nEND_IF")),
  uninstanced(fb("enum_undeclared_name_uninstanced", "a name NOTHING declares, read in an FB NOTHING instances",
    "\tout : INT;", "out := eunu_nothing;")),
]
