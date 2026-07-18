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
import { buildSymbolTable } from "../src/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../src/analysis/index.js"
import { get, post, TARGET } from "./bridge.js"

/** The messages the LSP (in `vendor` mode) emits for `ourCode` on this repro — what we must match to the IDE.
 *  `extra` are cross-file context units (a code's `reproFiles`); the symbol table is built from all of them but
 *  diagnostics still run on `repro`. */
function lspMessagesForCode(
  repro: string,
  vendor: "codesys" | "twincat",
  ourCode: string | undefined,
  extra?: { uri: string; source: string }[],
): string[] {
  if (ourCode === undefined) return []
  const pr = parseSource(repro)
  const files = [
    { uri: "R.fb", parseResult: pr, source: repro },
    ...(extra ?? []).map((f) => ({ uri: f.uri, source: f.source, parseResult: parseSource(f.source) })),
  ]
  const project = buildSymbolTable(files)
  return computeSemanticDiagnostics({ parseResult: pr, source: repro, project, config: resolveConfig({ vendor, lints: { unknownType: true, unknownAttribute: true } }) })
    .filter((d) => d.code === ourCode)
    .map((d) => d.message)
}

const WRITE = process.argv.includes("--write")
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : undefined
const CATALOG = join(import.meta.dir, "..", "docs", "codesys-reference", "error-catalog.json")
const MINIMAL_PLC = "PROGRAM PLC_PRG\nEND_PROGRAM\n"
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
/** The VAR_INPUT parameter count of a function unit — for synthesizing a reachable call with dummy args. */
function inputCount(u: any): number {
  let n = 0
  for (const sec of u.varSections ?? []) if (sec.sectionKind === "VAR_INPUT") for (const d of sec.decls) n += d.names.length
  return n
}
/** Back up from a unit's start over immediately-preceding whitespace + `{…}` pragma blocks (its leading
 *  attributes), so the slice includes attributes the parser dropped as trivia. Returns the earliest such offset. */
function leadStart(source: string, start: number): number {
  let s = start
  for (;;) {
    let j = s
    while (j > 0 && /\s/.test(source[j - 1]!)) j--
    if (j > 0 && source[j - 1] === "}") {
      const open = source.lastIndexOf("{", j - 1)
      if (open >= 0) {
        s = open
        continue
      }
    }
    return s
  }
}

/** Split a repro into { plcBody?, items[], instTypes[] (VAR-instantiable), calls[] (function calls) }. */
function splitRepro(source: string): { plcBody?: string; items: { wire: string; src: string }[]; instTypes: string[]; calls: string[] } {
  const tops = parseSource(source).units.filter((u) => TOP.has(u.kind))
  const items: { wire: string; src: string }[] = []
  const instTypes: string[] = []
  const calls: string[] = []
  let plcBody: string | undefined
  tops.forEach((u: any, i) => {
    // A VAR_GLOBAL list is often written without a name (`VAR_GLOBAL … END_VAR`) — give it one so its globals push.
    const name: string | undefined = u.name?.text ?? (u.kind === "global_var_list" ? "GVL" : undefined)
    if (name === undefined) return // nameless/malformed unit (e.g. a namespace wrapper) — skip
    // Slice from the unit's LEADING attribute pragmas (`{attribute 'pack_mode'}` etc. — parser trivia, so not in
    // the unit span) to the next unit's leading pragmas, so each pushed item carries its own attributes.
    const end = i + 1 < tops.length ? leadStart(source, tops[i + 1]!.span.start) : source.length
    const src = complete(source.slice(leadStart(source, u.span.start), end).trimEnd() + "\n", u.kind)
    if (u.kind === "program" && /^(plc_prg|main)$/i.test(name)) { plcBody = src; return }
    items.push({ wire: `${name}.${unitExt(u)}`, src })
    if (INSTANTIABLE.has(u.kind)) instTypes.push(name)
    // A FUNCTION is only compiled when CALLED — synth a statement call with dummy `0` args so its body/decl builds.
    if (u.kind === "function") calls.push(`${name}(${Array(inputCount(u)).fill("0").join(", ")});`)
  })
  return { plcBody, items, instTypes, calls }
}
/** A PLC_PRG that instantiates each VAR-instantiable unit and calls each function, so untasked units compile. */
const synthPlc = (types: string[], calls: string[]): string =>
  `PROGRAM PLC_PRG\nVAR\n${types.map((t, i) => `  v${i} : ${t};`).join("\n")}\nEND_VAR\n${calls.join("\n")}\nEND_PROGRAM\n`

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

// Vendor (→ which catalog fields to stamp) auto-detected from the bridge's platform.
const VENDOR: "codesys" | "twincat" = (await get("/health")).platform === "beckhoff" ? "twincat" : "codesys"
const ACTUAL_FIELD = `${VENDOR}Actual`
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
// `codesysOnly` codes are CODESYS-specific rules TwinCAT's compiler doesn't have (live /build confirmed clean).
// The check is vendor-gated, so on TwinCAT it correctly emits nothing — skip it there so a "silent" outcome
// never resets its (correct) verified flag.
// Not verifiable on TwinCAT: a `codesysOnly` rule TwinCAT's compiler lacks, or a `twincatInternalError` repro
// that makes TwinCAT throw an INTERNAL compiler error (a TC bug — no usable diagnostic). Skip both on TC so a
// "silent" outcome never resets their (correct) verified flag; the LSP still emits the CODESYS-correct error.
const targets = codes.filter(
  (c) =>
    c.status === "implemented" &&
    (!ONLY || ONLY.has(c.code)) &&
    c.repro &&
    !((c.codesysOnly === true || c.twincatInternalError === true) && VENDOR !== "codesys"),
)

