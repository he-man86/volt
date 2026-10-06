/**
 * A MEASUREMENT'S COMMITTED BASELINE — the known-divergence discipline of the phase-0 harness (design.md §5): a new
 * finding fails, and so does a finding that disappeared, until the baseline says so. `VOLT_WRITE_BASELINE=1` rewrites
 * it from the measurement instead of comparing; the diff of that file is then the review.
 *
 * THE CEILINGS (`baselines/ceilings.json`) are what makes "may only fall" (tasks.md 0.6) mechanical rather than a
 * reviewer's eye: each disagreement measure of a baseline — its finding count (`findings`), a NONE / NOSCOPE /
 * NO-CALLEE / UNKNOWN count — has a ceiling. The writer REFUSES a measurement above a ceiling (so regenerating cannot
 * absorb a rise) and lowers every ceiling to what it measured; the check fails a ceiling that is stale, and
 * `baseline.test.ts` fails a ceilings file that rose against any committed version of itself.
 */
import { expect } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { EXPLICIT_PAIR_TESTS } from "../conformance/fixtures/conversions/explicit-pairs.js"

/** The front-end's baselines — the default directory. A measurement elsewhere (`test/analysis/baselines/`) passes its own:
 *  the discipline, the ceilings and the history check are shared, not copied. */
export const FRONTEND_BASELINES = join(import.meta.dir, "baselines")
export const CEILINGS_PATH = join(FRONTEND_BASELINES, "ceilings.json")
/** A baseline directory's ceilings file. */
export const ceilingsPath = (dir: string): string => join(dir, "ceilings.json")
/** A path as an error names it: package-relative, slash-separated. */
const pkgPath = (path: string): string => relative(join(import.meta.dir, "..", ".."), path).split("\\").join("/")

export interface Baseline {
  /** Pinned numbers: a count that moves, either way, is a change to explain. */
  counts: Record<string, number>
  /** Findings, one line each, sorted. */
  findings: string[]
}

/** Per baseline name, per measure: the most it may be. `findings` names the baseline's finding count. */
export type Ceilings = Record<string, Record<string, number>>

export function readCeilings(path: string = CEILINGS_PATH): Ceilings {
  if (!existsSync(path)) throw new Error(`no ${pkgPath(path)}`)
  return JSON.parse(readFileSync(path, "utf8")) as Ceilings
}

/** One baseline's ceiling section — a baseline without one is refused: every measurement names what may not rise. */
export function ceilingsOf(name: string, ceilings: Ceilings = readCeilings(), path: string = CEILINGS_PATH): Record<string, number> {
  const section = ceilings[name]
  if (section === undefined) throw new Error(`${pkgPath(path)} has no section "${name}"`)
  return section
}

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

const LIB_REFERENCE_FACTS =
  "the bridge exports each library reference's qualified-only, publish and direct-reference facts into the `.library` manifest (volt-cli `CodesysObjectModel.Libraries.cs` `ToLibRef`)"
const TWO_LIBRARIES_ERROR =
  "bare `ERROR` (Util's, CAA Device Diagnosis') is Util's on CODESYS — DED's is no candidate, a qualified-access fact the manifest does not carry; the LSP ranks the two alike and binds DED's by the URI tiebreak, so `.WRONG_CONFIGURATION` is unresolved. Not a regression: the same input gave the same answer before 3.4, which made it measurable"

/** Why each analysis-conformance 3.7–3.9 niche cell is excepted (counts: tasks.md 3.7.4, 3.8.4, 3.9.4). */
const ANALYSIS_NICHE_WHY = {
  deref: "an ABSTRACT FB value-assigned through a pointer (`p^ := c2`): the vendors' reinitialization warning and CODESYS's target refusal — niche: accepted loss (0 FB copies through a pointer in the corpora)",
  outputDefault: "CODESYS warns an abstract method's VAR_OUTPUT default twice where the FB is extended, and for a body-less method of an ABSTRACT FB — niche: accepted loss (0 such defaults in the corpora)",
  generic: "TwinCAT has no VAR_GENERIC: its declaration-area recovery (TWINCAT_NO_VAR_GENERIC, frontend-conformance 2.8.2)",
  recursion: "a recursive METHOD's hole echoed with its literal untyped beside the hole — niche: accepted loss (0 recursive calls in the corpora)",
  callRecursion: "CODESYS's 'Call recursion: A -> B -> A' warning for two FUNCTIONs calling each other — niche: accepted loss (0 recursive calls in the corpora)",
  realLabel: "a REAL literal as a CASE label: the vendors' parser refuses it ('No CASE label found') and recovers — niche: accepted loss (0 REAL case labels in the corpora)",
} as const

const DEAD_CODE_TASK =
  "none planned: the replay/census analyse a fixture's file with no reachability (divergences.ts DEAD_POU_NOT_IN_THE_REPLAY, PRAGMA_DIVERGENCES' accepted loss); remove with the fixtures"
const DEAD_CODE_WHY =
  "analysis-conformance gate 2's dead-code fixtures (fixtures/grammar/dead-code.ts), recorded 2026-10-06 to settle what the server shows in dead code"

const TYPE_NAME_VALUE_TASK =
  "none planned — niche: accepted loss (0 in the corpora, which build): a value type for a type's name, so the vendors' \"Operation … is not possible on type 'T'\" and \"Cannot convert type 'T' …\" could be said beside C0230"
