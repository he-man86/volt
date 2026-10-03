/**
 * THE FRONT-END'S IMPORT RULES, INSIDE `bun test` (openspec frontend-conformance design.md §5, task 1.2).
 *
 * `scripts/check-layering.ts` scans `src/`, `test/`, `scripts/` and `libraries/`. A violation it finds that its known
 * lists do not name fails here, and so does a listed violation that no longer occurs — the list only shrinks, and a
 * task that removes a violation removes its entry in the same commit.
 */
import { expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { layeringReport, layeringViolations } from "../../scripts/check-layering.js"

test("every import obeys the layering rules, or is a listed violation that still occurs", () => {
  const { unexpected, stale } = layeringReport()
  expect({ unexpected, stale }).toEqual({ unexpected: [], stale: [] })
})

/**
 * THE GATE FIRES (spec "the front-end is a layer", scenario "a back-end reaching into the front-end"): the scan above
 * passes on the real tree, which on its own proves only that it finds nothing. Each case plants one violation in a
 * scratch package and asserts the scan names it — both files, by rule.
 */
function scan(files: Record<string, string>): string[] {
  const root = mkdtempSync(join(tmpdir(), "volt-layering-"))
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), text)
    }
    return layeringViolations(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const TYPES = {
  "src/frontend/types/index.ts": `export { x } from "./elementary.js"\n`,
  "src/frontend/types/elementary.ts": `export const x = 1\n`,
}

test("F2: a transpiler file importing a front-end file other than its index is named, with both files", () => {
  const found = scan({ ...TYPES, "src/transpile/lower/a.ts": `import { x } from "../../frontend/types/elementary.js"\n` })
  expect(found).toEqual([
    "F2 transpile/lower/a.ts → frontend/types/elementary.ts: deep import (a consumer imports the front-end through an index)",
  ])
})

test("F2: the same import through the index is clean", () => {
  expect(scan({ ...TYPES, "src/transpile/lower/a.ts": `import { x } from "../../frontend/types/index.js"\n` })).toEqual([])
})

test("F1: a front-end file importing a consumer is named, with both files", () => {
  const found = scan({
    ...TYPES,
    "src/frontend/types/elementary.ts": `import { y } from "../../analysis/rules.js"\nexport const x = y\n`,
    "src/analysis/rules.ts": `export const y = 1\n`,
  })
  expect(found).toEqual(["F1 frontend/types/elementary.ts → analysis/rules.ts: the front-end imports outside the front-end"])
})

test("F3: syntax importing symbols is named, with both files", () => {
  const found = scan({
    "src/frontend/syntax/span.ts": `import { s } from "../symbols/index.js"\nexport const t = s\n`,
    "src/frontend/symbols/index.ts": `export const s = 1\n`,
  })
  expect(found).toEqual(["F3 frontend/syntax/span.ts → frontend/symbols/index.ts: syntax must not import symbols"])
})

test("F5: a front-end file reading the environment is named", () => {
  const found = scan({ "src/frontend/syntax/span.ts": `export const g = process.env.VOLT_GRAPHICAL\n` })
  expect(found).toEqual(["F5 frontend/syntax/span.ts: reads process.env (the front-end reads no environment)"])
})
