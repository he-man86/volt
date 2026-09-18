/**
 * Execution recorder — re-creates `test/conformance/recordings/codesys.run.json` from CODESYS itself.
 *
 *   bun run record:exec                          # every case that builds; Windows + CODESYS 3.5.21.40 (SP21)
 *   RECORD_ONLY=a,b bun run record:exec          # just those cases, MERGED into the committed recording
 *
 * Launches a headless CODESYS with `record-exec.py` as its runscript, which opens a COPY of the committed fixture, puts
 * its device in simulation, and for each case loads the fixture's units, writes PLC_PRG, builds, runs `cycles` scans and
 * reads every variable path (see the .py for the measured facts that shape it). Not a bridge op: the scripting online
 * object only works inside a running script.
 *
 * WHICH cases: every conformance fixture whose CODESYS build recording says it builds, plus the execution cases (a
 * program that does not compile records its error — that is how a `refused` case is pinned). A fixture with no variable
 * to read has nothing to compare and is not sent. The paths come from `support/run-paths.ts` and the units from
 * `support/fixture-units.ts` — the PARSER, not lowering, so a case the transpiler cannot lower yet is still recorded:
 * the ground truth is wanted BEFORE the implementation (unify-conformance-suite design §2).
 */
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ALL_TESTS } from "../test/conformance/fixtures/index.js"
import { fixtureUnits, withDependencies } from "../test/conformance/support/fixture-units.js"
import { runPaths } from "../test/conformance/support/run-paths.js"

const CODESYS = "C:\\Program Files\\CODESYS 3.5.21.40\\CODESYS\\Common\\CODESYS.exe"
const PROFILE = "CODESYS V3.5 SP21 Patch 4"
const PROJECT =
  process.env.VOLT_EXEC_PROJECT ?? join(import.meta.dir, "..", "..", "volt-cli", "test", "fixtures", "CodesysTestProject.project")
const RECORDINGS = join(import.meta.dir, "..", "test", "conformance", "recordings")
const ONLY = process.env.RECORD_ONLY ? new Set(process.env.RECORD_ONLY.split(",")) : undefined

const build = JSON.parse(readFileSync(join(RECORDINGS, "codesys.build.json"), "utf8")).tests as Record<string, { buildSuccess: boolean }>
const cases = ALL_TESTS.filter((t) => !t.recorderSkip && !t.execSkip && (ONLY === undefined || ONLY.has(t.name)))
  // A case the BUILD recording says does not build is skipped; one it does not mention is NEW, and unknown is not
  // known-bad — sending it is how a fixture written today gets its values without a bridge round-trip first.
  .filter((t) => t.source === "" || build[t.name]?.buildSuccess !== false)
  .map((t) => ({
    name: t.name,
    units: withDependencies(t, ALL_TESTS).flatMap(fixtureUnits),
    vars: t.plcPrgVar ?? "",
    body: t.plcPrgBody ?? "",
    cycles: t.cycles ?? 1,
    names: runPaths(t, ALL_TESTS),
  }))
// NOT filtered on `names.length > 0`. A fixture with nothing to read still answers the question underneath every
// other one — DOES IT COMPILE, AND DOES THE SCAN FINISH — and dropping it meant an INTERFACE, a VAR_CONFIG or an FB
// whose only members are VAR_TEMP had never reached a compiler at all. The runscript reads the cycle counter first
// and the fixture's own paths after, so an empty list is a perfectly good case: it comes back `{cycles, values: {}}`,
// or with the vendor's refusal.
const skipped = ALL_TESTS.filter((t) => t.execSkip)
if (skipped.length > 0)
	console.log(`not sent (${skipped.length} with no execution ground truth to have): ` +
		skipped.map((t) => `${t.name} — ${t.execSkip}`).join("; "))
if (ONLY !== undefined) {
  const missing = [...ONLY].filter((n) => !cases.some((c) => c.name === n))
  if (missing.length > 0) console.warn(`not recorded (no build success, or nothing to read): ${missing.join(", ")}`)
}

const work = join(tmpdir(), "volt-exec-oracle")
mkdirSync(work, { recursive: true })
const casesPath = join(work, "cases.json")
const outPath = join(work, "result.json")
rmSync(outPath, { force: true })
// Non-ASCII as JSON `\uXXXX` escapes: the runscript's IronPython `json` reads raw UTF-8 as one character per BYTE, so
// "héllo" reached CODESYS as "hÃ©llo" — which is why a WSTRING(3) of it recorded as "hé" (three units, not two).
const asciiJson = (text: string): string =>
  text.replace(/[^\x00-\x7f]/g, (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"))
writeFileSync(casesPath, asciiJson(JSON.stringify(cases)))

console.log(`recording ${cases.length} case(s) in CODESYS simulation (log: ${outPath}.log)…`)
// Verbatim arguments: CODESYS parses `--profile="…"` itself, and Node's own quoting would wrap the WHOLE argument.
spawnSync(CODESYS, [`--profile="${PROFILE}"`, "--noUI", `--runscript="${join(import.meta.dir, "record-exec.py")}"`], {
  env: { ...process.env, VOLT_EXEC_CASES: casesPath, VOLT_EXEC_OUT: outPath, VOLT_EXEC_PROJECT: PROJECT },
  windowsVerbatimArguments: true,
  stdio: "ignore",
  // a hang guard, not a budget: a launch is about a minute, a healthy case a few seconds
  timeout: (120 + 15 * cases.length) * 1000,
})
if (!existsSync(outPath)) throw new Error(`CODESYS wrote no recording — see ${outPath}.log`)

// The runscript writes each non-ASCII character as the TEXT `\uXXXX` (see `ascii_escaped` in the .py), which json.dump
// escapes once more; un-doubling the backslash makes it a real JSON escape again.
const result = JSON.parse(readFileSync(outPath, "utf8").replace(/\\\\u([0-9a-f]{4})/g, "\\u$1"))
mkdirSync(RECORDINGS, { recursive: true })
const file = join(RECORDINGS, "codesys.run.json")
const doc = "Generated by scripts/record-exec.ts. Do not edit by hand — re-record."
if (ONLY !== undefined && existsSync(file)) {
  const committed = JSON.parse(readFileSync(file, "utf8"))
  for (const [name, rec] of Object.entries(result.tests)) committed.tests[name] = rec
  committed.recorded = result.recorded
  writeFileSync(file, JSON.stringify({ ...committed, _doc: doc }, null, 2) + "\n")
} else {
  writeFileSync(file, JSON.stringify({ _doc: doc, ...result }, null, 2) + "\n")
}
const tests = result.tests as Record<string, { error?: string; unreadable?: Record<string, string> }>
const failed = Object.entries(tests).filter(([, t]) => t.error)
const partial = Object.entries(tests).filter(([, t]) => t.unreadable !== undefined)
console.log(`recorded ${Object.keys(tests).length} case(s), ${failed.length} failed in the IDE, ${partial.length} with an unreadable path`)
for (const [name, t] of failed) console.log(`  ${name}: ${t.error}`)
for (const [name, t] of partial) console.log(`  ${name}: unreadable ${JSON.stringify(t.unreadable)}`)
