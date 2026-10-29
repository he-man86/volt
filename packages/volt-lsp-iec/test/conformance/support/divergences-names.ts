/**
 * THE NAMES' KNOWN DIVERGENCES — scopes, inheritance, members, enums, SFC steps, libraries: the fixtures whose recorded
 * answer the LSP does not give, each set with its reason. One concern of `divergences.ts`, which assembles
 * `KNOWN_DIVERGENCES` (openspec lsp-same-standard 4.4).
 */
/**
 * FRONTEND-CONFORMANCE 3.1 (2026-10-02) — scope and lookup fixtures (`fixtures/names/scopes.ts`) the LSP does not answer as
 * the vendors do, each niche or a fact the workspace does not hold:
 *   `sym_var_external_of_ambiguous_global` (both) — a VAR_EXTERNAL naming a global two lists declare: "Ambiguous use of
 *        name" at the declaration and at the use, the use undefined and its conversion a hole, and on CODESYS alone "No
 *        global definition found for VAR_EXTERNAL" (TwinCAT words the first in lower case). The LSP binds the external to
 *        the first list's (`symbols/scope-nav` `externalGlobal`) and says nothing. Niche: accepted loss (0 occurrences in
 *        the corpora — they hold no VAR_EXTERNAL at all).
 */
export const SCOPE_DIVERGENCES: readonly string[] = ["sym_var_external_of_ambiguous_global"]

/**
 *   `sym_library_gvl_needs_qualification` (CODESYS) — StringUtils' global `HALFSHIFT` read bare is "Identifier
 *        'HALFSHIFT' not defined": the library requires qualified access (search order step 7, `09-shadowing.md`), and
 *        whether a library does is a property its manifest does not carry (`.library`: NAMESPACE, RESOLUTION, PLACEHOLDER,
 *        SYSTEM, DEPENDENCIES — no qualified-access flag), so the LSP resolves a library's global bare. A bridge fact to
 *        export before the rule can be, never guessed per library. Niche: accepted loss (0 occurrences in the corpora: no
 *        project file reads a library's global bare).
 *   `sym_library_gvl_qualified_by_namespace` (CODESYS) — `Stu.HALFSHIFT` is "'STRINGUTILS, 3.5.20.0 (SYSTEM)' contains
 *        no definition for 'HALFSHIFT'": a library's namespace reaches its lists by name (`Stu.GVL_UTF8.HALFSHIFT` builds,
 *        `sym_library_gvl_qualified_fully`), not their variables. The LSP's namespace holds the variables too and says
 *        nothing — the message, worded from the library's RESOLUTION, it has never emitted. Niche: accepted loss (0
 *        occurrences in the corpora of a namespace-qualified library global).
 */
export const CODESYS_SCOPE_DIVERGENCES: readonly string[] = ["sym_library_gvl_needs_qualification", "sym_library_gvl_qualified_by_namespace"]

/**
 *   `sym_library_gvl_needs_qualification`, `sym_library_gvl_qualified_by_namespace`, `_by_list`, `_fully` (TwinCAT) —
 *        TwinCAT's fixture project references no StringUtils, so each is the library's ABSENCE ("Identifier 'Stu' / 'GVL_UTF8'
 *        / 'HALFSHIFT' not defined"); the replay binds the CODESYS fixture project's libraries for both vendors
 *        (`support/project-libraries.ts`), as every library fixture does. The question is CODESYS's.
 *   `sym_device_instance_bare` (TwinCAT) — TwinCAT's project has no device `Device` (its corpus mirror holds no `.device`
 *        descriptor) and says so as the LSP does, plus a third message for the ADR of the undefined name, "Unknown type:
 *        'Device'". Niche: accepted loss (0 occurrences in the corpora, which build).
 */
export const TWINCAT_SCOPE_DIVERGENCES: readonly string[] = [
  "sym_library_gvl_needs_qualification",
  "sym_library_gvl_qualified_by_namespace",
  "sym_library_gvl_qualified_by_list",
  "sym_library_gvl_qualified_fully",
  "sym_device_instance_bare",
]

