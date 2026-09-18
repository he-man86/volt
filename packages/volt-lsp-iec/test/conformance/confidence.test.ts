/**
 * HOW WELL IS EACH FIXTURE EVIDENCED? — a confidence rating over the whole suite.
 *
 * A fixture is a question put to the vendor. How much it is worth depends entirely on whether the vendor ANSWERED and
 * whether we match that answer — and until this file, nothing said which fixtures were in which state. "959 fixtures"
 * reads as 959 facts; it is not. Some are measured and matched, some are measured and NOT matched, and some have never
 * been asked.
 *
 * The rating is computed from the recordings and the fixture's own flags, never declared — and it does NOT compare
 * values itself. `transpile.test.ts` owns that comparison, in both backends, with the vendor's own display formats
 * (`ideValue` reads `DUT_X.Running`, `TIME#1s1ns`, `'a$Tb'`). Re-implementing it here produced 97 false DIVERGES on a
 * suite that was green, which is the exact failure a confidence report must not have: a rating nobody can trust is
 * worse than no rating. So CONFIRMED means "the vendor answered, we execute it, and the gate that owns value equality
 * is asserting it" — a statement about where the evidence is, not a second opinion about the values.
 *
 *   CONFIRMED   the vendor RAN it, we lower and run it, and `transpile.test.ts` asserts its values in both
 *               backends. The strongest thing this suite can say.
 *   REFUSED     the vendor REJECTS the source and so do we. A confirmed negative, and worth as much as a positive:
 *               it is how the input contract is pinned.
 *   NOT-LOWERED the vendor RAN it and we refuse, with a diagnostic saying why. A COVERAGE gap — the construct is
 *               not modelled — and not a wrong answer. `lower-completeness` is what tracks shrinking it.
 *   DIVERGES    the vendor answered and we do NOT match — every one carries `deferred.transpile` saying what was
 *               measured and why it is not matched yet. The one rating that means something is WRONG rather than
 *               missing, and the only one that must not grow.
 *   LSP-GAP     the vendor rejects it, we know, and the LSP does not say so yet (`deferred.lsp`).
 *   UNASKED     no recording. The fixture states a question nobody has put to CODESYS; it proves nothing yet.
 *   UNASKABLE   `execSkip` / `recorderSkip` — there is no execution ground truth to have (network text, and shapes
 *               the recorder cannot carry into a POU).
 *
 * The gate is not "all CONFIRMED" — UNASKED is the normal state of a fixture written before its recording, and
 * REFUSED is an answer. What it holds is that DIVERGES and LSP-GAP cannot grow silently, and it prints the whole
 * distribution so the number in a status report is the measured one.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { lowerSource } from "../../src/transpile/lower/index.js"
import { run } from "../../src/transpile/interp/index.js"
import { ALL_TESTS } from "./fixtures/index.js"
import { withDependencies } from "./support/fixture-units.js"
import { plcPrgSource } from "./support/plc-prg.js"
import { STANDARD_LIBRARY } from "./support/standard-library.js"
import type { LanguageTest } from "./types.js"

type Rating = "CONFIRMED" | "REFUSED" | "NOT-LOWERED" | "DIVERGES" | "LSP-GAP" | "UNASKED" | "UNASKABLE"

const RECORDINGS = join(import.meta.dir, "recordings")
const runRec = JSON.parse(readFileSync(join(RECORDINGS, "codesys.run.json"), "utf8")).tests as Record<string, RunRecord>
const buildRec = JSON.parse(readFileSync(join(RECORDINGS, "codesys.build.json"), "utf8")).tests as Record<string, { buildSuccess?: boolean }>

interface RunRecord {
  error?: string
  values?: Record<string, string>
}

function sourceOf(t: LanguageTest): { source: string; libraries: { uri: string; source: string }[] } {
  const fixtures = withDependencies(t, ALL_TESTS).filter((f) => f.source !== "")
  const gvls = fixtures.filter((f) => f.kind === "gvl").map((f) => ({ uri: `${f.pouName}.gvl`, source: f.source }))
  return {
    source: [...fixtures.filter((f) => f.kind !== "gvl").map((f) => f.source), plcPrgSource(t)].join("\n"),
    libraries: [...STANDARD_LIBRARY, ...gvls],
  }
}

function rate(t: LanguageTest): Rating {
  if (t.execSkip !== undefined || t.recorderSkip === true) return "UNASKABLE"
  if (t.deferred?.lsp !== undefined) return "LSP-GAP"
  // `deferred.transpile` is read BELOW, after we know whether we execute the case at all. A fixture deferred because
  // lowering REFUSES it is a coverage gap (NOT-LOWERED); only one we run and answer differently is a DIVERGES. Reading
  // the flag first conflated the two and reported four refusals as wrong answers.

  const rec = runRec[t.name]
  const build = buildRec[t.name]
  // A vendor REFUSAL is an answer, from either recording.
  if (rec?.error?.startsWith("does not compile") === true || build?.buildSuccess === false || t.refused !== undefined) return "REFUSED"
  if (rec?.values === undefined) return "UNASKED"

  // The vendor ran it. Do WE? That is the only thing left to determine here — whether the values then MATCH is
  // `transpile.test.ts`'s assertion, and it runs on every one of these.
  const { source, libraries } = sourceOf(t)
  let pou
  try {
    pou = lowerSource(source, "PLC_PRG", libraries).pou
  } catch {
    return "DIVERGES" // a THROW is not a refusal — lowering must end in a diagnostic, so this is a defect
  }
  if (pou === undefined) return "NOT-LOWERED" // we say why we cannot: a coverage gap, not a wrong answer
  if (t.deferred?.transpile !== undefined) return "DIVERGES" // we DO run it, and the deferral says the answer differs
  try {
    const p = run(pou)
    for (let i = 0; i < (t.cycles ?? 1); i++) p.scan()
  } catch {
    return "DIVERGES" // the vendor completed the scan and we faulted
  }
  return "CONFIRMED"
}

let cached: Map<string, Rating> | undefined
const ratings = (): Map<string, Rating> => (cached ??= new Map(ALL_TESTS.map((t) => [t.name, rate(t)])))

describe("how well each fixture is evidenced", () => {
  test("the distribution, printed so a status report quotes a measured number", () => {
    const all = ratings()
    const count = (r: Rating): number => [...all.values()].filter((x) => x === r).length
    const total = all.size
    const pct = (n: number): string => `${((n / total) * 100).toFixed(1)}%`

    const order: Rating[] = ["CONFIRMED", "REFUSED", "NOT-LOWERED", "UNASKED", "LSP-GAP", "DIVERGES", "UNASKABLE"]
    console.log(`  [confidence] ${total} fixtures`)
    for (const r of order) console.log(`  [confidence]   ${r.padEnd(10)} ${String(count(r)).padStart(4)}  ${pct(count(r)).padStart(6)}`)
    // Of everything the vendor ANSWERED and that we actually execute, how much do we match? That is the number a
    // status report should quote — not "959 fixtures", which counts questions rather than facts.
    const executed = count("CONFIRMED") + count("DIVERGES")
    const answered = count("CONFIRMED") + count("REFUSED") + count("NOT-LOWERED") + count("DIVERGES")
    console.log(`  [confidence] the vendor ANSWERED ${answered} of ${total} (${pct(answered)})`)
    console.log(`  [confidence] of the ${executed} we both EXECUTE, we match ${count("CONFIRMED")} — ${executed === 0 ? "n/a" : ((count("CONFIRMED") / executed) * 100).toFixed(1) + "%"}`)

    expect(total).toBeGreaterThan(900)
  })

  test("NOT-LOWERED — the vendor ran it and we say why we cannot: a coverage gap, not a wrong answer", () => {
    const notLowered = [...ratings()].filter(([, r]) => r === "NOT-LOWERED").map(([n]) => n)
    console.log(`  [confidence] NOT-LOWERED: ${notLowered.length} fixtures the vendor runs and lowering refuses`)
    expect(notLowered.length).toBeLessThanOrEqual(120)
  })

  test("DIVERGES — we RUN it and produce a different value; each is named, and the count does not grow", () => {
    const diverging = [...ratings()].filter(([, r]) => r === "DIVERGES").map(([n]) => n)
    console.log(`  [confidence] DIVERGES: ${diverging.join(", ") || "none"}`)
    // Every one of these carries `deferred.transpile` saying what was measured and why it is not matched yet. A NEW
    // one is a fixture that started failing without anybody writing down why.
    expect(diverging.length).toBeLessThanOrEqual(3)
  })

  test("LSP-GAP — CODESYS refuses it, we know, and the LSP does not say so yet", () => {
    const gaps = [...ratings()].filter(([, r]) => r === "LSP-GAP").map(([n]) => n)
    console.log(`  [confidence] LSP-GAP: ${gaps.length} fixtures`)
    expect(gaps.length).toBeLessThanOrEqual(18)
  })

  test("UNASKED — a fixture is only worth what the vendor said about it", () => {
    const unasked = [...ratings()].filter(([, r]) => r === "UNASKED").map(([n]) => n)
    console.log(`  [confidence] UNASKED: ${unasked.length} fixtures have no recording — run \`bun run record:exec\``)
    // A ceiling, not a demand for zero: a fixture written today is legitimately unasked until the next recording.
    // It exists so that number is visible rather than assumed to be small.
    expect(unasked.length).toBeLessThanOrEqual(140)
  })
})
