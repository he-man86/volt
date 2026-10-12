/**
 * THE GRAMMAR'S KNOWN DIVERGENCES — the lexer's, the expressions', the statements' and the literals': the fixtures whose
 * recorded answer the LSP does not give, each set with its reason. One concern of `divergences.ts`, which assembles
 * `KNOWN_DIVERGENCES` (openspec lsp-same-standard 4.4).
 */
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
export const SYSTEM_OPERAND_AT_STATEMENT_START: readonly string[] = [
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
 *
 * FRONTEND-CONFORMANCE 4.3.4 (2026-10-03) answered the call form: `XSIZEOF(i)` and `XSIZEOF(big)` on TwinCAT are the
 * undefined name, three messages each (`ar_xsizeof_type`) — so XSIZEOF IS a CODESYS-only word (`CODESYS_ONLY_KEYWORDS`).
 * `cp_xsizeof`'s lone "Expression expected instead of 'DINT'" is TwinCAT stopping at a TYPE argument's parse error and
 * saying nothing else of the POU; the LSP reads a lone type argument in any call, so it parses on and names the three
 * undefined calls. `lex_keyword_before_name_xsizeof` lacks the "has no effect" warning of an identifier statement. Both
 * stay niche, as above.
 */
export const TWINCAT_XSIZEOF_IS_NO_KEYWORD: readonly string[] = [
  // the call of a TYPE, named in the note above and held here since frontend-conformance 2.8.3 emptied the parse census:
  // TwinCAT stops at the type argument's parse error (the 4.3.4 paragraph above)
  "cp_xsizeof",
  "lex_keyword_before_name_xsizeof",
  // (`lex_keyword_assigned_xsizeof`, `lex_keyword_operand_xsizeof` and `lex_keyword_called_xsizeof` left 2026-10-03,
  // frontend-conformance 4.3.4: `ar_xsizeof_type` recorded the call form `XSIZEOF(i)` on TwinCAT as the undefined name —
  // "Identifier 'XSIZEOF' not defined", "Program name, function or function block instance expected instead of
  // 'XSIZEOF'" — so XSIZEOF is CODESYS-only after all (`CODESYS_ONLY_KEYWORDS`); what `cp_xsizeof` answers is the TYPE
  // argument's parse error alone, and the two above are the identifier's statement shapes.)
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
export const TWINCAT_NO_EFFECT_AFTER_AN_UNKNOWN_WORD: readonly string[] = [
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
export const TWINCAT_VECTOR_REFUSAL_CASCADE: readonly string[] = ["lex_vector_twincat_return_type"]

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
 *   (`expr_en_eno_call` left 2026-10-02, task 3.5: a FUNCTION's or METHOD's named arguments are counted before they are
 *                            named — more than it has inputs is "requires exactly 'N' inputs" and every unknown name only
 *                            "not defined", `mem_method_unknown_param_*`.)
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
 *   (`expr_global_namespace_ambiguous_bare` left 2026-10-06, analysis-conformance 3.5: a global two lists declare names
 *                            nothing — `types/names` `globalClash` — so it is "not defined" and its use a hole's.)
 */
export const EXPRESSION_NICHE_DIVERGENCES: readonly string[] = [
  "expr_trailing_comma_conversion_call",
  "expr_ampersand_in_argument",
  "expr_member_named_type_keyword",
  "expr_trailing_comma_operator_call_in_initializer",
  "expr_pool_qualified_call",
  "expr_pool_qualified_global",
  "expr_pool_qualified_fb_type",
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
export const STATEMENT_DIVERGENCES: readonly string[] = [
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
export const TWINCAT_TRY_NEEDS_CATCH: readonly string[] = ["stmt_try_without_catch", "stmt_try_finally_only"]

export const LITERAL_FOLLOW_ON_RULES: readonly string[] = [
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
export const LITERAL_REFUSAL_DECLARATION_RECOVERY: readonly string[] = [
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
export const TWINCAT_WSTRING_ESCAPE_RUNS_TO_END: readonly string[] = [
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
export const TWINCAT_MALFORMED_ADDRESS_ALIGNMENT: readonly string[] = ["lit_address_two_segments", "lit_address_multi_segment"]

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
export const TWINCAT_REFUSED_PREFIX_INSIDE_A_LIST: readonly string[] = [
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
export const COMPONENT_CARRIED_ON_IN_A_DUT: readonly string[] = ["lit_char_typed_in_struct_field", "lit_char_typed_in_enum_value"]

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
export const TWINCAT_REFUSED_LDATE_LITERAL_STOPS: readonly string[] = ["xf_ldate_to_date_call_once"]

/**
 * TWINCAT_IF_RECOVERY_AFTER_A_REFUSED_LITERAL — after the cascade over a refused `LTOD#`/`LDT#` in a THEN branch, TwinCAT
 * stays out of the IF: "Unexpected Token 'ELSE' found", "';' expected instead of 'F_LANG_…'" on the ELSE branch's target,
 * "Unexpected Token 'END_IF' found" and "';' expected instead of end of POU". The LSP resumes inside the IF and says none
 * of the four. Statement recovery, R2/R3's (task 2.8.3).
 */
export const TWINCAT_IF_RECOVERY_AFTER_A_REFUSED_LITERAL: readonly string[] = [
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
/**
 * TWINCAT_ECHO_NAMES_A_POSITIONAL_ARGUMENT (frontend-conformance 3.6, 2026-10-02) — the three `xf_<d>_to_ldate_call_once`
 * whose source has no refused literal, first build-recorded in 3.6: PLC_PRG's `DATE_TO_LDATE(F(calls))` is the hole's
 * conversion on TwinCAT, and its echo writes the user FUNCTION's positional argument FORMALLY —
 * `DATE_TO_LDATE(F_LANG_…(calls := calls))` inside the "Unknown type" — as `hdr_function_extends` records (`F(2)` echoed `F(x := INT#2)`); the
 * LSP echoes the call as written. Every other message agrees (the "not defined" of the conversion the dialect lacks, its
 * call target, LDATE's "Unknown type"). Not trivial: the echo (`analysis/expr-echo`) would need the callee's parameter
 * list. Niche: accepted loss (0 occurrences in the corpora — they build, and no build of theirs echoes a hole).
 */
export const TWINCAT_ECHO_NAMES_A_POSITIONAL_ARGUMENT: readonly string[] = [
  "xf_date_to_ldate_call_once",
  "xf_dt_to_ldate_call_once",
  "xf_tod_to_ldate_call_once",
]

export const TWINCAT_NOTHING_OF_PLC_PRG_BESIDE_A_PARSE_ERROR: readonly string[] = [
  "xf_ldate_to_date_call_once",
  "xf_ldt_to_date_call_once",
  "xf_ltod_to_date_call_once",
  "xf_ldt_to_ldate_call_once",
  "xf_ltod_to_ldate_call_once",
]