/**
 * FRONTEND-CONFORMANCE 3.2 (2026-10-02) — inheritance fixtures (`fixtures/names/inheritance.ts`) whose refusal the LSP
 * does not make, both vendors:
 *   `inh_override_final_method` — an override of a base METHOD declared FINAL: "Function block 'D': No override possible
 *        on method B.M with access specifier FINAL" (TwinCAT: "No override possible on Method B.M with attribute FINAL");
 *   `inh_abstract_method_not_implemented` — a concrete FB leaving its base's ABSTRACT method unimplemented: "There is no
 *        implementation for ABSTRACT method 'M' defined in function block 'B'" (TwinCAT: "functionblock").
 * Niche: accepted loss (0 occurrences in the corpora — they build, holding 7 FINAL and 11 ABSTRACT methods). Not trivial:
 * a wire diagnostic is a catalog `Cnnnn` (`corpus/support/diagnostic-codes.ts` admits no new slug) and a build message carries
 * none, so emitting either waits for the number from the vendor's help.
 */
export const INHERITANCE_DIVERGENCES: readonly string[] = ["inh_override_final_method", "inh_abstract_method_not_implemented"]

/**
 * FRONTEND-CONFORMANCE 3.5 (2026-10-02) — member fixtures (`fixtures/names/members.ts`, rule M6) whose refusal the LSP
 * does not make, both vendors: an access modifier checked AFTER resolution — "Cannot access private method B.M"
 * (TwinCAT "private Method"), "Cannot access protected property B.P", the declaring FB named — from outside, from a
 * derived FB for PRIVATE, through a REFERENCE, a POINTER, SUPER^; and an interface METHOD implemented PRIVATE, "must be
 * PUBLIC". The member still RESOLVES on both sides: its result is typed ("Cannot convert type 'INT' to type 'BOOL'"
 * beside the refusal) and its parameters bound, as the LSP does. Niche: accepted loss (0 occurrences in the corpora of a
 * refused access — they build). The modifiers themselves are NOT rare and NOT library-only: pro2193's own Application
 * declares 525 PRIVATE/PROTECTED/INTERNAL members (524 METHODs — 163 PRIVATE, 350 PROTECTED, 11 INTERNAL — and 1
 * PROTECTED PROPERTY), 380 under `01 Main`…`04 Physical Interfaces` and 145 in its project-local `99 Library` folder,
 * none from a referenced library (counted 2026-10-03; the first note said "all library code", which was wrong). So an
 * edit reaching one from outside is a realistic mistake the LSP stays silent on — the loss is accepted, not absent.
 * Not trivial: a wire diagnostic is a catalog `Cnnnn` (`corpus/support/diagnostic-codes.ts` admits no new slug). A METHOD's
 * refusal ("Cannot access private method B.M") has none. The PROPERTY cells have catalog entries — C0513 private, C0514
 * internal, C0515 protected property access — but each documents another sentence ("Should not access private property
 * POU Prop") than the one recorded ("Cannot access private property B.P"), unverified on either vendor (`ide-only`), so
 * taking their number for the recorded refusal is a guess until a recording ties them; and the check itself needs the
 * enclosing FB's EXTENDS chain at every member reference (PRIVATE from a derived FB and through SUPER^, PROTECTED
 * inherited through a derived instance).
 */
export const MEMBER_DIVERGENCES: readonly string[] = [
  "mem_private_member_resolves_then_refused",
  "mem_protected_method_from_outside",
  "mem_private_method_result_typed",
  "mem_private_method_unknown_param",
  "mem_private_method_via_reference",
  "mem_private_method_via_pointer",
  "mem_private_method_from_derived",
  "mem_private_method_via_super",
  "mem_protected_inherited_from_outside",
  "mem_private_method_implementing_interface",
  "mem_private_property_from_outside",
  "mem_private_property_write_from_outside",
  "mem_protected_property_from_outside",
  "mem_private_property_from_derived",
]

