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
])
/** Fixtures that legitimately do NOT match, each with a documented reason. Empty until a real divergence
 *  is confirmed against a recording (not a not-yet-ported check — those are tracked by the ratchet). */
// subrange is NO LONGER a divergence: the check now emits the compilers' own type-CONVERSION wording
// (`Cannot convert type '200' to type 'INT (1..100)'`, folded onto `cannotConvert`) — byte-identical on both,
// so it's in the ratchet. array-index-out-of-bounds is likewise byte-identical. The overflow fixtures are NOT
// here: the `constant-overflow` check was REMOVED (it false-positived — CODESYS accepts out-of-range untyped
// literals), so the LSP is silent on them; they read as honest "not-yet-implemented" misses.
/**
 * FRONTEND-CONFORMANCE 2.1 (2026-09-30) — lexer fixtures whose one disagreement is the RECOVERY after the first refused
 * token: rule R1 (openspec frontend-conformance design.md §4 2.8, task 2.8.2), not the lexer. `n := 1 ! 2;` — both
 * vendors report the stray character exactly as the LSP does ("';' expected instead of '!'", "Unexpected token '!'
 * found") and then name the `2` the same way; the statement parser resyncs to the `;` in silence after its first pair.
 * `n := 7 DIV 2;` is the same shape — DIV is no infix operator on either vendor. One mechanism, both vendors, identical
 * answers, so one list; it leaves with R1's fix (`syntax/parse/errors.ts` `reportStatementCascade` is that cascade, used
 * today only after a refused statement start).
 */
const R1_CASCADE_AFTER_A_STRAY_TOKEN: readonly string[] = [
  "lex_unknown_character",
  "lex_unknown_character_at",
  "lex_unknown_character_tilde",
  "lex_unknown_character_backslash",
  "lex_unknown_character_pipe",
  "lex_unknown_character_dollar",
  "lex_unknown_character_question",
  "lex_unknown_character_hash",
  "lex_unknown_character_percent",
  "lex_div_as_operator",
]

/**
 * FRONTEND-CONFORMANCE 2.1.3 (2026-09-30) — `__CURRENTTASK` and `__POOL` where a statement starts. Every keyword was asked
 * there (`lex_keyword_assigned_*`, `lex_keyword_before_name_*`), and these two answer in a shape of their own on both
 * vendors: each takes the NEXT token as its member — `__currenttask := 1;\nn := 2;` is "'__CURRENTTASK.n' is no valid
 * assignment target" and "Identifier 'n' not defined" (TwinCAT adds its stack-size sentence), `__pool n := 2;` quotes
 * `__POOL.!!!'ERROR'!!!`. The LSP refuses neither word there any more (`REFUSED_AT_STATEMENT_START`), but reads them
 * with the `__CURRENTTASK` rule of an operand and nothing for `__POOL` — the system operands' rules, E30 and E34
 * (task 2.5.6), which this recording is evidence for. `__POOL` as a bare OPERAND (`n := __pool;`) is the same rule:
 * CODESYS "Identifier expected instead of ''", TwinCAT "Expression expected instead of ''", and the LSP reads a name.
 * NICHE: ACCEPTED LOSS (0 occurrences in the corpora — neither word appears in any of the six, in any position; owner
 * triage 2026-09-30). They stay pinned here, and leave only if task 2.5.6 fixes them on the way.
 */
const SYSTEM_OPERAND_AT_STATEMENT_START: readonly string[] = [
  "lex_keyword_assigned_sys_currenttask",
  "lex_keyword_before_name_sys_currenttask",
  "lex_keyword_assigned_sys_pool",
  "lex_keyword_before_name_sys_pool",
  "lex_keyword_operand_sys_pool",
]

/**
 * FRONTEND-CONFORMANCE 2.1.3 (2026-09-30) — TwinCAT's XSIZEOF is no keyword. Named alone it is an identifier nothing
 * declares: `xsizeof := 1;` is "Identifier 'xsizeof' not defined" and "'xsizeof' is no valid assignment target", `xsizeof
 * n := 2;` is a statement of its own ("The code 'xsizeof;' has no effect"), `n := xsizeof;` "not defined" — where
 * CODESYS refuses the reserved word. But CALLED it is no undefined name either: `XSIZEOF(DINT)` answers only "Expression
 * expected instead of 'DINT'" (`cp_xsizeof`), so it is not simply a CODESYS-only word (`CODESYS_ONLY_KEYWORDS` made that
 * call three "not defined" false positives). The LSP reads CODESYS's keyword on both vendors; what TwinCAT's XSIZEOF is
 * — a callable that is no keyword — is the dialect vocabulary's question (rule L10). Task 2.1.4 answered the rest of
 * L10 and left this one standing: an identifier on TwinCAT would make the call form "not defined" (`cp_xsizeof`), so
 * the fix needs a name that resolves only as a callee — a resolution rule (Y23), not a vocabulary one.
 * NICHE: ACCEPTED LOSS (0 occurrences in the TwinCAT corpus; the 5 in pro2193 are CODESYS, all called — `XSIZEOF(x)`;
 * owner triage 2026-09-30): a bare `xsizeof` is asked by nothing real, and the call form needs a callable-but-no-keyword
 * reading the vocabulary does not have.
 */
