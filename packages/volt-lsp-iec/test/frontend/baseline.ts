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

const ADR_RESULT_TYPE = "frontend-conformance 4.3.4 (every built-in's result type: ADR's is POINTER TO its operand's)"
const ADR_IN_A_MEMBER_FIXTURE =
  "3.5's pointer cells (rule M3) must take an instance's address — `p := ADR(sb)` — to ask what is reached through it; ADR's call is the named class `call UNKNOWN, SIZEOF or ADR`, which no known-divergence list can hold (the replay agrees with both builds)"
/** The 3.5 member fixtures taking `ADR(sb)`, with how many each carries — one ceiling exception per fixture and vendor. */
const ADR_CELLS: readonly [string, number][] = [
  ["mem_unknown_member_through_pointer", 1],
  ["mem_pointer_deref_method", 1],
  ["mem_pointer_to_pointer_member", 2],
  ["mem_pointer_member_without_deref", 1],
]

export const CEILING_EXCEPTIONS: readonly CeilingException[] = [
  ...ADR_CELLS.flatMap(([fixture, by]) =>
    (["codesys", "twincat"] as const).map((vendor) => ({
      baseline: "type-dump",
      measure: `fixtures ${vendor}: call UNKNOWN, SIZEOF or ADR (no result type yet, task 4.3.4)`,
      by,
      fixture,
      task: ADR_RESULT_TYPE,
      why: ADR_IN_A_MEMBER_FIXTURE,
    })),
  ),
  { baseline: "resolution-dump", measure: "findings", by: 1, fixture: "lib_ns_type_name_two_libraries", task: LIB_REFERENCE_FACTS, why: TWO_LIBRARIES_ERROR },
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
