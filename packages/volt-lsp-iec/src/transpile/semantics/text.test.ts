/**
 * The formatters against their case table (`text.cases.ts`) — the check that fails FIRST, in milliseconds, when a
 * formatter drifts; `fixtures.test.ts` grades both backends against the recordings, and the twin harness
 * (`test/conformance/runtime-twins.test.ts`) runs the same table against the Rust runtime.
 */
import { expect, test } from "bun:test"
import { LONG_CALENDAR_TEXT_CASES, LREAL_TEXT_CASES, LREAL_TIE_CASES } from "./text.cases.js"
import { longCalendarText, lrealText } from "./text.js"

for (const [rule, cases] of Object.entries(LREAL_TEXT_CASES))
  test(rule, () => {
    for (const c of cases) expect(lrealText(c.input), c.name).toBe(c.expected)
  })

test("an exact 16th-digit tie rounds half-up (tr_33_fmt_lreal_tie)", () => {
  for (const c of LREAL_TIE_CASES) expect(lrealText(c.input), c.name).toBe(c.expected)
})

test("LDT / LDATE / LTOD read their u64 signed and print every fraction shape (tr_12_fmt_long_dates)", () => {
  for (const c of LONG_CALENDAR_TEXT_CASES) expect(longCalendarText(c.input.name, c.input.ns), c.name).toBe(c.expected)
})
