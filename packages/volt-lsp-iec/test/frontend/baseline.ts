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
import { join } from "node:path"
import { EXPLICIT_PAIR_TESTS } from "../conformance/fixtures/conversions/explicit-pairs.js"

const DIR = join(import.meta.dir, "baselines")
export const CEILINGS_PATH = join(DIR, "ceilings.json")

export interface Baseline {
  /** Pinned numbers: a count that moves, either way, is a change to explain. */
  counts: Record<string, number>
  /** Findings, one line each, sorted. */
  findings: string[]
}

/** Per baseline name, per measure: the most it may be. `findings` names the baseline's finding count. */
export type Ceilings = Record<string, Record<string, number>>

export function readCeilings(): Ceilings {
  if (!existsSync(CEILINGS_PATH)) throw new Error(`no ${CEILINGS_PATH}`)
  return JSON.parse(readFileSync(CEILINGS_PATH, "utf8")) as Ceilings
}

/** One baseline's ceiling section — a baseline without one is refused: every measurement names what may not rise. */
export function ceilingsOf(name: string, ceilings: Ceilings = readCeilings()): Record<string, number> {
  const section = ceilings[name]
  if (section === undefined) throw new Error(`baselines/ceilings.json has no section "${name}"`)
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

const LITERAL_TYPING = "frontend-conformance LT14 (an untyped number's type in its context — the transpiler's call site, task 5.3)"
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
]

/** Per measure, how far `name`'s exceptions lift its ceiling. */
export function allowanceOf(name: string, exceptions: readonly CeilingException[] = CEILING_EXCEPTIONS): Record<string, number> {
  const out: Record<string, number> = {}
  for (const e of exceptions) if (e.baseline === name) out[e.measure] = (out[e.measure] ?? 0) + e.by
  return out
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
    if (e.measure === "findings" && !actual.findings.some((f) => f.includes(`/${e.fixture}/`)))
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

export function checkBaseline(name: string, actual: Baseline): void {
  const path = join(DIR, `${name}.json`)
  const sorted: Baseline = { counts: sortKeys(actual.counts), findings: [...actual.findings].sort() }
  const ceilings = readCeilings()
  const allow = allowanceOf(name)
  const ceiling = ceilingReport(ceilingsOf(name, ceilings), sorted, allow, CEILING_EXCEPTIONS.filter((e) => e.baseline === name))
  if (process.env.VOLT_WRITE_BASELINE === "1") {
    if (ceiling.rises.length > 0 || ceiling.missing.length > 0)
      throw new Error(
        [
          `refusing to write baselines/${name}.json — a measure may only fall (tasks.md 0.6):`,
          ...ceiling.rises.map((r) => `  RISE    ${r}`),
          ...ceiling.missing.map((k) => `  MISSING ${k} (the ceiling names a measure this measurement lacks)`),
        ].join("\n"),
      )
    mkdirSync(DIR, { recursive: true })
    writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`)
    // the ratchet: every ceiling comes down to what was measured
    const lowered = Object.fromEntries(
      Object.keys(ceilings[name]).map((k) => [k, (k === "findings" ? sorted.findings.length : sorted.counts[k]) - (allow[k] ?? 0)]),
    )
    writeFileSync(CEILINGS_PATH, `${JSON.stringify({ ...ceilings, [name]: lowered }, null, 2)}\n`)
    return
  }
  if (!existsSync(path)) throw new Error(`no baseline ${name}.json — measure with VOLT_WRITE_BASELINE=1 and commit it`)
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
    ...gone.map((f) => `GONE  ${f} (remove it from baselines/${name}.json)`),
    ...moved.map((m) => `COUNT ${m}`),
    ...ceiling.rises.map((r) => `RISE  ${r} (above its ceiling in baselines/ceilings.json)`),
    ...ceiling.stale.map((r) => `STALE ${r} (lower the ceiling: rewrite with VOLT_WRITE_BASELINE=1)`),
    ...ceiling.missing.map((k) => `MISSING ${k} (baselines/ceilings.json names a measure this measurement lacks)`),
  ]
  expect(report).toEqual([])
}

const sortKeys = (o: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))

/** Add one to `key`. */
export const tally = (counts: Record<string, number>, key: string, by = 1): void => {
  counts[key] = (counts[key] ?? 0) + by
}
