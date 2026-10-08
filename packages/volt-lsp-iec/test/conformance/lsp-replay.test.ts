/**
 * THE LSP AGAINST EACH VENDOR'S RECORDED BUILD — the replay (`support/replay.ts`) of every fixture, no false
 * positive and the agreement ratchet. The contract and the selection are `support/fixture-suite.ts`'s
 * (transpile-restructure 1.8.7).
 */

import { describe, expect, test } from "bun:test"
import type { Vendor } from "../../src/analysis/index.js"
import { CODESYS_TRIAGE, KNOWN_DIVERGENCES, TWINCAT_TRIAGE } from "./support/divergences.js"
import { ALL_TESTS } from "./fixtures/index.js"
import { RUNS } from "./support/recordings.js"
import { replayDiagnostics, withReplayFixture } from "./support/replay.js"
import { comparable } from "./support/compare-message.js"
import { expectStillDiverges } from "./support/expected-failure.js"
import { BUILDS, SELECTION, whole, type RecordedDiagnostic } from "./support/fixture-suite.js"

// ─── ratchet two: the LSP against each vendor's recorded build ───────────────────────────────────────────────

/**
 * BYTE-IDENTICAL AGREEMENT, per vendor. The active vendor selects the recording AND the LSP's config, because the
 * two IDEs diverge at times. Two assertions encode the incremental build toward full parity:
 *
 *   1. NO FALSE POSITIVES (hard, always green): every LSP message is a real IDE message (LSP ⊆ IDE). This is the
 *      safety guarantee — the LSP never invents an error the compiler did not emit.
 *   2. AGREEMENT RATCHET: the count of fixtures whose message SETS match exactly only ever rises.
 *
 * This is a different mechanism from the rating rows above and deliberately so: the rating asks WHETHER the LSP
 * objects, this asks whether it says the same thing, and conflating them would make the first either too strict (a
 * wording drift becomes a gap) or unable to run at all, since most fixtures carry no fragment to compare.
 *
 * The replay is pure — no live bridge. Re-record via `bun run record:language`.
 */
