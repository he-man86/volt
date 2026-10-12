/**
 * WHICH FIXTURES DO NOT MATCH, AND WHY — the two triage backlogs and the two divergence sets, as data.
 *
 * They lived in the fixture gate, which is where they are ASSERTED (`lsp-replay.test.ts`, `map.test.ts`). They are read in more than one place
 * now — `scripts/agreement-residue.ts` has to skip a documented divergence or its work list is mostly device
 * facts — and a second copy of a list whose whole value is that it only shrinks would be the worst possible
 * duplication. So the lists live here and the gates import them.
 *
 * One file per concern (openspec lsp-same-standard 4.4): the triage backlogs are `divergences-triage.ts`, the transpiler's
 * accepted run divergences `divergences-transpile.ts`, and the sets this file assembles into `KNOWN_DIVERGENCES` are
 * `divergences-grammar.ts`, `-units`, `-declarations`, `-names` and `-types`, each set beside its reason.
 */
import type { Vendor } from "../../../src/analysis/index.js"
import * as declarations from "./divergences-declarations.js"
import * as grammar from "./divergences-grammar.js"
import * as names from "./divergences-names.js"
import * as types from "./divergences-types.js"
import * as units from "./divergences-units.js"

/**
 * A NAME THE IDE REFUSES TO CREATE, AND THE LSP DOES NOT SAY SO — openspec bridge-refusal-review 3.1 / DIALECT C28
 * (review 5+6). The push no longer judges a name (`StReader.IsIdentifier` went); each driver's `RefusedName` answers the
 * vendors' measured create rule: no ASCII identifier is refused by both IDEs for a POU and every member kind, and CODESYS
 * CREATES a backtick-quoted name, which TwinCAT refuses. Such a fixture carries `vendorRefuses`, so it has no build to
 * replay and the agreement gate never sees it; this list is where the LSP's side is written down. The LSP models no
 * create refusal by name — the 1092 measured reserved words neither (`parse/parser.test.ts`, "a unit header takes all
 * nine as its name") — so on `METHOD My-Name` it gives a message with the wrong cause (the stray `-Name : BOOL` reads as
 * code above the IMPLEMENTATION line: "an IMPLEMENTATION line inside a body"), and on TwinCAT it is silent on a
 * backtick name. Niche: accepted loss (0 occurrences in the corpora — no POU or member header in the six names itself
 * outside an ASCII identifier, and none with a backtick). Each entry is the vendor's own sentence the LSP would have to
 * say; `transpile-replay.test.ts` holds each as an expected failure, so the day the LSP says it, the entry must go.
 */
export const CREATE_REFUSAL_BY_NAME_NOT_MODELLED: Record<Vendor, Readonly<Record<string, string>>> = {
  codesys: { rcc_member_name_not_identifier: "The name 'My-Name' is not valid for this object." },
  twincat: {
    rcc_member_name_not_identifier: "Creating the child named 'My-Name' is not possible on node (Name mismatch)",
    rcc_member_backtick_name: "Creating the child named '`a b`' is not possible on node (Name mismatch)",
  },
}

