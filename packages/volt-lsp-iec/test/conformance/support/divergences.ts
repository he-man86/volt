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
 *   (`cc3_reference_assign` left 2026-10-02: a second cell, `stmt_ref_eq_literal_value`, says TwinCAT reverses the
 *                             pair for EVERY literal `REF=` statement — `refLiteralCannotConvert`.)
 *   (`cc5_deprecated_functionblock_keyword` left 2026-10-02, frontend-conformance 2.8.1: a POU's text opening with a name
 *                             declares nothing and the parser says nothing about it, as both vendors — `parse/parser`.)
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
 *                             "Cannot convert type 'STRING(INT#23)' to type 'DINT'" in an implementation and
 *                             `STRING(INT#13)` in a declaration (`sysop_position_initializer`, a known divergence since
 *                             frontend-conformance 2.8.3: `CODESYS_POSITION_IN_AN_INITIALIZER`).
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
])

export const TWINCAT_TRIAGE: ReadonlySet<string> = new Set<string>([])
/** Fixtures that legitimately do NOT match, each with a documented reason. Empty until a real divergence
 *  is confirmed against a recording (not a not-yet-ported check — those are tracked by the ratchet). */
// subrange is NO LONGER a divergence: the check now emits the compilers' own type-CONVERSION wording
// (`Cannot convert type '200' to type 'INT (1..100)'`, folded onto `cannotConvert`) — byte-identical on both,
// so it's in the ratchet. array-index-out-of-bounds is likewise byte-identical. The overflow fixtures are NOT
// here: the `constant-overflow` check was REMOVED (it false-positived — CODESYS accepts out-of-range untyped
// literals), so the LSP is silent on them; they read as honest "not-yet-implemented" misses.
// FRONTEND-CONFORMANCE 2.1 (2026-09-30) opened `R1_CASCADE_AFTER_A_STRAY_TOKEN` here — `n := 1 ! 2;`, `n := 7 DIV 2;` and
// the eight other `lex_unknown_character*`: the vendors' resync after the first stray token, where the statement parser
// skipped to the `;` in silence. Closed in 2.5 (2026-10-01): a statement without its `;` STANDS and the parser resyncs as
// the vendors do (`parse/statements` `resyncAfterMissingSemicolon`) — the rule the `**`/`&` refusals needed.

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
 * triage 2026-09-30). Task 2.5.6 (2026-10-02) asked `__POOL` where it qualifies a name (`expr_pool_qualified_*`, pinned
 * with the expressions below): a lookup in the POUs view, which the workspace does not model — they stay pinned.
 */
const SYSTEM_OPERAND_AT_STATEMENT_START: readonly string[] = [
  "lex_keyword_assigned_sys_currenttask",
  "lex_keyword_before_name_sys_currenttask",
  "lex_keyword_assigned_sys_pool",
  "lex_keyword_before_name_sys_pool",
  "lex_keyword_operand_sys_pool",
  // …and CALLED where a statement starts (review 2.6, both vendors 2026-10-02): `__currenttask(n);` and `__pool(n);` are
  // the same member read of the next token ("The code '__CURRENTTASK.!!!'ERROR'!!!;' has no effect", `__POOL`'s
  // "Global scope operation '.' …"); the LSP reads a call. Niche, as above (0 in the corpora).
  "lex_keyword_called_sys_currenttask",
  "lex_keyword_called_sys_pool",
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
  // the call of a TYPE, named in the note above and held here since frontend-conformance 2.8.3 emptied the parse census:
  // the lone type argument stands only in a KEYWORD operator's call, which XSIZEOF is to the LSP on both vendors
  "cp_xsizeof",
  "lex_keyword_assigned_xsizeof",
  "lex_keyword_before_name_xsizeof",
  "lex_keyword_operand_xsizeof",
  // …and called where a statement starts, `xsizeof(n);`: "Identifier 'xsizeof' not defined" and "Program name, function
  // or function block instance expected instead of 'xsizeof'" — the LSP refuses CODESYS's reserved word (review 2.6)
  "lex_keyword_called_xsizeof",
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
 * aside), so one list serves both. (`lit_invalid_digit_hex` and `lit_time_underscore` left in 2.5, 2026-10-01: the
 * statement without its `;` now stands and the parser resumes at the name, "The code 'G;' has no effect", as both do.)
 *   `lit_real_no_leading_digit` — `.5` is no literal on either vendor: a leading `.` is the GLOBAL SCOPE operator, so
 *                            they answer "Identifier expected instead of '5'" and "Global scope operation '.' is not
 *                            valid on expression '!!!'ERROR'!!!'". The `.name` primary is E33 (task 2.5.6); the LSP's
 *                            "expected expression, got punct '.'" is Volt's wording until then.
 *   (`lit_time_fraction_ms` left 2026-10-02, task 2.8.3: the IL operator S left after the literal is refused as a WORD
 *                            in the resync, `parse/errors` `reportStatementCascade`.)
 */
/**
 * FRONTEND-CONFORMANCE 2.5 (2026-10-01) — expression fixtures (`fixtures/grammar/expressions.ts`) whose disagreement is a
 * rule the parser cannot decide, each NICHE: about zero occurrences in the six corpora, and not trivial. Both vendors
 * answer each identically (TwinCAT's capitals aside), so one list serves both:
 *   `expr_trailing_comma_conversion_call`, `expr_ampersand_in_argument` — a CONVERSION (`INT_TO_DINT`, `BOOL_TO_INT`)
 *                            takes ONE argument as an operator does: after it the vendors want the `)` — "')' expected
 *                            instead of ','" for `INT_TO_DINT(a,)`, "… '&'" for `BOOL_TO_INT(a & b)` — where a user
 *                            function's list says "',' or ')' expected" and takes a trailing comma
 *                            (`expr_ampersand_in_user_call`, `expr_trailing_comma_call`). The parser cannot tell a
 *                            conversion from a user function named like one (pro2193 calls a FUNCTION `RANGE_TO_WORD`
 *                            with three arguments); that is the type layer's name. Niche: accepted loss (0 occurrences in
 *                            the corpora: no conversion call holds a second argument, a trailing comma or `&`).
 *   `expr_member_named_type_keyword` — `bx.INT`: an elementary type's name where a member's belongs is refused as a keyword
 *                            member is, "'INT' is no component of 'bx'", the analysis of the body stopping there; the
 *                            lexer reads `INT` as a name, so the LSP answers it as an unknown member ("… of
 *                            'DUT_LANG_…'" and the conversion of the unknown type). Niche: accepted loss (0 occurrences:
 *                            no component can be declared with such a name).
 *   `expr_en_eno_call` — EN and ENO on a user FUNCTION called in ST are no parameters there: "Identifier 'EN' not defined",
 *                            "Identifier 'ENO' not defined" and the input count ("requires exactly '2' inputs"), where
 *                            `call-arguments` says "'EN' is no input of …". The call checks' (the LSP review); niche:
 *                            accepted loss (0 occurrences: the corpora's `EN :=` are FB and PROGRAM calls, which build).
 *   `expr_trailing_comma_operator_call_in_initializer` — `c : INT := MAX(1, 2,);`: the LSP refuses the `)` as the vendors
 *                            do ("Expression expected instead of ')'"), and misses the two messages about the value they
 *                            keep, `MAX(MAX(SINT#1, 2), !!!'ERROR'!!!)` — a nested echo of the operator's operands with a
 *                            typed literal, and "Unknown type: '!!!'ERROR'!!!'" for a CALL's operand where
 *                            `refused-initializer` knows a binary operator's. Missing-only; niche: accepted loss (0
 *                            occurrences in the corpora: they build, and a trailing comma in an operator's list does not).
 *   (`stmt_case_const_expr_label`, `stmt_case_paren_label`, `stmt_case_nonconst_label` left 2026-10-02, task 2.6: a
 *                            literal or `(` where a statement starts is refused, and a binary operation as a statement
 *                            is "no valid statement" — the statements' rules, ST5.)
 *   `expr_pool_qualified_call`, `expr_pool_qualified_global`, `expr_pool_qualified_fb_type` — `__POOL.X` (rule E34,
 *                            task 2.5.6, 2026-10-02) looks X up in the POUs VIEW only, and an object of the APPLICATION
 *                            is not there: `__POOL.F(a, b)` is "Identifier 'F' not defined", the call-target and the
 *                            conversion messages (TwinCAT adds "Identifier 'a'/'b' not defined"), `__POOL.gPool` the same
 *                            for a global — yet `inner : __POOL.FB_x;` as a declared TYPE builds on both. The workspace
 *                            does not say which view an object lives in, so the LSP reads `__POOL.X` as X's member
 *                            access (silent) and refuses the type at parse. Niche: accepted loss (0 occurrences of
 *                            `__POOL` in the corpora, in any position).
 *   (`expr_inline_assign_operand` left 2026-10-02, task 2.6: a chain's inner target that is no name is refused, ST4.)
 *   `expr_global_namespace_ambiguous_bare` — a bare `gAmb` two lists declare is "Ambiguous use of name 'gAmb'" AND
 *                            "Identifier 'gAmb' not defined" and the conversion of the hole on both vendors (2026-10-02):
 *                            the name resolves to nothing. The LSP says the first (`names/ambiguous-global`) and resolves
 *                            the name to the first list's, so it types it — the `.gAmb` beside it agrees (`lookupGlobal`).
 *                            Missing-only; niche: accepted loss (0 occurrences in the corpora, which build).
 */
