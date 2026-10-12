/**
 * THE TYPES' AND THE ANALYSIS' KNOWN DIVERGENCES — arithmetic results, constant evaluation, the elementary rules, the
 * analysis niches, the programs' init order: the fixtures whose recorded answer the LSP does not give, each set with its
 * reason. One concern of `divergences.ts`, which assembles `KNOWN_DIVERGENCES` (openspec lsp-same-standard 4.4).
 */
// (`C0033_CONFIGURED_AS_AN_ERROR` closed 2026-10-06, analysis-conformance 3.1: its premise was false — neither recording
// project's settings raise a warning to an error, and C0033's own wording appears in no recording. A pointer refused by
// its target is the compiler's ordinary conversion ERROR, which `pointer-conversion` now gives: its ten fixtures agree on
// both vendors, `ar_new_type` on TwinCAT.)

/**
 * FRONTEND-CONFORMANCE 4.3 (2026-10-03) — the built-in result-type fixtures (`fixtures/types/arithmetic-results.ts`) whose
 * answer the LSP does not give, each for a reason that is not a rule this step could close:
 *   `ar_new_type` — CODESYS only: `__NEW(T)` is typed POINTER TO T and the store into a STRING agrees word for word
 *                            (analysis-conformance 3.1 closed the severity), but the recording project has no memory for
 *                            dynamic creation ("No memory for dynamic object creation defined…", the `newdel_*` wall).
 *   `ar_varinfo_type` — "Cannot convert type '__SYSTEM.VAR_INFO' to type 'STRING'": `__VARINFO` is the compiler's
 *                            VAR_INFO struct, whose members no recording names (so `types/system` binds none), and a
 *                            struct stored into an elementary target is unchecked for every struct — task 4.5.3, as
 *                            `ty_version_into_string`. Both vendors.
 *   `ar_real_literal_operand_types` — an untyped REAL literal beside an INTEGER (`anInt + 1.5`) is named LREAL into a
 *                            STRING and is silent into a REAL (`division_with_a_real_operand`'s `int7 / 2.0`): its type is
 *                            the STORE's context, which an operation's own type does not carry (`arith/checked`
 *                            `literalOperandType` leaves it undefined, so the three cells are missing, never wrong) — the
 *                            context literal type is LT14's / the transpiler's (`contextLiteralType`, task 5.3). Beside a
 *                            REAL or an LREAL the literal is the real's, and those four cells agree. Both vendors.
 */
export const ARITHMETIC_RESULT_DIVERGENCES: readonly string[] = ["ar_varinfo_type", "ar_real_literal_operand_types"]
export const CODESYS_ARITHMETIC_RESULT_DIVERGENCES: readonly string[] = ["ar_new_type"]

/**
 * FRONTEND-CONFORMANCE 4.5.1 (2026-10-03) — a LIBRARY enum stored into a scalar (`cv_library_enum_into_int`,
 * `cv_library_enum_into_scalars`, `cv_library_enum_255_into_scalars`): CODESYS converts Util's WEEKDAY as an unsigned
 * 16-bit type (refused into SINT, USINT, BYTE; "unsigned Type 'WEEKDAY' to signed Type 'INT'") and StringUtils'
 * EDATETIMEPLACEHOLDER as an unsigned 8-bit one ("…to signed Type 'SINT'"). Both are written `( … );` — no base — in the
 * materialized declarations the LSP reads (`Library Manager/Util/WEEKDAY.dut` in every corpus), so the base the compiler
 * uses is a fact the materialization does not carry, and `types/enums` `enumBase` leaves a library enum unjudged
 * (missing, never wrong). Closing it is the bridge's: materialize a library enum's base. Frontend-conformance 4.7.3 adds its
 * STORAGE: SIZEOF of a WEEKDAY is 2 on CODESYS (`dt_library_enum_storage`), which `types/enums` `enumStorage` cannot say.
 */
export const LIBRARY_ENUM_BASE_NOT_MATERIALIZED: readonly string[] = [
  "cv_library_enum_into_int",
  "cv_library_enum_into_scalars",
  "cv_library_enum_255_into_scalars",
  "dt_library_enum_storage",
]

