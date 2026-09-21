/**
 * WHICH FIXTURES DO NOT MATCH, AND WHY — the two triage backlogs and the two divergence sets, as data.
 *
 * They lived in `fixtures.test.ts`, which is where they are ASSERTED. They are read in more than one place
 * now — `scripts/agreement-residue.ts` has to skip a documented divergence or its work list is mostly device
 * facts — and a second copy of a list whose whole value is that it only shrinks would be the worst possible
 * duplication. So the lists live here and the gates import them.
 */
import type { Vendor } from "../../../src/analysis/index.js"
/**
 * THE TWINCAT TRIAGE BACKLOG — fixtures where the LSP says something TwinCAT does not. THREE, as of the end of
 * 2026-09-20, from 79 that morning.
 *
 * These are NOT excused. `lsp-parity-not-better` is the rule: an LSP-only message is a false positive until a
 * recording says otherwise. A fixture that legitimately cannot match — reachability, a project setting, a
 * vendor's own defect — belongs in `KNOWN_DIVERGENCES` with its evidence, and several moved there today.
 *
 * HOW THE 79 WENT. Almost none of it was the LSP being wrong about ST, and none of it was closed by teaching
 * a check to branch on the vendor:
 *
 *   ~25  THE RECORDING WAS WRONG. TwinCAT's driver joined lines onto a message while its quote count was odd,
 *        and a complete message can have an odd count, because what it quotes is ST source full of string
 *        literals. A family of warnings TwinCAT reports IDENTICALLY read as divergence.
 *   ~18  THE PROJECT WAS ON THE WRONG TARGET. The fixture solution's active platform was `TwinCAT CE7 (ARMV7)`
 *        — 32-bit ARM — so `__XINT` measured DINT where the CODESYS oracle says LINT, and `__XADD` returned
 *        `Internal Error (ARM): RiscFrontEnd: Unknown operator` instead of an answer. Re-recorded on
 *        `TwinCAT RT (x64)`; `check-recording.ts` now refuses to adopt a recording that is not 64-bit.
 *   ~15  THE VOCABULARY IS VENDOR DATA. `__POSITION`, `__POUNAME`, `__COMPARE_AND_SWAP`, `__VECTOR` and the
 *        `UCHAR#`/`LDATE#`/`LDT#`/`LTOD#` prefixes are CODESYS's alone, so the LSP was typing names TwinCAT
 *        has never heard of. They lex as identifiers there now, and resolve nowhere, which is what TwinCAT
 *        says about them.
 *   ~10  THE WORDING. Capitalisation and punctuation, measured on both sides and now data in `messages.ts`:
 *        "Unexpected Token", "Assignment target not specified", an upper-cased recursion chain, an input
 *        count TwinCAT never words as a range, and `INDEXOF`, which both vendors removed and word differently.
 *    ~9  A MESSAGE TWINCAT CANNOT PRINT. Below STRING(3) the prefix in "String constant '…' too long" would
 *        have a negative length; TwinCAT's builder throws where CODESYS falls back, and says so in the
 *        recording (`System.ArgumentOutOfRangeException: Length cannot be less than zero`).
 *    ~6  RULES TWINCAT DOES NOT HAVE, each measured on its own fixtures: the ABSTRACT-keyword warning, the
 *        second message for an unresolved base class, a sign crossing at an ARGUMENT (it warns for every
 *        assignment and none of these), and `__NEW` nested in an expression.
 *     1  A RULE NEITHER VENDOR HAS: C0098, the deprecated `FUNCTIONBLOCK` spelling. Deleted.
 *
 * WHAT IS LEFT, and why each is still open rather than excused:
 *
 *   cc3_reference_assign      TwinCAT reverses the conversion direction for a reference assign — "Cannot
 *                             convert type 'REFERENCE TO INT' to type 'SINT'" where CODESYS says the same
 *                             pair the other way round. ONE cell; a rule built on one cell is a guess.
 *   cc5_deprecated_functionblock_keyword  The parser's own `unexpected identifier 'FUNCTIONBLOCK' at file
 *                             scope`, which is Volt's wording, where both vendors say nothing about the
 *                             header and complain where the missing FB is USED.
 *   ldate_ltod_ldt            Arrived with the vocabulary fix: after an unknown literal prefix the two
 *                             parsers resync differently and ours says three things more.
 *
 * THE RULE HERE IS THAT IT ONLY SHRINKS. A fixture not in this list may not emit an LSP-only message, and a
 * fixture that stops emitting one must leave the list — both are asserted below, so this cannot quietly grow
 * and cannot quietly rot. Triage is tracked in `openspec/changes/twincat-conformance-parity`.
 */
