/**
 * Conformance recorder — re-creates `test/conformance/recordings/<vendor>.build.json` from a LIVE bridge.
 * Speaks the Volt NAMED-PIPE wire through `scripts/bridge.ts`, so it needs no CLI. (This said "the raw HTTP
 * wire" — there is no HTTP wire any more, and has not been since the bridge moved to named pipes.)
 *
 * THE PIPE NAME IS NOT THE DEFAULT when `ide.ps1` serves it. That script gives each IDE its own
 * `volt.bridge.<vendor>.<pid>` so several can run at once, while `bridge.ts` defaults to the bare
 * `volt.bridge.<vendor>`. Pass the one `ide.ps1 -Wait` prints:
 *
 *   VOLT_VENDOR=twincat VOLT_PIPE=volt.bridge.twincat.<pid> bun run record:language
 *
 *   VOLT_VENDOR=codesys bun run scripts/record-language.ts        # CODESYS
 *   VOLT_VENDOR=twincat bun run scripts/record-language.ts        # TwinCAT
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
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ALL_TESTS } from "../test/conformance/fixtures/index.js"
import { withDependencies } from "../test/conformance/support/fixture-units.js"
import { parseSource } from "../src/syntax/index.js"
import { plcPrgSource } from "../test/conformance/support/plc-prg.js"
import { call } from "./bridge.js"
import { markImplementations } from "../test/conformance/support/mark-implementations.js"

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
    // MARKED on the way out. A push without `(* @volt-implementation *)` is refused, and the marker goes
    // where the PARSER says the body starts — see mark-implementations.ts. Leaving it off recorded a
    // fixture the IDE never received as `buildSuccess: true`.
    src: markImplementations(source.slice(starts[i]!, i + 1 < tops.length ? starts[i + 1]! : source.length).trimEnd() + "\n"),
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

/**
 * `refs`, WITH THE ONE RECOVERY A LONG RUN NEEDS.
 *
 * The worker can be replaced under a running recording — `ide.ps1` retries its attach, the connector spawns its
 * own, a crashed one is restarted — and the replacement comes up with NO PROJECT SELECTED. `refs` then answers
 * without `items`, and every caller here read `.items[...]` straight off it: a bare
 * `TypeError: undefined is not an object`, forty fixtures in, naming a line that is not the problem. That is how
 * today's second TwinCAT run ended.
 *
 * So: say what happened, re-`connect` ONCE (which is the actual repair — the session lost its selection, not its
 * pipe), and fail loudly if that does not fix it. A recorder that guesses past this writes down a build of a
 * project the fixture never reached, which is the trap `pushOps` below is already written against.
 */
let selected: string | undefined
async function refs(): Promise<any> {
  const first = await call("refs").catch((e: Error) => ({ __error: e.message }) as any)
  if (first?.items !== undefined) return first
  if (selected === undefined)
    throw new Error(`refs returned no items and no project is known to re-select: ${first?.__error ?? JSON.stringify(first)}`)
  console.warn(`  bridge lost its project selection — re-connecting to '${selected}'`)
  await call("connect", { project: selected })
  const second = await call("refs")
  if (second?.items === undefined)
    throw new Error("refs still returned no items after re-connecting — the bridge is not serving this project")
  return second
}

async function pushOps(ops: unknown[]): Promise<void> {
  const r = await call("push", { expectedProjectVersion: (await refs()).projectVersion, ops })
  // A REJECTED PUSH IS FATAL, not a warning. This used to log and carry on, and the next thing the recorder
  // does is BUILD and write down the result — of a project the fixture never reached. Measured: pushing
  // `cc6_reference_assign_literal` was rejected outright and the recorder wrote
  // `{"buildSuccess": true, "diagnostics": []}`, i.e. "this fixture compiles clean", about source the IDE had
  // never seen. That is the reachability trap the whole suite is built to avoid — a clean build on something
  // that is not there is not weak evidence, it is no evidence — and it arrives as GREEN, which is the one
  // colour nobody re-checks.
  if (!r.accepted)
    throw new Error(
      `push rejected, so nothing below this line would describe the fixture:\n  ` +
        JSON.stringify(r.conflicts ?? r),
    )
}
async function fetchItem(name: string): Promise<any> {
  const f = await call("fetch", { knownItems: {}, onlyItems: [name] })
  return (f.changed ?? []).find((i: any) => i.name === name)
}
const version = async (name: string): Promise<string | null> => (await refs()).items[name] ?? null