/**
 * FRONTEND-CONFORMANCE 4.7.4 (2026-10-03) — an ALIAS's initializer (`TYPE A : SINT := 300`, `INT := 'abc'`, `REAL :=
 * LREAL#1.5`, rule DT2): CODESYS checks it as a store into the alias's base, and says it as often as the alias is USED —
 * never for an alias no variable is declared with (`dt_alias_init_narrowing_unused`, `dt_alias_init_wrong_type_unused`:
 * silent, as the LSP is), a refusal once, and a warning once for the alias plus once per variable of it declared in a
 * FUNCTION_BLOCK (`dt_alias_init_narrowing_in_program` 1, `dt_alias_init_narrowing` 2 each, `_two_uses` 3). TwinCAT says
 * the refusals as CODESYS does and the warnings twice for one or two variables, in an FB or a PROGRAM (`_in_program` 2,
 * `_two_uses` 2). The LSP does not check an alias's initializer: saying it needs the project-wide count of the alias's
 * uses, at the alias's declaration. Missing-only, both vendors; niche: accepted loss (0 occurrences in the corpora — no
 * alias in them has an initializer).
 */
export const ALIAS_INITIALIZER_NOT_CHECKED: readonly string[] = [
  "dt_alias_init_out_of_range",
  "dt_alias_init_wrong_type",
  "dt_alias_init_narrowing",
  "dt_alias_init_narrowing_two_uses",
  "dt_alias_init_narrowing_in_program",
]

/**
 * FRONTEND-CONFORMANCE 4.6.1 (2026-10-03) — NOT or a shift of an UNTYPED literal as an array bound (`ce_fold_not_int_untyped`
 * `NOT 250`, `ce_fold_shl_untyped` `SHL(1, 3)`): both vendors fold it at the literal's narrowest type (5, 8) and refuse
 * the index past it. The fold gives an untyped literal no width without a context (`types/const/fold` `integerTypeOf`):
 * the transpiler folds a CONSTANT's initializer by itself, and there the context's width is the right one (`NOT 0` into a
 * WORD is 65535, `ce_fold_untyped_in_context_values`). Missing-only, both vendors; niche: accepted loss (0 occurrences in
 * the corpora — no NOT or shift of a literal is an array bound in them).
 */
export const UNTYPED_OPERAND_AS_A_BOUND: readonly string[] = ["ce_fold_not_int_untyped", "ce_fold_shl_untyped"]

/**
 * FRONTEND-CONFORMANCE 4.6.1 (2026-10-03) — both vendors, `c3 : INT := NOT 5` CONSTANT
 * (`ce_fold_untyped_not_signed_context_values`): "Cannot convert type 'INT' to type 'ANY_BIT'" — the literal takes the
 * constant's INT, and NOT takes no signed integer handed over by a context, where `NOT INT#-5` as a bound builds. One cell;
 * the LSP says nothing. Missing-only; niche: accepted loss (0 signed CONSTANTs initialized by NOT of a literal in the corpora).
 */
export const UNTYPED_NOT_IN_A_SIGNED_CONTEXT: readonly string[] = ["ce_fold_untyped_not_signed_context_values"]

/**
 * FRONTEND-CONFORMANCE 4.6.1 (2026-10-03) — TwinCAT, `ARRAY[0..NOT INT#-5]` (`ce_fold_not_int_signed`): "Array Border
 * NOT(INT#-5) does not evaluate to a valid signed integer constant" and a self-conversion of the array type, where CODESYS
 * folds the bound to 4 (NOT of an INT computes in UINT) and refuses only the index, as the LSP does on both. LSP-only on
 * TwinCAT; niche: accepted loss (0 occurrences in the corpora — no NOT is an array bound in them).
 */
export const TWINCAT_NOT_OF_A_SIGNED_BOUND: readonly string[] = ["ce_fold_not_int_signed"]