const TYPE_NAME_VALUE_WHY = "a type's name written as a value, an operand or a condition, measured 2026-10-06 (analysis-conformance 3.5, `tav_*`)"
const METHOD_NAME_VALUE_WHY = "a METHOD named without its call as an operand, measured 2026-10-06 (analysis-conformance 3.6, `oopa_method_ref_in_operand`)"
const CONDITION_TYPE_TASK = "analysis-conformance 3.11 — \"Expression of type 'BOOL' expected in this place\" for an untyped condition (no catalog code yet)"
const CONDITION_TYPE_WHY = "an ambiguous global as an IF condition, measured 2026-10-06 (analysis-conformance 3.5)"

const LITERAL_TYPING ="frontend-conformance LT14 (an untyped number's type in its context — the transpiler's call site, task 5.3)"
const NEGATED_LITERAL_CELLS =
  "4.1.3's, 4.2's and 4.3's cells write negated untyped numbers (the minima `-128`, `-32768`, a negative CASE label, comparison and argument; 4.3's negative dividends and ABS operands; 4b's negative literal beside a bit operator; 4c's negative enum literals and the negative SOURCE value of every explicit-pair cell over SINT, INT, DINT, LINT and LREAL) — measured, not regressed: a signed untyped number is UNKNOWN in the census until LT14 types it, and it keeps its own capped key (step 4a review)"
/** The 4.1.3 / 4.2 / 4.3 / 4b fixtures writing negated untyped numbers, with how many each carries (the same on both vendors). */
const NEGATED_LITERAL_ROWS: readonly [string, number][] = [
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
]

const UNTYPED_CALL_CELLS =
  "4d's constant-folding cells call a built-in over untyped numbers only (`ABS(-3)`, `MIN(5, 3)`, `SHL(1, 20)`, …) and NOT one (`NOT 0`); the untyped-operand bounds are known divergences, not measured: CODESYS folds each (the recorded bound names the value), but the TYPE of the call or the NOT is the untyped number's, which LT14 decides in its context — measured, not regressed"