console.log(`Verifying ${targets.length} implemented codes against ${TARGET} (${VENDOR}) …\n`)
// The true per-vendor mirror test: does the LSP's message (for `vendor`) appear among the IDE's messages?
//   verified — every LSP message for this code is one the IDE also emits (LSP mirrors the IDE).
//   mismatch — the LSP emits wording the IDE does NOT (a wording delta to adopt, or an FP if the IDE is silent).
//   silent   — the LSP check doesn't fire on this repro (coverage gap / repro doesn't trigger it).
type Outcome = "verified" | "mismatch" | "silent" | "error"
const results: { code: string; outcome: Outcome; lsp: string[]; actual: string[] }[] = []
const norm = (s: string): string => s.replace(/\r?\n/g, "").trim() // real messages sometimes embed the source line

for (const c of targets) {
  const { plcBody, items, instTypes, calls } = splitRepro(c.repro)
  // Cross-file context (`reproFiles`, e.g. extra GVLs) — push each under its own uri-derived name so distinct
  // files stay distinct (a nameless VAR_GLOBAL would otherwise collapse to a single "GVL").
  const extraItems = (c.reproFiles ?? []).map((f: { uri: string; source: string }) => ({
    wire: f.uri,
    src: complete(f.source.trimEnd() + "\n", f.uri.endsWith(".gvl") ? "global_var_list" : "function_block"),
  }))
  let actual: string[] = []
  let lsp: string[] = []
  let outcome: Outcome = "error"
  try {
    await resetProject()
    for (const it of [...items, ...extraItems]) { touched.add(it.wire); await robustSet(it.wire, it.src) }
    await robustSet("PLC_PRG.prg", plcBody ?? synthPlc(instTypes, calls))
    const r = await post("/build", { buildType: "full" })
    actual = (r.diagnostics ?? []).filter((d: any) => d.severity === "error" || d.severity === "warning").map((d: any) => `${d.message}`)
    lsp = lspMessagesForCode(c.repro, VENDOR, c.ourCode, c.reproFiles)
    const actualN = actual.map(norm)
    outcome = lsp.length === 0 ? "silent" : lsp.every((m) => actualN.includes(norm(m))) ? "verified" : "mismatch"
    // Detection-parity: a code flagged `<vendor>WordingDivergence` where the IDE's OWN message is buggy (TC
    // renders a pointer type as '1', C0126) or truncated (C0139). The IDE DETECTS the same error (non-empty
    // actual) at the same spot; byte-matching would ship the IDE's bug. So the LSP keeps the correct wording
    // and this counts as verified-by-detection, not a mismatch.
    if (outcome === "mismatch" && actual.length > 0 && c[`${VENDOR}WordingDivergence`] === true) outcome = "verified"
  } catch (e) {
    console.warn(`  ${c.code}: ERROR ${(e as Error).message}`)
  } finally {
    await resetProject()
  }
  results.push({ code: c.code, outcome, lsp, actual })
  console.log(`${{ verified: "✓", mismatch: "≠", silent: "∅", error: "✗" }[outcome]} ${c.code} ${outcome}`)
  if (outcome !== "verified") {
    console.log(`    lsp(${VENDOR}): ${JSON.stringify(lsp)}`)
    console.log(`    ide:          ${JSON.stringify(actual)}`)
  }
}

// ── summary + report ─────────────────────────────────────────────────────────
const by = (o: Outcome) => results.filter((r) => r.outcome === o).length
console.log(`\n─── ${results.length} codes ───`)
console.log(`  ✓ verified: ${by("verified")}   ≠ mismatch: ${by("mismatch")}   ∅ silent: ${by("silent")}   ✗ error: ${by("error")}`)
const report = join(import.meta.dir, "..", "docs", "codesys-reference", "catalog-verification.json")
writeFileSync(report, JSON.stringify({ at: new Date().toISOString(), base: TARGET, results }, null, 2) + "\n")
console.log(`\nreport → ${report}`)

// ── adopt (optional) ──────────────────────────────────────────────────────────
if (WRITE) {
  const byCode = new Map(results.map((r) => [r.code, r]))
  for (const c of codes) {
    const r = byCode.get(c.code)
    if (r === undefined) continue
    c.verified = { ...(c.verified ?? {}), [VENDOR]: r.outcome === "verified" }
    if (r.outcome !== "verified") c[ACTUAL_FIELD] = r.actual
    else delete c[ACTUAL_FIELD]
  }
  writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + "\n")
  console.log(`\nadopted → verified.${VENDOR} flags + ${ACTUAL_FIELD} written to error-catalog.json`)
}
