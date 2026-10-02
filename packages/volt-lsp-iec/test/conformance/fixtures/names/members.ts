/**
 * MEMBERS, RULE BY RULE — design.md §4 3.5 of openspec `frontend-conformance` (M1–M6; task 3.5), each rule the recorded
 * fixtures elsewhere left a GAP in put to the vendor by fixtures of its own: `record:language` for accept/refuse and the
 * vendor's words, `record:exec` for WHICH member a name reached (every FB below that builds copies what it reads into
 * `out`, so the run recording holds `inst_<name>.out`).
 *
 *   M1  an unknown member, off every base a member is read from: an FB instance (a variable, a METHOD), a REFERENCE TO
 *       one, a POINTER TO one dereferenced, an interface
 *   M3  members through a REFERENCE TO an FB (a variable read and written, a METHOD, a PROPERTY, a STRUCT field), a
 *       POINTER TO one dereferenced (a METHOD with a result; a POINTER TO POINTER), a pointer read WITHOUT `^`; a call
 *       of an instance reached through a REFERENCE, an array element and SUPER^ with a parameter it does not declare
 *   M6  access modifiers, cell by cell: PRIVATE, PROTECTED, INTERNAL and PUBLIC METHODs and PROPERTYs, reached from the
 *       declaring FB's own body (bare and through THIS^), from a derived FB (bare and through SUPER^), from outside
 *       through an instance, a REFERENCE, a POINTER and an interface; and whether a refused member still RESOLVES — its
 *       result typed, its parameters bound
 *
 * M2 (UNION), M4 (a PROPERTY through an interface, read and written) and M5 (CONSTANT symbols fold) are recorded
 * elsewhere: `type_dut_union`, `xo_union_across_objects`, `itf_property_through_interface`, `named_const_*`,
 * `cfold_global_list`.
 *
 * GLOBAL NAMES ARE THE FIXTURE'S OWN (`…_<name>`): the replay binds every fixture into one project.
 */
import type { LanguageTest } from "../../types.js"

const doc = "frontend-conformance design.md §4 3.5 (members); docs/codesys-reference/09-shadowing.md"

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

/** `METHOD [mod] M : INT` answering `k * 2` (14 over `k := 7`). */
const methodM = (mod = ""): string => `METHOD ${mod ? `${mod} ` : ""}M : INT\nM := k * INT#2;\nEND_METHOD\n`
/** `PROPERTY [mod] P : INT` reading `k + 1` (8 over `k := 7`) and writing `k`. */
const propertyP = (mod = ""): string =>
  `PROPERTY ${mod ? `${mod} ` : ""}P : INT\nGET\nP := k + INT#1;\nEND_GET\nSET\nk := P;\nEND_SET\nEND_PROPERTY\n`

/** An FB `FB_LANG_<name>_sub` holding `k : INT := 7` and the METHOD/PROPERTY units `members`, written ahead of the
 *  fixture's FB, which reaches it from outside. */
const sub = (name: string, members: string): string =>
  `FUNCTION_BLOCK FB_LANG_${name}_sub\nVAR\n\tk : INT := 7;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n${members}${members ? "\n" : ""}`

/** `fb` reaching an instance `sb` of `FB_LANG_<name>_sub` (holding `members`) through `extraVars` and `body`. */
const outside = (name: string, feature: string, members: string, extraVars: string, body: string): LanguageTest =>
  fb(name, feature, `\tsb : FB_LANG_${name}_sub;\n${extraVars}\tout : INT;`, body, sub(name, members))

/** An FB `FB_LANG_<name>_base` holding `k : INT := 7` and the units `members`, and the fixture's FB EXTENDS it with
 *  `vars`/`body`, its own units `after`. */
const derived = (name: string, feature: string, members: string, vars: string, body: string, after = ""): LanguageTest =>
  fb(name, feature, vars, body,
    `FUNCTION_BLOCK FB_LANG_${name}_base\nVAR\n\tk : INT := 7;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n${members}\n`, after,
    ` EXTENDS FB_LANG_${name}_base`)

