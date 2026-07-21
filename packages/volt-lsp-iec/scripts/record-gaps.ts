/**
 * One-off: build crafted repros for the unverified "compiler-warnings" gap codes on the LIVE CODESYS bridge and
 * dump the IDE's ACTUAL diagnostics. Trigger/wording verification for the coverage doc. Throwaway (not a gate).
 *
 * METHODOLOGY (learned the hard way): an untasked POU is NOT compiled, so "no diagnostic" is ambiguous — it can
 * mean "built and silent" OR "never built". So every case (a) makes its POU reachable from the TASKED PLC_PRG
 * (FB/type → VAR + call; FUNCTION → call; PROGRAM → call by name), and (b) carries a POSITIVE CONTROL: a
 * reference to `VOLT_PROBE_UNDEFINED`, which — if the unit compiled — MUST surface as "not defined". If the
 * control fires but the target code doesn't, the silence is genuine; if the control is ALSO absent, the unit was
 * never built and the case is invalid.
 *
 *   VOLT_PIPE=volt.bridge.codesys.<pid> bun run scripts/record-gaps.ts
 */
import { call } from "./bridge.js"
import { MINIMAL_PLC, openFixture } from "./bridge-fixture.js"

const PROBE = "VOLT_PROBE_UNDEFINED" // positive control: an undefined identifier that errors iff its unit compiled
const fx = await openFixture()

type Case = { code: string; note: string; items: Record<string, string>; plc: string }
const cases: Case[] = [
  // C0187 — external reference on a PROGRAM. extProg is now CALLED from PLC_PRG (reachable), and PLC_PRG carries
  // the positive control so we can see whether extProg was actually pulled into the build.
  {
    code: "C0187",
    note: "external PROGRAM, CALLED from PLC_PRG (reachable)",
    items: { "extProg.prg": "{external}\nPROGRAM extProg\nVAR\n  x : INT;\nEND_VAR\nEND_PROGRAM\n" },
    plc: `PROGRAM PLC_PRG\nVAR\nEND_VAR\nextProg();\n${PROBE};\nEND_PROGRAM\n`,
  },
  // C0543 — soft-reserved keyword as identifier. F1 is instantiated + called; its body has the positive control.
  {
    code: "C0543-STEP",
    note: "var named STEP; F1 reachable + probed",
    items: { "F1.fb": `FUNCTION_BLOCK F1\nVAR\n  STEP : INT;\nEND_VAR\n${PROBE};\nEND_FUNCTION_BLOCK\n` },
    plc: "PROGRAM PLC_PRG\nVAR\n  f : F1;\nEND_VAR\nf();\nEND_PROGRAM\n",
  },
  {
    code: "C0543-TRANSITION",
    note: "var named TRANSITION; F4 reachable + probed",
    items: { "F4.fb": `FUNCTION_BLOCK F4\nVAR\n  TRANSITION : INT;\nEND_VAR\n${PROBE};\nEND_FUNCTION_BLOCK\n` },
    plc: "PROGRAM PLC_PRG\nVAR\n  f : F4;\nEND_VAR\nf();\nEND_PROGRAM\n",
  },
  // C0561 — mutual recursion between two FUNCTIONs, both reachable via PLC_PRG (isolated run, clean reset).
  {
    code: "C0561-mutual",
    note: "A()<->B() mutual recursion, both called",
    items: { "A.fun": "FUNCTION A : INT\nA := B();\nEND_FUNCTION\n", "B.fun": "FUNCTION B : INT\nB := A();\nEND_FUNCTION\n" },
    plc: "PROGRAM PLC_PRG\nVAR\n  r : INT;\nEND_VAR\nr := A();\nEND_PROGRAM\n",
  },
  // C0564 — init order. Vars live in PLC_PRG itself (always tasked/built); probe confirms compilation.
  {
    code: "C0564",
    note: "PLC_PRG b := a before a init (+probe)",
    items: {},
    plc: `PROGRAM PLC_PRG\nVAR\n  b : INT := a;\n  a : INT := 5;\nEND_VAR\n${PROBE};\nEND_PROGRAM\n`,
  },
]

for (const c of cases) {
  console.log(`\n═══ ${c.code} — ${c.note} ═══`)
  try {
    await fx.reset()
    for (const [name, src] of Object.entries(c.items)) await fx.set(name, src)
    await fx.set("PLC_PRG.prg", c.plc)
    const r = await call("build", { buildType: "full" })
    const diags = (r.diagnostics ?? []).filter((d: any) => d.severity === "error" || d.severity === "warning")
    const compiled = diags.some((d: any) => String(d.message).includes(PROBE))
    console.log(`  positive control (${PROBE}) seen: ${compiled ? "YES — unit compiled" : "NO — unit was NOT built (case invalid)"}`)
    for (const d of diags) if (!String(d.message).includes(PROBE)) console.log(`  [${d.severity}] ${d.code ?? "—"}  ${JSON.stringify(d.message)}`)
    if (diags.every((d: any) => String(d.message).includes(PROBE))) console.log("  (no diagnostics besides the control)")
  } catch (e) {
    console.log(`  ERROR: ${(e as Error).message}`)
  }
}
await fx.reset()
console.log("\ndone.")
