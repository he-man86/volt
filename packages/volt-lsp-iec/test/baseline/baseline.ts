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
import { CeilingException } from "./baseline-shared.js"
import { CEILING_EXCEPTIONS_A } from "./baseline-a.js"
import { CEILING_EXCEPTIONS_B } from "./baseline-b.js"
import { CEILING_EXCEPTIONS_C } from "./baseline-c.js"
import { CEILING_EXCEPTIONS_D } from "./baseline-d.js"
import { CEILING_EXCEPTIONS_E } from "./baseline-e.js"

/** The front-end's baselines — the default directory. A measurement elsewhere (`test/analysis/baselines/`) passes its own:
 *  the discipline, the ceilings and the history check are shared, not copied. */
export const FRONTEND_BASELINES = join(import.meta.dir, "..", "frontend", "baselines")

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

export const CEILING_EXCEPTIONS: readonly CeilingException[] = [...CEILING_EXCEPTIONS_A, ...CEILING_EXCEPTIONS_B, ...CEILING_EXCEPTIONS_C, ...CEILING_EXCEPTIONS_D, ...CEILING_EXCEPTIONS_E]

/** Per measure, how far `name`'s exceptions lift its ceiling. */
export function allowanceOf(name: string, exceptions: readonly CeilingException[] = CEILING_EXCEPTIONS): Record<string, number> {
  const out: Record<string, number> = {}
  for (const e of exceptions) if (e.baseline === name) out[e.measure] = (out[e.measure] ?? 0) + e.by
  return out
}

/** Does finding `f` name `fixture` — by its file (`…/fixture/F.pou …`, the dumps) or as `<vendor> <fixture>: …` (the bound census)? */
function namesFixture(f: string, fixture: string): boolean {
  // a dump's site (`fixture/<name>/<file>`), a census line (`codesys <name>: …`), the parse census's (`codesys fixture/<name> — …`),
  // resolution's message agreement (`fixture codesys <name>: recorded only …`)
  // …and the fold dump's (`<name>: <path> is …, the initializer folds to …`)
  return (
    f.includes(`/${fixture}/`) ||
    new RegExp(`^(fixture )?(codesys|twincat) ${fixture}: `).test(f) ||
    f.startsWith(`${fixture}: `) ||
    f.includes(`fixture/${fixture} `)
  )
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