const FLOORS: ReadonlyArray<{ vendor: Vendor; floor: number }> = [
  // floor = current exact-agreement count; raise as checks are ported, never lower.
  // + oop/ (interface-implementation) + pragmas/ (message + orphan-conditional) + names/
  // (unresolved-identifier): 231 TC / 228 CS of 259. Remaining non-agreements are documented IDE-only
  // divergences (parse cascades, app-config warnings, op_sys_* / __-system constructs) — not reproducible
  // offline; the subset (no-FP) gate stays green on them.
  // 253 → 255 (2026-09-14): gap 13 — untyped integer literals typed as CODESYS/TwinCAT type them (`overflow_*`).
  // 255 → 256: consolidate-lsp-structure A7 — the network-text jump-label check no longer fires on TwinCAT.
  // 265 -> 266: `__CURRENTTASK` is refused, and TwinCAT refuses it too (the fixture records both).
  // 266 -> 2200 (2026-09-20). Not a precision improvement: TwinCAT's ground truth went from 280 fixtures
  // (recorded 2026-07-07, before the census sweeps took the suite from ~967 to 2530) to 2524, so most of the
  // old gap was questions TwinCAT had never been asked. Measured on the 406 both vendors had answered before
  // this: 96.1% identical build verdicts. CODESYS is now the UNDER-measured vendor at 866 — its recording still
  // covers only 893 fixtures, and re-recording it is the obvious next move.
  // 2200 -> 2203: the TwinCAT driver stopped gluing its build log onto three string-warning messages.
  // 2203 -> 2220 (2026-09-20). Five wording differences, measured on both recordings and now data in
  // `messages.ts`: TwinCAT capitalises "Unexpected Token", drops the article and the full stop from
  // "Assignment target not specified", upper-cases the names in a recursion chain, and never words a
  // function's input count as a range. Plus two rules TwinCAT does not have at all (the ABSTRACT-keyword
  // warning) and `INDEXOF`, which both vendors removed and word differently. No check changed its mind about
  // anything — the LSP says what it said, in the vendor's spelling.
  // 2220 -> 2229. Nine string-constant cells, closed by TwinCAT's own exception text: below STRING(3) the
  // prefix it prints would have a negative length, and its message builder throws where CODESYS falls back.
  // One more: TwinCAT names an unresolved base class and stops, where CODESYS adds the type it therefore lacks.
  // 2229 -> 2230, and the backlog 33 -> 19, which is the number that moved: THE VOCABULARY IS VENDOR DATA TOO.
  // `__POSITION`, `__POUNAME`, `__COMPARE_AND_SWAP`, `__VECTOR` and the `UCHAR#`/`LDATE#`/`LDT#`/`LTOD#` literal
  // prefixes are CODESYS's alone, so on TwinCAT they lex as ordinary identifiers that resolve nowhere — which is
  // exactly what TwinCAT says about them. Fifteen fixtures stopped inventing a type for a name the compiler has
  // never heard of; `ldate_ltod_ldt` is the one that arrived, where the two parsers resync differently after an
  // unknown prefix.
  // 2230 -> 2240, and the backlog 19 -> 4, on the day the TwinCAT recording was finally made against the RIGHT
  // TARGET. The fixture solution had been building for `TwinCAT CE7 (ARMV7)`; on `TwinCAT RT (x64)` the
  // platform-width family answers LINT/ULINT/LWORD exactly as CODESYS does, and `__XADD` stops reporting an ARM
  // code-generator crash and states its signature — the mirror image of CODESYS's, taking the counter where
  // CODESYS takes its address, and returning the operand's own type where CODESYS returns DINT. Six operand
  // types each. Plus two rules measured as CODESYS's alone: a sign crossing at an ARGUMENT, and `__NEW` nested
  // in an expression.
  // 2240 -> 2241: the last contaminated row. An apostrophe is a quote, so "Outputs can't be of type
  // 'REFERENCE TO'" carries three and the driver joined the build summary onto it.
  // 2241 -> 2242: `op_sys_varinfo` left `KNOWN_DIVERGENCES` — it was masked as a TwinCAT divergence while
  // the real fault was the same line-joining bug, and the two vendors record it identically now.
  // 2242 -> 2255: the LSP was UNDER-reporting, which costs agreement without ever making a gate red. A sign
  // crossing in a comparison has a 32-bit floor and the floor is CODESYS's — TwinCAT warns at SINT/USINT and
  // INT/UINT too, in all twelve of those cells.
  // 2255 -> 2305 on ONE rule, and not a rule about any check: TwinCAT never says the same thing twice on
  // one LINE. 111 of 2541 CODESYS fixtures carry a message repeated on a single line and ZERO TwinCAT ones
  // do, so the collapse happens once, where the diagnostics leave the analyzer.
  // 2305 -> 2317: a BITWISE operator computes in the UNSIGNED integer of its operands' width, so every
  // signed operand converts going in and the result converts coming back out — three warnings for
  // `out := a AND b` with LINT operands, which the LSP answered with silence because it typed the result
  // LINT and saw no conversion at all.
  // 2317 -> 2346, and the same rule again from the other end: ARITHMETIC MEETS ITS OPERANDS and converts both
  // into the meet. `aUlint MOD aSint` meets at LINT and the ULINT operand warns; `aLint + aReal` meets at REAL
  // and the LINT operand warns about the mantissa. Neither pair is the same WIDTH, which is all the check used
  // to look at, so it had no rule to name a whole family of conversions with.
  // 2346 -> 2351: the 64-bit DATE types are CODESYS's as well — TwinCAT has LTIME and has no LDATE, LTOD or
  // LDT, so a declaration is "Unknown type" there and `DATE_TO_LDATE` is an identifier nothing defines.
  // 2351 -> 2424 on SEVENTY-THREE fixtures, by deleting placeholders. Six checks were gated to CODESYS with
  // the note "TwinCAT unmeasured" — written when TwinCAT's recording covered 280 fixtures. It covers 2524
  // now and every one of the six AGREES: an IL operator used as a name cascades identically on both, down
  // to the ten messages and their order. The single false positive they exposed was the reachability case
  // CODESYS already had documented, measured on TwinCAT and filed beside it.
  // 2424 -> 2426: three more gates that rested on the same stale premise. TwinCAT HAS the dynamic-creation
  // rule (it calls the pragma an attribute), the conditional-call rule (it hyphenates call-statement) and
  // the FB_init one (it stops at the name, with no input count and no suggested syntax).
  // 2426 -> 2446: the twenty `mathret_*` cells, recorded on both vendors and agreeing on both.
  // 2446 -> 2447: a declaration's initializer converts even when it is not a literal.
  // 2447 -> 2450: an ordinary name in a resync cascade IS a statement once the compiler has supplied the `;` it
  // was asking for, and both vendors then say what they always say about a statement that reads a variable and
  // does nothing with it.
  // 2450 -> 2470: AN UNKNOWN LITERAL PREFIX CASCADES LIKE ANY OTHER REFUSED NAME, and the cascade machine
  // was already here — `LDT#` quoted whole, then a pair per token to the `;`. Twenty fixtures, and the only
  // new code is a token scan: the parser gives up at the first stray, so there is no AST to walk. It also
  // found that the cascade re-lexed WITHOUT the dialect, which read `LDATE#2026-05-09` as one CODESYS date
  // literal and quoted a token TwinCAT never saw.
  // 2470 -> 2479: the NINE `xf_*_to_l*` conversions, and the fix is one guard drawn a shade finer. An
  // assignment whose source has no type was skipped when the TARGET had none either, on the sound worry
  // that the target is usually a library type the LSP cannot see. TwinCAT does not fall silent there -- it
  // writes the unresolved name out ("... to type 'LDATE'"), so the skip only had to stop covering the
  // names the VENDOR provably lacks, which `dialectMissingType` already decided for the declaration.
  // 2479 -> 2496: THE REPLAY HAD NO STANDARD LIBRARY ON TWINCAT, so `LEN` resolved nowhere and seventeen
  // fixtures said nothing where the recording has a real error. The harness had said so in a comment for
  // months ("Tc2_Standard, a different materialization — not added for it") and nobody costed the sentence.
  // Sharing CODESYS's materialization adds ZERO false positives, which is the gate that makes it a
  // measurement rather than a guess.
  // 2496 -> 2497: `__NEW` again, and this time the answer was that there is no answer to have. TwinCAT
  // prints the attribute message with the attribute PRESENT, in every position, for a self-reference, for a
  // different FB and for a STRUCT alike, and with the attribute removed nothing changes. CODESYS prints
  // "No memory for dynamic object creation" on either side of the same message, so the pragma rule is
  // plainly never reached on either project. Five TwinCAT cells joined the divergence list with that
  // evidence; the one that moved is the new control, which agrees.
  // 2497 -> 2501: PARTIAL ACCESS (`dwSource.%W1`) IS A CODESYS EXTENSION. TwinCAT reads the `.` as an ordinary
  // member access, finds `%` where a component name belongs and leaves the width+index standing as a statement
  // of its own — three messages, and the same three at all four widths. `.%W`/`.%B` had been recorded since
  // 2026-05-29 and `.%X`/`.%D` were asserted in a note beside them; asked properly they answer identically.
  // 2501 -> 2506: A DECLARATION INITIALIZER IS NOT A BODY, and the name check only ever walked bodies, so
  // `n : DINT := nope;` said nothing where both vendors say "Identifier 'nope' not defined". Plus the rule
  // above it: a `__` name the compiler does not know is a PARSE refusal there, not an undefined identifier
  // — three messages, both vendors, and four probes to tell that apart from "an initializer must fold"
  // (a sibling VARIABLE initializes one just fine).
  // 2506 -> 2513: A UNARY OPERATOR CONVERTS ITS OPERAND, and two rows of that rule had been written down as
  // "nothing". They were the summary's error, not the recording's — `unary_minus_on_bool` has carried
  // "Cannot convert type 'BOOL' to type 'INT'" all along and `uop_not_time` the TIME one, both read as the
  // RESULT conversion with the operand half unnoticed. Four new cells close it: `-BOOL` asked into a STRING,
  // where the operand message cannot hide behind the result's, and `NOT` on TOD, DT and LTIME. Every one
  // reports, on both vendors, at its operand's own width.
  // 2513 -> 2516: two dialect rules and a gate that named the wrong kind. TwinCAT refuses LOWER_BOUND/
  // UPPER_BOUND on an array with FIXED bounds where CODESYS folds them (the `ARRAY[*]` cells compile clean on
  // both, which is what makes it a rule rather than a coincidence). A DEFAULT does not make an input optional
  // there either — leaving out the one that HAS an initial value is "requires exactly '2' inputs". And the
  // required-inputs check was gated to `function` while the METHOD form had never been asked: asked, both
  // vendors answer with the same message, naming the method.
  // 2516 -> 2526: `TEST_AND_SET` TAKES A DWORD BY ADDRESS, and four cells could only say that in outline. Seven
  // more operand types turn it into one sentence: the operand converts into a DWORD exactly as an assignment
  // would convert it, so DWORD and UDINT make no temporary and say nothing, a legal conversion makes one and
  // "'BYTE_TO_DWORD(flag)' is not allowed as operand for ADR" is the address being refused, a SIGNED operand
  // adds the sign-change warning the same conversion carries anywhere else, and a type with no conversion at
  // all (BOOL, REAL, STRING, LWORD) reports the conversion instead. Identical on both vendors, and written
  // through the shared assignment rules so an operand nobody probed answers the way `x : DWORD := flag` does.
  // 2526 -> 2528: A DECLARATION'S INITIALIZER IS A PLACE EXPRESSIONS LIVE, twice over. The narrowing check asked
  // only what the STORE converts, so `i : DINT := REAL_TO_DINT(EXPT(2, 10))` was silent — nothing converts at
  // the store and everything converts at the ARGUMENT. And `unknown-source` walked bodies, so a hole in an
  // initializer was named as an undefined identifier and never carried into the declared type.
  // 2528 -> 2538: ONE RULE, TWO IMPLEMENTATIONS, AND THEY DISAGREED — found by a review of
  // `consolidate-lsp-structure`, which is the change about exactly this. A one-argument math function's result
  // is its argument's REAL type, and lowering typed a non-real argument LREAL while inference said nothing at
  // all, its own comment recording the integer case as "unmeasured". Ten cells measured it: `SQRT(anInt)` into
  // a REAL warns on both vendors, as do LN, LOG, EXP, SIN, COS, TAN, ASIN, ACOS and ATAN.
  // 2538 -> 2539: WHICH NAMES MAY A CALL BIND — one question with two answers in one package. The ST check
  // asked `lookupMember` unfiltered, so a plain `VAR loc : INT` bound silently; the network-text check beside
  // it already restricted to the pin sections and properties. Both vendors say the ST side was wrong. The
  // same cell settled the CASING too: a call site upper-cases the callee, a member WRITE keeps its case, and
  // only the network check knew.
  // 2539 -> 2546 (2026-09-27): network text v2 (openspec network-text-literal-nwl 5.6). TwinCAT reports a JMP to a
  // missing label after all (census 1.15 — the silence measured 2026-07-07 was of v1 text), and the label checks
  // follow the recorded builds: four new label fixtures, each recorded live on both vendors.
  // 2546 -> 2562 (2026-09-30): push-without-header-check 4.1/4.2 — the texts the push now writes as sent, recorded on
  // both vendors: a DUT/GVL read as the IDE reads it (nothing before its keyword), a declaration missing its `;` in
  // CODESYS's own words, a FUNCTION's EXTENDS, and C0145 in TwinCAT's spelling.
  // 2562 -> 2564 (2026-09-30, the step's review): `op_sys_type_class_bare` and `call_ldate_instance`, recorded live —
  // the second pins C0035 beside "Unknown type: 'LDATE'" for a call of a CODESYS-only type's instance.
  // 2564 -> 2601 (2026-09-30, frontend-conformance 2.1): the lexer's fixtures (`grammar/lexer.ts`), recorded live — 37
  // agree; ten are `KNOWN_DIVERGENCES` (the recovery rule R1's) and six are refused at object creation (`execSkip`).
  // 2601 -> 2886 (2026-09-30, frontend-conformance 2.1.3): every keyword asked in the three positions a statement gives a
  // name (`lex_keyword_{assigned,before_name,operand}_*`), the cascade meeting a soft name, the modifiers as named
  // arguments and `cal` read — recorded live; the parser refuses a keyword that is no operand, takes the next token for
  // a call operator's `(`, and refuses at a statement start only the words the recordings refuse.
  // 2886 -> 2954 (2026-10-01, frontend-conformance 2.2): the literal fixtures (`grammar/literals.ts`), recorded live — the
  // lexer ends a literal where the vendor does and refuses a malformed one whole (`Token.malformed`), a calendar field
  // out of range is "too large", and the statement a refused literal's resync resumes at is warned (`resumed`); 2.1.4's
  // own fixtures had already taken the count past the old floor.
  // 2954 -> 2968 (2026-10-01, frontend-conformance 2.2a): the review's 18 literal cells, recorded live — `_` as free in a
  // typed integer and a duration as in an integer, a duration's components strictly largest first, a 32-bit DATE/DT's
  // upper end, a refused literal in a type position or after an operator in an initializer said where it stands. The
  // four that do not agree are `LITERAL_REFUSAL_DECLARATION_RECOVERY`.
  // 2968 -> 3025 (2026-10-01, frontend-conformance 2.2.6/2.2.7): the typed character, string, enum and UTF8# literals and
  // the address shapes (58 `lit_*`), recorded live — every `<word>#` TwinCAT has no literal for is ONE refused token
  // (`TWINCAT_LITERAL_PREFIXES`), an address is taken by its shape (`literal/address`); `tr_12_fmt_long_dates`, first
  // recorded on TwinCAT here, agrees. Not agreeing: `TWINCAT_MALFORMED_ADDRESS_ALIGNMENT`,
  // the `xf_l*_call_once` (then one mark; split by the 2.2b review into the three rules they show).
  // 3025 -> 3036 (2026-10-01, frontend-conformance 2.2b): the review's 17 literal and address cells, recorded live — a
  // literal hole under NOT/ABS/ADR/a negation or a bare conversion, a sized address with no position in a body, a typed
  // integer as a CASE label, a UCHAR# escape past ASCII; the six a refused `<word>#` reaches inside a list are
  // `TWINCAT_REFUSED_PREFIX_INSIDE_A_LIST`.
  // 3036 -> 3081 (2026-10-01, frontend-conformance 2.3.1-2.3.5): the declaration fixtures (`grammar/declarations.ts`),
  // recorded live — VAR_ACCESS at file scope, the qualifiers in any order, NON_RETAIN a name, AT refused after the type
  // and on an operand that is no address (the declaration dropped by the binder), `:=` with no value, repeat counts, a
  // STRUCT field read by the one declaration parser, a VAR section in a STRUCT named by its placement. Not agreeing: the
  // marks of `support/divergences.ts` 2.3 (recovery, VAR_GENERIC, the driver's cut echo, NON_RETAIN's recovery).
  // 3081 -> 3086 (2026-10-01, 2.3 review fixes and 2.3a): the review's five cells, and `decl_struct_init_unknown_field_in_array`,
  // `_in_field_array` (a struct value in an array initializer held to the element's struct).
  // 3086 -> 3124 (2026-10-01, frontend-conformance 2.3.6): the same type-expression fixtures and fixes, on TwinCAT, with
  // its own words for a reversed bound, a reference as a base type and an `ARRAY[*]` outside a VAR_IN_OUT.
  // 3124 -> 3135 (2026-10-01, 2.3b review): the same cells on TwinCAT, in its words for a nested `ARRAY[*]`.
  // 3135 -> 3191 (2026-10-01, frontend-conformance 2.4a): the same unit fixtures and fixes, on TwinCAT, with its own
  // words for PRIVATE/PROTECTED, the alias's EXTENDS (the type named, not the base) and an interface property's
  // PRIVATE/PROTECTED (it builds).
  // 3191 -> 3200 (2026-10-01, 2.4a review): the review's cells on TwinCAT (a PROPERTY's FINAL/ABSTRACT after its access
  // modifier, an interface METHOD's VAR_TEMP/VAR_STAT/VAR_INST, a refused FB as no base).
  // 3200 -> 3268 (2026-10-01, frontend-conformance 2.5): the expression fixtures (`grammar/expressions.ts`) and the parser
  // moves — `**`/`&` and the IL call form refused by the parser, a statement without its `;` standing and resynced as the
  // vendors do (which also closed the ten `R1_CASCADE_AFTER_A_STRAY_TOKEN` marks and two literal ones), a keyword member
  // and TwinCAT's `.%` partial access refused as no component, an index list's trailing comma and an operator's.
  // 3268 -> 3278 (2026-10-02, 2.5a review): the review's cells — a parenthesis left open in an IF/WHILE condition and in
  // an index, a one-operand operator's trailing comma (with its operand count), `&` in ABS, an operator word before a
  // sign, `d.%W0` beside an undefined name, a missing `;` before a CASE arm.
  // 3278 -> 3306 (2026-10-02, frontend-conformance 2.5.6): the THIS/SUPER, inline-assignment, global-namespace and
  // parenthesis fixtures (`expr_this_*`, `expr_super_*`, `expr_inline_assign_*`, `expr_global_namespace_*`,
  // `expr_paren_*`), with a leading-dot primary (`global_expr`), an inline assignment as a CASE selector, a FOR bound and
  // an index, SUPER typed by its base and refused as the vendors refuse it in a base-less FB (`refuse_super_without_base`
  // agrees now), and THIS/SUPER without their `^` no structured variable.
  // 3306 -> 3316 (2026-10-02, 2.5b review): the review's cells — the corpora's `1...X` array bounds (bare, list-qualified,
  // enum, an index past one), `.g` as a CONSTANT target, called, in a CONSTANT's initializer, declared by two lists,
  // SUPER.Get() with no base, an inline assignment as a FOR start (`expr_global_namespace_ambiguous_bare` a niche
  // divergence); a fixture's lists bound as objects of their own (`splitLists`).
  // 3316 -> 3393 (2026-10-02, frontend-conformance 2.6): the statement fixtures (`grammar/statements.ts`, 85 `stmt_*`) and
  // the statement rules — a token no statement starts with refused at the start, `s=`/`ref=` in any case, the one-line
  // missing `;` after RETURN/EXIT/CONTINUE/JMP and before a block's END, a CASE label list's trailing comma, `__CATCH`
  // without its operand, a binary operation as a statement "no valid statement", an empty CASE arm a warning, S=/R= and
  // FOR counter and typed-label conversions, a chain's non-name target, TwinCAT's reversed literal REF= and its CASE
  // range full stop (`cc3_reference_assign` agrees now, `expr_inline_assign_operand` too).
  // 3393 -> 3508 (2026-10-02, 2.6 review): every reserved word called where a statement starts (`lex_keyword_called_*`),
  // an assignment without its `;` before every statement and block keyword (`stmt_assign_no_semicolon_before_*`), a
  // negation as a chain's inner target and as a FOR counter, a FUNCTION's own name bare inside it.
  // 3508 -> 3585 (2026-10-02, frontend-conformance 2.7): the pragma fixtures (`grammar/pragmas.ts`, 75 `prag_*`) — conditional
  // directives only where a statement may start, one statement tree per body, the condition grammar and its operators,
  // message pragmas only where said; attributes in the AST (obsolete per use, a METHOD's its own); and the 49 fixtures the
  // recorder had pushed without the pragmas above their units, re-recorded (the five TwinCAT `newdel_*` agree now).
  // 3585 -> 3592 (2026-10-02, 2.7 review): the message words in upper/mixed case, the unquoted `hasattribute` cells.
  // 3592 -> 3645 (2026-10-02, frontend-conformance 2.8): the error-recovery fixtures (`grammar/recovery.ts`, 55 `rec_*`) —
  // one token wording, a block left open, the refused words and their cascades in the parser — and the cells they closed
  // (`stmt_assign_missing_value`, `stmt_if_else_if_two_words`, `stmt_s_eq_spaced`, `stmt_assign_spaced_operator`,
  // `lit_time_fraction_ms`, `cc5_deprecated_functionblock_keyword`).
  // 3645 -> 3662 (2026-10-02, 2.8 review): the refused word in the positions 2.8.3 had not asked (`rec_refused_word_*`: a
  // label, a JMP target, an initializer, a STRUCT/UNION field), the end of the text as a member name, a keyword in an
  // INTERFACE, the first CASE arm without its label ("No case label found" — `lit_enum_typed_case_label` agrees with it).
  // 3662 -> 3696 (2026-10-02, frontend-conformance 2.10): area 2's last rules asked — T6's POINTER TO POINTER used, P14's
  // `strict` cells (its refusals are 4.5.1's, `deferred.lsp`), P15's `to_string`, P16's `const_replaced`/`_non_replaced`.
  // 3696 -> 3732 (2026-10-02, frontend-conformance 3.1): the scope and lookup fixtures (`fixtures/names/scopes.ts`, Y1–Y24)
  // and the bare-name search order the front-end now owns (`types/names` `resolveBareName`).
  // 3732 -> 3764 (2026-10-02, frontend-conformance 3.2): the inheritance fixtures (`fixtures/names/inheritance.ts`,
  // H4–H10) — interface EXTENDS bound and linked, every base through the link, overrides checked in compiled FBs only.
  // 3764 -> 3784 (2026-10-02, frontend-conformance 3.3): the enum fixtures (`fixtures/names/enums.ts`, EN1–EN6) — a
  // bare member resolved per asker, ambiguity reported, a library member bare where one enum declares it.
  // 3784 -> 3787 (2026-10-02, frontend-conformance 3.4): the library-namespace fixtures (`fixtures/names/libraries.ts`,
  // LB1–LB9) — library precedence per asker, a qualified type in its namespace, the incremental library rebind.
  // 3787 -> 3825 (2026-10-03, frontend-conformance 3.5): the member fixtures (`fixtures/names/members.ts`, M1–M6) —
  // callees found by their instance's TYPE (REFERENCE, array element, SUPER^), interface members as `<ITF>__Union`,
  // the named-argument count; access refusals are MEMBER_DIVERGENCES.
  // 3825 -> 3870 (2026-10-03, frontend-conformance 4a): the type fixtures (`fixtures/types/elementary-rules.ts`,
  // `literal-contexts.ts`, TY1–TY15, LT1–LT14) — platform width per target, ANY groups, literal context conversions.
  // 3870 -> 3960 (2026-10-03, frontend-conformance 4b): the arithmetic-result fixtures (`fixtures/types/
  // arithmetic-results.ts`, AR1–AR31) — literal operands, shifts, LIMIT/SEL/MUX meets, built-in result types, temporal.
  // 3960 -> 4345 (2026-10-03, frontend-conformance 4c): comparisons and BOOL (`fixtures/types/comparisons-bool.ts`, CB1–CB5),
  // enum conversions (`enum-conversions.ts`, CV3–CV5), pointers and references (`pointer-reference.ts`, CV6, DT12–DT14),
  // the 327 explicit conversion pairs (`fixtures/conversions/explicit-pairs.ts`, CV7).
  // 4345 -> 4406 (2026-10-03, frontend-conformance 4d): constant evaluation (`fixtures/types/constant-evaluation.ts`,
  // CE1–CE9, P16 — conversions, pure built-ins, SIZEOF, enum values, NOT and shifts fold; the constant cycle) and derived
  // types (`derived-types.ts`, DT3, DT4, DT6 — subrange, union and enum storage in the Type).
  // 4406 -> 4437 (2026-10-03, frontend-conformance 4e): aliases, static bases, callees and rendering (`derived-types.ts`,
  // DT1–DT2, DT7–DT11 — THIS/SUPER as pointers, a static name stored as a value, a PROGRAM takes no positional argument).
  { vendor: "twincat", floor: 4437 },
  // the `???` slots match on text. 257 → 280 (2026-09-14): the LSP gaps the transpiler's execution oracle exposed —
  // `r`/`s` names, `**`, unary-minus and EXPT typing, set/reset chains — plus the operator-coverage fixtures
  // (now `suite.test.ts`), which found `&` is not a CODESYS operator either. Each recorded live and fixed.
  // 280 → 293 (2026-09-14): gaps 7 (a TIME literal's US/NS unit), 8 (LTIME literal typing), 9 (a library FUNCTION's
  // arguments), 11 (string arithmetic), 12 (a stray token after an initializer); the Standard library now in the CODESYS
  // replay project, as it is in the recording project; and declaration parse errors no longer counted twice here.
  // 293 → 311: gap 13 — an untyped integer literal the target cannot hold, typed as its narrowest integer type.
  // 311 → 315: consolidate-lsp-structure A2 — an L-prefixed date literal is the 64-bit type, printed in full.
  // 315 → 316: A4 — one conversion-name parser; the types it prints are the compiler's.
  // 316 → 318: A10 — one string-literal decoder; the assignment message counts decoded characters.
  // 318 → 333: A13 — declaration initializers type-checked like assignments (gap 14).
  // 333 → 349: A14 — IL operator names reserved as identifiers; C8 — a project enum's values and variables convert as INT.
  // 349 → 354: B6 — inference types an enum value, so call arguments and comparisons see it as assignments do.
  // 354 → 460 (2026-09-14): unify-conformance-suite §5 — the 117 execution programs build-recorded through the bridge.
  // 460 → 503: §5.2 — operand sign changes (arithmetic, bit operations, comparisons, MAX/MIN, NOT), a chained
  // assignment's inner store, an over-long WSTRING, a REAL literal beyond REAL, a typed literal sum; 37 `cc_*` probes.
  // 503 → 509: the six memory-model fixtures (transpile-st-to-rust design §9).
  // 509 → 521: the twelve call fixtures (`fb-call.ts`, transpile-st-to-rust phase 3).
  // 521 → 734 (2026-09-16): the fixture programme — 138 new fixtures across the cross-object, corpus-mined and
  // check-coverage batches, and the eleven LSP defects they found. The last jump, 717 → 734, is the IDE's parse-error
  // CASCADE after a reserved name, which no fixture could agree without.
  // 734 → 755 (2026-09-16): how often a DECLARATION'S INITIALIZER warning repeats. The IDE reports one twice — once
  // for the type, once for the instance initialisation it generates — and the LSP now does the same (measured with
  // `initializer-repeat.ts`: no instance 0, one instance 2, two instances 2, nested 2, PROGRAM 1; so it is per-type,
  // not per-instance). The goal is the IDE's answer, not a tidier one.
  // 849 -> 857 (2026-09-17): NINE ng_* fixtures whose recorded "ground truth" was of a project they never
  // entered. Their network text was not a round-trip fixed point, the bridge refused the push with
  // NETWORK_NOT_CANONICAL, and the recorder (then) logged a warning and wrote down the build anyway — so the
  // IDE side read `Unknown type: 'FB_NG_arith'`, which is PLC_PRG failing to find an FB that was never
  // created. Rewritten with the canonical body the refusal prints verbatim, eight now build CLEAN and the
  // ninth records real errors. No LSP change was involved in any of it.
  // 857 -> 859: `NOT` on a signed integer types as the UNSIGNED integer of its width (the result side of a
  // rule the operand side already had), and an ARRAY OF STRING(n) checks its elements.
  // 859 -> 862: the abstract ATTRIBUTE on a method without the ABSTRACT keyword warns; two probe fixtures
  // (`cc6_abstract_attribute_on_fb` / `_on_method`) established it is a METHOD rule, which `cc4_not_instantiable`
  // could not say because it carries the attribute on both and records one warning.
  // 862 -> 865: `ANYNUM_TO_*` is not a CODESYS function (it was accepted on the strength of 80 corpus uses, every
  // one inside a materialized library file), and an FB whose `FB_Init` takes extra inputs must be given them at
  // the declaration.
  // 865 -> 866: `__CURRENTTASK`, whose two messages are the same in all six positions measured.
  // 866 -> 2412 (2026-09-20). Like TwinCAT's jump the same day, this is COVERAGE and not precision: the CODESYS
  // recording covered 893 of 2530 fixtures — it had not been re-recorded since 2026-09-17, before the last of the
  // census sweeps — so two thirds of the suite could not agree because there was nothing to agree WITH.
  // 2412 -> 2418: six new fixtures, not six fixes. `cc_string_prefix_len_*` now sweeps EVERY capacity from 1
  // to 10 instead of four of them, and the sweep confirms the prefix rule the LSP already implements
  // (`n - 3`, and `n` when there is nothing to subtract from) against the "length mod 3" guess the old
  // comment carried from three data points.
  // 2419 -> 2423: four more `cc_enum_arg_into_*` cells. The family asked one unsigned target and TwinCAT was
  // silent on exactly that one, which is a hypothesis, not a measurement — four more unsigned targets make it one.
  // 2423 -> 2424: `sysop_position_value`, which asks what `__POSITION` actually EVALUATES to. It answers
  // `'Line 1, Column 1 (Impl)'` and `'Line 5 (Decl)'` — the text behind the two sizes the type carries.
  // 2424 -> 2436: the same bitwise model. It is the first CODESYS gain today that is the LSP learning a RULE
  // rather than a vendor difference being taken out of one.
  // 2436 -> 2465: the meet-based operand rule, the same twenty-nine fixtures as on TwinCAT.
  // 2465 -> 2485: A ONE-ARGUMENT MATH FUNCTION HANDS BACK THE REAL IT WAS GIVEN. All ten, both ways: the
  // catalog modelled no return type for any of them, so the LSP said nothing about a narrowing the compiler
  // reports twice. `cfold_sqrt` was the one data point, and one point cannot tell "SQRT is LREAL" from "SQRT
  // follows its argument, and an untyped real literal is an LREAL". Twenty cells can.
  // 2485 -> 2486: `cfold_sqrt` — the initializer check only ever asked `literalCheckType`, so an initializer
  // with a SHAPE (a call, a member read, an expression) converted in silence.
  // 2486 -> 2489: the same three, on CODESYS.
  // 2489 -> 2505: SEVENTEEN `tc_*` fixtures, and the catalog was the bug. `{attribute 'TcRetain'}` is a real
  // attribute to TwinCAT and an unknown one to CODESYS, which says so -- but both families sat in ONE flat set,
  // so every `Tc*` name was known to both and the LSP answered silence where CODESYS warns. Sixteen warn; the
  // seventeenth is `Tc2GvlVarNames` above a `VAR_GLOBAL`, which CODESYS says nothing about for a reason that is
  // not the name at all -- the attribute pass does not run on a GVL file, exactly as it does not on a DUT.
  // 2505 -> 2521: a WSTRING hex escape is FOUR digits, and the four cells that said so were never enough to
  // say it. They establish a REFUSAL; "a WSTRING takes no `$` escape" and "a WSTRING escape is four digits"
  // both fit them and disagree about every valid string. Thirteen new cells separate the two — `$0041`,
  // `$20AC`, `a$0041b`, the named escapes and both `WSTRING(n)` forms all compile, `$41`/`$FF`/`$C3$A9`/`$004`
  // do not — and twelve of the thirteen agreed the moment they were recorded.
  // 2521 -> 2523: the two new partial-access widths, which CODESYS compiles clean and now says so.
  // 2523 -> 2526: the same two, on the vendor where `__POSITION` resolves and only the plain unknown name bites.
  // 2526 -> 2533: the same rule, the same seven cells.
  // 2533 -> 2534: the METHOD half of the required-inputs rule, which CODESYS words as a range like a FUNCTION's.
  // 2534 -> 2544: the same eleven cells.
  // 2544 -> 2545: the same two, on the vendor that records `cfold_expt`.
  // 2545 -> 2555: the same ten cells.
  // 2555 -> 2556: the same cell.
  // 2556 -> 2560 (2026-09-27): the four label fixtures of network text v2 (5.6), each the build's own message.
  // 2560 -> 2582 (2026-09-30): the same, plus C0077 "Unknown type" for a bare name nothing declares (CODESYS only —
  // TwinCAT's library materialization does not carry every type its compiler knows).
  // 2582 -> 2585 (2026-09-30, the step's review): a global missing its `;` is silent on CODESYS
  // (`pwh_gvl_missing_semicolon` left `KNOWN_DIVERGENCES`), bare TYPE_CLASS is no unknown type
  // (`op_sys_type_class_bare`) and a call of an LDATE instance (`call_ldate_instance`), both recorded live.
  // 2585 -> 2622 (2026-09-30, frontend-conformance 2.1): the lexer's fixtures (`grammar/lexer.ts`), recorded live — 37
  // agree; ten are `KNOWN_DIVERGENCES` (the recovery rule R1's) and six are refused at object creation (`execSkip`).
  // 2622 -> 2912 (2026-09-30, frontend-conformance 2.1.3): the same fixtures, the same fixes, on the vendor they were
  // first recorded on.
  // 2912 -> 2982 (2026-10-01, frontend-conformance 2.2): the same literal fixtures and fixes, on CODESYS.
  // 2982 -> 2996 (2026-10-01, frontend-conformance 2.2a): the same review cells and fixes, on CODESYS.
  // 2996 -> 3054 (2026-10-01, frontend-conformance 2.2.6/2.2.7): the same 58 literal and address fixtures, all agreeing —
  // a `<word>#<operand>` is a typed literal, a character, a UTF-8 string, its token's own text, or a component
  // (`literal/value` `typedLiteralForm`), `STRING#`/`WSTRING#` refused words.
  // 3054 -> 3069 (2026-10-01, frontend-conformance 2.2b): the same 17 cells — a literal hole is a hole under NOT, ABS,
  // ADR and a negation and converts to ANY in a bare conversion (`analysis/hole` `passThroughOperand`), `%MW` is no
  // operand and no target, "no component" in every initializer, `INT#5:` a CASE label and an enum's `Type#Value` none,
  // `UCHAR#'$80'` one character; the two DUT ones are `COMPONENT_CARRIED_ON_IN_A_DUT`.
  // 3069 -> 3128 (2026-10-01, frontend-conformance 2.3.1-2.3.5): the same declaration fixtures and fixes, on CODESYS,
  // with VAR_GENERIC (`FB<6>`, its CONSTANT, its count) and the section-in-a-STRUCT echo whole.
  // 3128 -> 3137 (2026-10-01, 2.3 review fixes and 2.3a): the review's five cells; a struct value in an array initializer
  // held to the element's struct (`decl_struct_init_unknown_field_in_array`, `_in_field_array`), and an ARRAY OF a
  // VAR_GENERIC FB counted by its element (`decl_var_generic_in_array_no_argument`, `_two_values`).
  // 3137 -> 3178 (2026-10-01, frontend-conformance 2.3.6): the type-expression fixtures (`grammar/type-expressions.ts`),
  // recorded live — the subrange/argument-list split by type, ARRAY dimensions all `*` or none, STRING's either closer
  // and WSTRING's `(…)` only, one enum value parser, an implicit enum's base and its values through an array, and the
  // declared types refused once read (`analysis` declared-type, string-length-non-const). Not agreeing: the marks of
  // `support/divergences.ts` 2.3.6.
  // 3178 -> 3190 (2026-10-01, 2.3b review): the cells the review asked for — punctuation and TIME/DATE/platform-integer
  // subranges, untyped negative and `N-1` bounds, a POINTER TO POINTER written through, a TYPE enum value followed by
  // neither `,` nor `)` in the vendors' two wordings, an `ARRAY[*]` nested, in a STRUCT field or a METHOD's VAR_INPUT.
  // 3190 -> 3250 (2026-10-01, frontend-conformance 2.4a): the unit fixtures (`grammar/units.ts`), recorded live — the
  // header clauses in each position, each modifier on each unit kind (an access modifier only first, OVERRIDE a name),
  // a qualified base linked through its library's namespace, the TYPE's `;` per body kind and a refused body kept, the
  // checks the recordings worded (PRIVATE/PROTECTED, ABSTRACT and FINAL, EXTENDS on an alias or enum). Not agreeing:
  // the marks of `support/divergences.ts` 2.4a.
  // 3250 -> 3259 (2026-10-01, 2.4a review): the review's cells (a PROPERTY's FINAL/ABSTRACT after its access modifier,
  // an interface METHOD's ABSTRACT FINAL and VAR_TEMP/VAR_STAT/VAR_INST, a refused FB as no base).
  // 3259 -> 3260 (2026-10-01, 2.4.6): `unit_namespace_opening_only` — no word about a text opening with NAMESPACE.
  // 3260 -> 3328 (2026-10-01, frontend-conformance 2.5): the expression fixtures and the parser moves, as on TwinCAT.
  // 3328 -> 3338 (2026-10-02, 2.5a review): the review's cells, as on TwinCAT.
  // 3338 -> 3366 (2026-10-02, frontend-conformance 2.5.6): the THIS/SUPER, inline-assignment, global-namespace and
  // parenthesis fixtures, as on TwinCAT.
  // 3366 -> 3376 (2026-10-02, 2.5b review): the review's cells, as on TwinCAT.
  // 3376 -> 3454 (2026-10-02, frontend-conformance 2.6): the statement fixtures and rules, as on TwinCAT.
  // 3454 -> 3569 (2026-10-02, 2.6 review): the review's cells, as on TwinCAT; `__queryinterface(n);` the operand count alone.
  // 3569 -> 3640 (2026-10-02, frontend-conformance 2.7): the same, on CODESYS — and with the pragmas pushed, an unknown
  // attribute on any DUT warns, `deprecated` is no CODESYS attribute, `abstract` on an FB warns, `pingroup` on a unit.
  // 3640 -> 3647 (2026-10-02, 2.7 review): the same, on CODESYS.
  // 3647 -> 3707 (2026-10-02, frontend-conformance 2.8): the same, on CODESYS, and `unit_struct_extends_after_struct`,
  // `unit_struct_extends_twice` (the declaration resync resuming at a name).
  // 3707 -> 3723 (2026-10-02, 2.8 review): the same, on CODESYS.
  // 3723 -> 3757 (2026-10-02, frontend-conformance 2.10): the same, on CODESYS.
  // 3757 -> 3797 (2026-10-02, frontend-conformance 3.1): the same, on CODESYS.
  // 3797 -> 3829 (2026-10-02, frontend-conformance 3.2): the same, on CODESYS.
  // 3829 -> 3854 (2026-10-02, frontend-conformance 3.3): the same, on CODESYS.
  // 3854 -> 3868 (2026-10-02, frontend-conformance 3.4): the same, on CODESYS.
  // 3868 -> 3914 (2026-10-03, frontend-conformance 3.5): the same, on CODESYS.
  // 3914 -> 3959 (2026-10-03, frontend-conformance 4a): the same, on CODESYS.
  // 3959 -> 4047 (2026-10-03, frontend-conformance 4b): the same, on CODESYS.
  // 4047 -> 4434 (2026-10-03, frontend-conformance 4c): the same, on CODESYS.
  // 4434 -> 4499 (2026-10-03, frontend-conformance 4d): the same, on CODESYS.
  // 4499 -> 4531 (2026-10-03, frontend-conformance 4e): the same, on CODESYS.
  { vendor: "codesys", floor: 4531 },
]


