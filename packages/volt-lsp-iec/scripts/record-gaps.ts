/**
 * One-off: build crafted repros for the unverified "compiler-warnings" gap codes on the LIVE CODESYS bridge and
 * dump the IDE's ACTUAL diagnostics (code + severity + message). Trigger/wording verification for the coverage
 * doc. Throwaway (not a gate). UNREADABLE-safe cleanup: every pushed name is tracked and force-deleted on reset.
 *
 *   VOLT_PIPE=volt.bridge.codesys.<pid> bun run scripts/record-gaps.ts
 */
import { call } from "./bridge.js"

const MINIMAL_PLC = "PROGRAM PLC_PRG\nEND_PROGRAM\n"
const pushOps = (ops: unknown[]) => call("push", { expectedProjectVersion: null, ops })
let touched = new Set<string>()

async function robustSet(name: string, src: string): Promise<void> {
  touched.add(name)
  const v = (await call("refs")).items[name] ?? null
  const r = await pushOps([{ op: "set", name, toFolder: "", sourceText: src, ifVersion: v }])
  if (r.accepted) return
  await pushOps([{ op: "deleteItem", name, ifVersion: "UNREADABLE000000" }])
  await pushOps([{ op: "set", name, toFolder: "", sourceText: src, ifVersion: null }])
}
async function robustDelete(name: string): Promise<void> {
  const v = (await call("refs")).items[name] ?? "UNREADABLE000000"
  await pushOps([{ op: "deleteItem", name, ifVersion: v }])
}

const refs0 = await call("refs")
const BASELINE = new Set(Object.keys(refs0.items))
async function reset(): Promise<void> {
  await robustSet("PLC_PRG.prg", MINIMAL_PLC)
  const listed = Object.keys((await call("refs")).items).filter((n) => !BASELINE.has(n) && n !== "PLC_PRG.prg")
  for (const name of new Set([...listed, ...touched])) if (name !== "PLC_PRG.prg") await robustDelete(name)
  touched = new Set()
}

type Case = { code: string; note: string; items: Record<string, string>; plc: string }
const cases: Case[] = [
  // C0187 — several candidate triggers for "external reference on a PROGRAM".
  { code: "C0187a", note: "{attribute 'external'} on PROGRAM", items: { "extA.prg": "{attribute 'external'}\nPROGRAM extA\nVAR\n  x : INT;\nEND_VAR\nEND_PROGRAM\n" }, plc: MINIMAL_PLC },
  { code: "C0187b", note: "PROGRAM with VAR_EXTERNAL", items: { "extB.prg": "PROGRAM extB\nVAR_EXTERNAL\n  g : INT;\nEND_VAR\nEND_PROGRAM\n" }, plc: MINIMAL_PLC },

  // C0543 — soft-reserved IEC keyword as an identifier, one candidate at a time (avoid hard-keyword parse aborts).
  { code: "C0543-STEP", note: "var named STEP", items: { "F1.fb": "FUNCTION_BLOCK F1\nVAR\n  STEP : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n" }, plc: "PROGRAM PLC_PRG\nVAR\n  f : F1;\nEND_VAR\nf();\nEND_PROGRAM\n" },
  { code: "C0543-RETAIN", note: "var named EXIT", items: { "F2.fb": "FUNCTION_BLOCK F2\nVAR\n  EXIT : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n" }, plc: "PROGRAM PLC_PRG\nVAR\n  f : F2;\nEND_VAR\nf();\nEND_PROGRAM\n" },
  { code: "C0543-TIME", note: "var named TIMER", items: { "F3.fb": "FUNCTION_BLOCK F3\nVAR\n  TIMER : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n" }, plc: "PROGRAM PLC_PRG\nVAR\n  f : F3;\nEND_VAR\nf();\nEND_PROGRAM\n" },

  // C0561 — the configurable recursion WARNING (vs C0224 error). Try method self-recursion + recursive-attr fn.
  { code: "C0561-method", note: "a METHOD that calls itself", items: { "R.fb": "FUNCTION_BLOCK R\nEND_FUNCTION_BLOCK\nMETHOD M : INT\nM := THIS^.M();\nEND_METHOD\n" }, plc: "PROGRAM PLC_PRG\nVAR\n  r : R;\nEND_VAR\nr.M();\nEND_PROGRAM\n" },
  { code: "C0561-recattr", note: "{attribute 'recursive'} function calling itself", items: { "Fac.fun": "{attribute 'recursive'}\nFUNCTION Fac : INT\nVAR_INPUT\n  n : INT;\nEND_VAR\nIF n > 1 THEN Fac := n * Fac(n - 1); END_IF\nEND_FUNCTION\n" }, plc: "PROGRAM PLC_PRG\nVAR\n  r : INT;\nEND_VAR\nr := Fac(5);\nEND_PROGRAM\n" },

  // C0564 — a var initialized from a later, not-yet-initialized var, in one POU.
  { code: "C0564", note: "PLC_PRG var b := a before a is initialized", items: {}, plc: "PROGRAM PLC_PRG\nVAR\n  b : INT := a;\n  a : INT := 5;\nEND_VAR\nEND_PROGRAM\n" },
]

for (const c of cases) {
  console.log(`\n═══ ${c.code} — ${c.note} ═══`)
  try {
    await reset()
    for (const [name, src] of Object.entries(c.items)) await robustSet(name, src)
    await robustSet("PLC_PRG.prg", c.plc)
    const r = await call("build", { buildType: "full" })
    const diags = (r.diagnostics ?? []).filter((d: any) => d.severity === "error" || d.severity === "warning")
    if (diags.length === 0) console.log("  (no error/warning diagnostics)")
    for (const d of diags) console.log(`  [${d.severity}] ${d.code ?? "—"}  ${JSON.stringify(d.message)}`)
  } catch (e) {
    console.log(`  ERROR: ${(e as Error).message}`)
  }
}
await reset()
console.log("\ndone.")
