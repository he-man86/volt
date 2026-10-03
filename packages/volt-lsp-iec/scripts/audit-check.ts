/**
 * Ad-hoc LSP-vs-live-IDE prober. Give it ONE POU source; it runs our LSP's semantic diagnostics AND the real
 * compiler (/build) and prints the mismatch — the tool for a quick "is this check right?" during investigation.
 * It holds NO test cases: durable checks belong in `test/conformance/fixtures/` (recorded via record-language).
 *
 *   VOLT_VENDOR=codesys bun run audit:check 'FUNCTION_BLOCK Scratch VAR x:INT:=40000; END_VAR END_FUNCTION_BLOCK'
 *
 * LSP-only = candidate false positive; IDE-only = a gap we miss. Non-destructive (scratch POU deleted after).
 */
import { parseSource } from "../src/frontend/syntax/index.js"
import { build } from "../src/frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig, type Vendor } from "../src/analysis/index.js"
import { call, landedInFull, VENDOR as V } from "./bridge.js"
import { NETWORK_TEXT_ENABLED } from "../src/server/config.js"

const VENDOR: Vendor = V
const source = process.argv[2]
if (source === undefined) {
  console.error("usage: audit:check '<full POU source>'  (pushes it, builds, diffs LSP vs IDE)")
  process.exit(1)
}
async function pushOps(ops: unknown[]): Promise<boolean> {
  const r = await call("push", { expectedProjectVersion: (await call("refs")).projectVersion, ops })
  return landedInFull(r)
}
const ver = async (n: string): Promise<string | null> => (await call("refs")).items[n] ?? null
const key = (d: any): string => `[${d.severity}] ${d.message}`

// LSP side (offline).
const pr = parseSource(source, { networkText: NETWORK_TEXT_ENABLED }, VENDOR)
const project = build.buildSymbolTable([{ uri: "S.pou", parseResult: pr, source }], [], VENDOR)
const lsp = computeSemanticDiagnostics({ parseResult: pr, source, project, config: resolveConfig({ vendor: VENDOR }) })
  .filter((d) => d.severity === "error" || d.severity === "warning")
  .map(key)
  .sort()

// IDE side (live) — push a scratch POU named from the source's first unit, build, diff, delete.
const unitName = /(?:FUNCTION_BLOCK|PROGRAM|FUNCTION)\s+(\w+)/.exec(source)?.[1] ?? "Scratch_audit"
const wire = `${unitName}.pou`
const refs0 = await call("refs")
const plcName = ["PLC_PRG.pou", "MAIN.pou"].find((n) => refs0.items[n])!
const plcOrig = (await call("fetch", { knownItems: {}, onlyItems: [plcName] })).changed.find((i: any) => i.name === plcName).sourceText
const base = new Set(((await call("build", { buildType: "incremental" })).diagnostics ?? []).map(key))

// VOLT_NO_INSTANTIATE=1 pushes the POU and does NOT reference it from the main program - which is how you
// ask the OTHER question: is this object compiled AT ALL? CODESYS generates code only for what it can reach,
// so an FB nobody instantiates is skipped and answers with silence no matter what is wrong inside it. That
// distinction is the difference between "the LSP is wrong" and "the compiler never looked", and it is what
// separates a real false positive from `Mach1_MIDS`/`AHWF` in Lenze_MID-S100 building clean around four
// `???` markers the LSP (correctly) reports.
const instantiate = process.env.VOLT_NO_INSTANTIATE !== "1"
const ops: unknown[] = [{ op: "set", name: wire, toFolder: "", sourceText: source, ifVersion: null }]
if (instantiate)
  ops.push({
    op: "set",
    name: plcName,
    toFolder: null,
    sourceText: `PROGRAM PLC_PRG\nVAR\n\tinst_audit : ${unitName};\nEND_VAR\nEND_PROGRAM\n`,
    ifVersion: await ver(plcName),
  })
if (!(await pushOps(ops))) {
  console.error("push rejected"); process.exit(1)
}
const r = await call("build", { buildType: "incremental" })
const ide = (r.diagnostics ?? []).filter((d: any) => d.severity === "error" || d.severity === "warning").map(key).filter((m: string) => !base.has(m)).sort()
await pushOps([{ op: "deleteItem", name: wire, ifVersion: await ver(wire) }, { op: "set", name: plcName, toFolder: null, sourceText: plcOrig, ifVersion: await ver(plcName) }])

console.log(`\nLSP(${VENDOR}):  ${lsp.join(" | ") || "(none)"}`)
console.log(`IDE(${VENDOR}): ${ide.join(" | ") || "(none)"}  success=${r.success}`)
const lspOnly = lsp.filter((m) => !ide.includes(m))
const ideOnly = ide.filter((m: string) => !lsp.includes(m))
console.log(lspOnly.length ? `\n⚠ LSP-only (candidate FALSE POSITIVE): ${lspOnly.join(" | ")}` : "")
console.log(ideOnly.length ? `ℹ IDE-only (LSP misses): ${ideOnly.join(" | ")}` : "")
if (!lspOnly.length && !ideOnly.length) console.log("\n✓ LSP matches the compiler exactly.")
