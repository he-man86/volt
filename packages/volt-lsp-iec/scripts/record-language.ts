/**
 * Conformance recorder — re-creates `test/conformance/recordings/expected-<vendor>.json` from a LIVE bridge.
 * Self-contained: speaks the raw HTTP wire, so it needs no CLI or bridge client.
 *
 *   VOLT_VENDOR=codesys VOLT_VENDOR=codesys bun run scripts/record-language.ts        # CODESYS
 *   VOLT_VENDOR=twincat VOLT_VENDOR=tc       bun run scripts/record-language.ts        # TwinCAT
 *
 * Each fixture is recorded ISOLATED (push its unit(s) → instantiate in PLC_PRG → build → capture → restore),
 * so no cross-fixture batch short-circuit can drop diagnostics. Multi-unit fixtures (e.g. a struct + FB) are
 * SPLIT into one bridge item per top-level unit (see splitItems). Writes to `expected-<vendor>.new.json` by
 * default (non-destructive) + auto-diffs vs committed; `--write` adopts it; `RECORD_ONLY=a,b` records just
 * those and MERGES them into the committed file. Only error+warning severities are kept (info dropped).
 * NOTE: graphical (VG) bodies can't be recorded — the bridge stores them as PlcOpen XML, not pushable text.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ALL_TESTS } from "../test/conformance/fixtures/index.js"
import { parseSource } from "../src/syntax/index.js"
import { get, post } from "./bridge.js"

// The bridge stores ONE item per top-level unit. A multi-unit fixture (e.g. a struct + an FB that uses it,
// for unknown-member) must therefore be pushed as SEPARATE items — else the splitter mangles all but the
// first. Group each fixture source into items: a top-level POU/type/gvl starts one; trailing method/action/
// property units append to it (they are that POU's members).
const TOP = new Set(["function_block", "program", "function", "interface", "global_var_list", "type_decl", "namespace"])
function unitExt(u: any): string {
  if (u.kind === "type_decl") {
    const bk = u.body?.kind
    return bk === "struct_body" ? "struct" : bk === "enum_body" ? "enum" : bk === "union_body" ? "union" : "alias"
  }
  return { function_block: "fb", program: "prg", function: "fun", interface: "itf", global_var_list: "gvl", namespace: "namespace" }[u.kind as string] ?? "fb"
}
function splitItems(source: string): { wire: string; src: string }[] {
  // Each item spans from a top-level unit's start to the NEXT top-level unit's start (or EOF) — a unit's own
  // span.end excludes its END_xxx keyword, and this also folds trailing member units into their POU.
  const tops = parseSource(source).units.filter((u) => TOP.has(u.kind))
  return tops.map((u, i) => ({
    wire: `${(u as any).name.text}.${unitExt(u)}`,
    src: source.slice(u.span.start, i + 1 < tops.length ? tops[i + 1]!.span.start : source.length).trimEnd() + "\n",
  }))
}

const WRITE = process.argv.includes("--write")

// Vendor (→ recording file) is auto-detected from the bridge's reported platform; VOLT_VENDOR overrides.
const health = await get("/health")
const VENDOR = process.env.VOLT_VENDOR ?? (health.platform === "twincat" ? "tc" : "codesys")

async function pushOps(ops: unknown[]): Promise<void> {
  const r = await post("/push", { expectedProjectVersion: (await get("/refs")).projectVersion, ops })
  if (!r.accepted) console.warn("  push rejected:", JSON.stringify(r.conflicts ?? r).slice(0, 160))
}
async function fetchItem(name: string): Promise<any> {
  const f = await post("/fetch", { knownItems: {}, onlyItems: [name] })
  return (f.changed ?? []).find((i: any) => i.name === name)
}
const version = async (name: string): Promise<string | null> => (await get("/refs")).items[name] ?? null

// Resolve PLC_PRG (CODESYS) / MAIN (TwinCAT) + its folder; save the original body for restore.
const refs0 = await get("/refs")
const plcName: string =
  ["PLC_PRG.prg", "MAIN.prg"].find((n) => refs0.items[n]) ??
  (() => {
    throw new Error("no PLC_PRG/MAIN in project")
  })()
const plcItem0 = await fetchItem(plcName)
const plcFolder = plcItem0.folder ?? ""
const plcOriginal: string = plcItem0.sourceText

async function setPlcPrg(src: string): Promise<void> {
  await pushOps([{ op: "set", name: plcName, toFolder: "", sourceText: src, ifVersion: await version(plcName) }])
}

const tests: Record<string, { buildSuccess: boolean; durationMs: number; diagnostics: { severity: string; message: string; line: number }[] }> = {}
let done = 0
// RECORD_ONLY=name1,name2 → record just those fixtures and MERGE into the committed recording (safe: leaves
// every other fixture's ground truth untouched — the way to add new fixtures without a risky full re-record).
const ONLY = process.env.RECORD_ONLY ? new Set(process.env.RECORD_ONLY.split(",")) : undefined
for (const t of ALL_TESTS) {
  if (t.recorderSkip || (ONLY && !ONLY.has(t.name))) continue
  const items = splitItems(t.source)
  try {
    await pushOps(items.map((it) => ({ op: "set", name: it.wire, toFolder: plcFolder, sourceText: it.src, ifVersion: null })))
    if (t.plcPrgVar !== undefined || t.plcPrgBody !== undefined) {
      await setPlcPrg(`PROGRAM PLC_PRG\nVAR\n${t.plcPrgVar ?? ""}\nEND_VAR\n${t.plcPrgBody ?? ""}\nEND_PROGRAM\n`)
    }
    const started = performance.now()
    const r = await post("/build", { buildType: "incremental" })
    const durationMs = Math.round(performance.now() - started)
    const diagnostics = (r.diagnostics ?? [])
      .filter((d: any) => d.severity === "error" || d.severity === "warning")
      .map((d: any) => ({ severity: d.severity, message: d.message, line: d.line ?? 0 }))
    tests[t.name] = { buildSuccess: !!r.success, durationMs, diagnostics }
  } catch (e) {
    console.warn(`  ${t.name}: ERROR ${(e as Error).message}`)
  } finally {
    // restore: delete every item this fixture created, put PLC_PRG back
    for (const it of items) await pushOps([{ op: "deleteItem", name: it.wire, ifVersion: await version(it.wire) }])
    if (plcOriginal !== undefined) await setPlcPrg(plcOriginal)
  }
  if (++done % 25 === 0) console.log(`  …${done} recorded`)
}

const out = {
  $schema: `./expected-${VENDOR === "tc" ? "tc" : VENDOR}.schema.json`,
  _doc: "Auto-generated by scripts/record-language.ts. Do not edit by hand — re-record after editing the catalog.",
  recorded: { at: new Date().toISOString(), bridgeVersion: (await get("/health")).version ?? "1.0.0", testCount: Object.keys(tests).length },
  tests,
}
const stem = VENDOR === "tc" ? "tc" : VENDOR
const dir = join(import.meta.dir, "..", "test", "conformance", "recordings")

// RECORD_ONLY → merge just the recorded fixtures into the committed file (leave the rest untouched).
if (ONLY) {
  const committed = JSON.parse(readFileSync(join(dir, `expected-${stem}.json`), "utf8"))
  for (const [name, rec] of Object.entries(tests)) committed.tests[name] = rec
  committed.recorded.at = out.recorded.at
  committed.recorded.testCount = Object.keys(committed.tests).length
  writeFileSync(join(dir, `expected-${stem}.json`), JSON.stringify(committed, null, 2) + "\n")
  console.log(`\nMerged ${Object.keys(tests).length} fixture(s) into expected-${stem}.json: ${[...ONLY].join(", ")}`)
  process.exit(0)
}

const path = join(dir, `expected-${stem}.${WRITE ? "" : "new."}json`)
writeFileSync(path, JSON.stringify(out, null, 2) + "\n")
console.log(`\nWrote ${Object.keys(tests).length} tests → ${path}`)

// Non-destructive by default → auto-diff the fresh recording against the committed one (signal only:
// message + severity + buildSuccess, ignoring durationMs/line). Re-run with --write to adopt it.
if (!WRITE) {
  const committed = JSON.parse(readFileSync(join(dir, `expected-${stem}.json`), "utf8")) as typeof out
  const sig = (r: any): string =>
    r === undefined ? "<none>" : `${r.buildSuccess} | ${(r.diagnostics ?? []).map((d: any) => `[${d.severity}] ${d.message}`).sort().join(" ~ ")}`
  const names = new Set([...Object.keys(committed.tests), ...Object.keys(tests)])
  const diffs = [...names].filter((n) => sig((committed.tests as any)[n]) !== sig((tests as any)[n]))
  console.log(`\ndiff vs committed: ${names.size - diffs.length}/${names.size} identical, ${diffs.length} changed`)
  for (const n of diffs) console.log(`● ${n}\n   committed: ${sig((committed.tests as any)[n])}\n   fresh:     ${sig((tests as any)[n])}`)
  console.log(diffs.length ? "\nrun with --write to adopt these changes." : "\nrecordings are up to date.")
}