/**
 * Every error+warning message the LSP emits for a fixture (incl. parse errors + PLC_PRG usage) — ONCE per fixture and
 * vendor. The replay against the recorded build and the simulator gate below both ask it for every codesys fixture; it
 * was computed twice (31 s of the file, measured 2026-10-01). Each call swaps its own fixture into the shared project
 * after undoing the previous one, so its answer does not depend on the order fixtures are asked in.
 */
const LSP_MEMO = new Map<string, string[]>()
function runLsp(testIdx: number, vendor: Vendor): string[] {
  const key = `${vendor} ${testIdx}`
  let hit = LSP_MEMO.get(key)
  if (hit === undefined) LSP_MEMO.set(key, (hit = runLspNow(testIdx, vendor)))
  return hit
}
function runLspNow(testIdx: number, vendor: Vendor): string[] {
  // the replay's project, with this fixture swapped in, and the one composition over it (`support/replay.ts`, shared with
  // the diagnostic census and the agreement residue)
  return withReplayFixture(testIdx, vendor, (files, project) =>
    replayDiagnostics(files, project, vendor)
      .filter((d) => d.severity === "error" || d.severity === "warning")
      .map((d) => `[${d.severity}] ${comparable(d.message)}`)
      .sort(),
  )
}

function ideMsgs(ds: readonly RecordedDiagnostic[]): string[] {
  return ds
    .filter((d) => d.severity === "error" || d.severity === "warning")
    .map((d) => `[${d.severity}] ${comparable(d.message)}`)
    .sort()
}

