/**
 * IS THIS RECORDING FIT TO ADOPT? — and what do the two vendors actually disagree about?
 *
 *   bun run scripts/check-recording.ts twincat          # verify a fresh <vendor>.build.new.json
 *   bun run scripts/check-recording.ts codesys
 *   bun run scripts/check-recording.ts --diff           # committed codesys vs committed twincat
 *
 * WHY THIS EXISTS. A `--write` REPLACES the committed recording, so anything the fresh run failed to produce is
 * dropped in silence. Checked by hand on 2026-09-20, that turned up three fixtures and every one was a finding
 * rather than noise: a fixture whose `kind` disagreed with its own source (so every push was refused, and it had
 * only ever recorded on the vendor whose recording predates the guard), a fixture TwinCAT's PLCopen importer
 * structurally cannot accept, and a `recorderSkip` row left over from before the flag. Adopting blind would have
 * lost the last two and hidden the first.
 *
 * It also re-runs the CONTAMINATION check, which is the one that matters most. A recorder that is killed mid-run
 * leaves the project's PLC_PRG declaring the fixture it was on; the next run adopts that as its restore target
 * and writes it back after every fixture. What that produces is not a crash but a plausible lie — a fixture
 * recording a diagnostic about some OTHER fixture's POU, as its own answer. Six rows in 1190 on 2026-09-20,
 * rare enough to read as a real vendor divergence. The carrier is fixed (`record-language.ts` derives its
 * pristine PLC_PRG now), so this is the belt to that braces.
 *
 * The `--diff` mode replaces the `diff:vendors` script that `live-tc-snapshot-was-stale-bridge` refers to and
 * which no longer exists. Comparison is on the build VERDICT and on whitespace-normalised message sets: the two
 * vendors word the same finding differently often enough that raw text equality measures spelling, not meaning.
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { ALL_TESTS } from "../test/conformance/fixtures/index.js"
import { withDependencies } from "../test/conformance/support/fixture-units.js"

const RECORDINGS = join(import.meta.dir, "..", "test", "conformance", "recordings")
type Row = { buildSuccess?: boolean; diagnostics?: { severity: string; message: string }[] }
const load = (f: string): Record<string, Row> =>
  JSON.parse(readFileSync(join(RECORDINGS, f), "utf8")).tests as Record<string, Row>

const norm = (m: string): string => m.replace(/\s+/g, " ").trim().toLowerCase()
const msgs = (r: Row): string[] => (r.diagnostics ?? []).map((d) => norm(d.message)).sort()

/**
 * Every POU a fixture legitimately names — ITS OWN, and every fixture the recorder pushes ALONGSIDE it.
 *
 * `withDependencies` is what the recorder actually sends, so it is what "own" has to mean here. Keying on the
 * fixture's own pouName alone called `interface_missing_implementation` contaminated for naming the interface it
 * deliberately depends on — a checker that cries wolf about the correct case is worse than no checker.
 */
const OWN = new Map<string, Set<string>>()
for (const t of ALL_TESTS) {
  const own = new Set<string>()
  for (const f of withDependencies(t, ALL_TESTS)) {
    own.add(f.pouName.toUpperCase())
    for (const g of f.gvlNames ?? []) own.add(g.toUpperCase())
  }
  OWN.set(t.name, own)
}
const ALL_POUS = new Set([...OWN.values()].flatMap((s) => [...s]))

/**
 * WHICH TARGET WAS THIS RECORDED ON? — read out of the recording, because nothing else says.
 *
 * `__XINT` is as wide as the target's pointer, so `plat_xint_into_string` names that width in its own error
 * message. Both oracles are meant to be 64-bit: the CODESYS device is `CODESYS Control Win V3 x64`, and the
 * TwinCAT project is meant to be on `TwinCAT RT (x64)`.
 *
 * On 2026-09-20 it was not. The TwinCAT fixture solution's active platform was `TwinCAT CE7 (ARMV7)` — 32-bit,
 * and nothing in the repo records the choice, because it lives in an uncommitted `.suo` (its sibling fixture
 * project was on x64 at the same time). Every width in that recording came back 32-bit and read as a vendor
 * difference, which is what put nine `plat_*` fixtures on the TwinCAT triage backlog; `__XADD` went further and
 * reported `Internal Error (ARM): RiscFrontEnd: Unknown operator`, a code generator the fixtures never meant to
 * exercise. The platform is one click in a toolbar dropdown and leaves no trace in git, so the only durable
 * guard is this one: the recording states its own target, and a recording is not fit to adopt on another.
 */
