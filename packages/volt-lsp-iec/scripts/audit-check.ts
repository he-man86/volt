/**
 * LSP-vs-live-IDE audit. For each case, runs the LSP's semantic diagnostics AND the real compiler (/build)
 * and reports mismatches — the tool for "is this check actually right?". Point at a bridge:
 *
 *   VOLT_BRIDGE_PORT=8556 bun run scripts/audit-check.ts overflow      # CODESYS
 *   VOLT_BRIDGE_PORT=8555 bun run scripts/audit-check.ts overflow      # TwinCAT
 *
 * A case is a self-contained FB body. LSP-only = candidate false positive; IDE-only = a gap we miss;
 * both-flag-different-wording = a wording bug. Non-destructive (creates + deletes a scratch POU per case).
 */
import { parseSource } from "../src/syntax/index.js"
import { buildSymbolTable } from "../src/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig, type Vendor } from "../src/analysis/index.js"

const PORT = process.env.VOLT_BRIDGE_PORT ?? "8556"
const BASE = `http://127.0.0.1:${PORT}`
const VENDOR: Vendor = PORT === "8555" ? "twincat" : "codesys"

const get = async (p: string): Promise<any> => (await fetch(BASE + p)).json()
const post = async (p: string, b: unknown): Promise<any> =>
  (await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).json()
async function pushOps(ops: unknown[]): Promise<void> {
  await post("/push", { expectedProjectVersion: (await get("/refs")).projectVersion, ops })
}
const ver = async (n: string): Promise<string | null> => (await get("/refs")).items[n] ?? null

// batteries — { name, decls, body } assembled into an FB; `inst` optional PLC_PRG usage line.
type Case = { name: string; decls?: string; body?: string; inst?: string }
const BATTERIES: Record<string, Case[]> = {
  overflow: [
    { name: "int_untyped_40000", decls: "x : INT := 40000;" },
    { name: "int_untyped_99999", decls: "x : INT := 99999;" },
    { name: "int_typed_40000", decls: "x : INT := INT#40000;" },
    { name: "int_at_max", decls: "x : INT := 32767;" },
    { name: "sint_200", decls: "x : SINT := 200;" },
    { name: "byte_300", decls: "x : BYTE := 300;" },
    { name: "uint_neg5", decls: "x : UINT := -5;" },
    { name: "word_70000", decls: "x : WORD := 70000;" },
    { name: "int_const_expr_sum", decls: "x : INT := 30000 + 10000;" },
    { name: "usint_256", decls: "x : USINT := 256;" },
    { name: "dint_overflow", decls: "x : DINT := 3000000000;" },
  ],
  subrange: [
    { name: "in_range", decls: "x : INT(0..10) := 5;" },
    { name: "above", decls: "x : INT(1..100) := 200;" },
    { name: "below", decls: "x : INT(-10..10) := -20;" },
    { name: "at_bound", decls: "x : INT(0..10) := 10;" },
    { name: "assign_out", decls: "x : INT(0..10);", body: "x := 20;" },
  ],
}

const key = (d: any): string => `[${d.severity}] ${d.message}`
function lsp(c: Case): string[] {
  const src = `FUNCTION_BLOCK Scratch\nVAR\n${c.decls ?? ""}\nEND_VAR\n${c.body ?? ""}\nEND_FUNCTION_BLOCK`
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "S.fb", parseResult: pr, source: src }])
  return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: VENDOR }) })
    .filter((d) => d.severity === "error" || d.severity === "warning")
    .map(key)
    .sort()
}

const battery = process.argv[2] ?? "overflow"
const cases = BATTERIES[battery] ?? []
const refs0 = await get("/refs")
const plcName = ["PLC_PRG.prg", "MAIN.prg"].find((n) => refs0.items[n])!
const plcFolder = ""
const plcOrig = (await post("/fetch", { knownItems: {}, onlyItems: [plcName] })).changed.find((i: any) => i.name === plcName).sourceText

console.log(`\n### ${battery} — LSP(${VENDOR}) vs live /build :${PORT}\n`)
for (const c of cases) {
  const wire = `Scratch_${c.name}.fb`
  const src = `FUNCTION_BLOCK Scratch_${c.name}\nVAR\n${c.decls ?? ""}\nEND_VAR\n${c.body ?? ""}\nEND_FUNCTION_BLOCK`
  await pushOps([{ op: "set", name: wire, toFolder: plcFolder, sourceText: src, ifVersion: null }])
  await pushOps([{ op: "set", name: plcName, toFolder: "", sourceText: `PROGRAM PLC_PRG\nVAR\n\ti_${c.name} : Scratch_${c.name};\nEND_VAR\nEND_PROGRAM\n`, ifVersion: await ver(plcName) }])
  const r = await post("/build", { buildType: "incremental" })
  const ide = (r.diagnostics ?? []).filter((d: any) => d.severity === "error" || d.severity === "warning").map(key).sort()
  const L = lsp(c)
  const lspOnly = L.filter((m) => !ide.includes(m))
  const ideOnly = ide.filter((m: string) => !L.includes(m))
  const verdict = lspOnly.length === 0 && ideOnly.length === 0 ? "OK" : lspOnly.length > 0 && ideOnly.length === 0 ? "LSP-FALSE-POSITIVE" : ideOnly.length > 0 && lspOnly.length === 0 ? "LSP-MISSES" : "WORDING/BOTH"
  console.log(`— ${c.name}  [${verdict}]  ide.success=${r.success}`)
  if (lspOnly.length) console.log(`    LSP-only: ${lspOnly.join(" | ")}`)
  if (ideOnly.length) console.log(`    IDE-only: ${ideOnly.join(" | ")}`)
  await pushOps([{ op: "deleteItem", name: wire, ifVersion: await ver(wire) }])
  await pushOps([{ op: "set", name: plcName, toFolder: "", sourceText: plcOrig, ifVersion: await ver(plcName) }])
}
console.log("\ndone")