const TWINCAT_XSIZEOF_IS_NO_KEYWORD: readonly string[] = [
  "lex_keyword_assigned_xsizeof",
  "lex_keyword_before_name_xsizeof",
  "lex_keyword_operand_xsizeof",
]


/**
 * FRONTEND-CONFORMANCE 2.1.4 review (2026-09-30) — TwinCAT's "no effect" after a word it does not know, before a name.
 * `__vector n := 2;` on TwinCAT is "';' expected instead of 'n'" AND the warning "The code '__vector;' has no effect.
 * Is this the intent?" — a statement of its own, warned although the word is declared nowhere and nothing says "not
 * defined". The LSP matches the error and not the warning: `flow/no-op-statement` stays silent on an unresolved name
 * (its zero-FP guard), which is right everywhere but here. A missing-only difference — pinned so the suite notices the
 * day it matches. The recovery's rule (R1–R2, task 2.8.2), not the vocabulary's: the same shape for every word
 * TwinCAT reads as an identifier there. (`lex_cascade_meets_soft_name_{get,set,override}` missed the same warning and
 * no longer do: the statement a refused operand's resync resumes at is marked, `ExprStatement.resumed`, task 2.2.)
 */
const TWINCAT_NO_EFFECT_AFTER_AN_UNKNOWN_WORD: readonly string[] = [
  "lex_keyword_before_name_sys_position",
  "lex_keyword_before_name_sys_pouname",
  "lex_keyword_before_name_sys_compare_and_swap",
  "lex_keyword_before_name_sys_vector",
  "lex_keyword_before_name_non_retain",
]

/**
 * FRONTEND-CONFORMANCE 2.1.4 review (2026-09-30) — TwinCAT's recovery after a refused `__VECTOR`, where it is not a
 * variable's type. Every place a type is written was recorded: in a VAR declaration, inside `POINTER TO` and
 * `ARRAY … OF`, and as a struct field TwinCAT says "Type definition expected instead of '__VECTOR'" and nothing more, and
 * the LSP agrees (`lex_vector_twincat{,_pointer_to,_array_of,_struct_field}`). As a DUT alias and as a function's return
 * type it goes on, each in a shape of its own: the alias wants "':= or ;'" at `END_TYPE` and then `END_TYPE` at the end
 * of the text; the return type swallows through `VAR_INPUT` and quotes the next declaration run together ("VAR,
 * VAR_INPUT, VAR_OUTPUT or VAR_INOUT expected instead of x:INT;"), so the function has no inputs and its call is
 * refused. The LSP gives the first message and its own recovery after it ("unexpected '[' at file scope", "expected
 * expression, got punct '['"). One shape each — too little to read TwinCAT's skip rule from; the vendor cascades are
 * task 2.8.3's (R3), and this is its evidence. CODESYS builds all six.
 *
 * THE ALIAS IS NOT A FIXTURE, and needs the owner. `TYPE DUT_LANG_vector_alias : __VECTOR[4] OF REAL;` + `END_TYPE`,
 * declared in PLC_PRG, was recorded 2026-09-30: CODESYS builds it (run: `v_alias[0..3]` = `REAL#0`); TwinCAT answers
 * "Type definition expected instead of '__VECTOR'", "':= or ;' expected instead of 'END_TYPE'" and "'END_TYPE' expected
 * instead of ''" (all line 1), where the LSP says the first and then "'END_TYPE' expected instead of '['" and
 * "unexpected '[' at file scope". It could not be kept: an alias binds no scope, so on CODESYS its count `4` is one more
 * `fixtures codesys: literal NOSCOPE` (0.4) and `decl NOSCOPE` (fold) than the ceilings allow, and a ceiling may only
 * fall. The fixture, its three recordings and its pin here go back together once the owner accepts that rise or an
 * alias binds a scope.
 */
const TWINCAT_VECTOR_REFUSAL_CASCADE: readonly string[] = ["lex_vector_twincat_return_type"]