for (const { vendor, floor } of FLOORS) {
  const expected = BUILDS[vendor]

  describe(`the LSP against ${vendor}'s recorded build`, () => {
    if (expected.recorded === null) {
      test.skip(`(no recording — run \`bun run record:language\` for ${vendor})`, () => {})
      return
    }

    let agree = 0
    const falsePositives: string[] = []
    const disagreed: { name: string; lsp: string[]; ide: string[] }[] = []
    /** Marked fixtures that AGREE exactly now — each mark is stale (`support/expected-failure.ts`). */
    const stale: string[] = []
    const stillDiverges = (name: string, mark: string, lsp: string[], ide: string[]): void => {
      try {
        expectStillDiverges(name, mark, [() => expect(lsp).toEqual(ide)], `${vendor}'s build`)
      } catch (error) {
        stale.push((error as Error).message)
      }
    }
    for (let i = 0; i < ALL_TESTS.length; i++) {
      const t = ALL_TESTS[i] as (typeof ALL_TESTS)[number]
      if (!SELECTION.has(t.name)) continue
      const rec = expected.tests[t.name]
      if (rec === undefined) continue
      const lsp = runLsp(i, vendor)
      const ide = ideMsgs(rec.diagnostics)
      // A KNOWN DIVERGENCE is still replayed, as an expected failure: exempt from the false-positive gate, and
      // reported the day it agrees, so the set cannot keep a fixture that no longer diverges.
      if (KNOWN_DIVERGENCES[vendor].has(t.name)) {
        stillDiverges(t.name, `KNOWN_DIVERGENCES.${vendor}`, lsp, ide)
        continue
      }
      const ideSet = new Set(ide)
      for (const m of lsp) if (!ideSet.has(m)) falsePositives.push(`${t.name}: LSP-only ${m}`)
      // A fixture the LSP deliberately does not answer yet — the reason, with its date, is on the fixture — claims no
      // agreement. Its FALSE POSITIVES are still checked, just above: a deferral says "we do not emit this", never
      // "anything we emit here is fine". And it is an expected failure like the set above: agreeing ends it.
      if (t.deferred?.lsp !== undefined) {
        stillDiverges(t.name, t.deferred.lsp, lsp, ide)
        continue
      }
      if (lsp.length === ide.length && lsp.every((m, k) => m === ide[k])) agree += 1
      else disagreed.push({ name: t.name, lsp, ide })
    }

    // `VOLT_REPLAY_REPORT=1 bun test test/conformance/lsp-replay.test.ts` — every fixture that is not exact agreement,
    // with both sides printed. The ratchet says HOW MANY are left; closing them needs to know WHICH, and grepping a
    // 890-entry recording by hand is how a session goes missing.
    if (process.env.VOLT_REPLAY_REPORT === "1") {
      console.log(`\n[${vendor}] ${disagreed.length} fixture(s) not in exact agreement:`)
      for (const d of disagreed) {
        const ideSet = new Set(d.ide)
        const lspSet = new Set(d.lsp)
        console.log(
          `\n  ${d.name}\n` +
            d.ide.map((m) => `    IDE  ${lspSet.has(m) ? " " : "-"} ${m}`).join("\n") +
            (d.ide.length > 0 ? "\n" : "") +
            d.lsp.map((m) => `    LSP  ${ideSet.has(m) ? " " : "+"} ${m}`).join("\n"),
        )
      }
    }

    test("emits NO false positives (every LSP message is a real IDE message)", () => {
      // CODESYS is a hard zero. TwinCAT has a dated triage list (see `TWINCAT_TRIAGE`) that may only shrink.
      const triaged = vendor === "twincat" ? TWINCAT_TRIAGE : CODESYS_TRIAGE
      const unexcused = falsePositives.filter((f) => !triaged.has(f.slice(0, f.indexOf(":"))))
      expect(unexcused).toEqual([])
      // ...and an entry that no longer fires must LEAVE the list, or the list becomes a place things go to hide.
      const firing = new Set(falsePositives.map((f) => f.slice(0, f.indexOf(":"))))
      console.log(`  [${vendor}] LSP-only on ${firing.size} fixture(s) — the triage backlog`)
      expect([...triaged].filter((n) => SELECTION.has(n) && !firing.has(n))).toEqual([])
    })

    test("every known divergence still diverges (a marked fixture that agrees must lose its mark)", () => {
      expect(stale).toEqual([])
    })

    whole(`agreement does not regress (>= ${floor})`, () => {
      console.log(`  [${vendor}] exact agreement: ${agree}/${ALL_TESTS.length} fixtures`)
      expect(agree).toBeGreaterThanOrEqual(floor)
    })
  })
}