/** The 4d fixtures whose bound is a built-in call, or a NOT, over untyped numbers only — what each leaves UNKNOWN. */
const UNTYPED_CALL_ROWS: readonly [string, "call" | "unary"][] = [
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

const SECTION_ECHO =
  "the TwinCAT RECORDING of a VAR section inside a STRUCT is cut at its first line break (\"Variable declaration expected instead of VAR\", the declarations CODESYS quotes lost) — divergences.ts TWINCAT_DRIVER_CUTS_THE_ECHO, a bridge bug; the LSP words the whole echo on both vendors, as the compiler does. Not regressed: since 1.11 the census attributes the gap to the builder that words it, so it moved from unowned to group syntax with the total GAP unchanged"
/** The TwinCAT fixtures whose recorded "Variable declaration expected instead of …" is cut by the driver (TWINCAT_DRIVER_CUTS_THE_ECHO). */
const SECTION_ECHO_ROWS: readonly string[] = [
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

export const CEILING_EXCEPTIONS: readonly CeilingException[] = [
  ...UNTYPED_CALL_ROWS.flatMap(([fixture, kind]) =>
    (["codesys", "twincat"] as const).map((vendor) => ({
      baseline: "type-dump",
      measure: `fixtures ${vendor}: ${kind} UNKNOWN`,
      by: 1,
      fixture,
      task: LITERAL_TYPING,
      why: UNTYPED_CALL_CELLS,
    })),
  ),
  ...NEGATED_LITERAL_ROWS.flatMap(([fixture, by]) =>
    (["codesys", "twincat"] as const).map((vendor) => ({
      baseline: "type-dump",
      measure: `fixtures ${vendor}: unary UNKNOWN, a signed untyped number (context-typed, as a literal)`,
      by,
      fixture,
      task: LITERAL_TYPING,
      why: NEGATED_LITERAL_CELLS,
    })),
  ),
  // (the FOR-bound exceptions — `n := n + 1` in `lt_literal_for_bounds`, `_out_of_range` and `cc6_loop_cannot_exit` — left
  // 2026-10-03: an operation on an untyped literal takes its neighbour's type since frontend-conformance 4.3.1, `arith/checked`
  // `literalOperandType`)
  // (the ADR exceptions — `ty_array_of_pointer` and 3.5's pointer cells `mem_*_pointer_*` — left 2026-10-03: ADR is
  // POINTER TO its operand's type since frontend-conformance 4.3.4, so their calls are typed)
  { baseline: "resolution-dump", measure: "findings", by: 1, fixture: "lib_ns_type_name_two_libraries", task: LIB_REFERENCE_FACTS, why: TWO_LIBRARIES_ERROR },
  // an ALIAS's type expression was NOSCOPE until frontend-conformance 4.7.4 placed it in the project its file sees (rule DT1,
  // `dumps.ts` `sites`): of pro2193's three library aliases bounded by a GVL constant (`ARRAY [1..GVL_Dashboard.
  // LogQueueLength] OF LogRecord`, BrinkEdgePcLogging), one constant is a platform integer, which on a corpus whose target
  // nobody measured is UNKNOWN — the same expression, moved from NOSCOPE (−3) into the TY6 class (+1)
  {
    baseline: "type-dump",
    measure: "corpus Library Manager: member UNKNOWN, a platform integer on a target nobody measured (TY6)",
    by: 1,
    fixture: "(corpus) pro2193 BrinkEdgePcLogging LOGRECORDARRAY.dut",
    task: "a measured target for each corpus (`workspace-refs` `MEASURED_DEVICE_TARGETS`)",
    why: "an alias's bound read in the project scope (frontend-conformance 4.7.4) — a NOSCOPE expression typed as far as an unmeasured target allows",
  },
  { baseline: "resolution-dump", measure: "fixtures codesys: member NONE", by: 1, fixture: "lib_ns_type_name_two_libraries", task: LIB_REFERENCE_FACTS, why: TWO_LIBRARIES_ERROR },
  { baseline: "type-dump", measure: "fixtures codesys: member UNKNOWN", by: 1, fixture: "lib_ns_type_name_two_libraries", task: LIB_REFERENCE_FACTS, why: TWO_LIBRARIES_ERROR },
  // the diagnostic census: a VAR section inside a STRUCT is echoed by `parse-errors` through a NAMED builder since
  // analysis-conformance 1.11 (`variableDeclarationExpectedInsteadOf`, an inline template before), so the gap against
  // TwinCAT's CUT recording of that echo (divergences.ts TWINCAT_DRIVER_CUTS_THE_ECHO: the driver drops everything after
  // the message's first line break) is attributed to the syntax group instead of `unowned` (unowned GAP 115 → 104, group
  // syntax GAP 70 → 81): the same eleven recorded messages, moved between classes, no diagnostic changed. The fix is the
  // BRIDGE's and a re-record, never the LSP matching the cut text; each exception goes when its fixture is re-recorded.
  ...SECTION_ECHO_ROWS.map((fixture) => ({
    baseline: "fixtures.twincat",
    measure: "group syntax: GAP",
    by: 1,
    fixture,
    task: "the TwinCAT driver: keep a message whole past its first line break, then re-record these fixtures (divergences.ts TWINCAT_DRIVER_CUTS_THE_ECHO)",
    why: SECTION_ECHO,
  })),
  // the diagnostic census: analysis-conformance gate 2 RECORDED what the server does with parse errors in dead code
  // (`fixtures/grammar/dead-code.ts`). The two dead-FB fixtures build clean on both vendors — the build never reads a POU
  // nothing reaches — while the census, analysing each fixture's file as the replay does, has no reachability and counts
  // their parse error as FP(div) (divergences.ts DEAD_POU_NOT_IN_THE_REPLAY; the SERVER suppresses it, src/server/
  // diagnostics.test.ts). The dead-method `hasattribute` fixture repeats `prag_hasattribute_unquoted_in_declaration`'s
  // accepted loss in a method nothing calls (CODESYS's extra "not supported in declaration part" GAP, TwinCAT's silence
  // FP(div)). New ground measured, not a regression: no existing finding changed.
  ...(["dead_fb_missing_then", "dead_fb_declaration_parse_error"] as const).flatMap((fixture) =>
    (["codesys", "twincat"] as const).map((vendor) => ({
      baseline: `fixtures.${vendor}`,
      measure: "total: FP",
      by: 1,
      fixture,
      task: DEAD_CODE_TASK,
      why: DEAD_CODE_WHY,
    })),
  ),
  // analysis-conformance 3.1 measured a POINTER compared with a SIGNED integer: both vendors meet the two at LINT and warn
  // the pointer's change of sign (`cmpop_pointer_vs_*`). The analysis says so (`types/compat` `pointerComparison`); the
  // front-end's type model has no meet of a pointer and an integer, so the bound census finds no store it types POINTER TO
  // INT → LINT. New ground measured, not a regression.
  // `cmpop_pointer_vs_xint` (the 3.1+3.3 gate review) is the same meet, an __XINT being LINT on the 64-bit target.
  ...(["cmpop_pointer_vs_lint", "cmpop_pointer_vs_sint", "cmpop_pointer_vs_int_ordered", "cmpop_pointer_vs_xint"] as const).map((fixture) => ({
    baseline: "type-dump",
    measure: "findings",
    by: 1,
    fixture,
    task: "the front-end's meet of a pointer and an integer (`arith/checked` `checkedMeetType`), which `pointerComparison` states for the analysis",
    why: "a comparison's pointer–integer meet, measured 2026-10-06 (analysis-conformance 3.1), that the type model does not carry",
  })),
  // …and `rec : S := (1)` (`litc_struct_init_one_in_parens`): an untyped literal in parentheses whose context is a STRUCT has
  // no type of its own — the analysis names it BIT as the vendors do (`types/literal` `literalErrorType`), the type dump
  // counts the parenthesis UNKNOWN, as it does every context-typed literal it cannot place
  ...(["codesys", "twincat"] as const).map((vendor) => ({
    baseline: "type-dump",
    measure: `fixtures ${vendor}: paren UNKNOWN`,
    by: 1,
    fixture: "litc_struct_init_one_in_parens",
    task: LITERAL_TYPING,
    why: "a parenthesized untyped literal stored into a STRUCT (analysis-conformance 3.1) — context-typed, with no elementary context",
  })),
  // analysis-conformance 3.2 measured an array initializer against its declared type (`fixtures/declarations/array-init-
  // shapes.ts`): each scalar where an ARRAY OF ARRAY or an ARRAY OF a struct needs a list converts into the element type
  // ("Cannot convert type 'SINT' to type 'ARRAY [0..1] OF INT'"), and an array literal on a scalar or a struct is "Cannot
  // convert type 'Unknown type: '[1, 2]'' …". The analysis says so (`array-init`); the bound census finds no store the
  // front-end types for an aggregate's element. New ground measured, not a regression.
  ...(
    [
      ["arrinit_flat_into_nested", 6],
      ["arrinit_scalar_into_struct_array", 4],
      ["arrinit_on_scalar", 2],
      ["arrinit_on_struct", 2],
    ] as const
  ).map(([fixture, by]) => ({
    baseline: "type-dump",
    measure: "findings",
    by,
    fixture,
    task: "the front-end's stores of an aggregate initializer's elements (the bound census reads assignments and initial values)",
    why: "an array initializer's element conversions, measured 2026-10-06 (analysis-conformance 3.2), that the bound census does not see as stores",
  })),
  // the diagnostic census: analysis-conformance 3.2 asked what an enum member may be initialized with (`fixtures/types/
  // enum-init-values.ts`). A refused value leaves the member 0, and both vendors then WARN "The constant 0 is assigned to
  // more than one enumeration" beside a member written 0 — as they do for two members written alike
  // (`eninit_explicit_duplicate`). That is the duplicate-value rule 0.2 classed missing-rule, 3.11's to add as a check;
  // each fixture is one unowned GAP per vendor until it does. New ground measured, not a regression.
  ...(["eninit_real_literal", "eninit_string_literal", "eninit_bool_literal", "eninit_gvl_variable", "eninit_explicit_duplicate"] as const).flatMap(
    (fixture) =>
      (["codesys", "twincat"] as const).flatMap((vendor) =>
        (["total: GAP", "total: unowned GAP"] as const).map((measure) => ({
          baseline: `fixtures.${vendor}`,
          measure,
          by: 1,
          fixture,
          task: "analysis-conformance 3.11 — the duplicate enum value (\"The constant … is assigned to more than one enumeration\")",
          why: "a duplicate enum value, measured 2026-10-06 (analysis-conformance 3.2) — 0.2's missing-rule class",
        })),
      ),
  ),
  // the diagnostic census: analysis-conformance 3.3 asked a BIT in every FB section (`fixtures/declarations/declaration-
  // rules.ts`). In a VAR_IN_OUT CODESYS adds "References to bits are not possible" — a reference rule 0.2 classed
  // missing-rule (3.11's) — one unowned GAP. And a FUNCTION called with no argument whose one input's default CODESYS refuses
  // (not constant) is "requires exactly '1' inputs" there (`callarg_no_argument_variable_default`, MEASURED_SILENT in fixtures.test.ts):
  // the call check reads only that a default is written, the calls group's to refine (3.8) — one calls GAP. New ground
  // measured, not a regression.
  // …and `b : BIT := 1` in a VAR CONSTANT (`bitu_fb_var_constant`, legal on both): one more literal of LT14's existing class
  // "into BIT — transpiler SINT, checker BIT", the transpiler's context literal type (task 5.3)
  {
    baseline: "literal-agreement",
    measure: "fixtures: literals the two disagree on",
    by: 1,
    fixture: "bitu_fb_var_constant",
    task: LITERAL_TYPING,
    why: "a BIT constant initialized with 1 (analysis-conformance 3.3) — LT14's class 'into BIT', one literal more",
  },
  ...(["total: GAP", "total: unowned GAP"] as const).map((measure) => ({
    baseline: "fixtures.codesys",
    measure,
    by: 1,
    fixture: "bitu_fb_var_in_out",
    task: "analysis-conformance 3.11 — references to bits (\"References to bits are not possible\")",
    why: "a BIT in a VAR_IN_OUT, measured 2026-10-06 (analysis-conformance 3.3) — 0.2's missing-rule class",
  })),
  // (`callarg_no_argument_variable_default`'s two left 2026-10-06, analysis-conformance 3.8: a VARIABLE default leaves a
  // FUNCTION input required on CODESYS, `call-arguments` says so.)
  // analysis-conformance 3.4 asked an FB instance initialized with a LITERAL for its VAR_IN_OUT (`ioinit_fb_instance_literal`):
  // both vendors convert the value into the parameter's REFERENCE ("Cannot convert type 'SINT' to type 'REFERENCE TO INT'",
  // TwinCAT the pair reversed). The bound census reads assignments and initial values, not an FB initializer's fields as
  // stores — one finding per vendor. New ground measured, not a regression.
  {
    baseline: "type-dump",
    measure: "findings",
    by: 2,
    fixture: "ioinit_fb_instance_literal",
    task: "the front-end's stores of an FB instance initializer's fields (the bound census reads assignments and initial values)",
    why: "an FB initializer's VAR_IN_OUT field given a literal, measured 2026-10-06 (analysis-conformance 3.4) — a store the bound census does not see",
  },
  // the diagnostic census: analysis-conformance 3.4 asked an access modifier on a FUNCTION and on a PROGRAM (`fixtures/
  // declarations/declaration-rules-b.ts`, divergences.ts ACCESS_MODIFIER_ON_A_FUNCTION_OR_PROGRAM, niche): the LSP's header
  // grammar refuses the word and loses the unit (its parse errors and the call's fallout, FP(div)), where both vendors
  // take the header and give the access message (a declarations GAP) and "Cannot access private method ???.F" at the call
  // (unowned: the access rule family, 3.11's). New ground measured, not a regression.
  ...(
    [
      ["hdr_function_private", 5],
      ["hdr_program_protected", 4],
    ] as const
  ).flatMap(([fixture, fp]) =>
    (["codesys", "twincat"] as const).flatMap((vendor) =>
      (
        [
          ["total: FP", fp],
          ["total: GAP", 2],
          ["total: unowned GAP", 1],
        ] as const
      ).map(([measure, by]) => ({
        baseline: `fixtures.${vendor}`,
        measure,
        by,
        fixture,
        task: "analysis-conformance 3.11 — the access rule family (\"Cannot access private method …\"), and a header grammar that takes an access modifier on a FUNCTION or a PROGRAM",
        why: "an access modifier on a FUNCTION / PROGRAM, measured 2026-10-06 (analysis-conformance 3.4) — niche: accepted loss (0 in the corpora)",
      })),
    ),
  ),
  // …and an ARRAY / STRUCT initializer reading the FB's own VAR_IN_OUT (`ioinit_array_initializer`, `_struct_`): CODESYS
  // records the uninitialized-access warning TWICE there (TwinCAT once); inout-initializer says it once. (The external
  // access from FB_INIT and the FB instance's conversion into the REFERENCE are said since 3.6.)
  ...(["ioinit_array_initializer", "ioinit_struct_initializer"] as const).map((fixture) => ({
    baseline: "fixtures.codesys",
    measure: "total: GAP",
    by: 1,
    fixture,
    task: "none planned: CODESYS repeats the warning for an aggregate initializer (FB_INIT), TwinCAT does not — said once",
    why: "an aggregate initializer reading a VAR_IN_OUT, measured 2026-10-06 (analysis-conformance 3.4)",
  })),
  // analysis-conformance 3.5 asked a TYPE's name as a value (`fixtures/names/name-rules.ts` `tav_*`): both vendors type it
  // as the type itself — "Operation 'Plus' is not possible on type 'T'", "Cannot convert type 'T' to type 'BOOL'" — where
  // the front-end has no value type for a type's name (an ALIAS's is UNKNOWN; the enum's and struct's are its scope). C0230
  // is said; the conversions are a niche divergence (0 in the corpora, which build). New ground measured, not a regression.
  ...(["tav_alias_as_value", "tav_alias_as_target", "tav_type_as_operand"] as const).flatMap((fixture) =>
    (["codesys", "twincat"] as const).map((vendor) => ({
      baseline: "type-dump",
      measure: `fixtures ${vendor}: ident_expr UNKNOWN`,
      by: 1,
      fixture,
      task: TYPE_NAME_VALUE_TASK,
      why: TYPE_NAME_VALUE_WHY,
    })),
  ),
  ...(["codesys", "twincat"] as const).map((vendor) => ({
    baseline: "type-dump",
    measure: `fixtures ${vendor}: binary UNKNOWN`,
    by: 1,
    fixture: "tav_type_as_operand",
    task: TYPE_NAME_VALUE_TASK,
    why: TYPE_NAME_VALUE_WHY,
  })),
  // (the census attributes "Operation 'Plus' is not possible on type 'T'" to the one check that says that wording, the calls
  // group's intrinsic-operands)
  ...(["codesys", "twincat"] as const).map((vendor) => ({
    baseline: `fixtures.${vendor}`,
    measure: "group calls: GAP",
    by: 1,
    fixture: "tav_type_as_operand",
    task: TYPE_NAME_VALUE_TASK,
    why: TYPE_NAME_VALUE_WHY,
  })),
  ...(["tav_type_as_operand", "tav_type_as_condition"] as const).map((fixture) => ({
    baseline: "type-dump",
    measure: "findings",
    by: 2,
    fixture,
    task: TYPE_NAME_VALUE_TASK,
    why: TYPE_NAME_VALUE_WHY,
  })),
  // …and a global two lists declare as an IF condition (`ambg_in_condition`): both vendors add "Expression of type 'BOOL'
  // expected in this place" for the hole the name leaves — no catalog code, 0.2's missing-rule class (3.11's, as for
  // `enum_same_member_comparison`); the parse census classes the wording as a syntax message
  ...(["codesys", "twincat"] as const).flatMap((vendor) => [
    {
      baseline: "parse-census",
      measure: `fixtures ${vendor}: refused with a syntax message, no LSP parse error`,
      by: 1,
      fixture: "ambg_in_condition",
      task: CONDITION_TYPE_TASK,
      why: CONDITION_TYPE_WHY,
    },
    {
      baseline: `fixtures.${vendor}`,
      measure: "total: unowned GAP",
      by: 1,
      fixture: "ambg_in_condition",
      task: CONDITION_TYPE_TASK,
      why: CONDITION_TYPE_WHY,
    },
  ]),
  { baseline: "parse-census", measure: "findings", by: 2, fixture: "ambg_in_condition", task: CONDITION_TYPE_TASK, why: CONDITION_TYPE_WHY },
  // analysis-conformance 3.6: an FB instance's VAR_IN_OUT field given a BOOL variable (`oopa_fb_init_inout_other_type`) —
  // the same store the bound census does not see as `ioinit_fb_instance_literal`'s — and a METHOD named without its call as
  // an operand (`oopa_method_ref_in_operand`, deferred niche): both vendors type it as a type of its own name ('VALUE'),
  // which the front-end has no value type for, so the operation is UNKNOWN. New ground measured, not a regression.
  {
    baseline: "type-dump",
    measure: "findings",
    by: 2,
    fixture: "oopa_fb_init_inout_other_type",
    task: "the front-end's stores of an FB instance initializer's fields (the bound census reads assignments and initial values)",
    why: "an FB initializer's VAR_IN_OUT field given a variable of another type, measured 2026-10-06 (analysis-conformance 3.6)",
  },
  { baseline: "type-dump", measure: "findings", by: 2, fixture: "oopa_method_ref_in_operand", task: TYPE_NAME_VALUE_TASK, why: METHOD_NAME_VALUE_WHY },
  ...(["codesys", "twincat"] as const).flatMap((vendor) =>
    (
      [
        ["group calls: GAP", 1],
        ["total: GAP", 2],
      ] as const
    ).map(([measure, by]) => ({ baseline: `fixtures.${vendor}`, measure, by, fixture: "oopa_method_ref_in_operand", task: TYPE_NAME_VALUE_TASK, why: METHOD_NAME_VALUE_WHY })),
  ),
  ...(["codesys", "twincat"] as const).map((vendor) => ({
    baseline: "type-dump",
    measure: `fixtures ${vendor}: binary UNKNOWN`,
    by: 1,
    fixture: "oopa_method_ref_in_operand",
    task: TYPE_NAME_VALUE_TASK,
    why: METHOD_NAME_VALUE_WHY,
  })),
  // analysis-conformance 3.7–3.9: the rule cells of oop B, calls and flow whose answer the LSP does not give — each a
  // NICHE divergence or a named GAP (tasks.md 3.7.4, 3.8.4, 3.9.4; `support/divergences.ts` ANALYSIS_NICHE,
  // TWINCAT_NO_VAR_GENERIC). New ground measured, not a regression: every count below is one fixture's own findings.
  ...(
    [
      ["codesys", "oopb_abstract_pointer_deref_assign", { "total: GAP": 2, "group oop: GAP": 1, "total: unowned GAP": 1 }, ANALYSIS_NICHE_WHY.deref],
      ["twincat", "oopb_abstract_pointer_deref_assign", { "total: GAP": 1, "total: unowned GAP": 1 }, ANALYSIS_NICHE_WHY.deref],
      ["codesys", "oopb_abstract_method_output_default", { "total: GAP": 1, "group oop: GAP": 1 }, ANALYSIS_NICHE_WHY.outputDefault],
      ["codesys", "oopb_implicit_abstract_output_default", { "total: GAP": 2, "group oop: GAP": 2 }, ANALYSIS_NICHE_WHY.outputDefault],
      ["twincat", "oopb_generic_two_constants_one_value", { "total: FP": 20, "total: GAP": 10, "total: unowned GAP": 1 }, ANALYSIS_NICHE_WHY.generic],
      ["twincat", "oopb_generic_as_input", { "total: FP": 15, "total: GAP": 8, "total: unowned GAP": 2, "group syntax: GAP": 2 }, ANALYSIS_NICHE_WHY.generic],
      ["codesys", "calls_method_recursive", { "total: FP": 2, "total: GAP": 2 }, ANALYSIS_NICHE_WHY.recursion],
      ["twincat", "calls_method_recursive", { "total: FP": 2, "total: GAP": 2 }, ANALYSIS_NICHE_WHY.recursion],
      ["codesys", "calls_functions_mutually_recursive", { "total: GAP": 1, "total: unowned GAP": 1 }, ANALYSIS_NICHE_WHY.callRecursion],
      ["codesys", "flw_case_real_label", { "total: GAP": 9, "group syntax: GAP": 1 }, ANALYSIS_NICHE_WHY.realLabel],
      ["twincat", "flw_case_real_label", { "total: GAP": 5, "group syntax: GAP": 1 }, ANALYSIS_NICHE_WHY.realLabel],
    ] as const
  ).flatMap(([vendor, fixture, counts, why]) =>
    Object.entries(counts).map(([measure, by]) => ({ baseline: `fixtures.${vendor}`, measure, by, fixture, task: "none: niche, accepted loss (analysis-conformance 3.7–3.9)", why })),
  ),
  // …and the front-end dumps over the same new cells (analysis-conformance 3.7–3.9, 2026-10-06), each a type the front-end
  // does not give where the vendor answers: INI has no result type, a STRUCT instance or THIS/SUPER out of place called or
  // dereferenced is untyped where the vendor refuses it, a bit access's address, a negated number as a FOR bound, a REAL
  // CASE label the parser takes (`flw_case_real_label`, niche), and two stores the bound census does not see (a refused
  // call's result, SQRT's operand). New ground measured, not a regression.
  ...(["codesys", "twincat"] as const).flatMap((vendor) =>
    (
      [
        ["call UNKNOWN", 1, "calls_ini_on_int", "INI has no result type in the front-end"],
        ["call UNKNOWN", 1, "calls_ini_on_fb_instance", "INI has no result type in the front-end"],
        ["call UNKNOWN", 1, "calls_struct_instance_called", "a STRUCT instance called — 'Cannot call object of type 'TYPE'' on the vendor"],
        ["deref UNKNOWN", 1, "flw_super_in_method_no_base", "SUPER^ in an FB extending nothing — refused by the vendor"],
        ["deref UNKNOWN", 1, "flw_this_in_function", "THIS^ in a FUNCTION — refused by the vendor"],
        ["ident_expr UNKNOWN", 1, "flw_this_in_function", "THIS in a FUNCTION — refused by the vendor"],
        ["member UNKNOWN", 1, "flw_this_in_function", "THIS^.a in a FUNCTION — refused by the vendor"],
        ["member UNKNOWN", 1, "calls_adr_on_bit_access", "a bit access `w.3` as ADR's operand"],
        ["unary UNKNOWN, a signed untyped number (context-typed, as a literal)", 2, "flw_for_int_down_to_min", "the FOR bounds -32768 and -1, negated untyped numbers (LT14's)"],
      ] as const
    ).map(([kind, by, fixture, why]) => ({
      baseline: "type-dump",
      measure: `fixtures ${vendor}: ${kind}`,
      by,
      fixture,
      task: "the front-end's types of refused and operator-only expressions (analysis-conformance 3.7–3.9 measured)",
      why,
    })),
  ),
  { baseline: "type-dump", measure: "fixtures twincat: call UNKNOWN, on an untyped operand", by: 1, fixture: "calls_adr_on_bit_access", task: "ADR of a bit access (the front-end types no bit access, by design: `call-arguments` `isBitAccess`)", why: "ADR(w.3), which TwinCAT builds, measured 2026-10-06" },
  { baseline: "type-dump", measure: "fixtures codesys: call UNKNOWN, on an untyped operand", by: 1, fixture: "calls_adr_on_bit_access", task: "ADR of a bit access (the front-end types no bit access, by design: `call-arguments` `isBitAccess`)", why: "ADR(w.3), CODESYS's single-bit warning measured 2026-10-06" },
  ...(["calls_constant_called", "calls_sqrt_of_bool", "calls_sqrt_of_string"] as const).map((fixture) => ({
    baseline: "type-dump",
    measure: "findings",
    by: 2,
    fixture,
    task: "the bound census reads assignments and initial values, not a refused call's result nor a FUNCTION's operand conversion",
    why: "a VAR CONSTANT called ('Unknown type: 'c()''), SQRT of a BOOL ('BOOL' to 'LREAL') and of a STRING ('STRING' to 'LREAL', gate 3.7+3.9) — both vendors, measured 2026-10-06 (analysis-conformance 3.8)",
  })),
  { baseline: "parse-census", measure: "findings", by: 2, fixture: "flw_case_real_label", task: "none: niche, accepted loss (analysis-conformance 3.9)", why: ANALYSIS_NICHE_WHY.realLabel },
  ...(["codesys", "twincat"] as const).map((vendor) => ({
    baseline: "parse-census",
    measure: `fixtures ${vendor}: refused with a syntax message, no LSP parse error`,
    by: 1,
    fixture: "flw_case_real_label",
    task: "none: niche, accepted loss (analysis-conformance 3.9)",
    why: ANALYSIS_NICHE_WHY.realLabel,
  })),
  { baseline: "literal-agreement", measure: "fixtures: literals the two disagree on", by: 1, fixture: "flw_case_real_label", task: LITERAL_TYPING, why: "a REAL CASE label on an INT selector (analysis-conformance 3.9, niche) — 'into INT', the transpiler's LREAL" },
  { baseline: "literal-agreement", measure: "fixtures: literals the two disagree on", by: 1, fixture: "flw_case_label_beyond_byte", task: LITERAL_TYPING, why: "a CASE label 300 on a BYTE selector (analysis-conformance 3.9) — LT14's class 'into BYTE', one literal more" },
  { baseline: "fixtures.twincat", measure: "total: FP", by: 1, fixture: "dead_method_hasattribute_unquoted", task: DEAD_CODE_TASK, why: DEAD_CODE_WHY },
  { baseline: "fixtures.codesys", measure: "total: GAP", by: 1, fixture: "dead_method_hasattribute_unquoted", task: DEAD_CODE_TASK, why: DEAD_CODE_WHY },
  { baseline: "fixtures.codesys", measure: "group names: GAP", by: 1, fixture: "dead_method_hasattribute_unquoted", task: DEAD_CODE_TASK, why: DEAD_CODE_WHY },
]

/** Per measure, how far `name`'s exceptions lift its ceiling. */
export function allowanceOf(name: string, exceptions: readonly CeilingException[] = CEILING_EXCEPTIONS): Record<string, number> {
  const out: Record<string, number> = {}
  for (const e of exceptions) if (e.baseline === name) out[e.measure] = (out[e.measure] ?? 0) + e.by
  return out
}

/** Does finding `f` name `fixture` — by its file (`…/fixture/F.pou …`, the dumps) or as `<vendor> <fixture>: …` (the bound census)? */
function namesFixture(f: string, fixture: string): boolean {
  // a dump's site (`fixture/<name>/<file>`), a census line (`codesys <name>: …`), the parse census's (`codesys fixture/<name> — …`)
  return f.includes(`/${fixture}/`) || new RegExp(`^(codesys|twincat) ${fixture}: `).test(f) || f.includes(`fixture/${fixture} `)
}

/** Held against a measurement: what rose above its ceiling (plus a named exception's allowance), what fell below it
 *  (stale), what it does not measure. A `findings` exception whose fixture no finding names is stale. */
export function ceilingReport(
  section: Record<string, number>,
  actual: Baseline,
  allow: Record<string, number> = {},
  exceptions: readonly CeilingException[] = [],
): { rises: string[]; stale: string[]; missing: string[] } {
  if ("findings" in actual.counts) throw new Error(`a count named "findings" shadows the finding count`)
  const rises: string[] = []
  const stale: string[] = []
  const missing: string[] = []
  for (const [key, ceiling] of Object.entries(section)) {
    const max = ceiling + (allow[key] ?? 0)
    const shown = allow[key] === undefined ? `${max}` : `${ceiling} + ${allow[key]} excepted`
    const now = key === "findings" ? actual.findings.length : actual.counts[key]
    if (now === undefined) missing.push(key)
    else if (now > max) rises.push(`${key}: ${shown} → ${now}`)
    else if (now < max) stale.push(`${key}: ${shown} → ${now}`)
  }
  for (const e of exceptions)
    if (e.measure === "findings" && !actual.findings.some((f) => namesFixture(f, e.fixture)))
      stale.push(`exception for ${e.fixture} (${e.measure}): no finding names it — remove it`)
  return { rises, stale, missing }
}

/** `older` → `newer` of the whole ceilings file: a raised ceiling, or one that vanished before it reached 0. */
export function ceilingRises(older: Ceilings, newer: Ceilings): string[] {
  const out: string[] = []
  for (const [name, section] of Object.entries(older))
    for (const [key, max] of Object.entries(section)) {
      const now = newer[name]?.[key]
      if (now === undefined) {
        if (max !== 0) out.push(`${name}.${key}: ${max} → removed`)
      } else if (now > max) out.push(`${name}.${key}: ${max} → ${now}`)
    }
  return out.sort()
}

export function checkBaseline(name: string, actual: Baseline, dir: string = FRONTEND_BASELINES): void {
  const path = join(dir, `${name}.json`)
  const cpath = ceilingsPath(dir)
  const sorted: Baseline = { counts: sortKeys(actual.counts), findings: [...actual.findings].sort() }
  const ceilings = readCeilings(cpath)
  const allow = allowanceOf(name)
  const ceiling = ceilingReport(ceilingsOf(name, ceilings, cpath), sorted, allow, CEILING_EXCEPTIONS.filter((e) => e.baseline === name))
  if (process.env.VOLT_WRITE_BASELINE === "1") {
    if (ceiling.rises.length > 0 || ceiling.missing.length > 0)
      throw new Error(
        [
          `refusing to write ${pkgPath(path)} — a measure may only fall (tasks.md 0.6):`,
          ...ceiling.rises.map((r) => `  RISE    ${r}`),
          ...ceiling.missing.map((k) => `  MISSING ${k} (the ceiling names a measure this measurement lacks)`),
        ].join("\n"),
      )
    mkdirSync(dir, { recursive: true })
    writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`)
    // the ratchet: every ceiling comes down to what was measured
    const lowered = Object.fromEntries(
      Object.keys(ceilings[name]).map((k) => [k, (k === "findings" ? sorted.findings.length : sorted.counts[k]) - (allow[k] ?? 0)]),
    )
    writeFileSync(cpath, `${JSON.stringify({ ...ceilings, [name]: lowered }, null, 2)}\n`)
    return
  }
  if (!existsSync(path)) throw new Error(`no baseline ${pkgPath(path)} — measure with VOLT_WRITE_BASELINE=1 and commit it`)
  const pinned = JSON.parse(readFileSync(path, "utf8")) as Baseline
  const known = new Set(pinned.findings)
  const now = new Set(sorted.findings)
  const added = sorted.findings.filter((f) => !known.has(f))
  const gone = pinned.findings.filter((f) => !now.has(f))
  const moved = Object.keys({ ...pinned.counts, ...sorted.counts })
    .filter((k) => pinned.counts[k] !== sorted.counts[k])
    .map((k) => `${k}: ${pinned.counts[k] ?? "—"} → ${sorted.counts[k] ?? "—"}`)
  const report = [
    ...added.map((f) => `NEW   ${f}`),
    ...gone.map((f) => `GONE  ${f} (remove it from ${pkgPath(path)})`),
    ...moved.map((m) => `COUNT ${m}`),
    ...ceiling.rises.map((r) => `RISE  ${r} (above its ceiling in ${pkgPath(cpath)})`),
    ...ceiling.stale.map((r) => `STALE ${r} (lower the ceiling: rewrite with VOLT_WRITE_BASELINE=1)`),
    ...ceiling.missing.map((k) => `MISSING ${k} (${pkgPath(cpath)} names a measure this measurement lacks)`),
  ]
  expect(report).toEqual([])
}

const sortKeys = (o: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))

/** Add one to `key`. */
export const tally = (counts: Record<string, number>, key: string, by = 1): void => {
  counts[key] = (counts[key] ?? 0) + by
}