// Resolve PLC_PRG (CODESYS) / MAIN (TwinCAT) + its folder; save the original body for restore.
selected = (health.projects ?? []).map((p: any) => p.project).find((n: any) => typeof n === "string")
if (selected !== undefined) await call("connect", { project: selected })
const refs0 = await refs()
const plcName: string =
  ["PLC_PRG.prg", "MAIN.prg"].find((n) => refs0.items[n]) ??
  (() => {
    throw new Error("no PLC_PRG/MAIN in project")
  })()
const plcItem0 = await fetchItem(plcName)
const plcFolder = plcItem0.folder ?? ""

/**
 * PLC_PRG, AS IT MUST BE BETWEEN FIXTURES — not merely as it happens to be right now.
 *
 * `plcOriginal` is what every fixture is restored to, and it was read straight off the LIVE PLC_PRG at startup.
 * That is only correct if the previous run finished. A run that was KILLED — a crash, Ctrl-C, the OOM killer —
 * dies between `setPlcPrg(fixture)` and the restore, leaving PLC_PRG DECLARING that fixture's instance. The next
 * run then adopts that as the pristine text and writes it back after every fixture, for the whole run.
 *
 * What that produces is not a crash but a plausible lie. Measured 2026-09-20: a killed run left
 * `inst : FB_LANG_bound_lint_at_min;` in PLC_PRG, and fixtures that compile the whole project — `linkalways_with
 * _unused_pou` by name, plus `sn_dut_mismatch`, `itf_var_section_declaration`, `oop_abstract_fb` and others —
 * recorded `Unknown type: 'FB_LANG_bound_lint_at_min'` as if it were their own answer. Six bad rows in 1190:
 * rare enough to read as a real vendor divergence rather than as damage.
 *
 * So the pristine text is DERIVED, not observed: `plcPrgSource({})` is the same template every fixture is built
 * from, with no declarations and no body. If the live PLC_PRG differs, say so and use the derived one.
 */
// MARKED, like every other unit this pushes — the wire refuses a program whose text does not say where its
// declaration ends ("no '(* @volt-implementation *)' line"). Caught immediately by `pushOps`, which is the guard
// doing its job rather than a surprise.
const plcPristine = markImplementations(plcPrgSource({}))
const plcLive: string = plcItem0.sourceText
const plcOriginal: string = plcPristine
if (plcLive.replace(/\s+/g, "") !== plcPristine.replace(/\s+/g, "")) {
  console.warn(
    "PLC_PRG is not pristine — an earlier run was killed mid-fixture and left its instantiation behind:\n" +
      `${plcLive.trim()}` +
      "\nrestoring the empty template before recording.",
  )
  await pushOps([{ op: "set", name: plcName, toFolder: null, sourceText: plcPristine, ifVersion: await version(plcName) }])
}

/**
 * SWEEP WHAT A KILLED RUN LEFT BEHIND, before recording anything.
 *
 * Each fixture is pushed in, built and then deleted in a `finally`. That covers a fixture that FAILS; it does
 * not cover the recorder being KILLED — a crash, a Ctrl-C, the OOM killer — which leaves that fixture's POUs in
 * the project for every later run to trip over.
 *
 * They are not inert. Most fixtures only compile what PLC_PRG reaches, so an orphan is invisible; but a fixture
 * that forces the whole project to compile sees it, and writes down diagnostics about a POU that has nothing to
 * do with it. Measured 2026-09-20: two killed runs left orphans, and six later fixtures recorded
 * `Unknown type: 'FB_XO_adder'` and friends — `linkalways_with_unused_pou` (which forces exactly that compile),
 * `itf_var_section_declaration`, `sn_dut_mismatch`, `sn_interface_mismatch`, `interface_extends_another_impl`,
 * `oop_abstract_fb`. Six bad rows in 1190, which is the worst kind of wrong: rare enough to look like a real
 * vendor divergence.
 *
 * The sweep is keyed on the fixtures' OWN names, so it can never delete a project POU that merely looks fixture-ish.
*/
const fixtureItems = new Set(
  ALL_TESTS.flatMap((t) => [
    `${t.pouName}.${extForKind(t.kind)}`,
    ...(t.gvlNames ?? []).map((g) => `${g}.gvl`),
  ]),
)
const orphans = Object.keys(refs0.items).filter((n) => fixtureItems.has(n))
if (orphans.length > 0) {
  console.log(`sweeping ${orphans.length} orphan(s) left by an earlier killed run: ${orphans.join(', ')}`)
  for (const n of orphans) await pushOps([{ op: "deleteItem", name: n, ifVersion: await version(n) }])
}

