/**
 * `semantics/numeric.cases.ts` is DATA copied from CODESYS's recordings; this holds it to them until the twin harness
 * (transpile-restructure 1.5.15) takes the check over. Every case names a fixture and the recorded variable: the case's
 * `expected` must be that recorded value (its type the destination), and its `input.value` the recorded `inst.v` (a
 * REAL's in single precision) — so a re-recording that changes a cell fails here, not silently in `convert.test.ts`.
 */
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { REAL_TO_INT_CASES } from "../../src/transpile/semantics/numeric.cases.js"

const RECORDED = JSON.parse(readFileSync(join(import.meta.dir, "recordings", "codesys.run.json"), "utf8")).tests as Record<
  string,
  { values?: Record<string, string> } | undefined
>

/** `<TYPE>#<text>` split at the first `#`; anything else is refused by name. */
function typed(text: string | undefined, where: string): { type: string; text: string } {
  const at = text?.indexOf("#") ?? -1
  if (text === undefined || at < 0) throw new Error(`${where}: no typed recorded value (${text})`)
  return { type: text.slice(0, at), text: text.slice(at + 1) }
}

test("every REAL -> integer case is the recorded cell of the fixture it names", () => {
  expect(REAL_TO_INT_CASES).toHaveLength(192)
  const bad: string[] = []
  for (const c of REAL_TO_INT_CASES) {
    const rec = c.recording
    if (rec === undefined) throw new Error(`${c.name} names no recording`)
    const values = RECORDED[rec.fixture]?.values
    if (values === undefined) throw new Error(`${c.name}: no recording of ${rec.fixture}`)
    const out = typed(values[rec.variable], `${rec.fixture} ${rec.variable}`)
    if (out.type !== c.input.to || BigInt(out.text) !== c.expected)
      bad.push(`${c.name}: recorded ${values[rec.variable]}, case ${c.input.to}#${c.expected}`)
    const v = typed(values["inst.v"], `${rec.fixture} inst.v`)
    const recorded = Number(v.text)
    const value = c.input.from === "REAL" ? Math.fround(recorded) : recorded
    if (!Object.is(value, c.input.value)) bad.push(`${c.name}: recorded v ${values["inst.v"]}, case ${c.input.value}`)
  }
  expect(bad).toEqual([])
})
