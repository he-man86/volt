/**
 * THE TYPE EXPRESSIONS' AND UNITS' KNOWN DIVERGENCES — type-expression and unit-header recovery, the system operands in
 * a unit, the members' headers: the fixtures whose recorded answer the LSP does not give, each set with its reason. One
 * concern of `divergences.ts`, which assembles `KNOWN_DIVERGENCES` (openspec lsp-same-standard 4.4).
 */
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
export const TYPE_EXPRESSION_RECOVERY: readonly string[] = [
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
export const IMPLICIT_ENUM_LIST_RECOVERY: readonly string[] = [
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
export const IMPLICIT_ENUM_TYPE_NAME: readonly string[] = [
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
 * (`decl_string_length_constant`, `_brackets` left 2026-10-03, frontend-conformance 4.6.2: a variable's type folds in its
 * declaring POU, rule CE8, and a capacity written as a name is named by it, `types/type` `lengthText`. An EXPRESSION is
 * printed in the compiler's own form, 'STRING((2 + 3))', which `exprText` does not write — the render, task 4.7.4.)
 * Analysis-conformance 3.1.3 (2026-10-06): the compiler's form is `shared/expr-echo` `compilerExprText`, an analysis
 * module the type render (front-end) may not import. Niche: accepted loss (0 occurrences in the corpora — no string
 * length there is written as an operation).
 */
export const STRING_LENGTH_AS_WRITTEN: readonly string[] = ["decl_string_length_expression"]

/**
 * FRONTEND-CONFORMANCE 2.3.6 (2026-10-01) — `v : NoSuchLib.T;`: both vendors "Unknown type: 'NoSuchLib.T'". Closed on
 * CODESYS by 3.4.2 (2026-10-02): a qualifier that names nothing is the unknown name (`analysis/resolution.ts`
 * `unknownQualifiedTypeName`). TWINCAT ONLY now: the unknown-type verdict is CODESYS's alone — TwinCAT's materialization
 * (`References/`) does not carry every type its compiler knows (`unknownTypeName`).
 */
export const UNKNOWN_QUALIFIED_TYPE: readonly string[] = ["decl_type_unknown_qualified"]

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
export const TWINCAT_STRUCT_EXTENDS_RECOVERY: readonly string[] = ["unit_struct_extends_after_struct", "unit_struct_extends_twice"]

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
export const RECOVERY_DIVERGENCES: readonly string[] = ["rec_refused_name_cascade_il_word", "rec_refused_word_for_variable", "rec_type_name_dot_dangling"]

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
export const CALC_CONDITIONAL_CALL: readonly string[] = [
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
 * `sysop_position_call_form` (frontend-conformance 4.8, from the triage backlog) is the same sized type in a body, "…
 * 'STRING(INT#23)' to type 'DINT'" where the LSP says 'STRING': the length is the position text's (`21 + digits(line) +
 * digits(column)`, `probe-position-length.ts` (deleted; `git show b2496efb4b:packages/volt-lsp-iec/scripts/probe-position-length.ts`)), which the type layer does not have.
 */
export const CODESYS_POSITION_IN_AN_INITIALIZER: readonly string[] = ["sysop_position_initializer", "sysop_position_call_form"]
/**
 * ANALYSIS-CONFORMANCE 3.10.4 (2026-10-06) — CODESYS, `here := ABS(__POSITION);` (`sysop_position_as_argument`): the
 * operator without its `(` eats the next token as it does where a statement starts (the system operands' rules E30/E34, as
 * `sysop_position_then_statement`), here the `)` — "',' or ')' expected instead of ';'", which the LSP says — and the
 * argument list's recovery then takes the `;` too: "';' expected instead of end of POU", which it does not. The only
 * recorded instance of that recovery after a call's argument list (the census, syntax GAP). Niche: accepted loss
 * (0 `__POSITION` in the corpora).
 */
export const CODESYS_POSITION_EATS_THE_CLOSING_PARENTHESIS: readonly string[] = ["sysop_position_as_argument"]
export const TWINCAT_RECOVERY_DIVERGENCES: readonly string[] = ["rec_interface_stray", "rec_refused_name_declared_fb_type"]

export const UNIT_HEADER_RECOVERY: readonly string[] = [
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
 * BRIDGE-REFUSAL-REVIEW D10 (2026-10-03) — a MEMBER HEADER the push reads by its LAST word before the colon, with no
 * modifier vocabulary: `METHOD PUBLC Run` is the method Run, `METHOD Run Walk` the method Walk, `METHOD OVERRIDE M` the
 * method M, and the header is written as sent. Both vendors then read the header's FIRST word after the keyword as the
 * name, against the object: "The name used in the signature is not identical to the object name", with each vendor's
 * recovery after it (CODESYS "Ambiguous use of name 'M'", TwinCAT "VAR, VAR_INPUT, VAR_OUTPUT or VAR_INOUT expected
 * instead of Run:BOOL;"). The LSP reads the header as the IEC grammar has it and knows no object name apart from it, so it
 * gives parse errors of its own. Both vendors; niche: accepted loss (0 occurrences in the corpora — no signature line
 * holds a word between its keyword and its name that is not one of the six modifiers, 1,420 of 1,420 with modifiers).
 */
/**
 * ANALYSIS-CONFORMANCE 3.4 (recorded 2026-10-06, both vendors) — an ACCESS MODIFIER on a FUNCTION or a PROGRAM
 * (`FUNCTION PRIVATE F`, `PROGRAM PROTECTED P`): both vendors take the header, say "PRIVATE and PROTECTED may only be
 * applied on methods of function blocks", and refuse the call from PLC_PRG as "Cannot access private method ???.F" /
 * "Cannot access protected method ???.P" (TwinCAT capitalizes "Method"). The LSP's header grammar has no modifier on a
 * FUNCTION or a PROGRAM, so it refuses the word and loses the unit; the call message belongs to the access rule family
 * no check has (task 3.11's missing-rule list). Niche: accepted loss (0 occurrences in the corpora — no FUNCTION or
 * PROGRAM header carries an access modifier).
 */
export const ACCESS_MODIFIER_ON_A_FUNCTION_OR_PROGRAM: readonly string[] = ["hdr_function_private", "hdr_program_protected"]

export const MEMBER_HEADER_NAMED_BY_ITS_LAST_WORD: readonly string[] = [
  "sig_unknown_word",
  "unit_method_override",
  "unit_method_override_public_order",
  "unit_property_override",
  "unit_interface_method_override",
  "unit_interface_property_override",
]

/**
 * BRIDGE-REFUSAL-REVIEW 2.6 (2026-10-04) — a POU PROPERTY whose header declares no type (`PROPERTY Ready`, or
 * `PROPERTY Ready :`), written as sent now. Both vendors answer it with a cascade over the declaration they synthesize
 * for the getter — "',, AT or :' expected instead of ';'" / "Type definition expected instead of ';'", "'END_VAR' expected
 * instead of ''", and "Cannot convert type 'BOOL' to type 'INT'" at the getter's `Ready := TRUE` (the property read as an
 * INT) — and TwinCAT adds "Type definition expected instead of ''" to the colon-less one. The LSP reads the header as the
 * empty type and gives ONE message, the first of that cascade both vendors give for the shape — "',, AT or :' expected
 * instead of ';'" without the colon, "Type definition expected instead of ';'" after it (`parse/units/property.ts`, review
 * 5+6: it used to borrow the METHOD rule's "instead of ''", a message only TwinCAT's colon-less build has). It MISSES the
 * rest; reproducing the vendors' synthesized text would be imitating their recovery. Both vendors; niche: accepted loss
 * (0 occurrences in the corpora — every PROPERTY header in the six declares a type).
 */
export const PROPERTY_WITHOUT_A_TYPE: readonly string[] = ["rcc_property_no_type", "rcc_property_empty_type"]

/**
 * FRONTEND-CONFORMANCE 2.10 (2026-10-02) — an accessor's text the PUSH drops, U16's accessor cells: the push reads an
 * accessor's declaration from the lines UNDER its keyword line and drops that line whole, so `GET PRIVATE` reaches both
 * IDEs as `GET`; and it closes a `GET` without END_GET at its own line, so the getter's body never reaches them (both
 * build what they were given, clean). The recordings are of the rewritten text; the LSP refuses the text as written, by
 * name, because the push would drop it (`parse/units/property.ts`, `property.test.ts`). Volt's format, not a vendor's
 * rule; the silent drop is the bridge's (reported). Niche: accepted loss (0 occurrences in the corpora — every accessor
 * line there stands alone and is closed).
 */
export const ACCESSOR_TEXT_DROPPED_BY_THE_PUSH: readonly string[] = [
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
export const FB_ACCESS_AT_THE_CALL: readonly string[] = ["unit_fb_private", "unit_fb_protected"]

/**
 * FRONTEND-CONFORMANCE 2.4a (2026-10-01) — `unit_enum_extends_enum`: `e := VA`, a value of ANOTHER enum type, is the
 * warning "Implicit conversion from one enumeration type (BASE) to another (E)" on both vendors (as
 * `decl_implicit_enum_cross_assign`), where the LSP's assignment check refuses it ("Cannot convert type …") — an
 * LSP-only error. The question the fixture asks (EXTENDS on an enum) agrees; the enum conversion is conformance 4.5.1's
 * (CV3–CV5).
 */
export const ENUM_TO_ENUM_IS_A_WARNING: readonly string[] = ["unit_enum_extends_enum"]

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
export const TWINCAT_UNIT_DIVERGENCES: readonly string[] = [
  "unit_fb_extends_qualified",
  "unit_fb_modifier_twice",
  "unit_fb_public_internal",
  "unit_fb_final_public_order",
  "unit_namespace_opening_only",
]