/**
 * FRONTEND-CONFORMANCE 4b (2026-10-03) — TwinCAT, `b := di < SIZEOF(big)` with `di : DINT` and a 100000-byte `big`
 * (`ar_sizeof_into_narrow`): silent on TwinCAT, where CODESYS warns "unsigned Type 'UDINT' to signed Type 'DINT'" as the
 * LSP does on both. TwinCAT compares the folded size like an untyped constant that fits (as `si = 200`, rule LT12's
 * neighbour) — one cell, too little to read a rule from. The store `si := SIZEOF(a)` agrees on both. LSP-only on TwinCAT;
 * niche: accepted loss (0 occurrences in the corpora — no SIZEOF or XSIZEOF is compared with anything in them).
 */
export const TWINCAT_SIZEOF_COMPARED_AS_A_CONSTANT: readonly string[] = ["ar_sizeof_into_narrow"]

/**
 * FRONTEND-CONFORMANCE 4.3.4 (2026-10-03) — CODESYS, `__POUNAME()` into an INT: "Cannot convert type 'STRING(INT#23)' to
 * type 'INT'" (`ar_pouname_type`) — a STRING sized by the asking body's qualified name (`FB`, `FB.Method`, `FB.Action`:
 * `cp_pouname_operator` runs 'FB_CP_named.Marked' in an ACTION). An action's body binds against its FB's scope, so the
 * name an action asks with is not on the path inference has; an unsized STRING would be a wrong message where this is a
 * missing one (as `sysop_position_call_form`). TwinCAT has no `__POUNAME` and agrees.
 */
export const CODESYS_POUNAME_IS_SIZED_BY_ITS_BODY: readonly string[] = ["ar_pouname_type"]

/**
 * FRONTEND-CONFORMANCE 4.3.5 (2026-10-03) — TwinCAT, LDATE − LDATE, LDT − LDT, LTOD − LTOD (`ar_ldate_minus_ldate_type`):
 * TwinCAT has none of the three types ("Unknown type: 'LDATE'", which the LSP gives) and then reads each difference as
 * that unknown type, "Cannot convert type 'LDATE' to type 'ANY_NUM'" and "…to type 'STRING'" — arithmetic on a type that
 * does not exist. Niche: accepted loss (0 occurrences of LDATE, LDT or LTOD in the TwinCAT corpus). `ldate_ltod_ldt`
 * (frontend-conformance 4.8) is the same arithmetic: `ldt1 + oneNs` reads the unknown LDT as ULINT — "Cannot convert type
 * 'LDT' to type 'ULINT'", 'LTIME' to 'ULINT', 'ULINT' to 'LDT' — beside the twenty messages both sides give.
 */
export const TWINCAT_ARITHMETIC_ON_AN_UNKNOWN_DATE_TYPE: readonly string[] = ["ar_ldate_minus_ldate_type", "ldate_ltod_ldt"]

/**
 * FRONTEND-CONFORMANCE 4.8 (2026-10-03) — TwinCAT, an initializer that is an operation over untyped integers whose value
 * the target cannot hold (`cc_fp_overflow_expr` `x : INT := 30000 + 10000`, `cc_init_constant_expr_into_sint` `si : SINT
 * := 100 + 100`): "Cannot convert type 'DINT' to type 'INT'" / 'INT' to 'SINT' — TwinCAT types the folded operation as
 * the smallest SIGNED integer holding its value and refuses the store, where CODESYS is silent on both (as the LSP is).
 * An untyped number's type in its context is LT14's (the transpiler's call site, task 5.3). Missing-only on TwinCAT;
 * niche: accepted loss (0 occurrences in the corpora — one initializer in them is an operation over untyped integers,
 * and its value fits).
 */
export const TWINCAT_UNTYPED_OPERATION_IN_AN_INITIALIZER: readonly string[] = ["cc_fp_overflow_expr", "cc_init_constant_expr_into_sint"]

