/**
 * THE RATING ROWS — each fixture under the row its EVIDENCE RATING names: confirmed (the interpreter AND the emitted
 * Rust produce the vendor's values), refused, not-lowered, diverges, lsp-gap, create-refused-by-name, unaskable. The
 * contract, the selection and the rating index are `support/fixture-suite.ts`'s (transpile-restructure 1.8.7).
 *
 * A RED ROW IS THE PRODUCT BEING WRONG, never the recording. Fix `lower/`, `interp/`, `emit/` or the check — never the
 * expectation. COST: this is the expensive file — every lowering case is compiled by `rustc` as its own binary, one
 * process per core.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { join } from "node:path"
import { emitRust } from "../../src/transpile/index.js"
import { ALL_TESTS } from "./fixtures/index.js"
import { RUNS } from "./support/recordings.js"
import { ideValue } from "./support/display.js"
import { CLIPPY, inRustBuildDir, RUSTC as rustc, skipLintCheck, skipRustSuite } from "./support/rustc.js"
import { buildRust } from "./support/rustc-cache-build.js"
import { edgeHarness, edgePlan, HARNESS_LOOP_GUARD } from "./support/transpile/edge.js"
import { buildArgv, rendered, splitFindings } from "./support/transpile/lint-policy.js"
import type { LanguageTest } from "./types.js"
import { lowering, rated } from "./support/fixture-suite.js"
import {
  HARNESS_PROBES,
  compareInterp,
  lintDrift,
  Measured,
  measuredDrift,
  edgeOf,
  RustRun,
  recordedScan,
  compareRust,
  compareFault,
} from "./support/transpile/replay-steps.js"

/**
 * THE VENDOR RAN IT AND SO DO WE. Two halves, because they fail differently: the interpreter and the emitter print
 * the same IR, so a LOWERING bug shows in both — but an EMITTER bug (a Rust operator that does not mean what the
 * IEC one does) shows only in the Rust half.
 *
 * A REAL compares as the 32-bit float the IDE holds, so a backend computing in float64 fails here. That is a real
 * divergence, not rounding noise.
 *
 * THE VENDOR STOPPING IS ALSO AN ANSWER, and `confirmed` covers it. A fixture written to build can FAULT when it
 * runs — `use_pointer_deref_struct_field` writes through a pointer its FB body never set, `cc_div_udint_dint`
 * divides by a zero-initialised DINT — and the simulator STOPS THE APPLICATION, which reaches the recorder as a
 * timeout or a done flag that never rose. There is no value to compare, and that used to make it a counted `todo`:
 * the case was named and then never run. But "no value to compare" is not "nothing to check". CODESYS's answer is
 * REFUSAL, and refusal is behaviour the transpiler has to match — the failure this guards against is the
 * interpreter quietly returning a number for `p^` on a null pointer or for `a / 0`, which is a silent divergence on
 * exactly the inputs where being wrong is worst.
 *
 * EITHER refusal counts and the two are not ranked: throwing at run time, or not lowering at all (`pointer-order`
 * catches a deref of an unbound pointer a stage EARLIER than CODESYS does). Asserting the disjunction keeps this
 * green when a construct graduates from "cannot lower" to "lowers, then faults", which is progress. What it will
 * never let through is a completed scan.
 */
describe("confirmed — the vendor ran it, and we produce its values", () => {
  for (const c of rated("confirmed")) {
    const rec = RUNS[c.name]!
    if (rec.error !== undefined) {
      test(`${c.name} — faults in CODESYS (${rec.error.slice(0, 40)}), and must fault here too`, () => compareFault(c))
      continue
    }
    test(c.name, () => {
      expect(ideValue(rec.cycles!)).toBe(BigInt(c.cycles ?? 1)) // the recorder's gate held
      compareInterp(c, rec)
    })
  }
})

/**
 * THE SAME RECORDINGS, THROUGH THE EMITTED RUST. Each case is its own binary, so one that does not compile or
 * panics cannot take the others down; and a DEBUG build on purpose, where an arithmetic overflow panics — a panic
 * is a divergence, not noise. Skipped where rustc is absent, like `emit.test.ts`.
 */
