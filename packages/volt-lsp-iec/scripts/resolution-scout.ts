/**
 * Resolution-cluster scout — cheap prototype detectors for the checkable `resolution` codes, run across the
 * whole corpus, reporting how many times each WOULD fire. The point is to learn the FP profile BEFORE a real
 * implementation, so we never repeat C0371 (implemented → 1307 corpus FPs → reverted). Reading:
 *   - high count → the pattern is idiomatic/option-gated in real code → defer (like C0371).
 *   - low count  → inspect the few hits; likely a real, implementable check.
 *   - zero       → safe-but-not-exercised by the corpus (needs a repro) or truly absent.
 * Baselines validate the scout: C0371 should show ~1300 (known bad), C0178 ~0 (known clean, shipped).
 *
 *   bun run scripts/resolution-scout.ts            # all detectors, counts only
 *   bun run scripts/resolution-scout.ts C0062      # one code, with sample hits
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { extname, join } from "node:path"
import { parseSource, walkAllExprs } from "../src/syntax/index.js"
import { bodies, buildSymbolTable } from "../src/symbols/index.js"
import { inferExprType, resolveMemberChain } from "../src/types/index.js"
import { deadPous } from "../src/analysis/index.js"
import { loadTaskRoots } from "../src/workspace-refs.js"

const CORPUS = join(import.meta.dir, "..", "test-corpus")
const EXTS = new Set([".fb", ".prg", ".fun", ".itf", ".struct", ".enum", ".union", ".alias", ".gvl"])
const only = process.argv[2]
const walk = (d: string): string[] => {
  const o: string[] = []
  for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? o.push(...walk(p)) : EXTS.has(extname(p).toLowerCase()) && o.push(p) }
  return o
}

const NOTES: Record<string, string> = {
  C0371: "BASELINE known-bad: method → enclosing FB's VAR_IN_OUT",
  C0178: "BASELINE known-clean: external instance VAR_IN_OUT member access",
  C0062: "member access on a non-struct (elementary) base",
  C0036: "calling a non-callable (a plain var / GVL block)",
  C0042: "a call mixing positional and named-input args",
}
const CALLABLE = new Set(["function_block", "function", "method", "program", "action", "interface_method"])
const isNumeric = (s: string) => /^\d+$/.test(s)

const tally = new Map<string, string[]>()
const add = (code: string, sample: string) => { const a = tally.get(code) ?? []; a.push(sample); tally.set(code, a) }

for (const project of readdirSync(CORPUS)) {
  const dir = join(CORPUS, project)
  if (!statSync(dir).isDirectory()) continue
  const inputs = walk(dir).map((uri) => { const source = readFileSync(uri, "utf8"); return { uri, source, parseResult: parseSource(source) } })
  const scope = buildSymbolTable(inputs)
  const dead = deadPous(inputs, loadTaskRoots(dir))
  const units = inputs.flatMap((i) => i.parseResult.units)

  for (const { unit, scope: bodyScope, statements } of bodies(units, scope)) {
    const owner = (unit as { name?: { text: string } }).name?.text
    if (owner !== undefined && dead.has(owner)) continue // skip dead POUs (approx; scout-grade)

    // C0371 — a VAR_IN_OUT owned by a pou, referenced from a method scope.
    if (bodyScope.kind === "method") {
      walkAllExprs(statements, (e) => {
        if (e.kind !== "ident_expr") return
        const sym = resolveMemberChain(e, bodyScope, scope)
        if (sym?.varSection === "VAR_IN_OUT" && sym.owner.kind === "pou") add("C0371", `${project}: ${sym.name}`)
      })
    }

    walkAllExprs(statements, (e) => {
      if (e.kind === "member") {
        const base = e.base.kind === "ident_expr" ? e.base.name.toUpperCase() : ""
        if (base === "THIS" || base === "SUPER") return
        const bt = inferExprType(e.base, bodyScope, scope)
        if (bt.kind === "function_block") {
          const sym = resolveMemberChain(e, bodyScope, scope)
          if (sym?.varSection === "VAR_IN_OUT") add("C0178", `${project}: ${e.member.name}`)
        } else if (bt.kind === "elementary" && !isNumeric(e.member.name) && !e.member.name.startsWith("%")) {
          add("C0062", `${project}: ${e.member.name}`)
        }
      }
      if (e.kind === "call") {
        const sym = resolveMemberChain(e.callee, bodyScope, scope)
        if (sym !== undefined && !CALLABLE.has(sym.kind) && inferExprType(e.callee, bodyScope, scope).kind !== "function_block")
          add("C0036", `${project}: ${sym.name}`)
        const hasPos = e.args.some((a) => a.param === undefined)
        const hasNamedInput = e.args.some((a) => a.param !== undefined && !a.output)
        if (hasPos && hasNamedInput) add("C0042", `${project}: mixed args`)
      }
    })
  }
}

console.log("\n─── resolution scout: corpus firing counts ───")
for (const code of only ? [only] : Object.keys(NOTES)) {
  const hits = tally.get(code) ?? []
  console.log(`${code}  ${String(hits.length).padStart(5)}   ${NOTES[code] ?? ""}`)
  if (only) for (const h of hits.slice(0, 40)) console.log(`     ${h}`)
}
console.log("\nRead: high = idiomatic/option-gated (defer); low = inspect + likely implement; 0 = needs repro or absent.")