/**
 * FRONTEND-CONFORMANCE 4.1.3 (2026-10-03) — elementary-type fixtures (`fixtures/types/elementary-rules.ts`, rules TY12,
 * TY14, TY15) whose refusal the LSP does not make, both vendors alike (TwinCAT's capitals and full stop aside):
 *   (`ty_reference_to_bit` left 2026-10-06, analysis-conformance 3.11: "References to bits are not possible" is said by
 *                            `bit-usage`, under C0205's switch — the reference half of the pointer rule.)
 *   `ty_any_num_as_local_variable` — "Variables of type 'ANY_NUM' only allowed as input of functions": no catalog code
 *                            either. Niche: accepted loss (0 occurrences in the corpora of a generic type outside a
 *                            function's VAR_INPUT — 9 generic declarations, every one an input).
 *   `ty_any_elementary_parameter_rejects_struct`, `ty_any_magnitude_parameter_accepts_time` — ANY_ELEMENTARY and
 *                            ANY_MAGNITUDE are NO TYPE on either vendor ("Unknown type: 'ANY_ELEMENTARY'" twice, the
 *                            argument's "Cannot convert" to it and the `x.diSize` it then cannot type); the LSP keeps
 *                            them in `ANY_FAMILIES` for the operators' rules and its unknown-type check passes every
 *                            name there. The generic parameter check knows them for no type (`types/compat`
 *                            `GENERIC_PARAMETER_TYPES`) and stays silent. Niche: accepted loss (0 occurrences in the corpora).
 *   (`ty_version_into_string` left 2026-10-03, frontend-conformance 4.5.3: a struct stored into an elementary target is
 *                            refused, named as the struct — `analysis/rules` `storeConversionError`.)
 */
export const ELEMENTARY_RULE_DIVERGENCES: readonly string[] = [
  "ty_any_num_as_local_variable",
  "ty_any_elementary_parameter_rejects_struct",
  "ty_any_magnitude_parameter_accepts_time",
]

/**
 * ANALYSIS-CONFORMANCE 3.7–3.9 (2026-10-06) — the rule cells of oop B, calls and flow whose disagreement is NICHE: about
 * zero occurrences in the six corpora, and not trivial. Each names its count.
 *   3.7 `oopb_abstract_pointer_deref_assign` — an ABSTRACT FB's instance value-assigned THROUGH A POINTER (`p^ := c2`):
 *                            both vendors warn "The instance p^ points to will be reinitialized for virtual function
 *                            calls. Make sure p^ doesn't point to a type derived from <FB>", CODESYS refuses the target
 *                            too; whether the warning holds for every FB copied through a pointer is unmeasured. Niche:
 *                            accepted loss (0 FB instances assigned through a pointer in the corpora — every `x^ :=` of
 *                            the 32 stores a scalar or a string, and the corpus builds record no such warning).
 *   3.8 `calls_method_recursive` — a METHOD calling itself is refused as a FUNCTION is (`recursive-call`, agreed), but the
 *                            vendors echo the hole's operation with the literal beside it UNTYPED — "'(M(n := (n - INT#1))
 *                            + 1)'", and "Unknown type: 'M(n := (n - 1))'" with none typed — where the LSP's echo types
 *                            every integer literal of an operation (`expr-echo`). Niche: accepted loss (0 recursive calls in
 *                            the corpora, which build).
 */
export const ANALYSIS_NICHE: readonly string[] = ["oopb_abstract_pointer_deref_assign", "calls_method_recursive"]

// (STRING_CONSTANT_INTO_AN_INOUT — `string_inout_wider_stores`, `wstring_inout_wider` — left 2026-10-11, lsp-transpile-review-gaps
// 2.6: a literal into a VAR_IN_OUT is unwarned, `string-constant`.)
/**
 *   3.7 `oopb_abstract_method_output_default`, `oopb_implicit_abstract_output_default` — CODESYS warns "The default value
 *                            for a VAR_OUTPUT is not used in abstract or interface methods" TWICE where the abstract FB is
 *                            extended (once in `cc5_abstract_assign_and_output`, which nothing extends), and for a
 *                            body-less method of an ABSTRACT FB without the keyword too; TwinCAT says nothing. Niche:
 *                            accepted loss (0 VAR_OUTPUT defaults in a method of an ABSTRACT FB in the corpora).
 */
