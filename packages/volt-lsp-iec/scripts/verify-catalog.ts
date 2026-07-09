/**
 * Catalog verification — build every IMPLEMENTED error-catalog `repro` on a LIVE bridge and compare the real
 * `Cnnnn` diagnostics against the entry's provisional `expect`. This is the "mirror, verified" pass: it turns
 * each PROVISIONAL wording into a confirmed one, catches a check that fires where the IDE is silent (a real FP
 * the offline corpus can't see), and (with --write) stamps `verified.<vendor>` + records the actual message.
 *
 *   VOLT_BRIDGE_PORT=8556 bun run scripts/verify-catalog.ts            # report only (non-destructive)
 *   VOLT_BRIDGE_PORT=8556 bun run scripts/verify-catalog.ts --write    # adopt: set verified + codesysActual
 *   ONLY=C0072,C0354 bun run scripts/verify-catalog.ts                 # just those codes
 *
 * Isolation model (learned the hard way): the repro's code must live in the TASKED PLC_PRG to be compiled — an
 * untasked POU is not built. So each repro either brings its own `PROGRAM PLC_PRG` (62 do) or we synthesize one
 * that instantiates its pushed units (making them reachable). A repro that puts VAR_CONFIG/malformed content in
 * PLC_PRG turns it UNREADABLE and un-settable; recovery is delete-with-the-`UNREADABLE000000`-sentinel then
 * recreate. Every fixture starts from a hard reset (minimal PLC_PRG + all non-baseline items deleted). Safe
 * against the headless fixture project only.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parseSource } from "../src/syntax/index.js"

const PORT = process.env.VOLT_BRIDGE_PORT ?? "8556"
const BASE = `http://127.0.0.1:${PORT}`
const WRITE = process.argv.includes("--write")
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : undefined
const CATALOG = join(import.meta.dir, "..", "docs", "codesys-reference", "error-catalog.json")
const MINIMAL_PLC = "PROGRAM PLC_PRG\nEND_PROGRAM\n"

const get = async (p: string): Promise<any> => (await fetch(BASE + p)).json()
const post = async (p: string, body: unknown): Promise<any> =>
  (await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json()
async function pushOps(ops: unknown[]): Promise<any> {
  return post("/push", { expectedProjectVersion: null, ops })
}

// ── unit → wire mapping ──────────────────────────────────────────────────────
const TOP = new Set(["function_block", "program", "function", "interface", "global_var_list", "type_decl", "namespace"])
const INSTANTIABLE = new Set(["function_block", "type_decl", "interface"]) // a VAR of this type makes the unit reachable
function unitExt(u: any): string {
  if (u.kind === "type_decl") {
    const bk = u.body?.kind
    return bk === "struct" ? "struct" : bk === "enum" ? "enum" : bk === "union" ? "union" : "alias"
  }
  return { function_block: "fb", program: "prg", function: "fun", interface: "itf", global_var_list: "gvl" }[u.kind as string] ?? "fb"
}
const TERMINATOR: Record<string, string> = {
  function_block: "END_FUNCTION_BLOCK", program: "END_PROGRAM", function: "END_FUNCTION",
  interface: "END_INTERFACE", type_decl: "END_TYPE", namespace: "END_NAMESPACE",
}
/** Some catalog repros omit the closing END_* (the offline parser recovers; the bridge needs it). Append it —
 *  but ONLY if the terminator is absent entirely: a folded FB+METHOD source already has its END_FUNCTION_BLOCK
 *  (before the trailing END_METHOD), and appending another would corrupt it. */
function complete(src: string, kind: string): string {
  const end = TERMINATOR[kind]
  return end === undefined || new RegExp(`\\b${end}\\b`, "i").test(src) ? src : `${src.trimEnd()}\n${end}\n`
}
/** Split a repro into { plcBody? (its own PROGRAM PLC_PRG source), items[] (every other unit), instTypes[] }. */
function splitRepro(source: string): { plcBody?: string; items: { wire: string; src: string }[]; instTypes: string[] } {
  const tops = parseSource(source).units.filter((u) => TOP.has(u.kind))
  const items: { wire: string; src: string }[] = []
  const instTypes: string[] = []
  let plcBody: string | undefined
  tops.forEach((u: any, i) => {
    if (u.name?.text === undefined) return // nameless/malformed unit (e.g. a namespace wrapper) — skip
    const src = complete(source.slice(u.span.start, i + 1 < tops.length ? tops[i + 1]!.span.start : source.length).trimEnd() + "\n", u.kind)
    if (u.kind === "program" && /^(plc_prg|main)$/i.test(u.name.text)) { plcBody = src; return }
    items.push({ wire: `${u.name.text}.${unitExt(u)}`, src })
    if (INSTANTIABLE.has(u.kind)) instTypes.push(u.name.text)
  })
  return { plcBody, items, instTypes }
}
/** A PLC_PRG that instantiates each pushed instantiable unit, so an otherwise-untasked unit gets compiled. */
const synthPlc = (types: string[]): string =>
  `PROGRAM PLC_PRG\nVAR\n${types.map((t, i) => `  v${i} : ${t};`).join("\n")}\nEND_VAR\nEND_PROGRAM\n`