/**
 * THE CODESYS TRIAGE BACKLOG, dated 2026-09-20 — and it is THREE, where TwinCAT's is 79.
 *
 * Same event, same reason it was invisible: the CODESYS recording covered 893 of 2530 fixtures until today, so
 * this gate was green on two thirds of the suite by having nothing to contradict it. That it comes back with 3
 * rather than 79 is the honest measure of how much more this LSP has been developed against CODESYS.
 *
 * Each is a real LSP-only message — an invented error, by `lsp-parity-not-better` — and small enough to name:
 *
 *   meet_bool_mod_int        the LSP says "MOD is not defined for BOOL"; CODESYS compiles it. The meet-type
 *                            table refuses a pair the vendor accepts.
 *   sysop_position_call_form  `__POSITION` typed as plain STRING where CODESYS names a SIZED one —
 *   sysop_position_initializer  "Cannot convert type 'STRING(INT#23)' to type 'DINT'" in an implementation and
 *                             `STRING(INT#13)` in a declaration.
 *
 * THE MEASUREMENT IS NO LONGER WHAT IS MISSING. `scripts/probe-position-length.ts` pinned the model with twelve
 * probes and the simulator then handed over the text itself: the length is `21 + digits(line) + digits(column)`
 * in an implementation and `12 + digits(line)` in a declaration, with the line counted inside the POU's OWN part
 * (its header is declaration line 1, its first statement is implementation line 1) and the column being the
 * STATEMENT'S, not the operator's. Every one of the twelve fits, and so do both cells here.
 *
 * WHAT IS MISSING IS A SEAM. `rules.rhsDisplay` is where a sized string type is rendered, and it is handed the
 * expression and its type — not the source text (for the line's indent), nor the unit (for the END_VAR the
 * implementation starts after). Closing this means threading both down, or hanging the position on the AST node
 * at parse time. Two fixtures is a thin reason to do either, and an implementation that gets the declaration
 * form right and guesses the column would be worse than the honest silence: it would be a WRONG number where
 * this is merely an unsized one.
 */
export const CODESYS_TRIAGE: ReadonlySet<string> = new Set([
  "sysop_position_call_form",
  "sysop_position_initializer",
])

export const TWINCAT_TRIAGE: ReadonlySet<string> = new Set([
  "cc3_reference_assign",
  "cc5_deprecated_functionblock_keyword",
  "ldate_ltod_ldt",
])
/** Fixtures that legitimately do NOT match, each with a documented reason. Empty until a real divergence
 *  is confirmed against a recording (not a not-yet-ported check — those are tracked by the ratchet). */