async function setPlcPrg(src: string): Promise<void> {
  // An UPDATE omits placement: `toFolder: ""` is the TREE ROOT, not "unchanged", so restating it here
  // asked to move PLC_PRG into the POU pool (which CODESYS refuses outright).
  await pushOps([{ op: "set", name: plcName, toFolder: null, sourceText: src, ifVersion: await version(plcName) }])
}

const tests: Record<string, { buildSuccess: boolean; durationMs: number; diagnostics: { severity: string; message: string; line: number }[] }> = {}
let done = 0

const stem = `${VENDOR === "tc" ? "twincat" : VENDOR}.build`
const dir = join(import.meta.dir, "..", "test", "conformance", "recordings")
/** The full run's output — and, from now on, its CHECKPOINT. */
const freshPath = join(dir, `${stem}.new.json`)

/**
 * CHECKPOINT EVERY 25, AND RESUME FROM IT.
 *
 * This wrote its result exactly once, after the last fixture. A full TwinCAT run is over two hours, and TwinCAT's
 * out-of-process COM does not survive two hours: on 2026-09-20 it died at fixture ~130 (a push hung for 13
 * minutes and came back to an invalidated project tree), and every one of those 130 recordings — forty minutes
 * of a live IDE — went with it, because nothing had been written. The cost of not checkpointing is the whole run,
 * every time, and the vendor makes that likely rather than rare.
 *
 * `--resume` reads the checkpoint back and skips what it already holds, so a crash costs the fixtures since the
 * last write rather than all of them. RECORD_ONLY does not checkpoint: it merges into the committed file at the
 * end and is short by construction.
 */
const RESUME = process.argv.includes("--resume")
let bridgeVersion = "1.0.0"
function checkpoint(): void {
  writeFileSync(
    freshPath,
    JSON.stringify(
      {
        $schema: `./${stem}.schema.json`,
        _doc: "Auto-generated by scripts/record-language.ts. Do not edit by hand — re-record after editing the catalog.",
        recorded: { at: new Date().toISOString(), bridgeVersion, testCount: Object.keys(tests).length },
        tests,
      },
      null,
      2,
    ) + "\n",
  )
}
// RECORD_ONLY=name1,name2 → record just those fixtures and MERGE into the committed recording (safe: leaves
// every other fixture's ground truth untouched — the way to add new fixtures without a risky full re-record).
const ONLY = process.env.RECORD_ONLY ? new Set(process.env.RECORD_ONLY.split(",")) : undefined
if (RESUME && !ONLY && existsSync(freshPath)) {
  const prior = JSON.parse(readFileSync(freshPath, "utf8"))
  Object.assign(tests, prior.tests ?? {})
  console.log(`resuming from ${freshPath}: ${Object.keys(tests).length} already recorded`)
}
for (const t of ALL_TESTS) {
  if (t.recorderSkip || (ONLY && !ONLY.has(t.name))) continue
  if (RESUME && tests[t.name] !== undefined) continue // already in the checkpoint
  // A fixture may use what ANOTHER fixture declares — a DUT it holds, a GVL it reads through VAR_EXTERNAL, a base FB —
  // exactly as the replay's cross-fixture project lets it. Those must be in the IDE too, or the build records nothing
  // but the fallout of their absence ("Unknown type: 'DUT_XO_tally'"), which is not the fixture's ground truth at all.
  // `withDependencies` names them, dependencies first, as the execution recorder already does.
  const items = [...new Map(withDependencies(t, ALL_TESTS).flatMap((f) => splitItems(f.source, f.pouName, f.gvlNames, f.kind)).map((it) => [it.wire, it])).values()]
  try {
    await pushOps(items.map((it) => ({ op: "set", name: it.wire, toFolder: plcFolder, sourceText: it.src, ifVersion: null })))
    if (t.plcPrgVar !== undefined || t.plcPrgBody !== undefined) {
      // MARKED, like every other pushed unit. `plcOriginal` at the restore below is NOT marked here:
      // it came back from a fetch, so it already carries the marker StWriter emitted.
      await setPlcPrg(markImplementations(plcPrgSource(t)))
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
  if (++done % 25 === 0) {
    console.log(`  …${done} recorded`)
    if (!ONLY) checkpoint() // the run can now die without taking the work with it
  }
}

bridgeVersion = (await call("health")).version ?? "1.0.0"
const out = {
  $schema: `./${stem}.schema.json`,
  _doc: "Auto-generated by scripts/record-language.ts. Do not edit by hand — re-record after editing the catalog.",
  recorded: { at: new Date().toISOString(), bridgeVersion, testCount: Object.keys(tests).length },
  tests,
}

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
