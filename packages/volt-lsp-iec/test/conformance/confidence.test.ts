/**
 * HOW WELL IS EACH FIXTURE EVIDENCED? — the rating, and the gate that keeps it honest.
 *
 * A fixture is a question put to the vendor. What it is worth depends entirely on whether the vendor ANSWERED and
 * whether we match — and nothing said which fixtures were in which state. "963 fixtures" reads as 963 facts; it is
 * not. Some are measured and matched, some are measured and NOT matched, and some have never been asked.
 *
 * Every fixture now carries its rating (`t.evidence`), generated into `fixtures/evidence.generated.ts` by
 * `bun run rate:fixtures` and merged by `fixtures/index.ts`. This file is the other half of that arrangement: it
 * RECOMPUTES every rating and fails if a stored one disagrees. Derived data committed to source is only safe with a
 * gate like this one; without it the ratings would rot the first time a recording landed.
 *
 * `support/evidence.ts` defines what each rating means and computes it — one implementation, so the generator and
 * this gate can never measure different things.
 *
 * WHAT THIS DOES NOT DO: compare values. `transpile.test.ts` owns that, in both backends, using the vendor's own
 * display formats. A first version re-implemented it here and reported 97 false divergences on a green suite.
 */
import { describe, expect, test } from "bun:test"
import { ALL_TESTS } from "./fixtures/index.js"
import { EVIDENCE_ORDER, type Evidence, rateFixture } from "./support/evidence.js"

/** Every fixture's rating, computed fresh. */
let cached: Map<string, Evidence> | undefined
const computed = (): Map<string, Evidence> => (cached ??= new Map(ALL_TESTS.map((t) => [t.name, rateFixture(t, ALL_TESTS)])))

/**
 * Ceilings, not targets. `unasked` is the normal state of a fixture written before the next recording, and `refused`
 * is an answer — neither is a problem. These exist so the numbers stay visible rather than assumed, and so the ones
 * that mean something is missing or wrong cannot grow quietly.
 */
const CEILINGS: Partial<Record<Evidence, number>> = {
  diverges: 3,
  // 18 -> 34 because the MEASUREMENT changed, not because gaps appeared. `refused` claimed the vendor rejects a
  // source AND so do we, while only checking the vendor; 16 fixtures were counted as evidence while the LSP accepted
  // them silently (`cc_reserved_name_s_string` and its neighbours). The rating asks both sides now.
  "lsp-gap": 34,
  "not-lowered": 20,
  unasked: 140,
}

describe("how well each fixture is evidenced", () => {
  test("the stored rating on every fixture matches the computed one", () => {
    // The whole reason `evidence` can live in a generated file: a stale entry is a red test, not a quiet lie.
    const byName = new Map(ALL_TESTS.map((t) => [t.name, t]))
    const stale = [...computed()]
      .filter(([name, rating]) => byName.get(name)?.evidence !== rating)
      .map(([name, rating]) => `${name}: stored ${byName.get(name)?.evidence ?? "(none)"}, computed ${rating}`)
    if (stale.length > 0) console.log("  [confidence] run `bun run rate:fixtures`")
    expect(stale).toEqual([])
  })

  test("the distribution, printed so a status report quotes a measured number", () => {
    const all = computed()
    const count = (r: Evidence): number => [...all.values()].filter((x) => x === r).length
    const total = all.size
    const pct = (n: number): string => `${((n / total) * 100).toFixed(1)}%`

    console.log(`  [confidence] ${total} fixtures`)
    for (const r of EVIDENCE_ORDER) console.log(`  [confidence]   ${r.padEnd(12)} ${String(count(r)).padStart(4)}  ${pct(count(r)).padStart(6)}`)

    // The number a status report should quote is not "963 fixtures", which counts QUESTIONS. It is how much of what
    // the vendor answered we actually match.
    const executed = count("confirmed") + count("diverges")
    const answered = count("confirmed") + count("refused") + count("not-lowered") + count("diverges")
    console.log(`  [confidence] the vendor ANSWERED ${answered} of ${total} (${pct(answered)})`)
    console.log(
      `  [confidence] of the ${executed} we both EXECUTE, we match ${count("confirmed")} — ${executed === 0 ? "n/a" : `${((count("confirmed") / executed) * 100).toFixed(1)}%`}`,
    )
    expect(total).toBeGreaterThan(900)
  })

  test("each rating stays within its ceiling, and the ones that matter are named", () => {
    const all = computed()
    const named = (r: Evidence): string[] => [...all].filter(([, x]) => x === r).map(([n]) => n)

    // DIVERGES is the only rating that means something is WRONG rather than missing. Every one carries
    // `deferred.transpile` saying what was measured and why it is not matched yet; a NEW one is a fixture that
    // started disagreeing with the vendor without anybody writing down why.
    console.log(`  [confidence] diverges: ${named("diverges").join(", ") || "none"}`)
    console.log(`  [confidence] not-lowered: ${named("not-lowered").length} the vendor runs and lowering refuses`)
    console.log(`  [confidence] unasked: ${named("unasked").length} have no recording — run \`bun run record:exec\``)

    const over = EVIDENCE_ORDER.filter((r) => CEILINGS[r] !== undefined && named(r).length > CEILINGS[r]!).map(
      (r) => `${r}: ${named(r).length} > ${CEILINGS[r]!}`,
    )
    expect(over).toEqual([])
  })
})
