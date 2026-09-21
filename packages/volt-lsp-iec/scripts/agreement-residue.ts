/**
 * Why each fixture does NOT agree exactly with the IDE — the work list for closing the agreement gap.
 *
 *   bun run scripts/agreement-residue.ts            the buckets + the most-missed messages
 *   bun run scripts/agreement-residue.ts --detail   every incomplete fixture and what it misses
 *   bun run scripts/agreement-residue.ts <name>…    one fixture's source beside both sides in full
 *
 * `fixtures.test.ts` reports ONE number (exact agreement) and fails only on a false positive, so a fixture that is
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
import { computeSemanticDiagnostics, messagesFor, resolveConfig } from "../src/analysis/index.js"
import { computeNetworkTextDiagnostics } from "../src/network/index.js"
import { comparable } from "../test/conformance/support/compare-message.js"

// WHICH VENDOR? `VOLT_VENDOR=twincat` picks the other recording AND the other dialect — since the vocabulary,
// the wording and one collapse rule all differ, reading TwinCAT's residue through a CODESYS analysis would invent
// differences that are not there.
const vendor = process.env.VOLT_VENDOR === "twincat" ? ("twincat" as const) : ("codesys" as const)
const build = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "test", "conformance", "recordings", `${vendor}.build.json`), "utf8"),
).tests as Record<string, { diagnostics: { severity: string; message: string }[] }>
const config = resolveConfig({ vendor })
const std = STANDARD_LIBRARY.map((l) => ({ uri: l.uri, parseResult: parseSource(l.source, vendor), source: l.source }))
const buckets = new Map<string, string[]>()
const add = (k: string, name: string) => buckets.set(k, [...(buckets.get(k) ?? []), name])
const missingMessages = new Map<string, number>()
const perFixture: [name: string, missing: string[], extra: string[]][] = []

const only = process.argv.slice(2).filter((a) => !a.startsWith("--"))
/** Each fixture as a DECLARATION source for the others — programs dropped, as the replay drops them. */
const crossDecls = ALL_TESTS.filter((t) => t.source !== "").map((t) => {
  const parsed = parseSource(t.source, vendor)
  return {
    name: t.name,
    uri: `${t.pouName}__decl.st`,
    source: t.source,
    parseResult: { units: parsed.units.filter((u) => u.kind !== "program"), errors: [], failedDeclarations: [] },
  }
})

for (const t of ALL_TESTS) {
  if (t.source === "") continue
  if (only.length > 0 && !only.includes(t.name)) continue
  const rec = build[t.name]
  if (rec === undefined) {
    add("no recording at all", t.name)
    continue
  }
  const ide = rec.diagnostics.filter((d) => d.severity === "error" || d.severity === "warning").map((d) => `[${d.severity}] ${comparable(d.message)}`).sort()
  const fixtures = withDependencies(t, ALL_TESTS).filter((f) => f.source !== "")
  const plc = plcPrgSource(t)
  // Every OTHER fixture's declarations are in scope too, exactly as `fixtures.test.ts` builds them (its `CROSS_DECLS`):
  // one recording project holds them all, so a name another fixture declares resolves here. Without them this script
  // invents unresolved-name findings that the replay does not have (`op_sys_queryinterface`).
  const own = new Set(fixtures.map((f) => f.name))
  const files = [
    ...fixtures.map((f) => ({ name: f.name, uri: `${f.pouName}.st`, parseResult: parseSource(f.source), source: f.source })),
    { name: `${t.name}__plcprg`, uri: "plc_prg.prg", parseResult: parseSource(plc, vendor), source: plc },
    ...crossDecls.filter((d) => !own.has(d.name)).map((d) => ({ ...d, name: `${d.name}__decl` })),
    ...std.map((l) => ({ ...l, name: "__std" })),
  ]
  const project = buildSymbolTable(files, [], vendor)
  const lsp: string[] = []
  // Only the fixture's OWN file and its PLC_PRG are ANALYZED — a dependency is in the project to resolve against,
  // not to be diagnosed, exactly as `fixtures.test.ts` does it. Analyzing them too attributed one fixture's findings
  // to another (`interface_with_property_impl` inherited the interface fixture's accessor-less property).
  const analyzed = files.filter((f) => f.name === t.name || f.name === `${t.name}__plcprg`)
  for (const f of analyzed)
    for (const d of computeSemanticDiagnostics({ parseResult: f.parseResult, source: f.source, project, config }))
      if (d.severity === "error" || d.severity === "warning") lsp.push(`[${d.severity}] ${comparable(d.message)}`)
  // Graphical bodies: the semantic pass skips them, so the replay runs the network-text checks too. Without this the
  // script reports every NETWORK fixture as answering nothing.
  const ownFile = files[0]
  if (ownFile !== undefined)
    for (const d of computeNetworkTextDiagnostics({ uri: ownFile.uri, source: ownFile.source, parseResult: ownFile.parseResult }, project, messagesFor("codesys")))
      if (d.severity === "error" || d.severity === "warning") lsp.push(`[${d.severity}] ${comparable(d.message)}`)
  lsp.sort()
  if (only.length > 0) {
    console.log(`
=== ${t.name}
--- source
${t.source}--- IDE (${String(ide.length)})`)
    for (const m of ide) console.log(`  ${m}`)
    console.log(`--- LSP (${String(lsp.length)})`)
    for (const m of lsp) console.log(`  ${m}`)
    continue
  }
  if (lsp.length === ide.length && lsp.every((m, i) => m === ide[i])) continue
  const ideSet = new Set(ide)
  const lspSet = new Set(lsp)
  const missing = ide.filter((m) => !lspSet.has(m))
  const extra = lsp.filter((m) => !ideSet.has(m))
  for (const m of missing) missingMessages.set(m, (missingMessages.get(m) ?? 0) + 1)
  add(extra.length > 0 ? (missing.length > 0 ? "both extra and missing" : "extra only") : "missing only", t.name)
  if (missing.length > 0 || extra.length > 0) perFixture.push([t.name, missing, extra])
  if (extra.length === 0 && missing.length === 0) {
    const count = (list: string[]) => { const m = new Map<string, number>(); for (const x of list) m.set(x, (m.get(x) ?? 0) + 1); return m }
    const a = count(ide), b = count(lsp)
    for (const [msg, n] of a) if ((b.get(msg) ?? 0) !== n) add(`repeat: ide ${String(n)} vs lsp ${String(b.get(msg) ?? 0)} | ${msg.slice(0, 70)}`, t.name)
  }
}

if (only.length > 0) process.exit(0)
console.log("why a fixture does not agree:")
for (const [k, names] of [...buckets].sort((a, b) => b[1].length - a[1].length)) console.log(`  ${String(names.length).padStart(4)}  ${k}${k.startsWith("repeat") ? `  <- ${names.slice(0, 2).join(", ")}` : ""}`)
console.log("\nthe IDE messages the LSP most often MISSES:")
for (const [m, n] of [...missingMessages].sort((a, b) => b[1] - a[1]).slice(0, 22)) console.log(`  ${String(n).padStart(4)}  ${m.slice(0, 118)}`)

// `--detail` lists every incomplete fixture with what it misses (-) and wrongly adds (+) — the work list itself.
if (process.argv.includes("--detail")) {
  console.log("\nper fixture:")
  for (const [name, missing, extra] of perFixture.sort((a, b) => b[1].length + b[2].length - (a[1].length + a[2].length))) {
    console.log(`\n  ${name}`)
    for (const m of missing) console.log(`    - ${m.slice(0, 130)}`)
    for (const m of extra) console.log(`    + ${m.slice(0, 130)}`)
  }
}