/**
 * FRONTEND-CONFORMANCE 3.3 (2026-10-02) — enum fixtures (`fixtures/names/enums.ts`) the LSP does not answer as the vendors
 * do, both vendors alike (TwinCAT's capitals aside):
 *   `enum_same_member_comparison`, `enum_implicit_member_in_other_pou` — `IF e = x THEN` with `x` a name that names nothing
 *        (a member two enums declare; another POU's implicit enum's value): the LSP says what the vendors say of `x`, and
 *        misses "Expression of type 'BOOL' expected in this place" for the condition the hole leaves untyped. Not trivial:
 *        a wire diagnostic is a catalog `Cnnnn` (`corpus/support/diagnostic-codes.ts` admits no new slug) and the message has none
 *        in the catalog. Niche: accepted loss (0 occurrences in the corpora — they build).
 *   (`enum_member_vs_global` left 2026-10-06, analysis-conformance 3.5: a project global and an own enum's member of one
 *        name clash at the globals' step of the search order — `types/names` `globalClash`.)
 *   `enum_member_vs_function_name` — `F()` where an enum member is named `F` too: the member is what the name means ("Program
 *        name, function or function block instance expected instead of 'F'"), before the POU name; the LSP calls the
 *        FUNCTION. Niche: accepted loss (0 occurrences in the corpora of a project POU named like a project enum's member).
 *   `enum_library_member_vs_library_global` (CODESYS) — Util's `TUESDAY`, a WEEKDAY member and a global of its list
 *        DAY_FLAGS: "Identifier 'TUESDAY' not defined" (the library's ambiguity, or a list requiring qualified access — the
 *        manifest carries no such flag, 3.1's `sym_library_gvl_needs_qualification`); the LSP's `lookup` answers the global.
 *        Niche: accepted loss (0 occurrences in the corpora of a library global named like a library enum's member).
 *   `enum_same_member_call_argument`, `enum_same_member_array_index` (step 3.3 review, 2026-10-02) — a member two enums
 *        declare as a named argument, as an array index: the vendors add the hole's conversion INTO the parameter's type
 *        ('… to type ''DUT_…_A'') and INTO 'AnyInt' for the index, and say nothing of the store `arr[x]` sits in. The
 *        LSP gives the name's two messages, no conversion for the argument, and for the index treats `arr[x]` itself as
 *        the hole ('Unknown type: ''arr[x]''' into the INT). Not trivial (`hole.ts` decides what a hole is for every
 *        check). Niche: accepted loss (0 occurrences in the corpora — no bare name two project enums declare).
 *   `enum_library_member_vs_project_function`, `_program` (CODESYS, step 3.3 review, 2026-10-02) — Util's GEN_MODE member
 *        before a project FUNCTION / PROGRAM of its name: "Program name, function or function block instance expected
 *        instead of 'SINE'". The LSP answers the POU: which libraries' members are candidates at all (open, direct) is not in
 *        the manifest (LB2 — 3.4.2 recorded it a bridge fact, `CODESYS_LIBRARY_DIVERGENCES`), and pro2193 builds clean with 87 project POU names beside other libraries' members
 *        (CAA Device Diagnosis' `HMI`, a Lenze `Round`) — refusing without that fact would refuse all 87. TwinCAT's
 *        project references no Util and builds both, as the LSP answers.
 *   `enum_undeclared_name_uninstanced` — an FB nothing instances reads a name nothing declares: both vendors build it clean,
 *        an uncompiled POU has no diagnostics (`ir_initializer_warning_no_instance`'s reason); the replay analyses the file
 *        it is given, as an editor must — the server's dead-unit suppression (`analysis/reachability.ts`) is not the
 *        replay's.
 */
