/**
 * THE FRONT-END'S IMPORT RULES, INSIDE `bun test` (openspec frontend-conformance design.md §5, task 1.2).
 *
 * `scripts/check-layering.ts` scans `src/`, `test/`, `scripts/` and `libraries/`. A violation it finds that its known
 * lists do not name fails here, and so does a listed violation that no longer occurs — the list only shrinks, and a
 * task that removes a violation removes its entry in the same commit.
 */
import { expect, test } from "bun:test"
import { layeringReport } from "../../scripts/check-layering.js"

test("every import obeys the layering rules, or is a listed violation that still occurs", () => {
  const { unexpected, stale } = layeringReport()
  expect({ unexpected, stale }).toEqual({ unexpected: [], stale: [] })
})