describe.skipIf(skipRustSuite())("confirmed — the same values out of the emitted Rust", () => {
  // LOWERED HERE, AT REGISTRATION, not inside `beforeAll`. Lowering is synchronous JS: done on the worker lanes it
  // does not overlap with anything, so all 1880 of them land INSIDE the hang guard and push it over 180s. The lanes
  // exist to overlap `rustc` processes, and this keeps them doing only that.
  const recorded = rated("confirmed").filter((c) => RUNS[c.name]?.values !== undefined && lowering(c).pou !== undefined)
  const runs = new Map<string, RustRun>()
  /** What the linter said about each case's EMITTED code, and what its edge run found — the halves of its row in
   *  `map.generated.ts` only this build can answer. */
  const measured = new Map<string, Measured>()

  beforeAll(
    async () => {
      const started = performance.now()
      await inRustBuildDir("volt-exec-rust-", async (dir) => {
        // BOUNDED CONCURRENCY, not `Promise.all` over every case. Each case spawns `rustc`, and at 2253 fixtures that
        // was 2253 compilers at once — which is not parallelism, it is thrashing, and it pushed this past its own hang
        // guard as the census sweeps landed. One per core keeps every core busy and the scheduler out of it.
        //
        // The guard stays 180s and stays a HANG guard: it is not the budget that changed, it is the shape.
        const lanes = Math.max(1, navigator.hardwareConcurrency - 1)
        let next = 0
        await Promise.all(
          // each case its own try: one that throws while being prepared fails as itself, not as every Rust case at once
          Array.from({ length: Math.min(lanes, recorded.length) }, async () => {
            for (let i = next++; i < recorded.length; i = next++) {
              const c = recorded[i]!
              try {
                await prepare(c, dir)
              } catch (error) {
                runs.set(c.name, { exit: -1, stdout: "", stderr: `could not be prepared: ${(error as Error).message}` })
              }
            }
          }),
        )
      })
      console.log(
        `  [rust] ${recorded.length} cases compiled+run in ${Math.round((performance.now() - started) / 1000)}s`,
      )

      async function prepare(c: LanguageTest, dir: string): Promise<void> {
        const { pou, diagnostics } = lowering(c)
        if (pou === undefined)
          return void runs.set(c.name, { exit: -1, stdout: "", stderr: `does not lower: ${diagnostics[0]?.message}` })
        // built with the harness's loop guard, which the edge run's seeds need and no recorded pass count reaches
        const emitted = emitRust(pou, { loopGuard: HARNESS_LOOP_GUARD })
        // THE EDGE RUN RIDES THE SAME BINARY: `main` runs the recorded scan, or with `edge` the edge variants
        const plan = edgePlan(c, ALL_TESTS, pou, emitted.code)
        const main = edgeHarness(pou, emitted, plan, recordedScan(c, pou, emitted))
        const file = join(dir, `${c.name}.rs`)
        const exe = join(dir, `${c.name}${process.platform === "win32" ? ".exe" : ""}`)
        // ST has no dynamic memory, so the Rust needs no `unsafe` — forbidden, so a case needing it fails rather than builds
        //
        // DENY warnings, with the exceptions `support/transpile/lint-policy.ts` names and REASONS. This used to be
        // `-A warnings`, which meant 600+ emitted programs were compiled with no lint checking at all while the
        // crate check applied real lints to about fifteen — one policy per harness, and the larger one denied
        // nothing. Measured when it was flipped: 2 of 625 failed, and BOTH were faithful emissions of correct ST
        // rather than emitter defects (a statement after RETURN, and a SINT loop bound of 127 that rustc reads as
        // a tautology), which is why those two lints are named there instead of the flip being abandoned.
        //
        // `-A unused_parens` USED TO BE ON THAT LIST, under "generated code is not read for style". It is not on it
        // any more: `emit/rust/index.ts` declares an emitted SURFACE a user's harness reaches into, so somebody reads
        // this code, and the printer was emitting 2,722 pairs of parentheses no one would write.
        //
        // BUILT WITH `clippy-driver` WHERE THERE IS ONE — a drop-in for `rustc` that also runs the lints, so the
        // OPTIMALITY half of the map costs the compile this pass was already paying for.
        //
        // NOTHING IS DENIED. `LINT_FLAGS` is `-W warnings -W clippy::all`, warn and not deny, for the reason spelled
        // out where it is defined: `-D` makes a diagnostic `level: "error"`, so a findings parser reading warnings
        // sees nothing and every row is written clean while the build fails for a reason no row records. What a
        // rustc lint used to get from `-D warnings` it gets from the RATCHET below instead — a fixture may report
        // only the lints its stored row carries — which is the same guarantee per fixture and covers clippy's too.
        // A real compile ERROR still fails the build here; it is not a lint.
        //
        // THROUGH THE CACHE (`support/rustc-cache.ts`): a source, argv and compiler already built are not built again.
        const build = await buildRust(
          buildArgv(CLIPPY ?? rustc!, file, { exe }),
          file,
          exe,
          `${emitted.code}\n${main}`,
          HARNESS_PROBES,
        )
        const buildExit = build.exit
        const buildErr = build.stderr
        const findings = splitFindings(buildErr, emitted.code.split("\n").length)
        const measure = (edge: Pick<Measured, "edge" | "edgeUnanswered">) =>
          measured.set(c.name, {
            lints: findings.found.map((f) => f.code),
            pedantic: findings.pedantic.length,
            ...edge,
          })
        if (buildExit !== 0) measure({ edge: "not-run" })
        if (buildExit !== 0)
          return void runs.set(c.name, {
            exit: -1,
            stdout: "",
            stderr: `does not compile:\n${rendered(buildErr)}`,
          })
        const run = Bun.spawn([exe], { stdout: "pipe", stderr: "pipe" })
        const exit = await run.exited
        runs.set(c.name, {
          exit,
          stdout: await new Response(run.stdout).text(),
          stderr: await new Response(run.stderr).text(),
        })
        measure(await edgeOf(true, exe, pou, plan))
      }
      // A HANG GUARD PROPORTIONAL TO THE WORK, not a constant. Measured 2026-09-20: 1857 cases compile and run in
      // 179s — against a guard of 180s, which it had silently grown into. That is the failure mode a constant has:
      // it is a budget the suite outgrows without anybody deciding to, and it fails as a timeout, which reads as a
      // hang rather than as "there are more fixtures now". 300ms per case is ~3x the measured cost, so a real hang
      // still fails and a thousand more fixtures do not.
    },
    Math.max(120_000, recorded.length * 300),
  )

  for (const c of recorded) {
    test(c.name, () => compareRust(c, runs.get(c.name)!))
  }

  /**
   * THE LINT ROWS, CHECKED IN BOTH DIRECTIONS — the optimality half of `map.generated.ts`, and what a rustc lint
   * gets instead of the `-D warnings` that moved out of the build above.
   *
   * IT USED TO FAIL ONLY UPWARD, on the reasoning that a fix which removes a finding is the point of the sweep and
   * should not arrive red. That was wrong in the way one-way ratchets always are: a row that still lists a lint the
   * emitter no longer produces EXCUSES that lint for that fixture forever, so a later regression reintroducing it
   * is green. Nothing else reclaimed a stale row — `rate:fixtures --check` is in no CI job.
   *
   * So it is symmetric, like `the stored rating on every fixture matches the computed one` already is: stored data
   * must equal computed data, and an improvement is a regeneration rather than an exception.
   */
  test.skipIf(skipLintCheck())("every case's lints are exactly what its stored row carries", () => {
    const stale = lintDrift(new Map([...measured].map(([name, m]) => [name, m.lints])))
    if (stale.length > 0) console.log("  [fixtures] the emitted Rust changed — run `bun run rate:fixtures`")
    expect(stale).toEqual([])
  })

  test.skipIf(skipLintCheck())("every case's pedantic count and edge verdict are what its stored row carries", () => {
    const stale = measuredDrift(measured)
    if (stale.length > 0) console.log("  [fixtures] run `bun run rate:fixtures`")
    expect(stale).toEqual([])
  })
})
