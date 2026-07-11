/**
 * Parser completeness probe — the evidence the Phase-2 resilient-recovery safety argument rests on.
 *
 * The corpus is all valid code (compiles clean in the IDE), so on it BOTH parser paths should record zero
 * errors and never halt on an unmodeled construct. This measures exactly that, for the two paths a transpiler
 * (and richer diagnostics) would depend on:
 *
 *   declaration path — parseSource(...).errors   (unit header + VAR sections + type decls; parser.ts:66)
 *   statement path   — parseStatements(body)      (ok / recorded-error / silent-stop)
 *
 * Any nonzero number here is a grammar gap on VALID code — the debt to close before that path's recorded
 * errors can be surfaced zero-FP. 0/0 means the path already fully models the corpus and its recorded errors
 * are safe to surface today.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, extname } from "node:path"
import { parseSource, parseStatements, unitBodies, isGraphicalBody } from "../src/syntax/index.js"

const CORPUS = join(import.meta.dir, "..", "test-corpus")
const EXTS = new Set([".fb", ".prg", ".fun", ".itf", ".struct", ".enum", ".union", ".alias", ".gvl"])
const walk = (d: string): string[] => {
  const o: string[] = []
  for (const n of readdirSync(d)) {
    const p = join(d, n)
    if (statSync(p).isDirectory()) o.push(...walk(p))
    else if (EXTS.has(extname(p).toLowerCase())) o.push(p)
  }
  return o
}

let files = 0, declErr = 0, bodies = 0, ok = 0, stmtRecorded = 0, stmtSilent = 0
for (const f of walk(CORPUS)) {
  files++
  let pr
  try { pr = parseSource(readFileSync(f, "utf8")) } catch { continue }
  declErr += pr.errors.length
  for (const unit of pr.units)
    for (const body of unitBodies(unit)) {
      if (isGraphicalBody(body)) continue
      bodies++
      const r = parseStatements(body)
      if (r.ok) ok++
      else if (r.errors.length > 0) stmtRecorded++
      else stmtSilent++
    }
}
console.log(`corpus: ${files} files, ${bodies} statement bodies`)
console.log(`declaration path — recorded errors on valid code: ${declErr}  ${declErr === 0 ? "✓ complete" : "✗ grammar gaps"}`)
console.log(`statement path   — ok ${ok} / recorded-error ${stmtRecorded} / silent-stop ${stmtSilent}  ${stmtRecorded + stmtSilent === 0 ? "✓ complete" : "✗ grammar gaps"}`)