/** The fixture's FB itself holds `k : INT := 7` and the units `members`, and reads them from its own body. */
const own = (name: string, feature: string, members: string, body: string, vars = ""): LanguageTest =>
  fb(name, feature, `\tk : INT := 7;\n${vars}\tout : INT;`, body, "", members)

/** `t`, whose refusal the LSP does not make — the reason, dated (`deferred.lsp`). */
function deferLsp(t: LanguageTest, reason: string): LanguageTest {
  return { ...t, deferred: { lsp: reason } }
}

const NO_CODE_NUMBER =
  "niche: accepted loss (0 occurrences in the corpora of a refused access: they build — though pro2193's own Application declares 525 PRIVATE/PROTECTED/INTERNAL members, 524 METHODs and 1 PROPERTY, user code, not a referenced library's) (2026-10-02, counts corrected 2026-10-03) — both vendors' words are recorded and the member still resolves (its result typed, its parameters bound, as the LSP does); not trivial: a wire diagnostic is a catalog `Cnnnn` (`server/diagnostic-codes.ts` admits no new slug) — a METHOD's refusal has none, and the PROPERTY ones (C0513/C0515) document another, unverified sentence (`support/divergences.ts` `MEMBER_DIVERGENCES`)"

/** An interface METHOD's implementation declared PRIVATE: "Implementation of interface method 'M' of function block
 *  '…' must be PUBLIC" (TwinCAT "functionblock"), both vendors 2026-10-02. */
const NOT_PUBLIC_NO_CODE_NUMBER =
  "niche: accepted loss (0 occurrences in the corpora: they build — no interface METHOD implemented PRIVATE or PROTECTED, beside pro2193's 513 PRIVATE/PROTECTED METHODs of its own) (2026-10-02, counts corrected 2026-10-03) — both vendors' words are recorded; not trivial: a wire diagnostic is a catalog `Cnnnn` (`server/diagnostic-codes.ts` admits no new slug) which no build message carries (`support/divergences.ts` `MEMBER_DIVERGENCES`)"