// ── robust item set: recovers from the UNREADABLE-but-exists state a malformed push can leave behind ─────
async function robustSet(name: string, src: string): Promise<void> {
  const v = (await get("/refs")).items[name] ?? null
  const r = await pushOps([{ op: "set", name, toFolder: "", sourceText: src, ifVersion: v }])
  if (r.accepted) return
  // Rejected → the item is UNREADABLE (invisible in /refs but blocks re-create). Delete with the sentinel, recreate.
  await pushOps([{ op: "deleteItem", name, ifVersion: "UNREADABLE000000" }])
  await pushOps([{ op: "set", name, toFolder: "", sourceText: src, ifVersion: null }])
}
async function robustDelete(name: string): Promise<void> {
  const v = (await get("/refs")).items[name] ?? "UNREADABLE000000"
  await pushOps([{ op: "deleteItem", name, ifVersion: v }])
}

const refs0 = await get("/refs")
const BASELINE = new Set(Object.keys(refs0.items)) // libs/device/task/PLC_PRG present before any fixture
let touched = new Set<string>() // every item name a fixture created (so UNREADABLE ones still get cleaned)
/** Reset to a known-clean project: minimal PLC_PRG + every touched/non-baseline item deleted (UNREADABLE-safe). */
async function resetProject(): Promise<void> {
  await robustSet("PLC_PRG.prg", MINIMAL_PLC)
  const listed = Object.keys((await get("/refs")).items).filter((n) => !BASELINE.has(n) && n !== "PLC_PRG.prg")
  for (const name of new Set([...listed, ...touched])) await robustDelete(name)
  touched = new Set()
}

// ── the catalog ──────────────────────────────────────────────────────────────
const catalog = JSON.parse(readFileSync(CATALOG, "utf8"))
const codes: any[] = Array.isArray(catalog) ? catalog : catalog.codes
const targets = codes.filter((c) => c.status === "implemented" && (!ONLY || ONLY.has(c.code)) && c.repro)

console.log(`Verifying ${targets.length} implemented codes against ${BASE} …\n`)
type Outcome = "verified" | "mismatch" | "silent" | "error"
const results: { code: string; outcome: Outcome; expect: string[]; actual: string[] }[] = []
const norm = (s: string): string => s.replace(/\r?\n/g, "").trim() // real messages sometimes embed the source line

for (const c of targets) {
  const { plcBody, items, instTypes } = splitRepro(c.repro)
  let actual: string[] = []
  let outcome: Outcome = "error"
  try {
    await resetProject()
    for (const it of items) { touched.add(it.wire); await robustSet(it.wire, it.src) }
    await robustSet("PLC_PRG.prg", plcBody ?? synthPlc(instTypes))
    const r = await post("/build", { buildType: "full" })
    actual = (r.diagnostics ?? []).filter((d: any) => d.severity === "error" || d.severity === "warning").map((d: any) => `${d.message}`)
    const expect: string[] = c.expect ?? []
    const actualN = actual.map(norm)
    outcome = expect.length && expect.every((e: string) => actualN.includes(norm(e))) ? "verified" : actual.length ? "mismatch" : "silent"
  } catch (e) {
    console.warn(`  ${c.code}: ERROR ${(e as Error).message}`)
  } finally {
    await resetProject()
  }
  results.push({ code: c.code, outcome, expect: c.expect ?? [], actual })
  console.log(`${{ verified: "✓", mismatch: "≠", silent: "∅", error: "✗" }[outcome]} ${c.code} ${outcome}`)
  if (outcome !== "verified") {
    console.log(`    expect: ${JSON.stringify(c.expect)}`)
    console.log(`    actual: ${JSON.stringify(actual)}`)
  }
}

// ── summary + report ─────────────────────────────────────────────────────────
const by = (o: Outcome) => results.filter((r) => r.outcome === o).length
console.log(`\n─── ${results.length} codes ───`)
console.log(`  ✓ verified: ${by("verified")}   ≠ mismatch: ${by("mismatch")}   ∅ silent: ${by("silent")}   ✗ error: ${by("error")}`)
const report = join(import.meta.dir, "..", "docs", "codesys-reference", "catalog-verification.json")
writeFileSync(report, JSON.stringify({ at: new Date().toISOString(), base: BASE, results }, null, 2) + "\n")
console.log(`\nreport → ${report}`)

// ── adopt (optional) ──────────────────────────────────────────────────────────
if (WRITE) {
  const byCode = new Map(results.map((r) => [r.code, r]))
  for (const c of codes) {
    const r = byCode.get(c.code)
    if (r === undefined) continue
    c.verified = { ...(c.verified ?? {}), codesys: r.outcome === "verified" }
    if (r.outcome !== "verified") c.codesysActual = r.actual
    else delete c.codesysActual
  }
  writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + "\n")
  console.log(`\nadopted → verified flags + codesysActual written to error-catalog.json`)
}
