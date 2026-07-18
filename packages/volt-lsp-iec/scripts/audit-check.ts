/**
 * Ad-hoc LSP-vs-live-IDE prober. Give it ONE POU source; it runs our LSP's semantic diagnostics AND the real
 * compiler (/build) and prints the mismatch — the tool for a quick "is this check right?" during investigation.
 * It holds NO test cases: durable checks belong in `test/conformance/fixtures/` (recorded via record-language).
 *
 *   VOLT_BRIDGE_PORT=8556 bun run audit:check 'FUNCTION_BLOCK Scratch VAR x:INT:=40000; END_VAR END_FUNCTION_BLOCK'
 *
 * LSP-only = candidate false positive; IDE-only = a gap we miss. Non-destructive (scratch POU deleted after).
 */
import { parseSource } from "../src/syntax/index.js"
import { buildSymbolTable } from "../src/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig, type Vendor } from "../src/analysis/index.js"
import { get, post, PORT } from "./bridge.js"

const VENDOR: Vendor = PORT === "8555" ? "twincat" : "codesys"
const source = process.argv[2]
if (source === undefined) {
  console.error("usage: audit:check '<full POU source>'  (pushes it, builds, diffs LSP vs IDE)")
  process.exit(1)
}
async function pushOps(ops: unknown[]): Promise<boolean> {
  const r = await post("/push", { expectedProjectVersion: (await get("/refs")).projectVersion, ops })
  return !!r.accepted
}
const ver = async (n: string): Promise<string | null> => (await get("/refs")).items[n] ?? null
const key = (d: any): string => `[${d.severity}] ${d.message}`

// LSP side (offline).
const pr = parseSource(source)
const project = buildSymbolTable([{ uri: "S.fb", parseResult: pr, source }])
const lsp = computeSemanticDiagnostics({ parseResult: pr, source, project, config: resolveConfig({ vendor: VENDOR }) })
  .filter((d) => d.severity === "error" || d.severity === "warning")
  .map(key)
  .sort()

// IDE side (live) — push a scratch POU named from the source's first unit, build, diff, delete.
const unitName = /(?:FUNCTION_BLOCK|PROGRAM|FUNCTION)\s+(\w+)/.exec(source)?.[1] ?? "Scratch_audit"
const wire = `${unitName}.fb`
const refs0 = await get("/refs")
const plcName = ["PLC_PRG.prg", "MAIN.prg"].find((n) => refs0.items[n])!
const plcOrig = (await post("/fetch", { knownItems: {}, onlyItems: [plcName] })).changed.find((i: any) => i.name === plcName).sourceText
const base = new Set(((await post("/build", { buildType: "incremental" })).diagnostics ?? []).map(key))

if (!(await pushOps([{ op: "set", name: wire, toFolder: "", sourceText: source, ifVersion: null }, { op: "set", name: plcName, toFolder: "", sourceText: `PROGRAM PLC_PRG\nVAR\n\tinst_audit : ${unitName};\nEND_VAR\nEND_PROGRAM\n`, ifVersion: await ver(plcName) }]))) {
  console.error("push rejected"); process.exit(1)
}
const r = await post("/build", { buildType: "incremental" })
const ide = (r.diagnostics ?? []).filter((d: any) => d.severity === "error" || d.severity === "warning").map(key).filter((m: string) => !base.has(m)).sort()
await pushOps([{ op: "deleteItem", name: wire, ifVersion: await ver(wire) }, { op: "set", name: plcName, toFolder: "", sourceText: plcOrig, ifVersion: await ver(plcName) }])

console.log(`\nLSP(${VENDOR}):  ${lsp.join(" | ") || "(none)"}`)
console.log(`IDE(:${PORT}): ${ide.join(" | ") || "(none)"}  success=${r.success}`)
const lspOnly = lsp.filter((m) => !ide.includes(m))
const ideOnly = ide.filter((m: string) => !lsp.includes(m))
console.log(lspOnly.length ? `\n⚠ LSP-only (candidate FALSE POSITIVE): ${lspOnly.join(" | ")}` : "")
console.log(ideOnly.length ? `ℹ IDE-only (LSP misses): ${ideOnly.join(" | ")}` : "")
if (!lspOnly.length && !ideOnly.length) console.log("\n✓ LSP matches the compiler exactly.")
