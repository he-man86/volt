/**
 * Why each fixture does NOT agree exactly with the IDE — the work list for closing the agreement gap.
 *
 *   bun run scripts/agreement-residue.ts
 *
 * `replay.test.ts` reports ONE number (exact agreement) and fails only on a false positive, so a fixture that is
 * merely INCOMPLETE — the LSP right about everything it says and silent about the rest — is invisible in it. This
 * buckets every disagreement into missing-only / extra-only / both / no-recording, then ranks the IDE messages the LSP
 * most often misses. It is how the parse-error cascade was found: 109 of 126 disagreements were missing-only, and the
 * missing messages were overwhelmingly one shape.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ALL_TESTS } from "../test/conformance/fixtures/index.js"
import { withDependencies } from "../test/conformance/support/fixture-units.js"
import { plcPrgSource } from "../test/conformance/support/plc-prg.js"
import { STANDARD_LIBRARY } from "../test/conformance/support/standard-library.js"
import { parseSource } from "../src/syntax/index.js"
import { buildSymbolTable } from "../src/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../src/analysis/index.js"

const build = JSON.parse(readFileSync(join(import.meta.dir, "..", "test", "conformance", "recordings", "codesys.build.json"), "utf8")).tests as Record<
  string,
  { diagnostics: { severity: string; message: string }[] }
>
const config = resolveConfig({ vendor: "codesys" })
const std = STANDARD_LIBRARY.map((l) => ({ uri: l.uri, parseResult: parseSource(l.source), source: l.source }))
const buckets = new Map<string, string[]>()
const add = (k: string, name: string) => buckets.set(k, [...(buckets.get(k) ?? []), name])
const missingMessages = new Map<string, number>()

for (const t of ALL_TESTS) {
  if (t.source === "") continue
  const rec = build[t.name]
  if (rec === undefined) {
    add("no recording at all", t.name)
    continue
  }
  const ide = rec.diagnostics.filter((d) => d.severity === "error" || d.severity === "warning").map((d) => `[${d.severity}] ${d.message}`).sort()
  const fixtures = withDependencies(t, ALL_TESTS).filter((f) => f.source !== "")
  const plc = plcPrgSource(t)
  const files = [
    ...fixtures.map((f) => ({ uri: `${f.pouName}.st`, parseResult: parseSource(f.source), source: f.source })),
    { uri: "plc_prg.prg", parseResult: parseSource(plc), source: plc },
    ...std,
  ]
  const project = buildSymbolTable(files)
  const lsp: string[] = []
  for (const f of files.slice(0, fixtures.length + 1))
    for (const d of computeSemanticDiagnostics({ parseResult: f.parseResult, source: f.source, project, config }))
      if (d.severity === "error" || d.severity === "warning") lsp.push(`[${d.severity}] ${d.message}`)
  lsp.sort()
  if (lsp.length === ide.length && lsp.every((m, i) => m === ide[i])) continue
  const ideSet = new Set(ide)
  const lspSet = new Set(lsp)
  const missing = ide.filter((m) => !lspSet.has(m))
  const extra = lsp.filter((m) => !ideSet.has(m))
  for (const m of missing) missingMessages.set(m, (missingMessages.get(m) ?? 0) + 1)
  add(extra.length > 0 ? (missing.length > 0 ? "both extra and missing" : "extra only") : "missing only", t.name)
  if (extra.length === 0 && missing.length === 0) {
    const count = (list: string[]) => { const m = new Map<string, number>(); for (const x of list) m.set(x, (m.get(x) ?? 0) + 1); return m }
    const a = count(ide), b = count(lsp)
    for (const [msg, n] of a) if ((b.get(msg) ?? 0) !== n) add(`repeat: ide ${String(n)} vs lsp ${String(b.get(msg) ?? 0)} | ${msg.slice(0, 70)}`, t.name)
  }
}

const sizes = new Map<number, string[]>()
for (const [k, names] of buckets) if (k === "missing only") for (const n of names) void n
console.log("why a fixture does not agree:")
for (const [k, names] of [...buckets].sort((a, b) => b[1].length - a[1].length)) console.log(`  ${String(names.length).padStart(4)}  ${k}${k.startsWith("repeat") ? `  <- ${names.slice(0, 2).join(", ")}` : ""}`)
console.log("\nthe IDE messages the LSP most often MISSES:")
for (const [m, n] of [...missingMessages].sort((a, b) => b[1] - a[1]).slice(0, 22)) console.log(`  ${String(n).padStart(4)}  ${m.slice(0, 118)}`)
