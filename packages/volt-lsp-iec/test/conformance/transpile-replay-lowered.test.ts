/**
 * THE TRANSPILE REPLAY, THE REST OF THE LOWERED FIXTURES — every fixture lowering takes and no confirmed run pins: its
 * emitted Rust builds (or says why not), the stored oracle matches what the compiler did, and the `diverges` rows run as
 * expected failures over the Rust runs this pass builds (`DIVERGES_RUST`, filled and read in this one file). The
 * confirmed runs: `transpile-replay.test.ts`; the refusals: `transpile-replay-refusals.test.ts`.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { join } from "node:path"
import { emitRust } from "../../src/transpile/index.js"
import { ALL_TESTS } from "./fixtures/index.js"
import { RUNS } from "./support/recordings.js"
import { CLIPPY, inRustBuildDir, RUSTC as rustc, skipLintCheck, skipRustSuite } from "./support/rustc.js"
import { buildRust } from "./support/rustc-cache-build.js"
import { rejectionIsADefect } from "./support/transpile/correctness.js"
import { edgeHarness, edgePlan, HARNESS_LOOP_GUARD } from "./support/transpile/edge.js"
import { buildArgv, rendered, splitFindings } from "./support/transpile/lint-policy.js"
import { expectStillDiverges } from "./support/expected-failure.js"
import { lowering, rated, SELECTION } from "./support/fixture-suite.js"
import {
  HARNESS_PROBES,
  compareInterp,
  lintDrift,
  Measured,
  measuredDrift,
  edgeOf,
  recordedScan,
  compareRust,
  compareFault,
  RustRun,
} from "./support/transpile/replay-steps.js"

/** The Rust runs of the `diverges` fixtures, filled by the rest-of-the-lowered pass that already builds them, and
 *  read by their expected-failure rows. Empty where there is no `rustc` — their Rust half is then unmeasured. */
const DIVERGES_RUST = new Map<string, RustRun>()

/**
 * THE LOWERED FIXTURES THE VALUE PASS DOES NOT REACH — compiled, and run only on edge inputs.
 *
 * The block above needs RECORDED VALUES, so it selects `confirmed` fixtures that have them: 1,912 of the 2,295 that
 * lower. The other 383 emitted Rust that nothing in this suite ever built, and their rows said `rust: "compiles"`
 * anyway — because the generator ran the compiler and threw the exit code away. **Six of them do not compile.**
 * All six are outside the input contract (`evidence: refused` — `i : INT := 1.5` emits `1.5i16`), which makes the
 * EMISSION defensible and the claim false; the map says `rejected` for them now.
 *
 * So this exists to make the claim checkable on every push, and to put the 383 under the lint ratchet with the
 * rest. Nothing recorded is compared — which is why it is its own block and not a widened selection above: that
 * one's whole shape is print-the-values-and-diff-them. What does run is the EDGE differential (interpreter against
 * the Rust on inputs nobody recorded), so the build is an executable; for exactly two fixtures that is stricter than
 * the metadata build this used to make (`array_index_const_*`: rustc's deny-by-default `unconditional_panic`),
 * and both are refused by CODESYS, so `rejected` is the honest oracle for them.
 */