/**
 * THE ORACLE A FIXTURE HAS THE DAY IT IS WRITTEN. A fixture written today has no BUILD recording until somebody
 * brings the bridge up and re-records, so it could sit green for weeks while the LSP reported nonsense on it. It
 * does have one: `codesys.run.json` says the case BUILT and RAN in the simulator, so every LSP ERROR on it is a
 * false positive whether or not its diagnostics were ever recorded.
 *
 * Errors only — a build that succeeds still emits warnings, and which ones is what the ratchet above is for. Weaker
 * than that check (it cannot see a diagnostic the LSP MISSES) and needs nothing but the run recording.
 *
 * AN EXPLICIT BUDGET, because the default 5s is not one. This runs the whole analyzer over every fixture and the
 * cost is LINEAR in how many there are — about 3ms each, and the census sweeps took the suite from 967 fixtures
 * to 2332 in a day. It timed out twice on the way and both times it was a real quadratic term in the harness, now
 * gone: a symbol table rebuilt per fixture from every other fixture's declarations, and `relink` walking
 * every child twice per fixture. What is left is the work the gate exists to do.
 */
test("the LSP emits NO error on a fixture the simulator built and executed", () => {
  const falsePositives: string[] = []
  const stale: string[] = []
  for (const [i, t] of ALL_TESTS.entries()) {
    if (!SELECTION.has(t.name)) continue
    const rec = RUNS[t.name]
    if (rec === undefined || rec.error !== undefined || t.source === "" || t.recorderSkip === true) continue
    const errors = runLsp(i, "codesys").filter((m) => m.startsWith("[error]"))
    if (KNOWN_DIVERGENCES.codesys.has(t.name)) {
      // A marked fixture with a BUILD recording is held to it by the build row. One WITHOUT — the push cannot create it,
      // so this row is its only CODESYS oracle — is an expected failure HERE. It was skipped, so such a mark could outlive
      // its false positive with nothing to notice (lsp-sfc-step-names 1.1: the SFC fixtures are only run-recorded).
      if (BUILDS.codesys.tests[t.name] === undefined) {
        try {
          expectStillDiverges(t.name, "KNOWN_DIVERGENCES.codesys", [() => expect(errors).toEqual([])], "the CODESYS run")
        } catch (error) {
          stale.push((error as Error).message)
        }
      }
      continue
    }
    for (const m of errors) falsePositives.push(`${t.name}: ${m}`)
  }
  expect(falsePositives).toEqual([])
  expect(stale).toEqual([])
}, 60_000)
