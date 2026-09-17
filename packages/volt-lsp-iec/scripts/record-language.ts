/**
 * Conformance recorder — re-creates `test/conformance/recordings/<vendor>.build.json` from a LIVE bridge.
 * Self-contained: speaks the raw HTTP wire, so it needs no CLI or bridge client.
 *
 *   VOLT_VENDOR=codesys VOLT_VENDOR=codesys bun run scripts/record-language.ts        # CODESYS
 *   VOLT_VENDOR=twincat VOLT_VENDOR=tc       bun run scripts/record-language.ts        # TwinCAT
 *
 * Each fixture is recorded ISOLATED (push its unit(s) AND every fixture it depends on → instantiate in PLC_PRG →
 * build → capture → restore),
 * so no cross-fixture batch short-circuit can drop diagnostics. Multi-unit fixtures (e.g. a struct + FB) are
 * SPLIT into one bridge item per top-level unit (see splitItems). Writes to `expected-<vendor>.new.json` by
 * default (non-destructive) + auto-diffs vs committed; `--write` adopts it; `RECORD_ONLY=a,b` records just
 * those and MERGES them into the committed file. Only error+warning severities are kept (info dropped).
 * Graphical (FBD/LD) bodies ARE recordable — the note here used to say they were not ("the bridge stores them as
 * PlcOpen XML, not pushable text"), which stopped being true when network text became the transport. That stale
 * sentence is why the graphical fixtures went unmeasured for so long; `network-graphical.ts` exists because of it.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ALL_TESTS } from "../test/conformance/fixtures/index.js"
import { withDependencies } from "../test/conformance/support/fixture-units.js"
import { parseSource } from "../src/syntax/index.js"
import { plcPrgSource } from "../test/conformance/support/plc-prg.js"
import { call } from "./bridge.js"

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
/** The wire extension for a FIXTURE's declared kind — the identity it states, not the one the parser infers. */
function extForKind(kind: string): string {
  return { function_block: "fb", program: "prg", function: "fun", interface: "itf", gvl: "gvl", dut: "dut", namespace: "namespace" }[kind] ?? "fb"
}

function splitItems(source: string, pouName: string, gvlNames?: readonly string[], kind?: string): { wire: string; src: string }[] {
  // Each item spans from a top-level unit's start to the NEXT top-level unit's start (or EOF) — a unit's own
  // span.end excludes its END_xxx keyword, and this also folds trailing member units into their POU.
  const tops = parseSource(source).units.filter((u) => TOP.has(u.kind))
  const lists = tops.filter((u) => u.kind === "global_var_list")
  // …starting at the PRAGMAS written above it, not at the keyword. A unit's span begins at `FUNCTION_BLOCK`, so
  // slicing from there dropped `{attribute 'pingroup' := …}` on the way to the IDE, and the fixture then recorded
  // a build of code it does not contain — `pragma_conflicting_pair` lost the very warning it exists for.
  const starts = tops.map((u) => pragmaStart(source, u.span.start))
  // THE ITEM'S NAME IS THE FIXTURE'S, NOT THE DECLARATION'S. CODESYS keeps the two apart — an object called one
  // thing may hold a signature calling itself another, and says so only at build time ("The name used in the
  // signature is not identical to the object name", measured 2026-09-17). Reading the name out of the parsed
  // signature therefore CORRECTED that mismatch on the way in, which made the one case worth recording
  // unrecordable. A fixture packing several items inline still needs a name for the others, and only the parse
  // has one — but the single-item case, which is every real workspace file, now comes from the fixture.
  const single = tops.length === 1 && kind !== undefined
  return tops.map((u, i) => ({
    // a VAR_GLOBAL block names nothing in its text — the fixture's pouName is its object's name, or its entry in
    // `gvlNames` where the fixture holds more than one list
    wire: single
      // a DUT keeps the sub-kind extension the parse gives it (struct/enum/union/alias) — the fixture's `dut`
      // says nothing about WHICH, and that spelling is what every existing DUT recording used
      ? `${u.kind === "global_var_list" ? (gvlNames?.[0] ?? pouName) : pouName}.${u.kind === "type_decl" ? unitExt(u) : extForKind(kind)}`
      : `${u.kind === "global_var_list" ? (gvlNames?.[lists.indexOf(u)] ?? pouName) : (u as any).name.text}.${unitExt(u)}`,
    src: source.slice(starts[i]!, i + 1 < tops.length ? starts[i + 1]! : source.length).trimEnd() + "\n",
  }))
}

/** Walk back over the pragma lines decorating a unit, so the pushed item carries the attributes written above it. */
function pragmaStart(source: string, unitStart: number): number {
  let at = unitStart
  for (;;) {
    const lineStart = source.lastIndexOf("\n", at - 1) + 1
    if (lineStart >= at) break // already at a line start with nothing above
    const prevEnd = lineStart - 1
    if (prevEnd <= 0) break
    const prevStart = source.lastIndexOf("\n", prevEnd - 1) + 1
    const line = source.slice(prevStart, prevEnd).trim()
    if (!line.startsWith("{") || !line.endsWith("}")) break
    at = prevStart
  }
  return at
}

const WRITE = process.argv.includes("--write")

// Vendor (→ recording file) is auto-detected from the bridge's reported platform; VOLT_VENDOR overrides.
const health = await call("health")
const VENDOR = process.env.VOLT_VENDOR ?? (health.platform === "twincat" ? "tc" : "codesys")

