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

/** Held against a measurement: what rose above its ceiling, what fell below it (stale), what it does not measure. */
export function ceilingReport(
  section: Record<string, number>,
  actual: Baseline,
): { rises: string[]; stale: string[]; missing: string[] } {
  if ("findings" in actual.counts) throw new Error(`a count named "findings" shadows the finding count`)
  const rises: string[] = []
  const stale: string[] = []
  const missing: string[] = []
  for (const [key, max] of Object.entries(section)) {
    const now = key === "findings" ? actual.findings.length : actual.counts[key]
    if (now === undefined) missing.push(key)
    else if (now > max) rises.push(`${key}: ${max} → ${now}`)
    else if (now < max) stale.push(`${key}: ${max} → ${now}`)
  }
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
  const ceiling = ceilingReport(ceilingsOf(name, ceilings), sorted)
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
      Object.keys(ceilings[name]).map((k) => [k, k === "findings" ? sorted.findings.length : sorted.counts[k]]),
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