describe.skipIf(skipRustSuite())("the rest of the lowered fixtures — the emitted Rust builds, or says why not", () => {
  const seen = new Set(
    rated("confirmed")
      .filter((c) => RUNS[c.name]?.values !== undefined)
      .map((c) => c.name),
  )
  const rest = SELECTION.selected.filter((t) => !seen.has(t.name) && t.transpile?.tier !== undefined)
  const built = new Map<string, { ok: boolean; why: string } & Measured>()

  beforeAll(
    async () => {
      const started = performance.now()
      await inRustBuildDir("volt-exec-rust-rest-", async (dir) => {
        const lanes = Math.max(1, navigator.hardwareConcurrency - 1)
        let next = 0
        await Promise.all(
          Array.from({ length: Math.min(lanes, rest.length) }, async () => {
            for (let i = next++; i < rest.length; i = next++) {
              const c = rest[i]!
              const pou = lowering(c).pou
              if (pou === undefined) continue
              const emitted = emitRust(pou, { loopGuard: HARNESS_LOOP_GUARD })
              // AN EXECUTABLE, like the value pass and the generator: the edge run needs one, and `rust` then means one
              // build everywhere — the generator's `compiles`/`rejected` is decided by this same argv.
              const plan = edgePlan(c, ALL_TESTS, pou, emitted.code)
              const file = join(dir, `${c.name}.rs`)
              const exe = join(dir, `${c.name}${process.platform === "win32" ? ".exe" : ""}`)
              // A `diverges` fixture the vendor RAN also gets the recorded scan, so its expected-failure row can tell
              // the day its Rust starts producing CODESYS's values (`DIVERGES_RUST`).
              const valued = c.evidence === "diverges" && RUNS[c.name]?.values !== undefined
              const source = `${emitted.code}\n${edgeHarness(pou, emitted, plan, valued ? recordedScan(c, pou, emitted) : "")}`
              const build = await buildRust(
                buildArgv(CLIPPY ?? rustc!, file, { exe }),
                file,
                exe,
                source,
                HARNESS_PROBES,
              )
              const ok = build.exit === 0
              const stderr = build.stderr
              if (valued && !ok)
                DIVERGES_RUST.set(c.name, { exit: -1, stdout: "", stderr: `does not compile:\n${rendered(stderr)}` })
              if (valued && ok) {
                const run = Bun.spawn([exe], { stdout: "pipe", stderr: "pipe" })
                const exit = await run.exited
                DIVERGES_RUST.set(c.name, {
                  exit,
                  stdout: await new Response(run.stdout).text(),
                  stderr: await new Response(run.stderr).text(),
                })
              }
              const { found, pedantic } = splitFindings(stderr, emitted.code.split("\n").length)
              built.set(c.name, {
                ok,
                lints: found.map((f) => f.code),
                pedantic: pedantic.length,
                ...(await edgeOf(ok, exe, pou, plan)),
                why: ok ? "" : rendered(stderr),
              })
            }
          }),
        )
      })
      console.log(`  [rust] ${rest.length} more cases compiled in ${Math.round((performance.now() - started) / 1000)}s`)
    },
    Math.max(120_000, rest.length * 300),
  )

  test("a fixture whose ST CODESYS accepts emits Rust that compiles", () => {
    const broken = rest
      .filter((c) => built.get(c.name)?.ok === false && rejectionIsADefect(c.evidence ?? ""))
      .map((c) => `${c.name} (${c.evidence}):\n${built.get(c.name)!.why}`)
    expect(broken).toEqual([])
  })

  test("the stored oracle matches what the compiler actually did", () => {
    const wrong = rest
      .filter((c) => built.has(c.name))
      .map((c) => [c, built.get(c.name)!.ok ? "compiles" : "rejected"] as const)
      .filter(([c, want]) => c.transpile?.rust !== want)
      .map(([c, want]) => `${c.name}: stored ${c.transpile?.rust}, compiler says ${want}`)
    if (wrong.length > 0) console.log("  [fixtures] run `bun run rate:fixtures`")
    expect(wrong).toEqual([])
  })

  test.skipIf(skipLintCheck())("every case's lints are exactly what its stored row carries", () => {
    const stale = lintDrift(
      new Map(rest.filter((c) => built.has(c.name)).map((c) => [c.name, built.get(c.name)!.lints])),
    )
    if (stale.length > 0) console.log("  [fixtures] the emitted Rust changed — run `bun run rate:fixtures`")
    expect(stale).toEqual([])
  })

  test.skipIf(skipLintCheck())("every case's pedantic count and edge verdict are what its stored row carries", () => {
    const stale = measuredDrift(built)
    if (stale.length > 0) console.log("  [fixtures] run `bun run rate:fixtures`")
    expect(stale).toEqual([])
  })
})

/**
 * WE BOTH EXECUTE IT AND DISAGREE — the only rating that means something is WRONG rather than missing. Each carries
 * `deferred.transpile` saying what was measured; the ceiling below is what keeps a new one visible.
 *
 * EACH RUNS AS AN EXPECTED FAILURE (`support/expected-failure.ts`), not a todo. The check is the one the fixture
 * would face as `confirmed` — the fault check when the vendor stopped, the values through the interpreter AND the
 * emitted Rust when it ran — and the row passes while that check still fails. The day both halves match, the row
 * fails and names the mark to delete. A todo could not notice, so a closed divergence stayed excused for whatever
 * reopened it.
 */
describe("diverges — measured, and run as an expected failure", () => {
  const inconclusive: string[] = []
  for (const c of rated("diverges")) {
    const mark = c.deferred?.transpile ?? "no reason recorded"
    test(`${c.name} — still diverges: ${mark}`, () => {
      const rec = RUNS[c.name]
      const halves =
        rec?.values === undefined
          ? [() => compareFault(c)]
          : [
              () => compareInterp(c, rec),
              // the Rust half is measured by the pass above; without `rustc` (or with it filtered out) it is not
              DIVERGES_RUST.has(c.name) ? () => compareRust(c, DIVERGES_RUST.get(c.name)!) : undefined,
            ]
      const verdict = expectStillDiverges(c.name, mark, halves)
      if (verdict.verdict === "inconclusive") inconclusive.push(c.name)
    })
  }

  // An interpreter half that MATCHES with no Rust half to settle it is unproven either way — reported, and allowed
  // only where the Rust pass did not run. Where it ran, every diverging fixture the vendor ran must be in it.
  test("an unproven row is one the Rust pass did not reach this run", () => {
    console.log(
      `  [fixtures] ${rated("diverges").length} diverge, each run as an expected failure` +
        (inconclusive.length > 0
          ? `; ${inconclusive.length} unproven (no Rust half this run): ${inconclusive.join(", ")}`
          : ""),
    )
    if (DIVERGES_RUST.size > 0) expect(inconclusive).toEqual([])
  })

  test("each names what was measured", () => {
    expect(
      rated("diverges")
        .filter((c) => c.deferred?.transpile === undefined)
        .map((c) => c.name),
    ).toEqual([])
  })
})
