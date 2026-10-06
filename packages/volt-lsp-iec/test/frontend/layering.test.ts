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

/**
 * THE ANALYSIS RULES FIRE (openspec analysis-conformance design.md §2 "Import rules", task 1.2): one planted violation
 * per rule, named with both files; the clean shape beside each is not.
 */
const analysisRules = (files: Record<string, string>): string[] => scan(files).filter((v) => /^A\d /.test(v))
const CHECK = {
  "src/analysis/checks/types/a.ts": `export const a = 1\n`,
  "src/analysis/checks/types/a.test.ts": `import { a } from "./a.js"\n`,
}

test("A1: analysis reaching into the reference catalog past its index is named", () => {
  const found = analysisRules({ "src/analysis/rules.ts": `import { k } from "../reference/catalog.js"\n`, "src/reference/catalog.ts": "" })
  expect(found).toEqual([
    "A1 analysis/rules.ts → reference/catalog.ts: deep import (analysis reads the reference catalog through reference/index.js)",
  ])
  expect(analysisRules({ "src/analysis/rules.ts": `import { k } from "../reference/index.js"\n` })).toEqual([])
})

test("A2: outside analysis, an import of any analysis file but its index is named — a dynamic import() too", () => {
  const found = analysisRules({
    "src/server/a.ts": `import { h } from "../analysis/hole.js"\nimport { i } from "../analysis/index.js"\n`,
    // three levels deep, so the planted text read as THIS file's import resolves outside the package's src/
    "test/x/y/b.test.ts": `const m = await import("../../../src/analysis/error-code-map.js")\n`,
    "scripts/c.ts": `import { c } from "../src/analysis/config.js"\n`,
  })
  expect(found.sort()).toEqual(
    [
      "A2 server/a.ts → analysis/hole.ts: deep import (outside analysis, only analysis/index.js)",
      "A2 test/x/y/b.test.ts → analysis/error-code-map.ts: deep import (outside analysis, only analysis/index.js)",
      "A2 scripts/c.ts → analysis/config.ts: deep import (outside analysis, only analysis/index.js)",
    ].sort(),
  )
})

test("A3: a check importing another check or the registry, and a check's test importing a check not its own, are named", () => {
  const found = analysisRules({
    ...CHECK,
    "src/analysis/checks/flow/b.ts": `import { a } from "../types/a.js"\nimport { R } from "../../pipeline/registry.js"\n`,
    "src/analysis/checks/flow/b.test.ts": `import { b } from "./b.js"\nimport { a } from "../types/a.js"\nimport { c } from "../../index.js"\n`,
  })
  expect(found.sort()).toEqual(
    [
      "A3 analysis/checks/flow/b.ts → analysis/checks/types/a.ts: a check imports no other check",
      "A3 analysis/checks/flow/b.ts → analysis/pipeline/registry.ts: a check never imports the registry or the pipeline (its test goes through analysis/index.js)",
      "A3 analysis/checks/flow/b.test.ts → analysis/checks/types/a.ts: a check's test imports only its own subject in checks/",
    ].sort(),
  )
})

test("A4: a shared module importing a check is named; the registry importing one is not", () => {
  const found = analysisRules({
    ...CHECK,
    "src/analysis/shared/rules.ts": `import { a } from "../checks/types/a.js"\n`,
    "src/analysis/pipeline/registry.ts": `import { a } from "../checks/types/a.js"\n`,
  })
  expect(found).toEqual(["A4 analysis/shared/rules.ts → analysis/checks/types/a.ts: only the registry and the pipeline import a check"])
})

test("A5: an analysis test importing the server is named", () => {
  const found = analysisRules({ "src/analysis/x.test.ts": `import { s } from "../server/workspace-store.js"\n` })
  expect(found).toEqual([
    "A5 analysis/x.test.ts → server/workspace-store.ts: an analysis test imports a rank above analysis (server)",
  ])
})

test("A6: a check without a test beside it, and a test without its subject, are both named", () => {
  const found = analysisRules({
    ...CHECK,
    "src/analysis/checks/oop/untested.ts": `export const u = 1\n`,
    "src/analysis/checks/types/orphan.test.ts": `import { a } from "../../index.js"\n`,
  })
  expect(found.sort()).toEqual(
    [
      "A6 analysis/checks/oop/untested.ts: no colocated untested.test.ts",
      "A6 analysis/checks/types/orphan.test.ts: no subject orphan.ts beside it",
    ].sort(),
  )
})