export const MEMBER_RULE_TESTS: readonly LanguageTest[] = [
  // ─── M1 an unknown member, off each base a member is read from ─────────────────────────────────────────────────
  outside("mem_unknown_member_of_fb_instance", "M1 — `sb.nope`: a variable the instance's FB does not declare",
    "", "", "out := sb.nope;"),
  outside("mem_unknown_method_of_fb_instance", "M1 — `sb.Nope()`: a METHOD the instance's FB does not declare",
    methodM(), "", "out := sb.Nope();"),
  outside("mem_unknown_member_through_reference", "M1 — `rf.nope` through a REFERENCE TO the FB",
    "", "\trf : REFERENCE TO FB_LANG_mem_unknown_member_through_reference_sub;\n",
    "rf REF= sb;\nout := rf.nope;"),
  outside("mem_unknown_member_through_pointer", "M1 — `p^.nope` through a POINTER TO the FB",
    "", "\tp : POINTER TO FB_LANG_mem_unknown_member_through_pointer_sub;\n",
    "p := ADR(sb);\nout := p^.nope;"),
  fb("mem_unknown_method_of_interface", "M1 — `i.Nope()` through an interface that declares no such METHOD",
    "\tsb : FB_LANG_mem_unknown_method_of_interface_sub;\n\ti : ITF_LANG_mem_unknown_method_of_interface;\n\tout : INT;",
    "i := sb;\nout := i.Nope();",
    "INTERFACE ITF_LANG_mem_unknown_method_of_interface\nMETHOD M : INT\nEND_METHOD\nEND_INTERFACE\n\n" +
      "FUNCTION_BLOCK FB_LANG_mem_unknown_method_of_interface_sub IMPLEMENTS ITF_LANG_mem_unknown_method_of_interface\nVAR\n\tk : INT := 7;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n" +
      methodM() + "\n"),

  // ─── M3 members through a REFERENCE TO an FB and a POINTER TO one ──────────────────────────────────────────────
  // a variable read through the reference (7)
  outside("mem_reference_to_fb_member", "M3 — `rf.k`: an FB variable read through a REFERENCE TO the FB",
    "", "\trf : REFERENCE TO FB_LANG_mem_reference_to_fb_member_sub;\n", "rf REF= sb;\nout := rf.k;"),
  //   …written through it, read back off the instance (5)
  outside("mem_reference_to_fb_member_write", "M3 — `rf.k := 5`: an FB variable written through a REFERENCE TO the FB",
    "", "\trf : REFERENCE TO FB_LANG_mem_reference_to_fb_member_write_sub;\n", "rf REF= sb;\nrf.k := 5;\nout := sb.k;"),
  //   …a VAR_INPUT written through it, read back off the instance (5): `_member_write` above writes a VAR, which the
  //   vendor refuses from outside however it is reached ("'k' is no input of …", as `sb.k := 5` is)
  fb("mem_reference_to_fb_input_write", "M3 — `rf.kin := 5`: an FB's VAR_INPUT written through a REFERENCE TO the FB",
    "\tsb : FB_LANG_mem_reference_to_fb_input_write_sub;\n\trf : REFERENCE TO FB_LANG_mem_reference_to_fb_input_write_sub;\n\tout : INT;",
    "rf REF= sb;\nrf.kin := 5;\nout := sb.kin;",
    "FUNCTION_BLOCK FB_LANG_mem_reference_to_fb_input_write_sub\nVAR_INPUT\n\tkin : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n"),
  //   …a METHOD called through it (14)
  outside("mem_reference_to_fb_method", "M3 — `rf.M()`: a METHOD called through a REFERENCE TO the FB",
    methodM(), "\trf : REFERENCE TO FB_LANG_mem_reference_to_fb_method_sub;\n", "rf REF= sb;\nout := rf.M();"),
  //   …a parameter it does not declare, at a METHOD called through it
  outside("mem_reference_to_fb_method_unknown_param", "M3 — `rf.M(zz := 1)`: a METHOD through a REFERENCE TO the FB, given a parameter it does not declare",
    methodM(), "\trf : REFERENCE TO FB_LANG_mem_reference_to_fb_method_unknown_param_sub;\n", "rf REF= sb;\nout := rf.M(zz := 1);"),
  //   …a PROPERTY read through it (8)
  outside("mem_reference_to_fb_property", "M3 — `rf.P`: a PROPERTY read through a REFERENCE TO the FB",
    propertyP(), "\trf : REFERENCE TO FB_LANG_mem_reference_to_fb_property_sub;\n", "rf REF= sb;\nout := rf.P;"),
  //   …the instance itself called through it, with an input it does not declare
  outside("mem_reference_to_fb_call_unknown_param", "M3 — `rf(zz := 1)`: the FB instance called through a REFERENCE TO it, with an input it does not declare",
    "", "\trf : REFERENCE TO FB_LANG_mem_reference_to_fb_call_unknown_param_sub;\n", "rf REF= sb;\nrf(zz := 1);\nout := sb.k;"),
  //   …and the wording of an unknown named argument by what the callee is, which `_method_unknown_param` above
  //   (a METHOD with no input: "Function 'M' requires exactly '0' inputs") and `inh_interface_method_unknown_param` (an
  //   interface METHOD with one: "'zz' is no input of 'M'") answered differently: a METHOD with one input, with none,
  //   with one given beside the unknown name, and a FUNCTION with one input and with none
  outside("mem_method_unknown_param_one_input", "M3/E21 — `sb.M1(zz := 1)`: a METHOD with one VAR_INPUT, given a parameter it does not declare",
    "METHOD M1 : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nM1 := a + k;\nEND_METHOD\n", "", "out := sb.M1(zz := 1);"),
  outside("mem_method_unknown_param_no_input", "M3/E21 — `sb.M(zz := 1)`: a METHOD with no input, given a parameter it does not declare",
    methodM(), "", "out := sb.M(zz := 1);"),
  outside("mem_method_unknown_param_beside_known", "M3/E21 — `sb.M1(a := 1, zz := 2)`: a METHOD's one VAR_INPUT given, and a parameter it does not declare beside it",
    "METHOD M1 : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nM1 := a + k;\nEND_METHOD\n", "", "out := sb.M1(a := 1, zz := 2);"),
  fb("mem_function_unknown_param_one_input", "M3/E21 — `F(zz := 1)`: a FUNCTION with one VAR_INPUT, given a parameter it does not declare",
    "\tout : INT;", "out := F_LANG_mem_function_unknown_param_one_input(zz := 1);",
    "FUNCTION F_LANG_mem_function_unknown_param_one_input : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nF_LANG_mem_function_unknown_param_one_input := a;\nEND_FUNCTION\n\n"),
  fb("mem_function_unknown_param_no_input", "M3/E21 — `F(zz := 1)`: a FUNCTION with no input, given a parameter it does not declare",
    "\tout : INT;", "out := F_LANG_mem_function_unknown_param_no_input(zz := 1);",
    "FUNCTION F_LANG_mem_function_unknown_param_no_input : INT\nVAR\n\tt : INT;\nEND_VAR\nF_LANG_mem_function_unknown_param_no_input := 3;\nEND_FUNCTION\n\n"),
  // a STRUCT field read through a REFERENCE TO the struct (4)
  fb("mem_reference_to_struct_field", "M3 — `rf.x`: a STRUCT field read through a REFERENCE TO the struct",
    "\tv : DUT_LANG_mem_reference_to_struct_field;\n\trf : REFERENCE TO DUT_LANG_mem_reference_to_struct_field;\n\tout : INT;",
    "v.x := 4;\nrf REF= v;\nout := rf.x;",
    "TYPE DUT_LANG_mem_reference_to_struct_field :\nSTRUCT\n\tx : INT;\nEND_STRUCT\nEND_TYPE\n\n"),
  // a METHOD with a result called through a dereferenced POINTER TO the FB (14)
  outside("mem_pointer_deref_method", "M3 — `p^.M()`: a METHOD with a result called through a dereferenced POINTER TO the FB",
    methodM(), "\tp : POINTER TO FB_LANG_mem_pointer_deref_method_sub;\n", "p := ADR(sb);\nout := p^.M();"),
  //   …a variable through a POINTER TO POINTER TO the FB, dereferenced twice (7)
  outside("mem_pointer_to_pointer_member", "M3 — `pp^^.k`: an FB variable through a POINTER TO POINTER TO the FB",
    "", "\tp : POINTER TO FB_LANG_mem_pointer_to_pointer_member_sub;\n\tpp : POINTER TO POINTER TO FB_LANG_mem_pointer_to_pointer_member_sub;\n",
    "p := ADR(sb);\npp := ADR(p);\nout := pp^^.k;"),
  //   …a variable read off the POINTER without its `^`
  outside("mem_pointer_member_without_deref", "M3 — `p.k`: an FB variable read off a POINTER TO the FB without `^`",
    "", "\tp : POINTER TO FB_LANG_mem_pointer_member_without_deref_sub;\n", "p := ADR(sb);\nout := p.k;"),
  // an element of an array of instances called with an input it does not declare
  outside("mem_array_element_call_unknown_param", "M3 — `arr[1](zz := 1)`: an element of an array of FB instances called with an input it does not declare",
    "", "\tarr : ARRAY[1..2] OF FB_LANG_mem_array_element_call_unknown_param_sub;\n", "arr[1](zz := 1);\nout := arr[1].k;"),
  // SUPER^ called with an input the base does not declare
  derived("mem_super_call_unknown_param", "M3 — `SUPER^(zz := 1)`: the base FB's body called through SUPER^ with an input it does not declare",
    "", "\tout : INT;", "SUPER^(zz := 1);\nout := k;"),

  // ─── M6 access modifiers: METHODs ──────────────────────────────────────────────────────────────────────────────
  // from outside, through an instance: PRIVATE, PROTECTED, INTERNAL, PUBLIC
  deferLsp(outside("mem_private_member_resolves_then_refused", "M6 — `sb.M()` from outside the FB: a PRIVATE METHOD",
    methodM("PRIVATE"), "", "out := sb.M();"), NO_CODE_NUMBER),
  deferLsp(outside("mem_protected_method_from_outside", "M6 — `sb.M()` from outside the FB: a PROTECTED METHOD",
    methodM("PROTECTED"), "", "out := sb.M();"), NO_CODE_NUMBER),
  outside("mem_internal_method_from_outside", "M6 — `sb.M()` from outside the FB, in the same application: an INTERNAL METHOD (14)",
    methodM("INTERNAL"), "", "out := sb.M();"),
  outside("mem_public_method_from_outside", "M6 — `sb.M()` from outside the FB: a PUBLIC METHOD (14)",
    methodM("PUBLIC"), "", "out := sb.M();"),
  //   …the refused PRIVATE METHOD still RESOLVES: its INT result stored to a BOOL (the LSP says the conversion, not the
  //   refusal — not silent, so no `deferred.lsp`: `MEMBER_DIVERGENCES` holds the missing sentence)
  outside("mem_private_method_result_typed", "M6 — `b := sb.M()` with a PRIVATE `M : INT` from outside: is the refused call typed",
    methodM("PRIVATE"), "\tb : BOOL;\n", "b := sb.M();\nout := 1;"),
  //   …and its parameters bound: a name it does not declare
  outside("mem_private_method_unknown_param", "M6 — `sb.M(zz := 1)` with a PRIVATE M from outside: are the refused call's parameters bound",
    methodM("PRIVATE"), "", "out := sb.M(zz := 1);"),
  //   …through a REFERENCE and a POINTER
  deferLsp(outside("mem_private_method_via_reference", "M6 — `rf.M()` through a REFERENCE TO the FB: a PRIVATE METHOD",
    methodM("PRIVATE"), "\trf : REFERENCE TO FB_LANG_mem_private_method_via_reference_sub;\n", "rf REF= sb;\nout := rf.M();"), NO_CODE_NUMBER),
  deferLsp(outside("mem_private_method_via_pointer", "M6 — `p^.M()` through a POINTER TO the FB: a PRIVATE METHOD",
    methodM("PRIVATE"), "\tp : POINTER TO FB_LANG_mem_private_method_via_pointer_sub;\n", "p := ADR(sb);\nout := p^.M();"), NO_CODE_NUMBER),
  // from the declaring FB's own body: bare, through THIS^, through a POINTER TO another instance of its own type (14)
  own("mem_private_method_from_own_body", "M6 — `M()` in the declaring FB's own body: a PRIVATE METHOD (14)",
    methodM("PRIVATE"), "out := M();"),
  own("mem_private_method_via_this", "M6 — `THIS^.M()` in the declaring FB's own body: a PRIVATE METHOD (14)",
    methodM("PRIVATE"), "out := THIS^.M();"),
  own("mem_private_method_of_same_type_instance", "M6 — `pOther^.M()` in the declaring FB, through a POINTER TO an instance of its own type: a PRIVATE METHOD",
    methodM("PRIVATE"), "pOther := THIS;\nout := pOther^.M();", "\tpOther : POINTER TO FB_LANG_mem_private_method_of_same_type_instance;\n"),
  //   …from another METHOD of the declaring FB (14)
  own("mem_private_method_from_own_method", "M6 — `M()` in another METHOD of the declaring FB: a PRIVATE METHOD (14)",
    methodM("PRIVATE") + "\nMETHOD Outer : INT\nOuter := M();\nEND_METHOD\n", "out := Outer();"),
  // from a derived FB: bare and through SUPER^
  deferLsp(derived("mem_private_method_from_derived", "M6 — `M()` in an FB derived from the declaring FB: a PRIVATE METHOD",
    methodM("PRIVATE"), "\tout : INT;", "out := M();"), NO_CODE_NUMBER),
  deferLsp(derived("mem_private_method_via_super", "M6 — `SUPER^.M()` in an FB derived from the declaring FB: a PRIVATE METHOD",
    methodM("PRIVATE"), "\tout : INT;", "out := SUPER^.M();"), NO_CODE_NUMBER),
  derived("mem_protected_member_from_derived", "M6 — `M()` in an FB derived from the declaring FB: a PROTECTED METHOD (14)",
    methodM("PROTECTED"), "\tout : INT;", "out := M();"),
  derived("mem_protected_method_via_super", "M6 — `SUPER^.M()` in an FB derived from the declaring FB: a PROTECTED METHOD (14)",
    methodM("PROTECTED"), "\tout : INT;", "out := SUPER^.M();"),
  //   …and a PROTECTED METHOD the derived FB inherits, reached from OUTSIDE through an instance of the derived FB
  deferLsp(fb("mem_protected_inherited_from_outside", "M6 — `d.M()` from outside: a PROTECTED METHOD an instance's FB inherits",
    "\td : FB_LANG_mem_protected_inherited_from_outside_d;\n\tout : INT;", "out := d.M();",
    "FUNCTION_BLOCK FB_LANG_mem_protected_inherited_from_outside_base\nVAR\n\tk : INT := 7;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n" + methodM("PROTECTED") +
      "\nFUNCTION_BLOCK FB_LANG_mem_protected_inherited_from_outside_d EXTENDS FB_LANG_mem_protected_inherited_from_outside_base\nVAR\n\tj : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n"), NO_CODE_NUMBER),
  //   …two levels down: a PROTECTED METHOD of the grandparent, bare in the grandchild (14)
  fb("mem_protected_method_from_grandchild", "M6 — `M()` in an FB two levels below the declaring FB: a PROTECTED METHOD (14)",
    "\tout : INT;", "out := M();",
    "FUNCTION_BLOCK FB_LANG_mem_protected_method_from_grandchild_g\nVAR\n\tk : INT := 7;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n" + methodM("PROTECTED") +
      "\nFUNCTION_BLOCK FB_LANG_mem_protected_method_from_grandchild_p EXTENDS FB_LANG_mem_protected_method_from_grandchild_g\nVAR\n\tj : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n",
    "", " EXTENDS FB_LANG_mem_protected_method_from_grandchild_p"),
  // through an interface whose METHOD the FB implements as PRIVATE
  deferLsp(fb("mem_private_method_implementing_interface", "M6 — `i.M()` through an interface, where the FB implements M as a PRIVATE METHOD",
    "\tsb : FB_LANG_mem_private_method_implementing_interface_sub;\n\ti : ITF_LANG_mem_private_method_implementing_interface;\n\tout : INT;",
    "i := sb;\nout := i.M();",
    "INTERFACE ITF_LANG_mem_private_method_implementing_interface\nMETHOD M : INT\nEND_METHOD\nEND_INTERFACE\n\n" +
      "FUNCTION_BLOCK FB_LANG_mem_private_method_implementing_interface_sub IMPLEMENTS ITF_LANG_mem_private_method_implementing_interface\nVAR\n\tk : INT := 7;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n" +
      methodM("PRIVATE") + "\n"), NOT_PUBLIC_NO_CODE_NUMBER),

  // ─── M6 access modifiers: PROPERTYs ────────────────────────────────────────────────────────────────────────────
  deferLsp(outside("mem_private_property_from_outside", "M6 — `sb.P` read from outside the FB: a PRIVATE PROPERTY",
    propertyP("PRIVATE"), "", "out := sb.P;"), NO_CODE_NUMBER),
  deferLsp(outside("mem_private_property_write_from_outside", "M6 — `sb.P := 4` written from outside the FB: a PRIVATE PROPERTY",
    propertyP("PRIVATE"), "", "sb.P := 4;\nout := sb.k;"), NO_CODE_NUMBER),
  deferLsp(outside("mem_protected_property_from_outside", "M6 — `sb.P` read from outside the FB: a PROTECTED PROPERTY",
    propertyP("PROTECTED"), "", "out := sb.P;"), NO_CODE_NUMBER),
  outside("mem_internal_property_from_outside", "M6 — `sb.P` read from outside the FB, in the same application: an INTERNAL PROPERTY (8)",
    propertyP("INTERNAL"), "", "out := sb.P;"),
  own("mem_private_property_from_own_body", "M6 — `P` read in the declaring FB's own body: a PRIVATE PROPERTY (8)",
    propertyP("PRIVATE"), "out := P;"),
  deferLsp(derived("mem_private_property_from_derived", "M6 — `P` read in an FB derived from the declaring FB: a PRIVATE PROPERTY",
    propertyP("PRIVATE"), "\tout : INT;", "out := P;"), NO_CODE_NUMBER),
  derived("mem_protected_property_from_derived", "M6 — `P` read in an FB derived from the declaring FB: a PROTECTED PROPERTY (8)",
    propertyP("PROTECTED"), "\tout : INT;", "out := P;"),
]
