/**
 * the helpers `baseline.ts`'s parts share: the fixture builders and the data they are built from (openspec
 * lsp-same-standard 4.4).
 */
import { EXPLICIT_PAIR_TESTS } from "../conformance/fixtures/conversions/explicit-pairs.js"

/**
 * A NAMED CEILING EXCEPTION — a rise the ratchet accepts because it is ONE known wrong answer that no known-divergence
 * list can hold (the replay agrees with the vendor's build, so a mark would trip) and whose root fix lives in a named task
 * elsewhere. It does not raise the ceiling: the file never rises (`ceilingRises`), the check allows `by` above it while
 * the fixture's finding is measured, and the exception goes STALE — failing — the moment the fixture stops producing it.
 * Remove it in the change that lands `task`.
 */
export interface CeilingException {
  /** The baseline's name (`resolution-dump`, `type-dump`). */
  baseline: string
  /** The ceiling key it lifts (`findings` for the finding count). */
  measure: string
  by: number
  /** The fixture the excepted answer is measured on — some finding (or, without one, the measure) must still carry it. */
  fixture: string
  /** Where the root fix is tracked. */
  task: string
  why: string
}

export const LIB_REFERENCE_FACTS =
  "the bridge exports each library reference's qualified-only, publish and direct-reference facts into the `.library` manifest (volt-cli `CodesysObjectModel.Libraries.cs` `ToLibRef`)"

export const TWO_LIBRARIES_ERROR =
  "bare `ERROR` (Util's, CAA Device Diagnosis') is Util's on CODESYS — DED's is no candidate, a qualified-access fact the manifest does not carry; the LSP ranks the two alike and binds DED's by the URI tiebreak, so `.WRONG_CONFIGURATION` is unresolved. Not a regression: the same input gave the same answer before 3.4, which made it measurable"

/** Why each analysis-conformance 3.7–3.9 niche cell is excepted (counts: tasks.md 3.7.4, 3.8.4, 3.9.4). */
export const ANALYSIS_NICHE_WHY = {
  deref: "an ABSTRACT FB value-assigned through a pointer (`p^ := c2`): the vendors' reinitialization warning and CODESYS's target refusal — niche: accepted loss (0 FB copies through a pointer in the corpora)",
  outputDefault: "CODESYS warns an abstract method's VAR_OUTPUT default twice where the FB is extended, and for a body-less method of an ABSTRACT FB — niche: accepted loss (0 such defaults in the corpora)",
  generic: "TwinCAT has no VAR_GENERIC: its declaration-area recovery (TWINCAT_NO_VAR_GENERIC, frontend-conformance 2.8.2)",
  recursion: "a recursive METHOD's hole echoed with its literal untyped beside the hole — niche: accepted loss (0 recursive calls in the corpora)",
  callRecursion: "CODESYS's 'Call recursion: A -> B -> A' warning for two FUNCTIONs calling each other — niche: accepted loss (0 recursive calls in the corpora)",
  realLabel: "a REAL literal as a CASE label: the vendors' parser refuses it ('No CASE label found') and recovers — niche: accepted loss (0 REAL case labels in the corpora)",
} as const

export const DEAD_CODE_TASK =
  "none planned: the replay/census analyse a fixture's file with no reachability (divergences.ts DEAD_POU_NOT_IN_THE_REPLAY, PRAGMA_DIVERGENCES' accepted loss); remove with the fixtures"

export const DEAD_CODE_WHY =
  "analysis-conformance gate 2's dead-code fixtures (fixtures/grammar/dead-code.ts), recorded 2026-10-06 to settle what the server shows in dead code"

export const TYPE_NAME_VALUE_TASK =
  "none planned — niche: accepted loss (0 in the corpora, which build): a value type for a type's name, so the vendors' \"Operation … is not possible on type 'T'\" and \"Cannot convert type 'T' …\" could be said beside C0230"

export const TYPE_NAME_VALUE_WHY = "a type's name written as a value, an operand or a condition, measured 2026-10-06 (analysis-conformance 3.5, `tav_*`)"

export const METHOD_NAME_VALUE_WHY = "a METHOD named without its call as an operand, measured 2026-10-06 (analysis-conformance 3.6, `oopa_method_ref_in_operand`)"

export const CONDITION_TYPE_TASK =
  "none planned — niche: accepted loss (analysis-conformance 3.11; 0 in the corpora, which build): \"Expression of type 'BOOL' expected in this place\" for a condition a hole leaves untyped"

export const CONDITION_TYPE_WHY = "an ambiguous global as an IF condition, measured 2026-10-06 (analysis-conformance 3.5)"

export const LITERAL_TYPING ="frontend-conformance LT14 (an untyped number's type in its context — the transpiler's call site, task 5.3)"