export const KNOWN_DIVERGENCES: Record<Vendor, ReadonlySet<string>> = {
  // `cc_vg_undefined_label` was listed here once, when TwinCAT said nothing about a network-text JMP to a missing label
  // (measured 2026-07-07 on v1 text). Census 1.15 re-measured it on v2 text and TwinCAT DOES report it, with a trailing
  // full stop; the label checks use the ST label messages (`jumpLabelUndefined`) on both vendors — no divergence left.
  //   `op_sys_varinfo` — the TwinCAT RECORDING is truncated, not the behaviour: it stores `The code '.size;` with no
  //                       closing quote, where CODESYS stores the whole sentence including the line break it quotes.
  //                       The message is cut at that break on the way out of the TwinCAT driver — a BRIDGE bug to
  //                       fix and re-record, not something for the LSP to match.
  //   THE SAME FIVE REASONS CODESYS ALREADY HAS, now checked against TwinCAT's own recording rather than
  //   assumed from its twin (2026-09-20). Each was on the triage backlog as if it were a false positive:
  //   `cc2_var_in_interface`, `itf_var_section_declaration`, `ir_initializer_warning_no_instance` — TwinCAT
  //                       builds all three CLEAN, exactly as CODESYS does, because nothing instantiates the
  //                       POU and an uncompiled POU has no diagnostics. An editor cannot work that way.
  //   `itf_var_section_inherited` — both vendors report the interface error and STOP, never type-checking the
  //                       body that uses the member the interface could not declare.
  //   (`cc6_loop_cannot_exit` left 2026-10-03, frontend-conformance 4.2: its TO 200 is the LT12 conversion into the
  //                       SINT counter, not C0266 configured off — the LSP matches both recordings.)
  //   `cc3_pointer_conversions` — TwinCAT prints `Variable of type '1' requires exactly 1 Index`, with the
  //                       INDEX where the type belongs. CODESYS names the type and the LSP matches CODESYS;
  //                       reproducing this one would be copying a vendor defect, not reaching parity.
  twincat: new Set<string>([
    ...units.RECOVERY_DIVERGENCES,
    ...types.ANALYSIS_NICHE,
    ...types.DELETE_NOT_ALLOWED_IN_A_STATEMENT,
    ...types.REFERENCE_TO_BIT_ALIAS,
    ...types.INIT_ORDER_OF_PROGRAMS,
    ...types.TWINCAT_ANALYSIS_NICHE,
    ...units.ACCESS_MODIFIER_ON_A_FUNCTION_OR_PROGRAM,
    ...units.CALC_CONDITIONAL_CALL,
    ...units.TWINCAT_RECOVERY_DIVERGENCES,
    ...units.TWINCAT_STRUCT_EXTENDS_RECOVERY,
    ...declarations.DECLARATION_RECOVERY,
    ...units.IMPLICIT_ENUM_LIST_RECOVERY,
    ...units.IMPLICIT_ENUM_TYPE_NAME,
    ...units.STRING_LENGTH_AS_WRITTEN,
    ...units.UNKNOWN_QUALIFIED_TYPE,
    ...declarations.AFTER_A_REFUSED_TYPE.twincat,
    ...units.UNIT_HEADER_RECOVERY,
    ...units.MEMBER_HEADER_NAMED_BY_ITS_LAST_WORD,
    ...units.PROPERTY_WITHOUT_A_TYPE,
    ...units.ACCESSOR_TEXT_DROPPED_BY_THE_PUSH,
    ...units.FB_ACCESS_AT_THE_CALL,
    ...units.ENUM_TO_ENUM_IS_A_WARNING,
    ...units.TWINCAT_UNIT_DIVERGENCES,
    ...declarations.EXTERNAL_LOOKUP_IN_A_REFUSED_SECTION,
    ...declarations.CALL_IN_AN_AGGREGATE_INITIALIZER,
    ...declarations.TWINCAT_NON_RETAIN_RECOVERY,
    ...declarations.TWINCAT_NO_VAR_GENERIC,
    ...declarations.TWINCAT_DRIVER_CUTS_THE_ECHO,
    ...grammar.LITERAL_FOLLOW_ON_RULES,
    ...grammar.EXPRESSION_NICHE_DIVERGENCES,
    ...grammar.STATEMENT_DIVERGENCES,
    ...declarations.PRAGMA_DIVERGENCES,
    ...declarations.TWINCAT_PRAGMA_DIVERGENCES,
    ...declarations.DEAD_POU_NOT_IN_THE_REPLAY,
    ...names.SCOPE_DIVERGENCES,
    ...names.INHERITANCE_DIVERGENCES,
    ...names.MEMBER_DIVERGENCES,
    ...names.TWINCAT_SCOPE_DIVERGENCES,
    ...names.ENUM_DIVERGENCES,
    ...names.TWINCAT_ENUM_DIVERGENCES,
    ...names.TWINCAT_LIBRARY_DIVERGENCES,
    ...grammar.TWINCAT_TRY_NEEDS_CATCH,
    ...grammar.LITERAL_REFUSAL_DECLARATION_RECOVERY,
    ...grammar.TWINCAT_WSTRING_ESCAPE_RUNS_TO_END,
    ...grammar.TWINCAT_MALFORMED_ADDRESS_ALIGNMENT,
    ...grammar.TWINCAT_REFUSED_LDATE_LITERAL_STOPS,
    ...grammar.TWINCAT_IF_RECOVERY_AFTER_A_REFUSED_LITERAL,
    ...types.ELEMENTARY_RULE_DIVERGENCES,
    ...types.ARITHMETIC_RESULT_DIVERGENCES,
    ...types.LIBRARY_ENUM_BASE_NOT_MATERIALIZED,
    ...types.UNTYPED_OPERAND_AS_A_BOUND,
    ...types.TWINCAT_NOT_OF_A_SIGNED_BOUND,
    ...types.UNTYPED_NOT_IN_A_SIGNED_CONTEXT,
    ...types.ALIAS_INITIALIZER_NOT_CHECKED,
    ...types.TWINCAT_ARITHMETIC_ON_AN_UNKNOWN_DATE_TYPE,
    ...types.TWINCAT_UNTYPED_OPERATION_IN_AN_INITIALIZER,
    ...grammar.TWINCAT_NOTHING_OF_PLC_PRG_BESIDE_A_PARSE_ERROR,
    ...grammar.TWINCAT_ECHO_NAMES_A_POSITIONAL_ARGUMENT,
    ...grammar.TWINCAT_REFUSED_PREFIX_INSIDE_A_LIST,
    ...grammar.SYSTEM_OPERAND_AT_STATEMENT_START,
    ...grammar.TWINCAT_XSIZEOF_IS_NO_KEYWORD,
    ...types.TWINCAT_SIZEOF_COMPARED_AS_A_CONSTANT,
    ...grammar.TWINCAT_NO_EFFECT_AFTER_AN_UNKNOWN_WORD,
    ...grammar.TWINCAT_VECTOR_REFUSAL_CASCADE,
    //   PUSH-WITHOUT-HEADER-CHECK (2026-09-30) — texts the push now writes as sent, whose build answer the LSP does not
    //   reproduce, each for a reason that is not a rule to implement from what was measured:
    //   `pwh_struct_then_prose`, `pwh_gvl_then_prose` — text after a DUT's END_TYPE / a GVL's END_VAR. The compilers
    //                            read it as more declarations and word the error from their own recovery ("VAR_GLOBAL
    //                            or VAR_CONFIG expected instead of a:;" quotes a declaration CODESYS rebuilt from the
    //                            prose), and the two vendors recover differently from each other. One shape each —
    //                            too little to read a rule from. The LSP's "unexpected identifier 'a' at file scope"
    //                            is NO vendor's message: an LSP-only message, a false positive by the parity rule,
    //                            left standing (an error where the build fails) until more shapes are measured.
    //   `hdr_function_extends`, `hdr_function_implements` — a return type AFTER the clause (`FUNCTION F EXTENDS B : INT`).
    //                            Both vendors close the header at the clause and cascade seven messages from the `:`,
    //                            one of them echoing the call as `F(x := INT#2)`. The LSP reads the clause where they
    //                            do and the return type after it, so it gives the clause's own message (their
    //                            `_no_return` twins agree exactly) and nothing of its own — a subset, not the cascade
    //                            (`header-rules.test.ts`).
    //   …and the six whose answer is "Unknown type": the LSP has no standing to say that on TwinCAT, whose `References/`
    //                            materialization lacks types its compiler knows (External Types, `ST_LibVersion` —
    //                            `analysis/resolution.ts` `unknownTypeName`). CODESYS agrees on all six.
    "pwh_struct_then_prose",
    "pwh_gvl_then_prose",
    "hdr_function_extends",
    "hdr_function_implements",
    "pwh_unclosed_comment_struct",
    "pwh_unclosed_comment_enum",
    "pwh_unclosed_comment_fb",
    "pwh_empty_struct",
    "pwh_prose_struct",
    "pwh_prose_then_struct",
    "cc2_var_in_interface",
    "itf_var_section_declaration",
    "itf_var_section_inherited",
    "ir_initializer_warning_no_instance",
    "cc3_pointer_conversions",
    //   `sn_dut_mismatch` — the same reachability rule as CODESYS's entry of the same name, and now measured on
    //                       TwinCAT rather than inherited from it: a DUT whose type name disagrees with its
    //                       object and that NOBODY references records nothing on either vendor, while
    //                       `sn_dut_mismatch_used` — one FB declaring a variable of the type — records it on
    //                       both. An editor answers about the file in front of it.
    "sn_dut_mismatch",
    //   THE `__TRY` FAMILY — a DEVICE fact, and the price of recording both vendors on one target. On
    //   `TwinCAT RT (x64)` the code generator answers "The codegenerator for the current device does not
    //   support structured exception handling." for all nine, where the same source built clean on the ARM CE7
    //   target the project used to carry. It is the same shape as CODESYS's `op_sys_new_delete`: a property of
    //   the configured device, which an editor cannot know and must not guess at.
    "op_sys_try_catch",
    "try_no_fault",
    "try_divide_by_zero",
    "try_log_of_zero",
    "try_finally_no_fault",
    "try_finally_on_fault",
    "try_catch_only_on_fault",
    "try_nested",
    "try_one_line",
    //   (The five `newdel_*` fixtures that carry `{attribute 'enable_dynamic_creation'}` were here: TwinCAT "printed the
    //   attribute message alone, like a vendor that ignores the attribute". It never received the attribute — the
    //   recorder dropped every pragma above a top-level unit. Re-recorded 2026-10-02 with it pushed (frontend-conformance
    //   2.7.2), TwinCAT builds all five clean and the LSP agrees.)
  ]),
  // The `???` fixtures were here while the LSP answered every position with ONE invented sentence. They are
  // NOT divergences any more: the check reads the slot and emits the COMPILER'S wording for it
  // (`Expression expected instead of '?'` for an operand/pin/instance, `The assignment target is not
  // specified.` for a coil target), so they match on text like every other fixture.
  // Three checks the LSP emits that CODESYS does NOT — found by giving the untriggered checks their first fixtures
  // (2026-09-16). Each is recorded here with what the IDE says INSTEAD, because deleting a check on one measurement
  // is a decision, not a cleanup: each may still be right on TwinCAT, or in a shape this fixture does not reach.
  // Four of them are GONE (2026-09-16): each was an LSP message neither compiler emits in ANY recording, and the goal
  // is the IDE's answer, not a better one. `cc2_call_recursion` and `cc2_type_name_…` now say what CODESYS says;
  // `cc2_var_in_interface`'s rule is deleted (SP21 builds it clean); `cc5_no_op_statement` was a storage convention
  // (CRLF vs LF) and is normalized in `comparable()`.
  //   (`cc5_pointer_not_convertible` moved to `C0033_CONFIGURED_AS_AN_ERROR`, both vendors — frontend-conformance 4.1.1.)
  //   `cc5_new_in_expression` — the recording device has no memory configured for dynamic creation, so the IDE
  //                            reports that instead and never reaches the nesting rule.
  //   (`sn_dut_mismatch_used` LEFT 2026-10-06, analysis-conformance 3.4. Its recorded error is about the DUT it uses — a
  //                            different object, pushed with it by `withDependencies` — and the replay now analyses the
  //                            files of every fixture a fixture depends on, as the build compiles them. The note here
  //                            said that cost more than it paid, because `interface_with_property_impl` set no
  //                            `plcPrgVar` and recorded nothing; it instances the FB now and records the interface's
  //                            warning, so the measurement is 3 fixtures gained on each vendor and none lost.)
  codesys: new Set<string>([
    ...units.RECOVERY_DIVERGENCES,
    ...types.ANALYSIS_NICHE,
    ...types.DELETE_NOT_ALLOWED_IN_A_STATEMENT,
    ...types.REFERENCE_TO_BIT_ALIAS,
    ...types.CODESYS_ANALYSIS_NICHE,
    ...units.ACCESS_MODIFIER_ON_A_FUNCTION_OR_PROGRAM,
    ...names.SFC_STEPS_NOT_IN_SCOPE,
    ...units.CALC_CONDITIONAL_CALL,
    ...units.CODESYS_POSITION_IN_AN_INITIALIZER,
    ...units.CODESYS_POSITION_EATS_THE_CLOSING_PARENTHESIS,
    ...units.UNIT_HEADER_RECOVERY,
    ...units.MEMBER_HEADER_NAMED_BY_ITS_LAST_WORD,
    ...units.PROPERTY_WITHOUT_A_TYPE,
    ...units.ENO_WITHOUT_EN_OUTPUT_TYPE,
    ...units.ACCESSOR_TEXT_DROPPED_BY_THE_PUSH,
    ...units.FB_ACCESS_AT_THE_CALL,
    ...units.ENUM_TO_ENUM_IS_A_WARNING,
    ...declarations.DECLARATION_RECOVERY,
    ...units.IMPLICIT_ENUM_LIST_RECOVERY,
    ...units.IMPLICIT_ENUM_TYPE_NAME,
    ...units.STRING_LENGTH_AS_WRITTEN,
    ...declarations.AFTER_A_REFUSED_TYPE.codesys,
    ...declarations.EXTERNAL_LOOKUP_IN_A_REFUSED_SECTION,
    ...declarations.CALL_IN_AN_AGGREGATE_INITIALIZER,
    ...declarations.CODESYS_DECLARATION_DIVERGENCES,
    ...grammar.COMPONENT_CARRIED_ON_IN_A_DUT,
    ...grammar.LITERAL_FOLLOW_ON_RULES,
    ...grammar.EXPRESSION_NICHE_DIVERGENCES,
    ...grammar.STATEMENT_DIVERGENCES,
    ...declarations.PRAGMA_DIVERGENCES,
    ...declarations.CODESYS_PRAGMA_DIVERGENCES,
    ...declarations.DEAD_POU_NOT_IN_THE_REPLAY,
    ...names.SCOPE_DIVERGENCES,
    ...names.INHERITANCE_DIVERGENCES,
    ...names.MEMBER_DIVERGENCES,
    ...names.CODESYS_SCOPE_DIVERGENCES,
    ...names.ENUM_DIVERGENCES,
    ...names.CODESYS_ENUM_DIVERGENCES,
    ...names.CODESYS_LIBRARY_DIVERGENCES,
    ...grammar.LITERAL_REFUSAL_DECLARATION_RECOVERY,
    ...grammar.SYSTEM_OPERAND_AT_STATEMENT_START,
    ...types.ELEMENTARY_RULE_DIVERGENCES,
    ...types.ARITHMETIC_RESULT_DIVERGENCES,
    ...types.CODESYS_ARITHMETIC_RESULT_DIVERGENCES,
    ...types.LIBRARY_ENUM_BASE_NOT_MATERIALIZED,
    ...types.CODESYS_POUNAME_IS_SIZED_BY_ITS_BODY,
    ...types.UNTYPED_OPERAND_AS_A_BOUND,
    ...types.UNTYPED_NOT_IN_A_SIGNED_CONTEXT,
    ...types.ALIAS_INITIALIZER_NOT_CHECKED,
    //   PUSH-WITHOUT-HEADER-CHECK (2026-09-30) — texts the push now writes as sent, whose build answer the LSP does not
    //   reproduce, each for a reason that is not a rule to implement from what was measured:
    //   `pwh_struct_then_prose`, `pwh_gvl_then_prose` — text after a DUT's END_TYPE / a GVL's END_VAR. The compilers
    //                            read it as more declarations and word the error from their own recovery ("VAR_GLOBAL
    //                            or VAR_CONFIG expected instead of a:;" quotes a declaration CODESYS rebuilt from the
    //                            prose), and the two vendors recover differently from each other. One shape each —
    //                            too little to read a rule from. The LSP's "unexpected identifier 'a' at file scope"
    //                            is NO vendor's message: an LSP-only message, a false positive by the parity rule,
    //                            left standing (an error where the build fails) until more shapes are measured.
    //   `hdr_function_extends`, `hdr_function_implements` — a return type AFTER the clause (`FUNCTION F EXTENDS B : INT`).
    //                            Both vendors close the header at the clause and cascade seven messages from the `:`,
    //                            one of them echoing the call as `F(x := INT#2)`. The LSP reads the clause where they
    //                            do and the return type after it, so it gives the clause's own message (their
    //                            `_no_return` twins agree exactly) and nothing of its own — a subset, not the cascade
    //                            (`header-rules.test.ts`).
    "pwh_struct_then_prose",
    "pwh_gvl_then_prose",
    "hdr_function_extends",
    "hdr_function_implements",
    //   (`sn_dut_mismatch_used` left 2026-10-06, analysis-conformance 3.4: the replay analyses the files of the fixtures
    //                            a fixture depends on, as the build compiles them — `support/replay.ts` `dependencies`.)
    "cc5_new_in_expression",
    //   C0149, three fixtures, one cause — the compiler only looks at what it REACHES:
    //   `cc2_var_in_interface`, `itf_var_section_declaration` — an interface NOBODY IMPLEMENTS is never compiled,
    //                            so its VAR section draws no error. This is why the rule was wrongly deleted on
    //                            2026-09-16: a clean build on an unreferenced POU was read as "not an error".
    //                            `itf_var_section_inherited` adds an implementer and the error appears.
    //   `itf_var_section_inherited` — CODESYS reports the interface error and STOPS, never type-checking the FB
    //                            body, so `held` is never called undefined. An editor cannot stop: the body is
    //                            in front of the engineer and `held` is genuinely not there. (The interface error
    //                            itself the LSP says now, from the dependency's file — analysis-conformance 3.4.)
    "cc2_var_in_interface",
    "itf_var_section_declaration",
    "itf_var_section_inherited",
    //   `sn_dut_mismatch` — a DUT whose type name disagrees with its object, REFERENCED BY NOBODY. The same
    //                            reachability rule, and `sn_dut_mismatch_used` is the proof it is only that: add
    //                            one FB that declares a variable of the type and CODESYS reports the mismatch.
    "sn_dut_mismatch",
    //   `op_sys_new_delete` — the same device fact: the recording project configures no dynamic memory, so every
    //                            __NEW reports that instead of anything about the code.
    "op_sys_new_delete",
    //   …and the four fixtures beside it that reach the same wall. `__NEW` is answered by the application's
    //   memory configuration before anything about the code is considered, so the pragma rule this suite is
    //   really asking about is never reached on THIS recording project.
    "newdel_without_pragma",
    "newdel_with_pragma",
    "newdel_with_pragma_has_method",
    "newdel_in_method_with_pragma",
    "newdel_elementary",
    //   …and the three probes added 2026-09-21 to take the last variables out of it — a DIFFERENT FB as the
    //   target, a STRUCT as the target, and the same pair with the pragma removed. All three answer exactly
    //   what the five above answer, on both vendors. The pool is the only thing being reported.
    "newdel_target_with_pragma",
    "newdel_target_without_pragma",
    "newdel_struct_with_pragma",
    //   THE `__…ImpVar<n>` CELLS — a name no offline analyzer can produce. A graphical body whose sink has no
    //   name makes the compiler invent a variable for it, and the name carries a COUNTER over the POU's own
    //   implicit variables: `__FB_NG_en__ImpVar18`, `__FB_NG_enwire__ImpVar20`,
    //   `__FB_LANG_network_unnamed_target_en__ImpVar15`. Both messages in each of these three quote that name,
    //   so matching them would mean reproducing the numbering of a pass the LSP does not have and does not
    //   want — it creates no implicit variables at all. The SHAPE is already reported: the unnamed sink draws
    //   the compiler's own "The assignment target is not specified." from `network-analysis`.
    "network_unnamed_target_behind_enable",
    "ng_en_eno_sink",
    "ng_en_eno_named_wire",
    //   THE VAR_PERSISTENT FAMILY — an APPLICATION fact of the same kind: "No VAR_PERSISTENT list is part of the
    //   application to enter instance path for variable PLC_PRG.inst.n" is about what the application is
    //   configured with, not about the declaration. TwinCAT's project HAS such a list and records nothing for the
    //   same five fixtures, which is the clearest proof it is configuration: same source, two projects, two
    //   answers.
    "var_persistent",
    "decl_persistent_counts",
    "decl_persistent_initialized",
    "decl_retain_persistent_counts",
    "decl_retain_persistent_initialized",
    "decl_persistent_retain",
    //   (`cc6_loop_cannot_exit` left 2026-10-03, both vendors, frontend-conformance 4.2: "C0266 is configurable and the
    //                            project has it OFF" was the wrong reading — `for_at_type_max` records C0266 for a bound AT
    //                            the counter's limit. A bound BEYOND it, `FOR small : SINT := 1 TO 200`, is a conversion
    //                            into the counter's type, and the vendors say only that sign change, as the LSP now does.)
    //   `ir_initializer_warning_no_instance` — the IDE compiles only what the entry point REACHES, so a POU nobody
    //                            instantiates gets no diagnostics at all. An editor cannot work that way: it has to
    //                            answer about the file in front of you before anything instantiates it. The fixture
    //                            stays because the 0 it records is what proves the FB count is not per-declaration.
    "ir_initializer_warning_no_instance",
    //   (`tr_20_output_index_moved_by_callee` left 2026-10-11, lsp-transpile-review-gaps 1.4: the call check reads a
    //                            FUNCTION's VAR_OUTPUT binding, `call-arguments.test.ts`.)
  ]),
}