const EXPRESSION_NICHE_DIVERGENCES: readonly string[] = [
  "expr_trailing_comma_conversion_call",
  "expr_ampersand_in_argument",
  "expr_member_named_type_keyword",
  "expr_en_eno_call",
  "expr_trailing_comma_operator_call_in_initializer",
  "expr_pool_qualified_call",
  "expr_pool_qualified_global",
  "expr_pool_qualified_fb_type",
  "expr_global_namespace_ambiguous_bare",
]

/**
 * FRONTEND-CONFORMANCE 2.6 (2026-10-02) — statement fixtures (`fixtures/grammar/statements.ts`) whose disagreement is a
 * rule of a later task or niche. Both vendors answer each identically (TwinCAT's capitals aside), so one list serves both:
 *   (`stmt_assign_missing_value`, `stmt_if_else_if_two_words`, `stmt_s_eq_spaced`, `stmt_assign_spaced_operator` left
 *                            2026-10-02, frontend-conformance 2.8: the one operand wording (R5), the block left open (R2),
 *                            the IL operator S refused as a word in the resync (R6), the label checks reading a body that
 *                            did not parse cleanly — `symbols` `bodiesThroughErrors`.)
 *   `stmt_case_const_expr_label`, `stmt_case_paren_label` — `2 + 1:` and `(2):` are no CASE label: the literal or `(`
 *                            opening the line is refused as a statement start ("Unexpected token '2' / '(' found"), as
 *                            the LSP says, and then the two vendors resync differently — CODESYS in silence to END_CASE
 *                            ("';' expected instead of 'END_CASE'"), TwinCAT on through the colon — where the LSP runs
 *                            the statement cascade to the `;`. Niche: accepted loss (0 occurrences in the corpora, which
 *                            build).
 *   `stmt_for_literal_control` — `FOR 1 := 1 TO 3 DO`: "'1' is no valid assignment target", as the LSP says, and "Cannot
 *                            convert type 'SINT' to type 'BIT'" (TwinCAT also "'BIT' to type 'BIT'"), a typing of the
 *                            refused counter no rule explains. Missing-only; niche: accepted loss (0 occurrences of a
 *                            literal FOR counter in the corpora).
 */
const STATEMENT_DIVERGENCES: readonly string[] = [
  "stmt_for_literal_control",
  "stmt_case_const_expr_label",
  "stmt_case_paren_label",
]

/**
 * FRONTEND-CONFORMANCE 2.6 (2026-10-02) — TwinCAT wants a `__CATCH` after the `__TRY` block: `__TRY … __ENDTRY` and
 * `__TRY … __FINALLY … __ENDTRY` are "Unexpected token '__ENDTRY' / '__FINALLY' found", the resync, and "Unexpected
 * End-of-file found: '__CATCH', '__FINALLY' or '__ENDTRY' expected", where CODESYS builds both (its application then
 * fails to start: `execSkip`) and the LSP says nothing. Niche: accepted loss (0 `__TRY` in the TwinCAT corpus, and
 * every one of the 36 `__TRY` in the CODESYS corpora has its `__CATCH`).
 */
const TWINCAT_TRY_NEEDS_CATCH: readonly string[] = ["stmt_try_without_catch", "stmt_try_finally_only"]