export const NEGATED_LITERAL_CELLS =
  "4.1.3's, 4.2's and 4.3's cells write negated untyped numbers (the minima `-128`, `-32768`, a negative CASE label, comparison and argument; 4.3's negative dividends and ABS operands; 4b's negative literal beside a bit operator; 4c's negative enum literals and the negative SOURCE value of every explicit-pair cell over SINT, INT, DINT, LINT and LREAL; transpile-restructure 2.1's negative FOR step variable) — measured, not regressed: a signed untyped number is UNKNOWN in the census until LT14 types it, and it keeps its own capped key (step 4a review)"

/** The 4.1.3 / 4.2 / 4.3 / 4b fixtures writing negated untyped numbers, with how many each carries (the same on both vendors). */
export const NEGATED_LITERAL_ROWS: readonly [string, number][] = [
  ["lt_literal_any_int_argument", 2],
  ["lt_literal_case_label", 3],
  ["lt_literal_for_bounds", 1],
  ["lt_literal_in_comparison", 1],
  ["lt_literal_negative_in_comparison_unsigned", 2],
  ["lt_negative_below_min_int", 1],
  ["lt_negative_below_min_sint", 1],
  ["lt_negative_min_dint_lint", 4],
  ["lt_negative_min_int", 2],
  ["lt_negative_min_sint", 2],
  ["ty_dint_to_uxint", 2],
  ["ty_xint_to_dint", 1],
  ["ar_div_negative", 7],
  ["ar_mod_negative", 7],
  ["ar_div_function_form", 1],
  ["ar_mod_function_form", 1],
  ["ar_abs_type", 4],
  ["ar_int_literal_operand_types", 1],
  ["ar_bitwise_literal_unsigned_or_negative", 3],
  ["ar_bitwise_literal_unsigned_or_negative_stores", 1],
  ["cv_literal_into_enum", 1],
  ["cv_literals_into_strict_enum", 1],
  // 4d: ABS of a negative literal, a subrange's negative lower bound
  ["ce_fold_builtin_bound_abs", 1],
  ["dt_subrange_assign_negative_lower", 1],
  // 4.5.3: each explicit-pair cell whose source value is negative (`v : SINT := -5`, `conversions/explicit-pairs.ts`)
  ...EXPLICIT_PAIR_TESTS.filter((t) => /:= -/.test(t.source)).map((t): [string, number] => [t.name, 1]),
  // analysis-conformance 3.11: two enum members written -1 (the duplicate value's negative cell)
  ["enumdup_negative", 2],
  // transpile-restructure 2.1: a negative FOR step variable's initial value (`downStep : INT := -4`)
  ["for_runtime_step_same_type", 1],
]

export const UNTYPED_CALL_CELLS =
  "4d's constant-folding cells call a built-in over untyped numbers only (`ABS(-3)`, `MIN(5, 3)`, `SHL(1, 20)`, …) and NOT one (`NOT 0`); the untyped-operand bounds are known divergences, not measured: CODESYS folds each (the recorded bound names the value), but the TYPE of the call or the NOT is the untyped number's, which LT14 decides in its context — measured, not regressed"

/** The 4d fixtures whose bound is a built-in call, or a NOT, over untyped numbers only — what each leaves UNKNOWN. */
export const UNTYPED_CALL_ROWS: readonly [string, "call" | "unary"][] = [
  ["ce_fold_builtin_bound_abs", "call"],
  ["ce_fold_builtin_bound_min", "call"],
  ["ce_fold_builtin_bound_max", "call"],
  ["ce_fold_builtin_bound_limit", "call"],
  ["ce_fold_builtin_bound_sel", "call"],
  ["ce_fold_builtin_bound_mux", "call"],
  // …and the CONSTANT initializers that measure the context an untyped number takes there
  ["ce_fold_untyped_in_context_values", "unary"],
  ["ce_fold_untyped_shl_in_context_values", "call"],
]

export const SECTION_ECHO =
  "the TwinCAT RECORDING of a VAR section inside a STRUCT is cut at its first line break (\"Variable declaration expected instead of VAR\", the declarations CODESYS quotes lost) — divergences.ts TWINCAT_DRIVER_CUTS_THE_ECHO, a bridge bug; the LSP words the whole echo on both vendors, as the compiler does. Not regressed: since 1.11 the census attributes the gap to the builder that words it, so it moved from unowned to group syntax with the total GAP unchanged"

/** The TwinCAT fixtures whose recorded "Variable declaration expected instead of …" is cut by the driver (TWINCAT_DRIVER_CUTS_THE_ECHO). */
export const SECTION_ECHO_ROWS: readonly string[] = [
  "decl_var_inside_struct",
  "decl_var_inside_struct_init",
  "decl_var_inside_struct_names",
  "decl_var_input_inside_struct",
  "decl_var_output_inside_struct",
  "decl_var_in_out_inside_struct",
  "decl_var_temp_inside_struct",
  "decl_var_stat_inside_struct",
  "decl_var_external_inside_struct",
  "decl_var_global_inside_struct",
  "rec_unterminated_var_before_section",
]