// subrange is NO LONGER a divergence: the check now emits the compilers' own type-CONVERSION wording
// (`Cannot convert type '200' to type 'INT (1..100)'`, folded onto `cannotConvert`) — byte-identical on both,
// so it's in the ratchet. array-index-out-of-bounds is likewise byte-identical. The overflow fixtures are NOT
// here: the `constant-overflow` check was REMOVED (it false-positived — CODESYS accepts out-of-range untyped
// literals), so the LSP is silent on them; they read as honest "not-yet-implemented" misses.
export const KNOWN_DIVERGENCES: Record<Vendor, ReadonlySet<string>> = {
  // TwinCAT does NOT flag a network-text JMP to a missing label (CODESYS does) — confirmed live 2026-07-07.
  // `cc_vg_undefined_label` was listed here: the LSP flagged the network-text JMP on TwinCAT too, a false positive this
  // set hid. The message is vendor data now (`networkJumpLabelUndefined`), undefined on TwinCAT — no divergence left.
  //   `op_sys_varinfo` — the TwinCAT RECORDING is truncated, not the behaviour: it stores `The code '.size;` with no
  //                       closing quote, where CODESYS stores the whole sentence including the line break it quotes.
  //                       The message is cut at that break on the way out of the TwinCAT driver — a BRIDGE bug to
  //                       fix and re-record, not something for the LSP to match.
  //   `operand_uchar_literal` — `UCHAR#'A'` is a CODESYS extension TwinCAT does not have: it parse-cascades on the
  //                       prefix (five errors), where CODESYS types the literal UDINT. The LSP's parser accepts the
  //                       extension for both, so it types the literal and TwinCAT sees a message it never emits.
  //                       The fix is a TwinCAT-only rejection of the prefix, in the shape `analysis/resync` already
  //                       models — TwinCAT work, deferred until CODESYS is finished.
  //   THE SAME FIVE REASONS CODESYS ALREADY HAS, now checked against TwinCAT's own recording rather than
  //   assumed from its twin (2026-09-20). Each was on the triage backlog as if it were a false positive:
  //   `cc2_var_in_interface`, `itf_var_section_declaration`, `ir_initializer_warning_no_instance` — TwinCAT
  //                       builds all three CLEAN, exactly as CODESYS does, because nothing instantiates the
  //                       POU and an uncompiled POU has no diagnostics. An editor cannot work that way.
  //   `itf_var_section_inherited` — both vendors report the interface error and STOP, never type-checking the
  //                       body that uses the member the interface could not declare.
  //   `cc6_loop_cannot_exit` — C0266 is configurable and is OFF in both recording projects: each records only
  //                       the sign-change warning in `FOR small : SINT := 1 TO 200`, which the LSP matches.
  //   `cc3_pointer_conversions` — TwinCAT prints `Variable of type '1' requires exactly 1 Index`, with the
  //                       INDEX where the type belongs. CODESYS names the type and the LSP matches CODESYS;
  //                       reproducing this one would be copying a vendor defect, not reaching parity.
  twincat: new Set<string>([
    "cc2_var_in_interface",
    "itf_var_section_declaration",
    "itf_var_section_inherited",
    "cc6_loop_cannot_exit",
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
    //   THE `newdel_*` FIXTURES THAT CARRY THE PRAGMA — the same APPLICATION fact as CODESYS's five, reached
    //   the long way because TwinCAT does not name it. CODESYS prints "No memory for dynamic object creation
    //   defined for application 'Device.Application'" on either side of the pragma message, so the pragma rule
    //   is plainly never reached; TwinCAT prints the attribute message ALONE and reads, wrongly, like a vendor
    //   that ignores the attribute.
    //
    //   Settled 2026-09-21 by removing every other variable rather than by argument. (a) The pragma REACHES the
    //   compiler: pushed above `FUNCTION_BLOCK` into a live TwinCAT and fetched back it round-trips
    //   byte-identically. (b) It is not the SELF-REFERENCE every earlier fixture happened to carry —
    //   `newdel_target_with_pragma` has one FB create a different one and answers the same. (c) It is not FBs
    //   only — `newdel_struct_with_pragma` answers the same for a STRUCT. (d) With the pragma REMOVED from the
    //   same two POUs (`newdel_target_without_pragma`) the answer does not change. The attribute moves nothing
    //   on this project, in any position, for any target.
    //
    //   So the message is downstream of the missing pool on BOTH vendors, and only one of them says so. The
    //   LSP keeps the documented rule (the pragma silences it), which these projects cannot test either way.
    //   `newdel_without_pragma`, `newdel_target_without_pragma` and `newdel_elementary` are NOT here: they
    //   agree, because the LSP reaches the same answer by the rule it does have.
    "newdel_with_pragma",
    "newdel_with_pragma_has_method",
    "newdel_in_method_with_pragma",
    "newdel_target_with_pragma",
    "newdel_struct_with_pragma",
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
  //   `cc5_pointer_not_convertible` — C0033 is CONFIGURABLE. The recording project has it as an ERROR; the replay
  //                            resolves no project settings, so it is a warning here. Configuration, not behaviour.
  //   `cc5_new_in_expression` — the recording device has no memory configured for dynamic creation, so the IDE
  //                            reports that instead and never reaches the nesting rule.
  //   `cc5_deprecated_functionblock_keyword` — the IDE does not report the spelling at all: it parses `FUNCTIONBLOCK`
  //                            as something else and reports "Unknown type". Both LSP messages are Volt's own.
  //   `sn_dut_mismatch_used` — THE RECORDING IS OF A PROJECT BUILD; A DIAGNOSTIC IS PER FILE. The fixture is an FB
  //                            holding `held : DUT_SN_signature`, and its recorded error — "The name used in the
  //                            signature is not identical to the object name" — is about the DUT, which is a
  //                            DIFFERENT OBJECT in a different file. `record:language` builds the fixture with
  //                            `withDependencies` and collects everything the build says, so the error lands under
  //                            this fixture's name; the LSP computes diagnostics for the file it is given, where
  //                            there is nothing wrong.
  //                            Analysing the dependencies too was tried and does close this one — and costs more
  //                            than it pays: `interface_with_property_impl` then reports the interface's
  //                            accessorless property, which CODESYS does NOT record, because that fixture sets no
  //                            `plcPrgVar` so nothing is instantiated and nothing is compiled. One gained, one
  //                            lost, plus a TwinCAT ratchet point. The rule "an implemented interface property is
  //                            silent" was written to explain it and is WRONG: `interface_with_property` has the
  //                            same interface AND an implementer in the project and still records the warning —
  //                            it instantiates the FB and reads the property, and the other does not.
  //                            What actually separates every one of these is REACHABILITY, which a per-file
  //                            analysis does not have and should not guess at.
  codesys: new Set<string>([
    "sn_dut_mismatch_used",
    "cc5_pointer_not_convertible",
    "cc5_new_in_expression",
    //   C0149, three fixtures, one cause — the compiler only looks at what it REACHES:
    //   `cc2_var_in_interface`, `itf_var_section_declaration` — an interface NOBODY IMPLEMENTS is never compiled,
    //                            so its VAR section draws no error. This is why the rule was wrongly deleted on
    //                            2026-09-16: a clean build on an unreferenced POU was read as "not an error".
    //                            `itf_var_section_inherited` adds an implementer and the error appears.
    //   `itf_var_section_inherited` — CODESYS reports the interface error and STOPS, never type-checking the FB
    //                            body, so `held` is never called undefined. An editor cannot stop: the body is
    //                            in front of the engineer and `held` is genuinely not there.
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
    "cc5_deprecated_functionblock_keyword",
    //   `cc6_loop_cannot_exit` — C0266 is CONFIGURABLE too, and the recording project has it OFF: the IDE warns only
    //                            about the sign change in `FOR small : SINT := 1 TO 200`, which the LSP matches.
    "cc6_loop_cannot_exit",
    //   `ir_initializer_warning_no_instance` — the IDE compiles only what the entry point REACHES, so a POU nobody
    //                            instantiates gets no diagnostics at all. An editor cannot work that way: it has to
    //                            answer about the file in front of you before anything instantiates it. The fixture
    //                            stays because the 0 it records is what proves the FB count is not per-declaration.
    "ir_initializer_warning_no_instance",
  ]),
}