export const ENUM_DIVERGENCES: readonly string[] = [
  "enum_same_member_comparison",
  "enum_implicit_member_in_other_pou",
  "enum_member_vs_function_name",
  "enum_undeclared_name_uninstanced",
  "enum_same_member_call_argument",
  "enum_same_member_array_index",
]
/**
 * THE SFC CHART IS NOT IN THE TEXT — openspec `lsp-sfc-step-names`, recorded 2026-10-03 (`fixtures/names/sfc-steps.ts`).
 * A POU whose body is SFC has its chart's step names in scope, each an `IecSfc.SFCStepType`; Volt materializes the body as
 * `%LANGUAGE SFC UNSUPPORTED`, so no step list reaches the LSP. Since 2.1 it BETS (`src/frontend/types/infer/sfc-step.ts`,
 * DIALECT D40): a name read WITH A MEMBER in an SFC POU, or through its program or instance, that the POU
 * does not declare and that names nothing else with members, is a step. What the bet cannot see stays here: a step read
 * BARE, with no member to evidence it — `SIZEOF(S_Boot)` is "Identifier 'S_Boot' not defined" here and builds on CODESYS.
 * Niche: accepted loss (0 occurrences in the corpora — the six hold two SFC charts, the `VltFixtureSfc` stubs, and no code
 * reads a step of either); the fix is the chart's step list on the wire, an engine change. The REFUSALS the bet answers
 * otherwise (a step read bare as a value, a variable of a step's name, an action's flags, a typo the bet takes for a step)
 * carry `deferred.lsp` on the fixture, which holds each as an expected failure in the lsp-gap row — and since the step 2
 * review (S15) so do a typo read with a member no step has (`S_Bot.y`, worded as a step's unknown member) and a pointer
 * global that is no step read with a member (taken for one). CODESYS only: TwinCAT
 * has no recorder that can create an SFC POU, so its side is unanswered (`test/frontend/sources.ts` `unanswered`).
 */
export const SFC_STEPS_NOT_IN_SCOPE: readonly string[] = [
  "sfc_step_sizeof_adr",
  "sfc_step_bare_value",
  "sfc_step_declared_as_variable",
  "sfc_step_action_flag",
  "sfc_step_typo",
  "sfc_step_typo_qualified",
  "sfc_step_qualified_self_typo",
  "sfc_step_typo_other_member",
  "sfc_step_pointer_global_no_step",
]
export const CODESYS_ENUM_DIVERGENCES: readonly string[] = [
  "enum_library_member_vs_library_global",
  "enum_library_member_vs_project_function",
  "enum_library_member_vs_project_program",
]

/**
 *   `wp_named_argument_time`, `wp_named_argument_ltime` (openspec lsp-field-false-positives 8, class 3) — `TIME` and
 *        `LTIME` as a named argument (`t(TIME := TRUE)`): CODESYS reads the word as the CLOCK OPERATOR it also is and
 *        wants its `(` — "'(' expected instead of ':='", "',' or ')' expected instead of ';'", "'TIME' needs at least
 *        '0' operands", "Expression expected instead of ';'" — before the refusal the other type names draw; the LSP
 *        refuses it as every refused word ("Expression expected instead of 'TIME'"). The call reading of the two clock
 *        words outside a call is that rule's own question. Niche: accepted loss (0 named arguments spelled by a type
 *        name in the corpora — none builds). TwinCAT reads them as the clock operator too, in its two lines ("'(' expected
 *        instead of ':='", "',' or ')' expected instead of ';'"), and nothing after.
 */
export const WORD_POSITION_DIVERGENCES: readonly string[] = ["wp_named_argument_time", "wp_named_argument_ltime"]

/**
 *   every `enum_library_*` cell but the project-enum one, the two project-POU ones and the uninstanced one (TwinCAT) — TwinCAT's fixture project
 *        references no Util (and no StringUtils), so each is the library's ABSENCE ("Unknown type: 'GEN_MODE'", "Identifier
 *        'SAWTOOTH_RISE' not defined"); the replay binds the CODESYS fixture project's libraries for both vendors
 *        (`support/project-libraries.ts`), as `TWINCAT_SCOPE_DIVERGENCES` says. The question is CODESYS's.
 */
export const TWINCAT_ENUM_DIVERGENCES: readonly string[] = [
  "enum_library_bare",
  "enum_library_qualified",
  "enum_library_namespace_qualified",
  "enum_library_bare_into_int",
  "enum_library_same_member_two_libraries",
  "enum_library_same_member_one_library",
  "enum_library_member_vs_library_global",
  "enum_library_member_direct_vs_caa",
]