/**
 * FRONTEND-CONFORMANCE 2.2 (2026-10-01) — literal fixtures whose literal the LSP now reads as both vendors do, and whose
 * one remaining disagreement is a rule of another task. Each vendor answers them identically (TwinCAT's capital "Token"
 * aside), so one list serves both:
 *   `lit_invalid_digit_hex`, `lit_time_underscore` — the literal ends where the vendor's does (`16#F` before `G`, `T#1h`
 *                            before `_30m`) and the LSP says "';' expected instead of 'G'" as they do. They then keep
 *                            the statement as if the `;` were there and RESUME at the name — "The code 'G;' has no
 *                            effect" — where the statement parser skips to the `;`. The recovery after a missing `;`
 *                            is R1–R2's (task 2.8.2); `ExprStatement.resumed` is the mark it will set there.
 *   `lit_real_no_leading_digit` — `.5` is no literal on either vendor: a leading `.` is the GLOBAL SCOPE operator, so
 *                            they answer "Identifier expected instead of '5'" and "Global scope operation '.' is not
 *                            valid on expression '!!!'ERROR'!!!'". The `.name` primary is E33 (task 2.5.6); the LSP's
 *                            "expected expression, got punct '.'" is Volt's wording until then.
 *   `lit_time_fraction_ms` — the literal is refused as the vendors refuse it (`T#1.5m`, `Token.malformed`), and the `s`
 *                            left after it is the IL operator S, which they refuse as a WORD ("Unexpected token 's'
 *                            found") where the LSP lexes a name and warns `s;` has no effect. The IL operators as
 *                            words are `refused-name`'s until task 2.8.3 gives the cascade its one home.
 */
const LITERAL_FOLLOW_ON_RULES: readonly string[] = [
  "lit_invalid_digit_hex",
  "lit_time_underscore",
  "lit_real_no_leading_digit",
  "lit_time_fraction_ms",
]

/**
 * FRONTEND-CONFORMANCE 2.2a (2026-10-01) — a malformed literal where a TYPE is read (an array bound, a subrange bound) or
 * inside an aggregate initializer. The LSP now says every refusal the vendors say there — "'] or ,' expected instead of
 * '3#'", "')' expected instead of 'BOOL#2'" with "Expression expected instead of 'BOOL#2'", "',, ( or ]' expected
 * instead of 'T#1500'" with its "Expression expected" — where a contained sub-parse used to drop the literal silently.
 * What is left is MISSING-ONLY and is the vendors' RECOVERY after the refusal, identical on both: they resync to END_VAR
 * and past it ("'OF' expected instead of 'END_VAR'", "Type definition expected instead of ''", "'END_VAR' expected
 * instead of ''", "';, :=, REF=, ( or [' expected instead of 'END_VAR'", "';' expected instead of 'END_VAR'") and the
 * subrange's placeholder bound adds "Border '!!!'ERROR'!!!' of array is no constant value". The declaration recovery is
 * R1–R3's (tasks 2.8.2, 2.8.3).
 */
const LITERAL_REFUSAL_DECLARATION_RECOVERY: readonly string[] = [
  "lit_malformed_array_bound",
  "lit_malformed_array_bound_typed",
  "lit_malformed_subrange_bound",
  "lit_init_malformed_in_aggregate",
]

/**
 * FRONTEND-CONFORMANCE 2.2.5 (2026-10-01) — TwinCAT after a WSTRING hex escape of fewer than four digits. The lexer ends
 * the literal where TwinCAT does (`"$C3`), so the LSP now gives every message TwinCAT records but one: the `"` left after
 * the cut opens a string that TwinCAT reads to the END OF THE POU, so its VAR block never closes — "'END_VAR' expected
 * instead of ''". Ours ends at the line (IEC strings do not span lines, and nothing measured says TwinCAT's do otherwise
 * than here). A missing-only difference, one shape; the recovery is R3's (task 2.8.3). CODESYS agrees exactly.
 */
const TWINCAT_WSTRING_ESCAPE_RUNS_TO_END: readonly string[] = [
  "esc_wstring_hex_41",
  "esc_wstring_hex_ff",
  "esc_wstring_pair",
  "esc_wstring_hex3",
]

/**
 * FRONTEND-CONFORMANCE 2.2.7 (2026-10-01) — TwinCAT's alignment WARNING on a malformed address. A WORD `AT %MW2.5` or
 * `AT %IW2.5.7.1` is "Direct Address '…' malformed" on both vendors, and the LSP says so; TwinCAT adds "Variable 'w'
 * has a granularity of 2 but is located at direct address %MW2.5 which is not aligned to 2 bytes." — reading SOME
 * position out of an address it has just refused. Which one is not readable from two cells (2.5 and 2.5.7.1 are both
 * "not aligned"), and no well-formed address was measured against it. Missing-only; niche — a malformed address is an
 * error already, and the corpora hold no multi-segment address. An accepted loss until an aligned/unaligned pair of
 * well-formed addresses is recorded on TwinCAT.
 */