function targetWidth(t: Record<string, Row>): string {
  const m = t["plat_xint_into_string"]?.diagnostics?.[0]?.message.match(/Cannot convert type '(\w+)'/)
  return m?.[1] ?? "unknown"
}
function verify(vendor: string): number {
  const stem = `${vendor}.build`
  const fresh = `${stem}.new.json`
  if (!existsSync(join(RECORDINGS, fresh))) {
    console.log(`no ${fresh} — nothing to verify (a completed run writes it; --write adopts it)`)
    return 1
  }
  const t = load(fresh)
  const committed = existsSync(join(RECORDINGS, `${stem}.json`)) ? load(`${stem}.json`) : {}
  const width = targetWidth(t)
  const wrongTarget = width !== "LINT"
  console.log(`target: __XINT is ${width} — ${wrongTarget ? "NOT the 64-bit oracle, do not adopt" : "a 64-bit target, as intended"}`)
  const ok = Object.values(t).filter((r) => r.buildSuccess).length
  console.log(`${fresh}: ${Object.keys(t).length} fixtures, ${ok} build clean, ${Object.keys(t).length - ok} with diagnostics`)

  // 1. CONTAMINATION — a diagnostic naming a POU that belongs to a DIFFERENT fixture.
  const leaks: string[] = []
  for (const [name, r] of Object.entries(t)) {
    const own = OWN.get(name) ?? new Set<string>()
    for (const d of r.diagnostics ?? [])
      for (const m of d.message.matchAll(/'([A-Za-z_]\w*)'/g)) {
        const pou = m[1]!.toUpperCase()
        if (ALL_POUS.has(pou) && !own.has(pou)) leaks.push(`${name}: names ${m[1]}, which belongs to another fixture`)
      }
  }
  console.log(`\ncross-fixture contamination: ${leaks.length}`)
  for (const l of leaks.slice(0, 10)) console.log(`   ${l}`)

  // 2. WHAT ADOPTING WOULD DROP. Every one needs a reason before `--write`.
  const dropped = Object.keys(committed).filter((n) => t[n] === undefined)
  console.log(`\nin the committed recording but NOT in this run: ${dropped.length}`)
  for (const n of dropped) {
    const f = ALL_TESTS.find((x) => x.name === n)
    const why = f === undefined ? "no longer a fixture" : f.recorderSkip ? "recorderSkip — the old row predates the flag" : "NEEDS A REASON"
    console.log(`   ${n.padEnd(38)} ${why}`)
  }

  // 3. EVERY FIXTURE ACCOUNTED FOR.
  const missing = ALL_TESTS.filter(
    (x) => !x.recorderSkip && x.vendorRefuses?.vendor !== vendor && t[x.name] === undefined,
  )
  console.log(`\nfixtures with no row in this run: ${missing.length}`)
  for (const m of missing.slice(0, 15)) console.log(`   ${m.name}`)

  const bad = (wrongTarget ? 1 : 0) + leaks.length + dropped.filter((n) => ALL_TESTS.find((x) => x.name === n)?.recorderSkip !== true && ALL_TESTS.some((x) => x.name === n)).length
  console.log(`\n${bad === 0 ? "OK to adopt (--write)" : "DO NOT ADOPT until each line above has a reason"}`)
  return bad === 0 ? 0 : 1
}

function diff(): number {
  const cs = load("codesys.build.json")
  const tc = load("twincat.build.json")
  const both = Object.keys(cs).filter((n) => tc[n] !== undefined)
  let sameVerdict = 0
  let sameMsgs = 0
  const verdict: string[] = []
  for (const n of both) {
    if (!!cs[n]!.buildSuccess !== !!tc[n]!.buildSuccess) {
      verdict.push(n)
      continue
    }
    sameVerdict++
    if (JSON.stringify(msgs(cs[n]!)) === JSON.stringify(msgs(tc[n]!))) sameMsgs++
  }
  console.log(`codesys ${Object.keys(cs).length}   twincat ${Object.keys(tc).length}   both ${both.length}`)
  console.log(`target width: codesys __XINT=${targetWidth(cs)}  twincat __XINT=${targetWidth(tc)}`)
  console.log(`\nsame build verdict : ${sameVerdict}/${both.length} (${((100 * sameVerdict) / Math.max(1, both.length)).toFixed(1)}%)`)
  console.log(`  identical messages: ${sameMsgs}`)
  console.log(`  differing wording : ${sameVerdict - sameMsgs}`)
  console.log(`different verdict   : ${verdict.length}`)
  for (const n of verdict.slice(0, 25)) {
    console.log(`\n  ${n}: CS build=${cs[n]!.buildSuccess} TC build=${tc[n]!.buildSuccess}`)
    for (const d of (cs[n]!.diagnostics ?? []).slice(0, 1)) console.log(`      CS: ${d.message.slice(0, 100)}`)
    for (const d of (tc[n]!.diagnostics ?? []).slice(0, 1)) console.log(`      TC: ${d.message.slice(0, 100)}`)
  }
  return 0
}

const arg = process.argv[2]
process.exit(arg === "--diff" ? diff() : arg === "codesys" || arg === "twincat" ? verify(arg) : (console.log("usage: check-recording.ts <codesys|twincat> | --diff"), 1))
