/**
 * THE CEILINGS — "every later task's numbers may only fall" (tasks.md 0.6), held mechanically.
 *
 * A baseline (`baseline.ts`) pins its counts and findings EXACTLY, and `VOLT_WRITE_BASELINE=1` rewrites them — so on its
 * own it would accept a rise the moment someone regenerates it. `baselines/ceilings.json` is the ratchet beside it: each
 * disagreement measure (a finding count, a NONE / NOSCOPE / NO-CALLEE / UNKNOWN count, a GAP count) has a ceiling, the
 * writer refuses a baseline that rises above one and lowers each to what it measured, and this file refuses a ceilings
 * file that rose against any committed version of itself. A measure retires only at zero.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { basename, join } from "node:path"
import { CEILINGS_PATH, ceilingReport, ceilingRises, readCeilings, type Baseline, type Ceilings } from "./baseline.js"

const DIR = join(import.meta.dir, "baselines")
const at = (counts: Record<string, number>, findings: string[] = []): Baseline => ({ counts, findings })

describe("ceilings — a measure may only fall", () => {
  test("a count above its ceiling is a rise; below it the ceiling is stale; a ceiling the measurement lacks is missing", () => {
    expect(ceilingReport({ "x NONE": 3, findings: 2 }, at({ "x NONE": 4 }, ["a", "b"]))).toEqual({
      rises: ["x NONE: 3 → 4"],
      stale: [],
      missing: [],
    })
    expect(ceilingReport({ "x NONE": 3, findings: 2 }, at({ "x NONE": 3 }, ["a"]))).toEqual({
      rises: [],
      stale: ["findings: 2 → 1"],
      missing: [],
    })
    expect(ceilingReport({ "y NONE": 1 }, at({ "x NONE": 1 })).missing).toEqual(["y NONE"])
  })

  test("a count named 'findings' would shadow the finding count — refused", () => {
    expect(() => ceilingReport({}, at({ findings: 1 }))).toThrow(/findings/)
  })

  test("history: a raised ceiling and a vanished non-zero one are rises; a lowered, a new and a retired-at-0 one are not", () => {
    const older: Ceilings = { a: { up: 1, down: 5, gone: 2, zero: 0 } }
    const newer: Ceilings = { a: { up: 2, down: 4, zero2: 7 }, b: { fresh: 9 } }
    expect(ceilingRises(older, newer)).toEqual(["a.gone: 2 → removed", "a.up: 1 → 2"])
  })

  test("every ceiling equals the count its committed baseline pins", () => {
    const ceilings = readCeilings()
    const problems: string[] = []
    for (const [name, section] of Object.entries(ceilings)) {
      if (name === "rules") continue // rules.test.ts holds these to rules.ts and the conversion matrix
      const pinned = JSON.parse(readFileSync(join(DIR, `${name}.json`), "utf8")) as Baseline
      const r = ceilingReport(section, pinned)
      problems.push(...r.rises, ...r.stale, ...r.missing.map((k) => `${name}: no measure ${k}`))
    }
    expect(problems).toEqual([])
  })

  // A measure a census starts counting must start with a ceiling, or it can rise unwatched: `call UNKNOWN, on an untyped
  // operand` (frontend-conformance 2.3) took 76 corpus library calls with none. An AGREEMENT with the vendor (", … on
  // the vendor too", ", a refused expression") is no disagreement; a literal's UNKNOWN is not ceilinged (tasks.md 0.4:
  // "UNKNOWN, not a literal").
  test("every disagreement count a baseline pins has a ceiling", () => {
    const ceilings = readCeilings()
    const agreement = /, (unknown on the vendor too|not defined on the vendor too|on a name not defined on the vendor too|a refused expression)$/
    const uncapped: string[] = []
    for (const [name, section] of Object.entries(ceilings)) {
      if (name === "rules") continue
      const pinned = JSON.parse(readFileSync(join(DIR, `${name}.json`), "utf8")) as Baseline
      for (const key of Object.keys(pinned.counts))
        if (/ (UNKNOWN|NONE|NOSCOPE|NO-CALLEE)/.test(key) && !agreement.test(key) && !/: literal UNKNOWN$/.test(key) && !(key in section))
          uncapped.push(`${name}: ${key}`)
    }
    expect(uncapped).toEqual([])
  })

  test("the ceilings never rose against any committed version of themselves", () => {
    const git = (...args: string[]) => {
      const r = Bun.spawnSync(["git", ...args], { cwd: import.meta.dir })
      if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`)
      return r.stdout.toString()
    }
    const rel = `${git("rev-parse", "--show-prefix").trim()}baselines/${basename(CEILINGS_PATH)}`
    // newest first; a shallow clone (CI's `test` job) holds only its tip, so there the check is tip → working tree
    const revs = git("log", "--format=%H", "--", `:/${rel}`).split("\n").filter(Boolean).reverse()
    const versions = [
      ...revs.map((rev) => ({ at: rev.slice(0, 10), c: JSON.parse(git("show", `${rev}:${rel}`)) as Ceilings })),
      { at: "working tree", c: readCeilings() },
    ]
    const problems: string[] = []
    for (let i = 1; i < versions.length; i++)
      problems.push(...ceilingRises(versions[i - 1].c, versions[i].c).map((p) => `${versions[i].at}: ${p}`))
    expect(problems).toEqual([])
  })
})
