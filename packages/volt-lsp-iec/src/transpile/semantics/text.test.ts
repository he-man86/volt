/**
 * The formatters against their case table (`text.cases.ts`) — the check that fails FIRST, in milliseconds, when a
 * formatter drifts; `fixtures.test.ts` grades both backends against the recordings.
 */
import { expect, test } from "bun:test"
import { LREAL_TEXT_CASES } from "./text.cases.js"
import { lrealText } from "./text.js"

for (const [rule, cases] of Object.entries(LREAL_TEXT_CASES))
  test(rule, () => {
    for (const c of cases) expect(lrealText(c.input), c.name).toBe(c.expected)
  })