export const CODESYS_ANALYSIS_NICHE: readonly string[] = ["oopb_abstract_method_output_default", "oopb_implicit_abstract_output_default"]
/** …and TwinCAT's own: none yet (its `oopb_generic_*` are TWINCAT_NO_VAR_GENERIC's, the recovery's). */
/**
 * ANALYSIS-CONFORMANCE 3.11 (2026-10-06) — TwinCAT, a PROGRAM's initializer reading a variable declared AFTER it
 * (`initprg_reads_later`, `ilate : INT := ABS(other2)` above `other2 : INT := -7`): "The uninitialized variable other2 is
 * used for initialization of ilate. Use the attribute 'global_init_slot' to change the order of initialisation." (C0572;
 * CODESYS builds it, and its application then does not start). The one recorded cell of an initialization-order rule —
 * which reads count (ADR of a later one is legal, `initprg_adr_of_later`), in which POU kinds, through which calls — is
 * unmeasured. Niche: accepted loss (0 occurrences in the corpora: no corpus build says C0572).
 */
export const TWINCAT_ANALYSIS_NICHE: readonly string[] = ["initprg_reads_later"]
/**
 * ANALYSIS-CONFORMANCE 3.11, the gate review (2026-10-06) — both vendors, `__DELETE` where a statement starts and is not
 * called (`__delete n := 2;`, `n := __delete;`): beside the call's parse errors, which the LSP says, "The usage of the
 * operator '__Delete' is not allowed in this statement". The LSP reads the parse errors only. Classified niche in 3.11's
 * table and listed there without a mark, so nothing went red if they began to match. Niche: accepted loss (0 `__DELETE`
 * in the corpora).
 */
export const DELETE_NOT_ALLOWED_IN_A_STATEMENT: readonly string[] = ["lex_keyword_before_name_sys_delete", "lex_keyword_operand_sys_delete"]
/**
 * ANALYSIS-CONFORMANCE 3.11, the gate review (2026-10-06) — both vendors, an ALIAS of REFERENCE TO BIT
 * (`TYPE R : REFERENCE TO BIT; END_TYPE`): "References to bits are not possible" only once a variable of the alias exists
 * (`refbit_alias_unused` builds clean on both), TwinCAT at the alias's line, CODESYS three times with no position
 * (`refbit_alias`, `refbit_alias_variable_unread` — reading the variable or not). The rule would need the alias's uses
 * across objects, and CODESYS's two further copies have no position to place them at. Niche: accepted loss
 * (0 occurrences in the corpora: no REFERENCE TO BIT at all).
 */
export const REFERENCE_TO_BIT_ALIAS: readonly string[] = ["refbit_alias", "refbit_alias_variable_unread"]

/**
 * ANALYSIS-CONFORMANCE 3.12 (2026-10-07), TwinCAT — an initializer reading a PROGRAM initialized LATER (and C0564's own
 * repro, an instance initialized with one declared after it in its VAR block): "The uninitialized variable <read> is used
 * for initialization of <target>. Use the attribute 'global_init_slot' to change the order of initialisation.", an ERROR
 * at build on the reader's declaration line. The order is the TASK's call order with `global_init_slot` before it (lower
 * first) — `initord_reads_later_name_called_second` is silent, `_declared_second` is not (`fixtures/cross-object/init-order.ts`).
 * CODESYS says the same only at CODE GENERATION (C0564, a warning for an FB instance read, this sentence as an error for a
 * value; measured by a single-use `app.generate_code()` probe) — never at the bridge's build, so its recordings are clean
 * and agree with the LSP; pro2193's three C0564 are those code-generation warnings. Not modelled: the rule needs the
 * task configuration and the call order across every program (a whole-project fact no check holds), and its CODESYS
 * evidence is out of every build recording's reach. Not niche (pro2193 ×3) — a divergence with that measured reason.
 */
export const INIT_ORDER_OF_PROGRAMS: readonly string[] = [
  "initord_reads_later_name",
  "initord_reads_later_name_declared_second",
  "initord_slot_on_read",
  "initord_array_later_name",
  "initord_interface_var_later_name",
  "initord_read_uninitialized",
  "initord_read_type_default",
  "initord_value_later_name",
  "initord_chain3_asc",
  "initord_chain4_asc",
  "initord_chain5_asc",
  "initord_same_block_later_instance",
]
