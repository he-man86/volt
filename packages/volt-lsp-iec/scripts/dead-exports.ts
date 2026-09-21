/**
 * Which exported names in `src/` nobody imports — the scanner `consolidate-lsp-structure` C8 asked for and
 * closed without ("a sweep for exports only tests use needs a dead-export scanner; none is installed").
 *
 *   bun run scripts/dead-exports.ts            the two lists
 *   bun run scripts/dead-exports.ts --all      …and every export with its importer counts
 *
 * It answers TWO different questions and keeps them apart, because only one of them is about dead code:
 *
 *   NOBODY            no file outside its own mentions the name. Usually NOT dead: a union member
 *                     (`IrLoad`, `UnaryExpr`) is used by the union declared beside it, so what is redundant
 *                     is the `export`, not the type. Read before deleting.
 *   TESTS/SCRIPTS     product code imports it, tests or scripts do. Also usually fine — `emitRust` and the
 *                     server harness have no other caller by design — but it is where a rule that outlived
 *                     its use hides, so it is worth a look when the list grows.
 *
 * DELIBERATELY TEXTUAL, not a type-aware graph. A name is "used" when it appears as a word in another file,
 * which over-counts (a mention in a comment reads as a use) and never under-counts. That direction is the safe
 * one for a tool whose output is a deletion list: it will miss something dead before it accuses something live.
 * The 92-name NOBODY list it printed on 2026-09-21 was almost entirely union members, and the two real finds —
 * `detectVendor` and `installCorpus`, 465 lines with no caller in a private package — were already known.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const ROOTS = ["src", "test", "scripts"]
const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith(".ts")) out.push(p.split("\\").join("/"))
  }
  return out
}
const all = ROOTS.flatMap((r) => walk(r))
const isTest = (f: string) => f.includes(".test.") || f.startsWith("test/")
const isScript = (f: string) => f.startsWith("scripts/")
const text = new Map(all.map((f) => [f, readFileSync(f, "utf8")]))

/** `export function|const|class|interface|type|enum <name>` — the declaration forms; `export {…}` re-exports
 *  are deliberately not counted, since a barrel naming something is not a USE of it. */
const EXPORT = /^export\s+(?:async\s+)?(?:function|const|class|interface|type|enum)\s+(\w+)/gm

interface Row {
  name: string
  file: string
  src: number
  test: number
  script: number
}
const rows: Row[] = []
for (const file of all) {
  if (!file.startsWith("src/") || isTest(file)) continue
  for (const m of text.get(file)!.matchAll(EXPORT)) {
    const name = m[1]!
    const used = new RegExp(`\\b${name}\\b`)
    const row: Row = { name, file, src: 0, test: 0, script: 0 }
    for (const [other, body] of text) {
      if (other === file || !used.test(body)) continue
      if (isScript(other)) row.script += 1
      else if (isTest(other)) row.test += 1
      else row.src += 1
    }
    rows.push(row)
  }
}

const nobody = rows.filter((r) => r.src === 0 && r.test === 0 && r.script === 0)
const notProduct = rows.filter((r) => r.src === 0 && (r.test > 0 || r.script > 0))
const show = (title: string, list: Row[]): void => {
  console.log(`\n${title} (${list.length})`)
  for (const r of list) console.log(`  ${r.name.padEnd(34)} ${r.file}${r.src + r.test + r.script > 0 ? `  (test ${r.test}, script ${r.script})` : ""}`)
}
console.log(`${rows.length} exported names across ${rows.length === 0 ? 0 : new Set(rows.map((r) => r.file)).size} files in src/`)
show("NOBODY — read before deleting; most are union members used by the union beside them", nobody)
show("TESTS/SCRIPTS ONLY — no product caller", notProduct)
if (process.argv.includes("--all")) show("EVERY export", rows)