const TWINCAT_MALFORMED_ADDRESS_ALIGNMENT: readonly string[] = ["lit_address_two_segments", "lit_address_multi_segment"]

/**
 * FRONTEND-CONFORMANCE 2.2b (2026-10-01) — TwinCAT, a refused `<word>#` (its lexer refuses every word it has no literal
 * for, `TWINCAT_LITERAL_PREFIXES`) where the parser is INSIDE something that is not a statement: a call's argument list,
 * a CASE label, an aggregate, a STRUCT field's or an enum value's initializer. Both sides refuse the token ("Expression
 * expected instead of 'CHAR#'"); TwinCAT then words the refusal by the place — "',' or ')' expected" in `ABS(…)`, "')'
 * expected" in a one-parameter `TO_INT(…)`, "No case label found", "', or )' expected" in an enum's list — and recovers
 * by that place's rule: it closes the VAR block or the TYPE ("'END_VAR' expected instead of ''"), carries the refused
 * value on as `!!!'ERROR'!!!` into a conversion, and checks the next enum value against it. The LSP resyncs as from a
 * refused statement. Both missing and LSP-only; recovery, R2/R3's (task 2.8.3). CODESYS reads none of these as a refused
 * token (they are an enum literal or a component there): it agrees on the first four, and the two DUT ones are
 * `COMPONENT_CARRIED_ON_IN_A_DUT`'s.
 */
const TWINCAT_REFUSED_PREFIX_INSIDE_A_LIST: readonly string[] = [
  "lit_enum_typed_as_argument",
  "lit_enum_typed_as_conversion_argument",
  "lit_enum_typed_case_label",
  "lit_char_typed_in_array_init",
  "lit_char_typed_in_struct_field",
  "lit_char_typed_in_enum_value",
]

/**
 * FRONTEND-CONFORMANCE 2.2b (2026-10-01) — CODESYS, a refused component (`CHAR#'A'`) as a DUT's initializer. The LSP says
 * the refusal CODESYS says first, "''A'' is no component of 'CHAR'"; CODESYS then CARRIES the refused pair on as a value
 * it echoes `CHAR#'null'`, and every rule of the place it stands in reports it: in a STRUCT field one "Cannot convert type
 * 'Unknown type: 'CHAR#'null''' to type 'BYTE'"; in an enum value
 * "Unknown type", "Cannot convert" and "is no valid initialisation for an enumeration" for the value AND for the next
 * one, which counts from it (`(CHAR#'null' + 1)`), and "The constant 0 is assigned to more than one enumeration". Missing-only; niche — the first message already refuses
 * the source, and the echo (`'null'` for an operand that was `'A'`) is the compiler's internal placeholder, not a rule
 * worth reproducing. An accepted loss. (A variable's initializer and an array element say the first message alone,
 * `lit_char_typed_in_array_init` agrees.)
 */
const COMPONENT_CARRIED_ON_IN_A_DUT: readonly string[] = ["lit_char_typed_in_struct_field", "lit_char_typed_in_enum_value"]

/**
 * FRONTEND-CONFORMANCE 2.2.6 (2026-10-01; split by the 2.2b review) — TwinCAT, the five `xf_l*_call_once`: a FUNCTION
 * returning a CODESYS-only date type whose IF assigns that type's refused literal. First recorded on TwinCAT in 2.2.7.
 * The return type's "Unknown type: 'LDT'" the LSP now says (`checks/declarations/unknown-type`); what is left is THREE
 * differences, each its own rule, and a fixture is listed under every one it shows:
 *
 * TWINCAT_REFUSED_LDATE_LITERAL_STOPS — `LDATE#1970-01-02`: TwinCAT gives, per literal, "';' expected instead of
 *   'LDATE#'" and "Expression expected instead of 'LDATE#'" and NOTHING over the date's pieces, where after `LTOD#`/`LDT#`
 *   (and the LSP after all three) it cascades "Unexpected Token" + "';' expected" per token. Why LDATE alone stops is not
 *   readable from one fixture; the cascade is R1's (task 2.8.2).
 */
const TWINCAT_REFUSED_LDATE_LITERAL_STOPS: readonly string[] = ["xf_ldate_to_date_call_once"]