/**
 * FRONTEND-CONFORMANCE 3.4 (2026-10-02) — library fixtures (`fixtures/names/libraries.ts`) CODESYS refuses and the LSP
 * accepts, each a fact the workspace does not hold, each niche: accepted loss (0 occurrences in the corpora, which build):
 *   `lib_ns_transitive_bare`, `lib_ns_transitive_namespace`, `lib_ns_qualified_access_library_bare` — CommFB's enum bare or
 *        by CommFB's own namespace, DED's `DEVICE_STATE` bare: "Unknown type". CommFB is a dependency of CAA Device
 *        Diagnosis, no reference of the APPLICATION, and DED's elements are reached only qualified; the manifest carries
 *        neither fact (`.library`: NAMESPACE, RESOLUTION, PLACEHOLDER, SYSTEM, DEPENDENCIES).
 *   `lib_ns_type_name_two_libraries_other_member` — bare `ERROR` is Util's, DED's no candidate (the same fact): DED's
 *        `TIME_OUT` "is no component of 'ERROR'". The LSP ranks Util and DED alike and takes DED's by the URI tiebreak.
 *   `lib_ns_direct_dependency_only` — `DED.IO_SYSTEM_TYPE`: DED's namespace does not reach CommFB, a dependency it does not
 *        PUBLISH, while 51 corpus references reach a published dependency's element through a namespace
 *        (`L_IE1P.L_IE1P_SeverityLevel`); which dependencies are published the manifest does not say (rule LB2).
 *   `lib_ns_library_internal_function_bare`, `_qualified` — Util's LEAPYEARS is INTERNAL ("Identifier 'LEAPYEARS' not
 *        defined"; "Cannot access internal object LeapYears of library util, 3.5.21.0 (system)"); its materialized
 *        declaration does not say so.
 *   `lib_ns_library_gvl_shared_list_name_bare` — `CONSTANTS.v`, a list name Util's and StringUtils' lists both carry:
 *        "Ambiguous use of name 'CONSTANTS'"; which libraries' lists are candidates is the application's references.
 */
export const CODESYS_LIBRARY_DIVERGENCES: readonly string[] = [
  "lib_ns_transitive_bare",
  "lib_ns_transitive_namespace",
  "lib_ns_qualified_access_library_bare",
  "lib_ns_type_name_two_libraries_other_member",
  "lib_ns_direct_dependency_only",
  "lib_ns_library_internal_function_bare",
  "lib_ns_library_internal_function_qualified",
  "lib_ns_library_gvl_shared_list_name_bare",
]

/**
 *   every `lib_ns_*` cell but the three a project unit answers (TwinCAT) — TwinCAT's fixture project references none of
 *        these libraries (no Util, no CAA Device Diagnosis), so each is the library's ABSENCE ("Unknown type: 'Util.ERROR'",
 *        "Identifier 'Util' not defined"); the replay binds the CODESYS fixture project's libraries for both vendors
 *        (`support/project-libraries.ts`), as `TWINCAT_SCOPE_DIVERGENCES` says. The question is CODESYS's.
 *   `cv_library_enum_type` (frontend-conformance 4.5.1) — the same absence: "Unknown type: 'WEEKDAY'" and
 *        'EDATETIMEPLACEHOLDER' (Util's and StringUtils' enums); CODESYS agrees exactly.
 */
export const TWINCAT_LIBRARY_DIVERGENCES: readonly string[] = [
  "cv_library_enum_type",
  // frontend-conformance 4.7.4: `txt := Util` — "Identifier 'Util' not defined" (CODESYS agrees exactly: 'UTIL')
  "dt_namespace_static_base",
  "lib_ns_type_qualified",
  "lib_ns_type_qualified_other_library",
  "lib_ns_type_name_two_libraries",
  "lib_ns_type_name_two_libraries_other_member",
  "lib_ns_qualified_access_library_bare",
  "lib_ns_qualified_access_library_qualified",
  "lib_ns_library_member_own_type",
  "lib_ns_library_member_own_type_other_enum",
  "lib_ns_library_internal_function_bare",
  "lib_ns_library_internal_function_qualified",
  "lib_ns_same_name_two_libraries",
  "lib_ns_transitive_bare",
  "lib_ns_direct_dependency_only",
  "lib_ns_transitive_namespace",
  "lib_ns_transitive_qualification",
  "lib_ns_transitive_qualification_call",
  "lib_ns_library_gvl_member",
  "lib_ns_library_gvl_shared_list_name",
  "lib_ns_library_gvl_shared_list_name_bare",
]