const LITERAL_FOLLOW_ON_RULES: readonly string[] = [
  "lit_real_no_leading_digit",
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
 * an aggregate, a STRUCT field's or an enum value's initializer (a CASE label left the set in review 2.8: "No case label found" is
 * the first arm's missing label, `rec_refused_word_case_label_first`). Both sides refuse the token ("Expression
 * expected instead of 'CHAR#'"); TwinCAT then words the refusal by the place — "',' or ')' expected" in `ABS(…)`, "')'
 * expected" in a one-parameter `TO_INT(…)`, "', or )' expected" in an enum's list — and recovers
 * by that place's rule: it closes the VAR block or the TYPE ("'END_VAR' expected instead of ''"), carries the refused
 * value on as `!!!'ERROR'!!!` into a conversion, and checks the next enum value against it. The LSP resyncs as from a
 * refused statement. Both missing and LSP-only; recovery, R2/R3's (task 2.8.3). CODESYS reads none of these as a refused
 * token (they are an enum literal or a component there): it agrees on the first three, and the two DUT ones are
 * `COMPONENT_CARRIED_ON_IN_A_DUT`'s.
 */
const TWINCAT_REFUSED_PREFIX_INSIDE_A_LIST: readonly string[] = [
  "lit_enum_typed_as_argument",
  "lit_enum_typed_as_conversion_argument",
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
/**
 * FRONTEND-CONFORMANCE 2.3.6 (2026-10-01) — type expressions whose one disagreement is the vendors' RECOVERY after the
 * first refusal, identical on both: the LSP says that first message — "Type definition expected instead of ';'"
 * (`decl_type_missing`), "'..' expected instead of ')'" (`decl_subrange_one_bound`), "'..' expected instead of ']'"
 * (`decl_array_single_bound`, `_empty_dims`, `_mixed_star`), "'*' expected instead of '0'" (`decl_array_star_then_fixed`),
 * "'OF' expected instead of 'INT'", "'TO' expected instead of 'INT'" (`decl_array_missing_of`, `decl_pointer_missing_to`),
 * "'(' expected instead of '3'" (`decl_wstring_brackets`), "')' expected instead of ']'"
 * (`decl_wstring_brackets_mismatched`), "Identifier expected instead of '5'" (`decl_type_enum_number_name`) — and the
 * vendors then resync through the rest of the list ("'] or ,' expected instead of ':'", "'OF' expected instead of
 * 'END_VAR'", "Type definition expected instead of ''", "'END_VAR' expected instead of ''", "';, :=, REF=, ( or ['
 * expected instead of ':'", "Type definition expected instead of ')'", "':= or ;' expected instead of 'END_TYPE'", and
 * "Identifier 'out' not defined" for the declaration the resync swallows). Missing-only but one: after WSTRING's missing
 * `)` the LSP's own recovery says "';' expected instead of ']'" and "Identifier expected instead of ']'" where the vendors
 * skip the `]` (LSP-only, an error where the build fails). Task 2.8.2.
 *
 * Added by the 2.3b review, the same shape: `decl_array_single_bound_used` — the refused `ARRAY[5]` USED: the vendors'
 * resync swallows `i` and `out` too and says "Identifier 'a' not defined", "'a[1]' is no valid assignment target" and
 * the same for `i` and `out`; the LSP drops the refused declaration alone and says nothing for its uses (missing-only,
 * no LSP-only line). `decl_type_enum_missing_comma`, `decl_type_enum_value_then_name` — the LSP says the vendors' first
 * line ("':=, , or )' expected instead of 'tm_b'", "', or )' expected instead of 'tv_b'"), the vendors then close the
 * TYPE ("':= or ;' expected instead of ''", "'END_TYPE' expected instead of ''", "Type definition expected instead of
 * 'END_TYPE'").
 */
const TYPE_EXPRESSION_RECOVERY: readonly string[] = [
  "decl_type_missing",
  "decl_subrange_one_bound",
  "decl_array_single_bound",
  "decl_array_empty_dims",
  "decl_array_mixed_star",
  "decl_array_star_then_fixed",
  "decl_array_missing_of",
  "decl_pointer_missing_to",
  "decl_wstring_brackets",
  "decl_wstring_brackets_mismatched",
  "decl_type_enum_number_name",
  "decl_array_single_bound_used",
  "decl_type_enum_missing_comma",
  "decl_type_enum_value_then_name",
]

/**
 * FRONTEND-CONFORMANCE 2.3.6 (2026-10-01) — an IMPLICIT enum's list where the vendors' parse goes another way than in a
 * TYPE enum's, both vendors alike:
 *   `decl_implicit_enum_number_name` — `e : (nn_a, 5);`: the TYPE enum's list says "Identifier expected instead of '5'"
 *     (`decl_type_enum_number_name`), the implicit one does NOT, and goes on to "Type definition expected instead of ')'".
 *     The LSP reads both lists with one parser and says the Identifier line in both (LSP-only here).
 *   `decl_implicit_enum_missing_close` — `e : (mc_a, mc_b;`: no "')' expected" at all, but "Type definition expected
 *     instead of 'END_VAR'" and the recovery; the LSP says "', or )' expected instead of ';'" (LSP-only — TwinCAT's words
 *     for a value followed by neither, `lit_char_typed_in_enum_value`).
 *   `decl_implicit_enum_missing_comma` — `e : (mm_a mm_b);`: no line at the list at all, but "';, :=, REF=, ( or ['
 *     expected instead of 'out'" at the NEXT declaration, and "Identifier 'out' not defined"; the LSP says the TYPE enum's
 *     "':=, , or )' expected instead of 'mm_b'" (LSP-only) — 2.3b review.
 * Niche: accepted loss (0 occurrences in the corpora — their 30 implicit enums, all in pro2193, are well-formed lists).
 */
const IMPLICIT_ENUM_LIST_RECOVERY: readonly string[] = [
  "decl_implicit_enum_number_name",
  "decl_implicit_enum_missing_close",
  "decl_implicit_enum_missing_comma",
]

/**
 * FRONTEND-CONFORMANCE 2.3.6 (2026-10-01) — an implicit enum's TYPE NAME, both vendors: it is a type of its own, named
 * `Implicit_Enum__<POU>__<variable>` — "A local variable named 'du_a' is already defined in
 * 'Implicit_Enum__FB_…__e'" (`decl_implicit_enum_duplicate`, where the LSP names the POU) and, upper-cased, "Cannot
 * convert type 'Unknown type: 'is_b'' to type 'IMPLICIT_ENUM__DUT_…__F'" (`decl_implicit_enum_in_struct`, where the LSP
 * renders '(IMPLICIT)'). The rule and the scope agree; only the name differs, and the Type model has no owner to name it
 * by. NOT niche: pro2193 declares 30 implicit enums (state variables, `( … ) DINT`), whose every message would name the
 * type. The type render (DT10, task 4.7.4) with the owner from the binder (EN4, task 3.3).
 *
 * The same missing identity keeps an implicit enum's value from being CHECKED where it is stored (2.3b review, both
 * vendors): "Cannot convert type 'IMPLICIT_ENUM__FB_…__E' to type 'BYTE'" for a value stored into a BYTE, with or
 * without a written base (`decl_implicit_enum_into_byte`, `decl_implicit_enum_with_base_into_byte`), and C0327's
 * warning "Implicit conversion from one enumeration type (IMPLICIT_ENUM__…__E2) to another (IMPLICIT_ENUM__…__E1)" for
 * one implicit enum's value stored into another (`decl_implicit_enum_cross_assign`). The LSP says neither: every
 * implicit enum is ONE type, `(implicit)`, with no base, so it neither converts as INT nor tells two of them apart —
 * and C0327 is not implemented for TYPE enums either. Missing-only. The corpora build clean of both.
 */
const IMPLICIT_ENUM_TYPE_NAME: readonly string[] = [
  "decl_implicit_enum_duplicate",
  "decl_implicit_enum_in_struct",
  "decl_implicit_enum_into_byte",
  "decl_implicit_enum_with_base_into_byte",
  "decl_implicit_enum_cross_assign",
]

/**
 * FRONTEND-CONFORMANCE 2.3.6 (2026-10-01) — A STRING LENGTH IS RENDERED AS WRITTEN, both vendors: "String constant ''a...'
 * too long for destination type 'STRING(N)'" for `STRING(N)`/`STRING[N]` (`decl_string_length_constant`, `_brackets`)
 * and 'STRING((2 + 3))' for `STRING(2+3)` (`decl_string_length_expression`) — the written length in the compiler's own
 * expression form, where the Type model holds a folded number and renders 'STRING(5)'. For a length from a LOCAL
 * `VAR CONSTANT` the LSP says nothing at all: `resolve` folds a type's length in the project scope, where the constant
 * is not (a global constant folds — and renders folded). NOT niche: 581 string lengths in the corpora are written as a
 * name or an expression. The type render (DT10/DT11, task 4.7.4) and the fold scope (CE1–CE5, task 4.6.2).
 */
const STRING_LENGTH_AS_WRITTEN: readonly string[] = [
  "decl_string_length_constant",
  "decl_string_length_constant_brackets",
  "decl_string_length_expression",
]

/**
 * FRONTEND-CONFORMANCE 2.3.6 (2026-10-01) — `v : NoSuchLib.T;`: both vendors "Unknown type: 'NoSuchLib.T'". Closed on
 * CODESYS by 3.4.2 (2026-10-02): a qualifier that names nothing is the unknown name (`analysis/resolution.ts`
 * `unknownQualifiedTypeName`). TWINCAT ONLY now: the unknown-type verdict is CODESYS's alone — TwinCAT's materialization
 * (`References/`) does not carry every type its compiler knows (`unknownTypeName`).
 */
const UNKNOWN_QUALIFIED_TYPE: readonly string[] = ["decl_type_unknown_qualified"]

/**
 * FRONTEND-CONFORMANCE 2.4a (2026-10-01) — what each vendor says AFTER a unit header it refuses. The LSP gives the
 * refusal itself, in the vendor's words (`parse/units`: "Unexpected token 'IMPLEMENTS' found" and "';' expected instead
 * of '<name>'" for a clause where the header no longer takes one; "Identifier expected instead of 'VAR'" for a list
 * ending in a comma; "Identifier expected instead of 'PRIVATE'" for an access modifier after another one; "Unexpected
 * token 'EXTENDS' found" for `STRUCT EXTENDS`), and not the vendors' recovery after it, which is each vendor's own and
 * conformance 2.8.2's:
 *   `unit_function_implements`, `unit_function_extends_after_return`, `unit_fb_implements_before_extends`,
 *   `unit_fb_implements_trailing_comma` — the rest of the declaration read as a declaration LIST ("',, AT or :'
 *     expected instead of 'VAR_INPUT'", "Unexpected token 'END_VAR' found", "';' expected instead of end of POU" on
 *     CODESYS; "VAR, VAR_INPUT, VAR_OUTPUT or VAR_INOUT expected instead of ITF…:;", "Type definition expected instead
 *     of 'END_VAR'" on TwinCAT) and every variable it held lost ("Identifier 'x' not defined");
 *   `unit_method_final_private_order`, `unit_method_two_access` — the method's object name no longer its signature's
 *     ("The name used in the signature is not identical to the object name") and the method not declared;
 *   `unit_struct_extends_list` — the bodiless type has no component ("'c' is no component of …"); the LSP types a
 *     refused body as nothing, and says nothing of its members.
 * Niche: accepted loss (0 occurrences in the corpora — no clause after a FUNCTION's return type, IMPLEMENTS before
 * EXTENDS, IMPLEMENTS list ending in a comma, access modifier after another modifier, STRUCT EXTENDS or EXTENDS list in
 * any of the six).
 */
/**
 * FRONTEND-CONFORMANCE 2.8.3 (2026-10-02) — `unit_struct_extends_after_struct`, `unit_struct_extends_twice`: the base read
 * as a field name ("',, AT or :' expected instead of 'b'"), the next field lost — the LSP reads it so since the declaration
 * resync resumes at a name and a refused `;` takes the declaration after it (`parse/errors` `reportBrokenDeclaration`,
 * `rec_refused_name_declared_fb_type`), and CODESYS agrees exactly. TwinCAT also loses the END_STRUCT, its own recovery.
 * Niche: accepted loss (0 STRUCT EXTENDS in the corpora).
 */
const TWINCAT_STRUCT_EXTENDS_RECOVERY: readonly string[] = ["unit_struct_extends_after_struct", "unit_struct_extends_twice"]

/**
 * FRONTEND-CONFORMANCE 2.8 (2026-10-02) — the error-recovery fixtures (`fixtures/grammar/recovery.ts`) whose one
 * disagreement is left, each niche:
 *   `rec_refused_name_cascade_il_word` (both) — `ld := n + st;`: the resync resumes a statement at `n` and refuses `st`
 *                            in it as both vendors do; they then judge the statement they rebuilt with the refused operand
 *                            as its placeholder, "'(n + !!!'ERROR'!!!);' is no valid statement", where the parser keeps no
 *                            statement with a refused operand. Missing-only; niche: accepted loss (0 occurrences in the
 *                            corpora — no IL operator or type name stands as an operand in a body that builds).
 *   `rec_refused_word_for_variable` — `FOR int := 1 TO 3 DO`: both vendors read the FOR on — "'TO' expected instead of
 *                            'int'", "'DO' expected instead of 'int'", "Counter initialisation expected" — before the
 *                            refused word's cascade, and leave the FOR's list where the IDE stops reporting; the LSP pairs
 *                            the word as an operand and closes the FOR at END_FOR. Both missing and LSP-only; niche:
 *                            accepted loss (0 occurrences in the corpora — review 2.8, 2026-10-02).
 *   `rec_type_name_dot_dangling` — `v : DUT.;`: both vendors refuse the TYPE ("Type definition expected instead of
 *                            'DUT'") and abandon the VAR section ("'END_VAR' expected instead of ''"), so the declarations
 *                            after it are lost ("Identifier 'out' not defined", "'out' is no valid assignment target");
 *                            the LSP says "expected identifier after '.'" and keeps the section. Both missing and
 *                            LSP-only; niche: accepted loss (0 occurrences in the corpora — review 2.8, 2026-10-02).
 * TwinCAT alone:
 *   `rec_interface_stray` — a name inside an INTERFACE: TwinCAT reads the declaration back first ("VAR, VAR_INPUT,
 *                            VAR_OUTPUT or VAR_INOUT expected instead of stray:;", "Type definition expected instead of
 *                            ''"), where the LSP says CODESYS's one line. Missing-only; niche: accepted loss (0 stray
 *                            tokens in the corpora's interfaces).
 *   `rec_refused_name_declared_fb_type` — `ld : TON; out : INT;`: after CODESYS's lines, which the LSP says, TwinCAT's own
 *                            recovery adds "Type definition expected instead of 'END_VAR'" and "'END_VAR' expected instead
 *                            of ''". Missing-only; niche: accepted loss (0 refused declared names in the corpora).
 */
const RECOVERY_DIVERGENCES: readonly string[] = ["rec_refused_name_cascade_il_word", "rec_refused_word_for_variable", "rec_type_name_dot_dangling"]

/**
 * FRONTEND-CONFORMANCE 2.8.3 (2026-10-02) — the CONDITIONAL CALL `CALC` (the IL operator that parses as a call where every
 * other refused word is a word, `lex/vocabulary` `IL_OPERATOR_WORDS`): its cascade is the vendors' own and unmodelled.
 * `calc : INT;` is read as a conditional call in the declaration part ("'(' expected instead of ':'", "This code is not
 * supported in declaration part", "Second parameter of conditional call must be a valid call statement" …, which the LSP
 * says) and then runs off the end of it ("';' expected instead of 'END_VAR'", "'END_VAR' expected instead of ''", "';'
 * expected instead of end of POU", and "The code '!!!'ERROR'!!!;' has no effect" — `cc_il_name_calc`); `CALC(flag, n :=
 * 2);` and its three siblings say the second-parameter error, which the LSP says, then a pair per token of the rest and a
 * warning for `flag` (`ilc_calc_*`). Missing-only, both vendors; niche: accepted loss (0 occurrences of CALC as code in
 * the corpora — two comments).
 */
const CALC_CONDITIONAL_CALL: readonly string[] = [
  "cc_il_name_calc",
  "ilc_calc_called_properly",
  "ilc_calc_declared_unused",
  "ilc_calc_other_type",
  "ilc_calc_used_not_declared",
]

/**
 * FRONTEND-CONFORMANCE 2.8.3 (2026-10-02) — CODESYS, `here : DINT := __POSITION;` (`sysop_position_initializer`, from the
 * CODESYS triage backlog): the position's SIZED string type ("Cannot convert type 'STRING(INT#13)' to type 'DINT'", the
 * LSP's 'STRING' — the seam the backlog note describes) and, in an INITIALIZER, `__POSITION` without its `(` eating the
 * `;` as it does in a body — "';' expected instead of 'END_VAR'" and "'END_VAR' expected instead of ''", the declaration
 * running to the end of the part. Both one fixture each; niche: accepted loss (0 `__POSITION` in the corpora).
 */
const CODESYS_POSITION_IN_AN_INITIALIZER: readonly string[] = ["sysop_position_initializer"]
const TWINCAT_RECOVERY_DIVERGENCES: readonly string[] = ["rec_interface_stray", "rec_refused_name_declared_fb_type"]

const UNIT_HEADER_RECOVERY: readonly string[] = [
  "unit_function_implements",
  "unit_function_extends_after_return",
  "unit_fb_implements_before_extends",
  "unit_fb_implements_trailing_comma",
  "unit_method_final_private_order",
  "unit_method_two_access",
  "unit_struct_extends_list",
  // 2.4a review (2026-10-01): an access modifier after FINAL on an INTERFACE method — the LSP gives the vendors' first
  // message, "Identifier expected instead of 'PUBLIC'"; both go on to read the object name '' (the signature, the
  // `;`, the parameters-only rule and a missing implementation of method '')
  "unit_interface_method_final_public_order",
]

/**
 * FRONTEND-CONFORMANCE 2.4a (2026-10-01) — an ACTION's header text, which the PUSH drops: a CODESYS action has no
 * declaration, so `ACTION Act` + a VAR section reaches the IDE as the body alone ("Identifier 't' not defined", both
 * vendors), and `ACTION PRIVATE Act` as a plain action (it builds). The LSP reads the text as written and refuses both.
 * A bridge fact, reported to the owner (the push drops text silently); niche: accepted loss (0 occurrences in the
 * corpora — a pulled action never carries a header beyond its name).
 */
const ACTION_HEADER_DROPPED_BY_THE_PUSH: readonly string[] = ["unit_action_var_section", "unit_action_modifier"]

/**
 * FRONTEND-CONFORMANCE 2.10 (2026-10-02) — an accessor's text the PUSH drops, U16's accessor cells: the push reads an
 * accessor's declaration from the lines UNDER its keyword line and drops that line whole, so `GET PRIVATE` reaches both
 * IDEs as `GET`; and it closes a `GET` without END_GET at its own line, so the getter's body never reaches them (both
 * build what they were given, clean). The recordings are of the rewritten text; the LSP refuses the text as written, by
 * name, because the push would drop it (`parse/units/property.ts`, `property.test.ts`). Volt's format, not a vendor's
 * rule; the silent drop is the bridge's (reported). Niche: accepted loss (0 occurrences in the corpora — every accessor
 * line there stands alone and is closed).
 */
const ACCESSOR_TEXT_DROPPED_BY_THE_PUSH: readonly string[] = [
  "unit_property_accessor_modifier",
  "unit_property_no_end_get",
  "unit_property_no_end_get_alone",
]

/**
 * FRONTEND-CONFORMANCE 2.4a (2026-10-01) — a PRIVATE or PROTECTED FUNCTION_BLOCK, CALLED: both vendors add "Cannot access
 * private method ???.FB_…" (TwinCAT "…private Method…") at the call, beside the header's "PRIVATE and PROTECTED may only
 * be applied on methods of function blocks", which the LSP gives (`unit_fb_private_not_called` has the header's alone).
 * Member access is conformance 3.5's (M1–M6: "access modifiers resolve first and are refused after"). Missing-only;
 * niche: accepted loss (0 PRIVATE or PROTECTED function blocks in the corpora).
 */
const FB_ACCESS_AT_THE_CALL: readonly string[] = ["unit_fb_private", "unit_fb_protected"]

/**
 * FRONTEND-CONFORMANCE 2.4a (2026-10-01) — `unit_enum_extends_enum`: `e := VA`, a value of ANOTHER enum type, is the
 * warning "Implicit conversion from one enumeration type (BASE) to another (E)" on both vendors (as
 * `decl_implicit_enum_cross_assign`), where the LSP's assignment check refuses it ("Cannot convert type …") — an
 * LSP-only error. The question the fixture asks (EXTENDS on an enum) agrees; the enum conversion is conformance 4.5.1's
 * (CV3–CV5).
 */
const ENUM_TO_ENUM_IS_A_WARNING: readonly string[] = ["unit_enum_extends_enum"]

/**
 * FRONTEND-CONFORMANCE 2.4a (2026-10-01), TwinCAT only:
 *   `unit_fb_extends_qualified` — TwinCAT has no `Standard` namespace (its library is Tc2_Standard), so the base is
 *     not found, as the LSP says; TwinCAT then reports every inherited name the body uses ("Identifier 'PT' not
 *     defined"), where the LSP is silent inside an FB whose base did not resolve (`hasUnresolvedBase`) — H6, task 3.2.4;
 *   `unit_fb_modifier_twice`, `unit_fb_public_internal`, `unit_fb_final_public_order` — the FB left undeclared is
 *     "Unknown type" where it is used, which the LSP has no standing to say on TwinCAT (`unknownTypeName`: its
 *     References/ materialization lacks types the compiler knows). CODESYS agrees exactly on all three;
 *   `unit_namespace_opening_only` (2.4.6) — the same "Unknown type" for an FB whose text opens with `NAMESPACE N`, which
 *     TwinCAT, like CODESYS, leaves undeclared without a word about the text. CODESYS agrees exactly. Niche: accepted
 *     loss (0 occurrences in the corpora — their 695 NAMESPACE lines are all library manifests', no source text holds one).
 */
const TWINCAT_UNIT_DIVERGENCES: readonly string[] = [
  "unit_fb_extends_qualified",
  "unit_fb_modifier_twice",
  "unit_fb_public_internal",
  "unit_fb_final_public_order",
  "unit_namespace_opening_only",
]

/**
 * FRONTEND-CONFORMANCE 2.3.6 (2026-10-01) — what a vendor says AFTER a declared type it refuses, each one cell and each
 * missing-only (the LSP says the refusal itself, `analysis` declared-type):
 *   `decl_array_reversed_bounds` (CODESYS) — "The variable 'a' is too large. (variable size: 2147483647, …)": the
 *     reversed dimension sized as a negative count;
 *   `decl_subrange_reversed` (TwinCAT) — "Cannot convert type '10' to type 'INT (10..0)'": the subrange's default checked
 *     against it;
 *   `decl_subrange_on_alias` (TwinCAT) — "No matching FB_init method found for instantiation of DUT_…": the refused
 *     parentheses read as FB_Init's arguments;
 *   `decl_array_star_in_function_input`, `decl_array_star_in_method_input` (TwinCAT) — the refused `ARRAY[*]` input typed
 *     on: "Cannot convert type 'ARRAY [0..1] OF INT' to type 'ARRAY[*] OF INT'", "Cannot apply indexing with [] to …",
 *     "Cannot convert type 'Unknown type: 'a[1]''";
 *   `decl_vector_constant_size` (TwinCAT, which has no __VECTOR) — "Cannot convert type 'Unknown type: 'v[2]'' to type
 *     'REAL'" for the undefined vector passed to REAL_TO_INT;
 *   `decl_array_of_array_comma_index` (both) — `a[1, 2] := 5` on an ARRAY OF ARRAY: after "Array requires exactly 1
 *     indexes" the target is typed as `a[1]`, "Cannot convert type 'SINT' to type 'ARRAY [0..2] OF INT'".
 * Niche: accepted loss (0 occurrences in the corpora — no reversed bound, subrange of an alias, variable-length input of
 * a function or method on TwinCAT, __VECTOR or comma index into an array of arrays in any of the six).
 */
const AFTER_A_REFUSED_TYPE: Record<Vendor, readonly string[]> = {
  codesys: ["decl_array_reversed_bounds", "decl_array_of_array_comma_index"],
  twincat: [
    "decl_subrange_reversed",
    "decl_subrange_on_alias",
    "decl_array_star_in_function_input",
    "decl_array_star_in_method_input",
    "decl_vector_constant_size",
    "decl_array_of_array_comma_index",
  ],
}

/**
 * FRONTEND-CONFORMANCE 2.3 (2026-10-01) — declaration fixtures whose one disagreement is the vendors' RECOVERY after the
 * first refusal, identical on both: the LSP says that first message and nothing it does not have, and the vendors then
 * resync through the rest of the list in their own way — "',' or ')' expected instead of ':'", "', or ]' expected
 * instead of ':'", "';, := or REF=' expected instead of 'END_VAR'", "'END_VAR' expected instead of ''" after a bracket
 * list without `:=` (`decl_bracket_init_no_assign`, `_scalar`, `decl_struct_field_bracket_init`: "'(' expected instead
 * of '1'"); "';' expected instead of 'accF'" … "';' expected instead of end of POU" after a VAR_ACCESS section in a POU
 * (`decl_var_access_in_fb`: "Unexpected token 'VAR_ACCESS' found"); "'END_STRUCT' expected instead of 'END_VAR'" after
 * a VAR_ACCESS or VAR_GENERIC inside a STRUCT, where the LSP's own recovery says "unterminated STRUCT" (an LSP-only
 * message, left standing — an error where the build fails — until the recovery is the vendors'). Task 2.8.2.
 */
const DECLARATION_RECOVERY: readonly string[] = [
  "decl_bracket_init_no_assign",
  "decl_bracket_init_no_assign_scalar",
  "decl_struct_field_bracket_init",
  "decl_var_access_in_fb",
  "decl_var_access_inside_struct",
  "decl_var_generic_inside_struct",
  ...TYPE_EXPRESSION_RECOVERY,
]

/**
 * FRONTEND-CONFORMANCE 2.3.4 (2026-10-01) — `rec : DUT := (1, 2);`: both vendors keep `1` and type it BIT ("Cannot
 * convert type 'BIT' to type 'DUT_…'"); the LSP types an untyped 1 as every other one, SINT. `(5, 2)` says SINT on both
 * and agrees (`decl_struct_init_positional_five`). On an ARRAY the same BIT ("Cannot convert type 'BIT' to type 'ARRAY
 * [0..1] OF INT'", `decl_array_init_positional`, both vendors), where the LSP says nothing past the two parse errors.
 * Which literals are BIT, and where, is the literal typing rule's (area 4, task 4.1.3), and two cells are too little to
 * read it from.
 */
const LITERAL_ONE_IS_BIT: readonly string[] = ["decl_struct_init_positional", "decl_array_init_positional"]

/**
 * FRONTEND-CONFORMANCE 2.3.5 (2026-10-01) — a VAR_EXTERNAL section inside a STRUCT: both vendors refuse the section as the
 * LSP does, and then still look its declaration up among the globals: "No global definition found for VAR_EXTERNAL a".
 * The LSP refuses the section at parse and binds nothing from it, so no global lookup runs. Niche: accepted loss (0
 * occurrences in the corpora — they hold no VAR_EXTERNAL at all; frontend-conformance 3.1.3 counted).
 */
const EXTERNAL_LOOKUP_IN_A_REFUSED_SECTION: readonly string[] = ["decl_var_external_inside_struct"]

/*
 * (`GVL_MEMBER_NOT_DECLARED` — `decl_non_retain_in_gvl` — left 2026-10-02, frontend-conformance 3.1.3: `GVL.gNr`, a member the
 * list does not declare, is "'gNr' is no component of 'GVL_…'" with its conversion, as both vendors say (rule Y9,
 * `analysis/resolution` `checkMember`). TwinCAT keeps its NON_RETAIN recovery mark.)
 */

/**
 * FRONTEND-CONFORMANCE 2.3.4 (2026-10-01) — `[K+L(7)]` with K, L constants: the parser reads `L(7)` as L's call, as both
 * vendors do (`parse/initializer`), and the vendors then refuse the call — "Program name, function or function block
 * instance expected instead of 'L'" and "Unknown type: 'L(7)'". The LSP's call check and its hole rule walk BODIES and a
 * scalar initializer, not an aggregate's elements: the calls check's (`analysis` non-callable-call, unknown-source), outside
 * the front-end — the LSP review.
 */
const CALL_IN_AN_AGGREGATE_INITIALIZER: readonly string[] = ["decl_repeat_count_expression_names"]

/**
 * FRONTEND-CONFORMANCE 2.3 (2026-10-01) — TwinCAT's recovery after "',, AT or :' expected instead of 'k'" (a NAME after
 * the name NON_RETAIN): it goes on to "Type definition expected instead of 'END_VAR'", and in a GVL "'END_VAR' expected
 * instead of ''". CODESYS stops at the first, and the LSP agrees with CODESYS on all four. Task 2.8.2.
 */
const TWINCAT_NON_RETAIN_RECOVERY: readonly string[] = [
  "var_non_retain",
  "decl_non_retain_in_gvl",
  "decl_non_retain_in_var_input",
  "decl_retain_non_retain",
]

/**
 * FRONTEND-CONFORMANCE 2.3.1 (2026-10-01) — TwinCAT has no VAR_GENERIC: it reads the word as a declaration's NAME, and
 * the LSP lexes it as an identifier there too (`CODESYS_ONLY_KEYWORDS`). What each then says about the rest of the POU is
 * the declaration-area recovery (TwinCAT: "VAR, VAR_INPUT, VAR_OUTPUT or VAR_INOUT expected instead of VAR_GENERIC:;",
 * the LSP: its statement cascade) — task 2.8.2. That recovery is ALL this mark holds: the consumer's `inst : FB<6>;` is
 * refused by both at its `<` ("';, :=, REF=, ( or [' expected instead of '<'", `parse/declarations` `endAfterType`,
 * frontend-conformance 2.3a), so a fixture here agrees on that line and differs in the FB's own.
 */
const TWINCAT_NO_VAR_GENERIC: readonly string[] = [
  "decl_var_generic",
  "decl_var_generic_no_argument",
  "decl_var_generic_no_constant",
  "decl_var_generic_read",
  "decl_var_generic_two_values",
  "decl_var_generic_in_array",
  "decl_var_generic_in_array_no_argument",
  "decl_var_generic_in_array_two_values",
]

/**
 * FRONTEND-CONFORMANCE 2.3.5 (2026-10-01) — the TwinCAT RECORDING is cut, not the behaviour, as for `op_sys_varinfo`: the
 * echo of a VAR section inside a STRUCT is stored as "Variable declaration expected instead of VAR", where CODESYS stores
 * the whole message with the lines it quotes. The TwinCAT driver cuts a message at its first line break — a BRIDGE bug
 * to fix and re-record, not something for the LSP to match. Every placement message before the echo agrees.
 */
const TWINCAT_DRIVER_CUTS_THE_ECHO: readonly string[] = [
  // …and the section an unclosed VAR section meets, read back the same way (`rec_unterminated_var_before_section`, 2.8)
  "rec_unterminated_var_before_section",
  "decl_var_inside_struct",
  "decl_var_inside_struct_init",
  "decl_var_inside_struct_names",
  "decl_var_input_inside_struct",
  "decl_var_output_inside_struct",
  "decl_var_in_out_inside_struct",
  "decl_var_temp_inside_struct",
  "decl_var_stat_inside_struct",
  "decl_var_inst_inside_struct",
  "decl_var_global_inside_struct",
  "decl_var_config_inside_struct",
]

/**
 * FRONTEND-CONFORMANCE 2.3 (2026-10-01) — CODESYS-only:
 *   `decl_nested_aggregate` — `ARRAY[0..1, 0..1] OF INT := [[1, 2], [3, 4]]`: CODESYS SP21's compiler THROWS
 *     ("Internal error:System.NullReferenceException …" and its stack); TwinCAT says "Unexpected array initialisation",
 *     which the LSP says on both. A vendor crash is no rule to conform to. Accepted.
 *   `decl_bracket_init_no_assign_fb` — `fbs : ARRAY[0..1] OF FB [(x := 1), (x := 2)]` passes each element's list to the
 *     FB's FB_Init, which this FB does not declare: "No matching 'FB_Init' method found for instantiation of FB_…"
 *     (TwinCAT records a failed build with no message). The FB_Init matching (`analysis` fb-init-instantiation, outside the front-end; the LSP review), which the grammar now reaches.
 */
const CODESYS_DECLARATION_DIVERGENCES: readonly string[] = ["decl_nested_aggregate", "decl_bracket_init_no_assign_fb"]

/**
 * FRONTEND-CONFORMANCE 2.7 (2026-10-02) — pragma cells the LSP does not reproduce, each NICHE: ACCEPTED LOSS.
 *   `prag_attribute_brace_in_value` (both) — a `}` inside a quoted attribute ends the pragma on both vendors (the lexer
 *        agrees), and the rest of the line opens a string that runs to the end of the DECLARATION part: both echo it
 *        whole ("',, AT or :' expected instead of ''}\r\n\tv : INT;…END_VAR\r\n'"), TwinCAT adds "Type definition
 *        expected". The LSP reads one text, so its string and its recovery end elsewhere. 0 occurrences in the corpora.
 *   `prag_project_defined_in_declaration` (both), `prag_project_defined_not_in_declaration` (TwinCAT) — `{IF
 *        project_defined (X)}` around a declaration: CODESYS drops the declaration when X is not set, TwinCAT (which has
 *        no `project_defined`) drops it either way. The declaration parser applies no conditional pragma. 0 occurrences.
 *   `prag_project_defined_forbidden_construct` (CODESYS) — a whole VAR block under `project_defined`: "The condition
 *        'project_defined' is not supported for this syntax …" and the declaration part's `{IF}` unterminated; the LSP
 *        says only the body's orphan `{END_IF}` (as TwinCAT does). 0 occurrences.
 *   `prag_if_defined_in_declaration` (CODESYS) — any other `{IF}` in a declaration part is "This code is not supported
 *        in declaration part" (TwinCAT builds it). 0 conditional directives in any declaration part of the corpora.
 *   `prag_hasattribute_unquoted_in_declaration` (both) — an `{IF hasattribute (pou: F, x)}` with the attribute unquoted
 *        in a VAR section: CODESYS adds "This code is not supported in declaration part" to the unquoted-attribute error,
 *        TwinCAT builds it clean (it checks the operand only in a body); the LSP's out-of-body scan says the attribute
 *        error on both. Niche: accepted loss (0 occurrences in the corpora — no `hasattribute` at all).
 */
const PRAGMA_DIVERGENCES: readonly string[] = ["prag_attribute_brace_in_value", "prag_project_defined_in_declaration", "prag_hasattribute_unquoted_in_declaration"]
const CODESYS_PRAGMA_DIVERGENCES: readonly string[] = ["prag_project_defined_forbidden_construct", "prag_if_defined_in_declaration"]
const TWINCAT_PRAGMA_DIVERGENCES: readonly string[] = ["prag_project_defined_not_in_declaration"]

/**
 * FRONTEND-CONFORMANCE 3.1 (2026-10-02) — scope and lookup fixtures (`fixtures/names/scopes.ts`) the LSP does not answer as
 * the vendors do, each niche or a fact the workspace does not hold:
 *   `sym_var_external_of_ambiguous_global` (both) — a VAR_EXTERNAL naming a global two lists declare: "Ambiguous use of
 *        name" at the declaration and at the use, the use undefined and its conversion a hole, and on CODESYS alone "No
 *        global definition found for VAR_EXTERNAL" (TwinCAT words the first in lower case). The LSP binds the external to
 *        the first list's (`symbols/scope-nav` `externalGlobal`) and says nothing. Niche: accepted loss (0 occurrences in
 *        the corpora — they hold no VAR_EXTERNAL at all).
 */
const SCOPE_DIVERGENCES: readonly string[] = ["sym_var_external_of_ambiguous_global"]

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
const CODESYS_SCOPE_DIVERGENCES: readonly string[] = ["sym_library_gvl_needs_qualification", "sym_library_gvl_qualified_by_namespace"]

/**
 *   `sym_library_gvl_needs_qualification`, `sym_library_gvl_qualified_by_namespace`, `_by_list`, `_fully` (TwinCAT) —
 *        TwinCAT's fixture project references no StringUtils, so each is the library's ABSENCE ("Identifier 'Stu' / 'GVL_UTF8'
 *        / 'HALFSHIFT' not defined"); the replay binds the CODESYS fixture project's libraries for both vendors
 *        (`support/project-libraries.ts`), as every library fixture does. The question is CODESYS's.
 *   `sym_device_instance_bare` (TwinCAT) — TwinCAT's project has no device `Device` (its corpus mirror holds no `.device`
 *        descriptor) and says so as the LSP does, plus a third message for the ADR of the undefined name, "Unknown type:
 *        'Device'". Niche: accepted loss (0 occurrences in the corpora, which build).
 */
const TWINCAT_SCOPE_DIVERGENCES: readonly string[] = [
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
 * a wire diagnostic is a catalog `Cnnnn` (`server/diagnostic-codes.ts` admits no new slug) and a build message carries
 * none, so emitting either waits for the number from the vendor's help.
 */
const INHERITANCE_DIVERGENCES: readonly string[] = ["inh_override_final_method", "inh_abstract_method_not_implemented"]

/**
 * FRONTEND-CONFORMANCE 3.3 (2026-10-02) — enum fixtures (`fixtures/names/enums.ts`) the LSP does not answer as the vendors
 * do, both vendors alike (TwinCAT's capitals aside):
 *   `enum_same_member_comparison`, `enum_implicit_member_in_other_pou` — `IF e = x THEN` with `x` a name that names nothing
 *        (a member two enums declare; another POU's implicit enum's value): the LSP says what the vendors say of `x`, and
 *        misses "Expression of type 'BOOL' expected in this place" for the condition the hole leaves untyped. Not trivial:
 *        a wire diagnostic is a catalog `Cnnnn` (`server/diagnostic-codes.ts` admits no new slug) and the message has none
 *        in the catalog. Niche: accepted loss (0 occurrences in the corpora — they build).
 *   `enum_member_vs_global` — a project global and a project enum member of one name: "Ambiguous use of name", "Identifier
 *        not defined" and the hole's conversion — the members sit at the globals' step of the search order, where the
 *        LSP's `lookup` answers the global before the members are asked (`types/names` `resolveBareName`). Niche: accepted
 *        loss (0 occurrences in the corpora of a project global named like a project enum's member).
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
const ENUM_DIVERGENCES: readonly string[] = [
  "enum_same_member_comparison",
  "enum_implicit_member_in_other_pou",
  "enum_member_vs_global",
  "enum_member_vs_function_name",
  "enum_undeclared_name_uninstanced",
  "enum_same_member_call_argument",
  "enum_same_member_array_index",
]
const CODESYS_ENUM_DIVERGENCES: readonly string[] = [
  "enum_library_member_vs_library_global",
  "enum_library_member_vs_project_function",
  "enum_library_member_vs_project_program",
]

/**
 *   every `enum_library_*` cell but the project-enum one, the two project-POU ones and the uninstanced one (TwinCAT) — TwinCAT's fixture project
 *        references no Util (and no StringUtils), so each is the library's ABSENCE ("Unknown type: 'GEN_MODE'", "Identifier
 *        'SAWTOOTH_RISE' not defined"); the replay binds the CODESYS fixture project's libraries for both vendors
 *        (`support/project-libraries.ts`), as `TWINCAT_SCOPE_DIVERGENCES` says. The question is CODESYS's.
 */
const TWINCAT_ENUM_DIVERGENCES: readonly string[] = [
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
const CODESYS_LIBRARY_DIVERGENCES: readonly string[] = [
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
 */
const TWINCAT_LIBRARY_DIVERGENCES: readonly string[] = [
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

/**
 * C0033 IS CONFIGURED AS AN ERROR in both recording projects (frontend-conformance 2.10, 2026-10-02). T6's refusal cell
 * `decl_pointer_to_pointer_deref_once_into_int` (`x := pp^;`, a POINTER TO POINTER read once into an INT) is answered
 * by both vendors with "Cannot convert type 'POINTER TO INT' to type 'INT'" — the message the LSP gives, word for word,
 * from `pointer-conversion`, at the severity C0033 ships with (a warning). The difference is the project's setting, as
 * `cc5_pointer_not_convertible` already records on CODESYS; what the cell decides — that one `^` of a POINTER TO
 * POINTER leaves a POINTER TO INT — agrees.
 */
const C0033_CONFIGURED_AS_AN_ERROR: readonly string[] = ["decl_pointer_to_pointer_deref_once_into_int"]

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
    ...RECOVERY_DIVERGENCES,
    ...CALC_CONDITIONAL_CALL,
    ...TWINCAT_RECOVERY_DIVERGENCES,
    ...TWINCAT_STRUCT_EXTENDS_RECOVERY,
    ...DECLARATION_RECOVERY,
    ...IMPLICIT_ENUM_LIST_RECOVERY,
    ...IMPLICIT_ENUM_TYPE_NAME,
    ...STRING_LENGTH_AS_WRITTEN,
    ...UNKNOWN_QUALIFIED_TYPE,
    ...AFTER_A_REFUSED_TYPE.twincat,
    ...UNIT_HEADER_RECOVERY,
    ...ACTION_HEADER_DROPPED_BY_THE_PUSH,
    ...ACCESSOR_TEXT_DROPPED_BY_THE_PUSH,
    ...FB_ACCESS_AT_THE_CALL,
    ...ENUM_TO_ENUM_IS_A_WARNING,
    ...TWINCAT_UNIT_DIVERGENCES,
    ...LITERAL_ONE_IS_BIT,
    ...EXTERNAL_LOOKUP_IN_A_REFUSED_SECTION,
    ...CALL_IN_AN_AGGREGATE_INITIALIZER,
    ...TWINCAT_NON_RETAIN_RECOVERY,
    ...TWINCAT_NO_VAR_GENERIC,
    ...TWINCAT_DRIVER_CUTS_THE_ECHO,
    ...LITERAL_FOLLOW_ON_RULES,
    ...EXPRESSION_NICHE_DIVERGENCES,
    ...STATEMENT_DIVERGENCES,
    ...PRAGMA_DIVERGENCES,
    ...TWINCAT_PRAGMA_DIVERGENCES,
    ...SCOPE_DIVERGENCES,
    ...INHERITANCE_DIVERGENCES,
    ...TWINCAT_SCOPE_DIVERGENCES,
    ...ENUM_DIVERGENCES,
    ...TWINCAT_ENUM_DIVERGENCES,
    ...TWINCAT_LIBRARY_DIVERGENCES,
    ...TWINCAT_TRY_NEEDS_CATCH,
    ...LITERAL_REFUSAL_DECLARATION_RECOVERY,
    ...TWINCAT_WSTRING_ESCAPE_RUNS_TO_END,
    ...TWINCAT_MALFORMED_ADDRESS_ALIGNMENT,
    ...TWINCAT_REFUSED_LDATE_LITERAL_STOPS,
    ...TWINCAT_IF_RECOVERY_AFTER_A_REFUSED_LITERAL,
    ...C0033_CONFIGURED_AS_AN_ERROR,
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
  //   `cc5_pointer_not_convertible` — C0033 is CONFIGURABLE. The recording project has it as an ERROR; the replay
  //                            resolves no project settings, so it is a warning here. Configuration, not behaviour.
  //   `cc5_new_in_expression` — the recording device has no memory configured for dynamic creation, so the IDE
  //                            reports that instead and never reaches the nesting rule.
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
    ...RECOVERY_DIVERGENCES,
    ...CALC_CONDITIONAL_CALL,
    ...CODESYS_POSITION_IN_AN_INITIALIZER,
    ...UNIT_HEADER_RECOVERY,
    ...ACTION_HEADER_DROPPED_BY_THE_PUSH,
    ...ACCESSOR_TEXT_DROPPED_BY_THE_PUSH,
    ...FB_ACCESS_AT_THE_CALL,
    ...ENUM_TO_ENUM_IS_A_WARNING,
    ...DECLARATION_RECOVERY,
    ...IMPLICIT_ENUM_LIST_RECOVERY,
    ...IMPLICIT_ENUM_TYPE_NAME,
    ...STRING_LENGTH_AS_WRITTEN,
    ...AFTER_A_REFUSED_TYPE.codesys,
    ...LITERAL_ONE_IS_BIT,
    ...EXTERNAL_LOOKUP_IN_A_REFUSED_SECTION,
    ...CALL_IN_AN_AGGREGATE_INITIALIZER,
    ...CODESYS_DECLARATION_DIVERGENCES,
    ...COMPONENT_CARRIED_ON_IN_A_DUT,
    ...LITERAL_FOLLOW_ON_RULES,
    ...EXPRESSION_NICHE_DIVERGENCES,
    ...STATEMENT_DIVERGENCES,
    ...PRAGMA_DIVERGENCES,
    ...CODESYS_PRAGMA_DIVERGENCES,
    ...SCOPE_DIVERGENCES,
    ...INHERITANCE_DIVERGENCES,
    ...CODESYS_SCOPE_DIVERGENCES,
    ...ENUM_DIVERGENCES,
    ...CODESYS_ENUM_DIVERGENCES,
    ...CODESYS_LIBRARY_DIVERGENCES,
    ...LITERAL_REFUSAL_DECLARATION_RECOVERY,
    ...SYSTEM_OPERAND_AT_STATEMENT_START,
    ...C0033_CONFIGURED_AS_AN_ERROR,
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
    "decl_persistent_retain",
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
