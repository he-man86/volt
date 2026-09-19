/**
 * THE CENSUS GATE — every cell the topic tree defines has a fixture, and the vendor has answered it.
 *
 * `support/census.ts` derives the cells from the LANGUAGE (the elementary-type table, the operator table, the
 * vendor's reference), not from the fixtures, so a question nobody thought of still has a node. This is what turns
 * that into something a change can break: delete a fixture out of a generated family, or add a type to
 * `ELEMENTARY_TYPES` without recording it, and the cell it belongs to goes red naming itself.
 *
 * It is a RATCHET, not a wish list. A cell is only defined once its family is built, so the gate is green today and
 * stays green; what keeps the unbuilt topics honest is `PLANNED`, which the report prints beside the closed count.
 * A topic in NEITHER list is the failure this file exists to prevent, and `openspec/changes/fixture-census/
 * operations.md` is the long form of that list.
 */
import { describe, expect, test } from "bun:test"
import { ALL_TESTS } from "./fixtures/index.js"
import { CELLS, PLANNED, closure } from "./support/census.js"

describe("the topic census", () => {
  test("every defined cell has a fixture", () => {
    const { missing } = closure(ALL_TESTS)
    expect(missing.map((c) => `${c.topic}/${c.subtopic}: ${c.slug}`)).toEqual([])
  })

  test("every defined cell has an answer from the vendor", () => {
    const { unanswered } = closure(ALL_TESTS)
    expect(unanswered.map((c) => `${c.topic}/${c.subtopic}: ${c.slug}`)).toEqual([])
  })

  test("the report — what is measured, and what is not even asked yet", () => {
    const { closed } = closure(ALL_TESTS)
    const byTopic = new Map<string, Map<string, number>>()
    for (const c of closed) {
      const subs = byTopic.get(c.topic) ?? new Map<string, number>()
      subs.set(c.subtopic, (subs.get(c.subtopic) ?? 0) + 1)
      byTopic.set(c.topic, subs)
    }
    /* eslint-disable no-console */
    console.log(`  [census] ${closed.length} cells closed across ${byTopic.size} topics`)
    for (const [topic, subs] of byTopic) {
      console.log(`  [census]   ${topic}`)
      for (const [sub, n] of subs) console.log(`  [census]     ${String(n).padStart(4)}  ${sub}`)
    }
    console.log(`  [census] ${PLANNED.length} topics have no cells defined at all:`)
    for (const p of PLANNED) console.log(`  [census]     ${p}`)
    /* eslint-enable no-console */
    // The ratchet: cells only ever get added. A drop means a family stopped generating, which the two tests above
    // name precisely — this one keeps the total from drifting down quietly while both of them stay green.
    expect(CELLS.length).toBeGreaterThanOrEqual(1229)
  })
})