async function pushOps(ops: unknown[]): Promise<void> {
  const r = await call("push", { expectedProjectVersion: (await call("refs")).projectVersion, ops })
  if (!r.accepted) console.warn("  push rejected:", JSON.stringify(r.conflicts ?? r).slice(0, 160))
}
async function fetchItem(name: string): Promise<any> {
  const f = await call("fetch", { knownItems: {}, onlyItems: [name] })
  return (f.changed ?? []).find((i: any) => i.name === name)
}
const version = async (name: string): Promise<string | null> => (await call("refs")).items[name] ?? null

// Resolve PLC_PRG (CODESYS) / MAIN (TwinCAT) + its folder; save the original body for restore.
const refs0 = await call("refs")
const plcName: string =
  ["PLC_PRG.prg", "MAIN.prg"].find((n) => refs0.items[n]) ??
  (() => {
    throw new Error("no PLC_PRG/MAIN in project")
  })()
const plcItem0 = await fetchItem(plcName)
const plcFolder = plcItem0.folder ?? ""
const plcOriginal: string = plcItem0.sourceText

async function setPlcPrg(src: string): Promise<void> {
  // An UPDATE omits placement: `toFolder: ""` is the TREE ROOT, not "unchanged", so restating it here
  // asked to move PLC_PRG into the POU pool (which CODESYS refuses outright).
  await pushOps([{ op: "set", name: plcName, toFolder: null, sourceText: src, ifVersion: await version(plcName) }])
}

const tests: Record<string, { buildSuccess: boolean; durationMs: number; diagnostics: { severity: string; message: string; line: number }[] }> = {}
let done = 0
// RECORD_ONLY=name1,name2 → record just those fixtures and MERGE into the committed recording (safe: leaves
// every other fixture's ground truth untouched — the way to add new fixtures without a risky full re-record).
const ONLY = process.env.RECORD_ONLY ? new Set(process.env.RECORD_ONLY.split(",")) : undefined
for (const t of ALL_TESTS) {
  if (t.recorderSkip || (ONLY && !ONLY.has(t.name))) continue
  // A fixture may use what ANOTHER fixture declares — a DUT it holds, a GVL it reads through VAR_EXTERNAL, a base FB —
  // exactly as the replay's cross-fixture project lets it. Those must be in the IDE too, or the build records nothing
  // but the fallout of their absence ("Unknown type: 'DUT_XO_tally'"), which is not the fixture's ground truth at all.
  // `withDependencies` names them, dependencies first, as the execution recorder already does.
  const items = [...new Map(withDependencies(t, ALL_TESTS).flatMap((f) => splitItems(f.source, f.pouName, f.gvlNames, f.kind)).map((it) => [it.wire, it])).values()]
  try {
    await pushOps(items.map((it) => ({ op: "set", name: it.wire, toFolder: plcFolder, sourceText: it.src, ifVersion: null })))
    if (t.plcPrgVar !== undefined || t.plcPrgBody !== undefined) {
      await setPlcPrg(plcPrgSource(t))
    }
    const started = performance.now()
    const r = await call("build", { buildType: "incremental" })
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
  $schema: `./${VENDOR === "tc" ? "twincat" : VENDOR}.build.schema.json`,
  _doc: "Auto-generated by scripts/record-language.ts. Do not edit by hand — re-record after editing the catalog.",
  recorded: { at: new Date().toISOString(), bridgeVersion: (await call("health")).version ?? "1.0.0", testCount: Object.keys(tests).length },
  tests,
}
const stem = `${VENDOR === "tc" ? "twincat" : VENDOR}.build`
const dir = join(import.meta.dir, "..", "test", "conformance", "recordings")

// RECORD_ONLY → merge just the recorded fixtures into the committed file (leave the rest untouched).
if (ONLY) {
  const committed = JSON.parse(readFileSync(join(dir, `${stem}.json`), "utf8"))
  for (const [name, rec] of Object.entries(tests)) committed.tests[name] = rec
  committed.recorded.at = out.recorded.at
  committed.recorded.testCount = Object.keys(committed.tests).length
  writeFileSync(join(dir, `${stem}.json`), JSON.stringify(committed, null, 2) + "\n")
  console.log(`\nMerged ${Object.keys(tests).length} fixture(s) into ${stem}.json: ${[...ONLY].join(", ")}`)
  process.exit(0)
}

const path = join(dir, `${stem}.${WRITE ? "" : "new."}json`)
writeFileSync(path, JSON.stringify(out, null, 2) + "\n")
console.log(`\nWrote ${Object.keys(tests).length} tests → ${path}`)

// Non-destructive by default → auto-diff the fresh recording against the committed one (signal only:
// message + severity + buildSuccess, ignoring durationMs/line). Re-run with --write to adopt it.
if (!WRITE) {
  const committed = JSON.parse(readFileSync(join(dir, `${stem}.json`), "utf8")) as typeof out
  const sig = (r: any): string =>
    r === undefined ? "<none>" : `${r.buildSuccess} | ${(r.diagnostics ?? []).map((d: any) => `[${d.severity}] ${d.message}`).sort().join(" ~ ")}`
  const names = new Set([...Object.keys(committed.tests), ...Object.keys(tests)])
  const diffs = [...names].filter((n) => sig((committed.tests as any)[n]) !== sig((tests as any)[n]))
  console.log(`\ndiff vs committed: ${names.size - diffs.length}/${names.size} identical, ${diffs.length} changed`)
  for (const n of diffs) console.log(`● ${n}\n   committed: ${sig((committed.tests as any)[n])}\n   fresh:     ${sig((tests as any)[n])}`)
  console.log(diffs.length ? "\nrun with --write to adopt these changes." : "\nrecordings are up to date.")
}