/**
 * TWINCAT_IF_RECOVERY_AFTER_A_REFUSED_LITERAL — after the cascade over a refused `LTOD#`/`LDT#` in a THEN branch, TwinCAT
 * stays out of the IF: "Unexpected Token 'ELSE' found", "';' expected instead of 'F_LANG_…'" on the ELSE branch's target,
 * "Unexpected Token 'END_IF' found" and "';' expected instead of end of POU". The LSP resumes inside the IF and says none
 * of the four. Statement recovery, R2/R3's (task 2.8.3).
 */
const TWINCAT_IF_RECOVERY_AFTER_A_REFUSED_LITERAL: readonly string[] = [
  "xf_ldt_to_date_call_once",
  "xf_ltod_to_date_call_once",
  "xf_ldt_to_ldate_call_once",
  "xf_ltod_to_ldate_call_once",
]

/**
 * TWINCAT_NOTHING_OF_PLC_PRG_BESIDE_A_PARSE_ERROR — PLC_PRG calls the conversion (`LDT_TO_DATE(F(calls))`, and in the
 * `_to_ldate` pair `LDATE_TO_ULINT(d)`), which TwinCAT does not have. The LSP says "Identifier 'LDT_TO_DATE' not defined",
 * "Program name, function or function block instance expected instead of 'LDT_TO_DATE'" and the "Cannot convert" after
 * them; TwinCAT says nothing about PLC_PRG in these builds, and no TwinCAT recording carries an "Identifier
 * '<L-type>_TO_…' not defined" anywhere. Whether TwinCAT checks a POU at all while another fails to parse is unrecorded;
 * it is a FALSE POSITIVE by the parity rule until it is, LSP-only on all five. Build-order recovery, task 2.8.3.
 */
const TWINCAT_NOTHING_OF_PLC_PRG_BESIDE_A_PARSE_ERROR: readonly string[] = [
  "xf_ldate_to_date_call_once",
  "xf_ldt_to_date_call_once",
  "xf_ltod_to_date_call_once",
  "xf_ldt_to_ldate_call_once",
  "xf_ltod_to_ldate_call_once",
]
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
  //   `cc6_loop_cannot_exit` — C0266 is configurable and is OFF in both recording projects: each records only
  //                       the sign-change warning in `FOR small : SINT := 1 TO 200`, which the LSP matches.
  //   `cc3_pointer_conversions` — TwinCAT prints `Variable of type '1' requires exactly 1 Index`, with the
  //                       INDEX where the type belongs. CODESYS names the type and the LSP matches CODESYS;
  //                       reproducing this one would be copying a vendor defect, not reaching parity.
  twincat: new Set<string>([
    ...R1_CASCADE_AFTER_A_STRAY_TOKEN,
    ...LITERAL_FOLLOW_ON_RULES,
    ...LITERAL_REFUSAL_DECLARATION_RECOVERY,
    ...TWINCAT_WSTRING_ESCAPE_RUNS_TO_END,
    ...TWINCAT_MALFORMED_ADDRESS_ALIGNMENT,
    ...TWINCAT_REFUSED_LDATE_LITERAL_STOPS,
    ...TWINCAT_IF_RECOVERY_AFTER_A_REFUSED_LITERAL,
    ...TWINCAT_NOTHING_OF_PLC_PRG_BESIDE_A_PARSE_ERROR,
    ...TWINCAT_REFUSED_PREFIX_INSIDE_A_LIST,
    ...SYSTEM_OPERAND_AT_STATEMENT_START,
    ...TWINCAT_XSIZEOF_IS_NO_KEYWORD,
    ...TWINCAT_NO_EFFECT_AFTER_AN_UNKNOWN_WORD,
    ...TWINCAT_VECTOR_REFUSAL_CASCADE,
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
    ...R1_CASCADE_AFTER_A_STRAY_TOKEN,
    ...COMPONENT_CARRIED_ON_IN_A_DUT,
    ...LITERAL_FOLLOW_ON_RULES,
    ...LITERAL_REFUSAL_DECLARATION_RECOVERY,
    ...SYSTEM_OPERAND_AT_STATEMENT_START,
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
    //   `tr_20_output_index_moved_by_callee` (transpile-review-2026-09-29 task 20, recorded 2026-09-29) — CODESYS
    //                            builds and RUNS it; the LSP reports `'o' is no output of 'F_CS_OUT20'` and a
    //                            wrong input count for the FUNCTION's `o => arr2[gCsK20]` output binding. An LSP
    //                            false positive this fixture found, open until the call check reads a FUNCTION's
    //                            VAR_OUTPUT; it must leave this list the day it stops.
    "tr_20_output_index_moved_by_callee",
  ]),
}
