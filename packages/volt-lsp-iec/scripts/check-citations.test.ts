/**
 * The citation check (openspec transpile-restructure task 1.0.3): what counts as a citation, how one resolves, and the
 * scan over a scratch repository reporting only the citation whose file is gone.
 */
import { expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { citationsIn, missingCitations, resolves, tailsOf } from "./check-citations.js"

test("a citation is a .ts path with an optional line; URLs, globs, placeholders in <> and .d.ts are not", () => {
  const text = [
    "// see lower/calls.ts:976 and `interp.ts:289-292`, also ir/ir.ts",
    "// https://example.com/a/b.ts, *.test.ts, <file>.test.ts, pipeline/{arith,control}.test.ts, lib.d.ts",
    "// a deleted file by its git object: `git show f5a189cb83:scripts/probe.ts`",
  ].join("\n")
  expect(citationsIn("x.ts", text).map((c) => `${c.line} ${c.cited}`)).toEqual([
    "1 lower/calls.ts",
    "1 interp.ts",
    "1 ir/ir.ts",
  ])
})

test("in a tasks.md a ticked task's lines are its record and are not read; an open task's, and prose outside a task, are", () => {
  const text = [
    "## 1. Phase",
    "- [x] 1.1 Split `lower/lower.ts`.",
    "  - Done. `lower/lower.ts` deleted; `emit.ts:517` moved.",
    "- [ ] 1.2 Move `lower/calls.ts:337`.",
    "  - Where: `lower/calls.ts`.",
    "### 1.3 heading naming `ir/ir.ts`",
    "- [x] 1.3.1 Done one (`gone.ts`).",
    "",
    "Prose after the list: `prose.ts`.",
  ].join("\n")
  expect(citationsIn("openspec/changes/c/tasks.md", text).map((c) => `${c.line} ${c.cited}`)).toEqual([
    "4 lower/calls.ts",
    "5 lower/calls.ts",
    "6 ir/ir.ts",
    "9 prose.ts",
  ])
  // any other text is read whole, a ticked box or not
  expect(citationsIn("x.ts", text).length).toBe(8)
})

test("a citation resolves by the file's tail at a / boundary", () => {
  const files = new Set(["packages/p/src/transpile/ir/ir.ts", "packages/p/src/transpile/lower/calls.ts"])
  const tails = tailsOf(files)
  expect(resolves("ir/ir.ts", files, tails)).toBe(true)
  expect(resolves("calls.ts", files, tails)).toBe(true)
  expect(resolves("src/transpile/lower/calls.ts", files, tails)).toBe(true)
  expect(resolves("r/ir.ts", files, tails)).toBe(false)
  expect(resolves("lower/ir.ts", files, tails)).toBe(false)
})

test("the scan reports a cited file that does not exist, in each kind of citing text, and nothing else", () => {
  const root = mkdtempSync(join(tmpdir(), "volt-citations-"))
  const files: Record<string, string> = {
    "packages/p/src/transpile/ir/ir.ts": "// moved from ir/old.ts:12; see ir/ir.ts\nexport {}\n",
    "packages/p/test/conformance/fixtures/f.ts": "// ir/ir.ts:3 and lower/gone.ts\n",
    "packages/p/test/conformance/support/notes/notes.data.ts": 'const NOTES = { a: "emit.ts:640" }\n',
    "packages/p/docs/architecture.md": "`ir/ir.ts` and `semantics/value.ts`\n",
    "openspec/changes/c/tasks.md": "- [ ] 1 Where: `ir/ir.ts`, `interp/interp.ts`\n",
    "openspec/changes/archive/old/tasks.md": "- [x] `nowhere.ts`\n",
  }
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), text)
    }
    const missing = missingCitations(join(root, "packages", "p"), root)
    expect(missing.map((c) => `${c.source}:${c.line} ${c.cited}`)).toEqual([
      "openspec/changes/c/tasks.md:1 interp/interp.ts",
      "packages/p/docs/architecture.md:1 semantics/value.ts",
      "packages/p/src/transpile/ir/ir.ts:1 ir/old.ts",
      "packages/p/test/conformance/fixtures/f.ts:1 lower/gone.ts",
      "packages/p/test/conformance/support/notes/notes.data.ts:1 emit.ts",
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
