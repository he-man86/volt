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
import { join } from "node:path"
import { allowanceOf, CEILING_EXCEPTIONS, ceilingReport, ceilingRises, ceilingsPath, FRONTEND_BASELINES, readCeilings, type Baseline, type Ceilings } from "./baseline.js"

/** Every baseline directory that keeps a ceilings file — the front-end's and the analysis census's
 *  (openspec analysis-conformance 0.1). Each test below holds every one of them. */
const BASELINE_DIRS: readonly string[] = [FRONTEND_BASELINES, join(import.meta.dir, "..", "analysis", "baselines")]
/** A directory as an error names it. */
const named = (dir: string): string => `${dir.split(/[\\/]/).slice(-2).join("/")}/ceilings.json`
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

  test("a named exception lifts its measure by its allowance, and is stale once no finding names its fixture", () => {
    const ex = [{ baseline: "b", measure: "findings", by: 1, fixture: "fx", task: "t", why: "w" }]
    expect(ceilingReport({ findings: 1 }, at({}, ["a", "codesys fixture/fx/F.pou 1:1 .m -> NONE"]), allowanceOf("b", ex), ex)).toEqual({ rises: [], stale: [], missing: [] })
    expect(ceilingReport({ findings: 1 }, at({}, ["a", "b", "c"]), allowanceOf("b", ex), ex).rises).toEqual(["findings: 1 + 1 excepted → 3"])
    expect(ceilingReport({ findings: 1 }, at({}, ["a", "b"]), allowanceOf("b", ex), ex).stale).toEqual(["exception for fx (findings): no finding names it — remove it"])
    // …and a bound-census finding names its fixture as `<vendor> <fixture>: …`
    expect(ceilingReport({ findings: 1 }, at({}, ["a", "codesys fx: build says …"]), allowanceOf("b", ex), ex)).toEqual({ rises: [], stale: [], missing: [] })
  })

  test("every named exception points at a ceiling its baseline has", () => {
    const ceilings: Ceilings = Object.assign({}, ...BASELINE_DIRS.map((d) => readCeilings(ceilingsPath(d))))
    expect(CEILING_EXCEPTIONS.filter((e) => ceilings[e.baseline]?.[e.measure] === undefined)).toEqual([])
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
    const problems: string[] = []
    for (const dir of BASELINE_DIRS)
      for (const [name, section] of Object.entries(readCeilings(ceilingsPath(dir)))) {
        if (name === "rules") continue // rules.test.ts holds these to rules.ts and the conversion matrix
        const pinned = JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8")) as Baseline
        const r = ceilingReport(section, pinned, allowanceOf(name), CEILING_EXCEPTIONS.filter((e) => e.baseline === name))
        problems.push(...[...r.rises, ...r.stale, ...r.missing.map((k) => `no measure ${k}`)].map((p) => `${named(dir)} ${name}: ${p}`))
      }
    expect(problems).toEqual([])
  })

  // A measure a census starts counting must start with a ceiling, or it can rise unwatched: `call UNKNOWN, on an untyped
  // operand` (frontend-conformance 2.3) took 76 corpus library calls with none. An AGREEMENT with the vendor (", … on
  // the vendor too", ", a refused expression", ", in a body that did not parse") is no disagreement; a literal's UNKNOWN
  // is not ceilinged (tasks.md 0.4: "UNKNOWN, not a literal").
  test("every disagreement count a baseline pins has a ceiling", () => {
    const agreement =
      /, (unknown on the vendor too|not defined on the vendor too|on a name not defined on the vendor too|no component on the vendor too|no structured variable on the vendor too|SUPER not allowed on the vendor too|a bit access refused on the vendor too|a refused expression|in a body that did not parse)$/
    const uncapped: string[] = []
    for (const dir of BASELINE_DIRS)
      for (const [name, section] of Object.entries(readCeilings(ceilingsPath(dir)))) {
        if (name === "rules") continue
        const pinned = JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8")) as Baseline
        for (const key of Object.keys(pinned.counts))
          if (/ (UNKNOWN|NONE|NOSCOPE|NO-CALLEE)/.test(key) && !agreement.test(key) && !/: literal UNKNOWN$/.test(key) && !(key in section))
            uncapped.push(`${named(dir)} ${name}: ${key}`)
      }
    expect(uncapped).toEqual([])
  })

  test("the ceilings never rose against any committed version of themselves", () => {
    const git = (cwd: string, ...args: string[]) => {
      const r = Bun.spawnSync(["git", ...args], { cwd })
      if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`)
      return r.stdout.toString()
    }
    const problems: string[] = []
    for (const dir of BASELINE_DIRS) {
      const file = ceilingsPath(dir)
      const rel = `${git(dir, "rev-parse", "--show-prefix").trim()}ceilings.json`
      // newest first; a shallow clone (CI's `test` job) holds only its tip, so there the check is tip → working tree
      const revs = git(dir, "log", "--format=%H", "--", `:/${rel}`).split("\n").filter(Boolean).reverse()
      const versions = [
        ...revs.map((rev) => ({ at: rev.slice(0, 10), c: JSON.parse(git(dir, "show", `${rev}:${rel}`)) as Ceilings })),
        { at: "working tree", c: readCeilings(file) },
      ]
      for (let i = 1; i < versions.length; i++)
        problems.push(...ceilingRises(versions[i - 1].c, versions[i].c).map((p) => `${rel} ${versions[i].at}: ${p}`))
    }
    expect(problems).toEqual([])
  })
})
