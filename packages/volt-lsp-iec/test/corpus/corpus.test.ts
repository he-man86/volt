/**
 * THE CORPUS — 29,359 files of real customer code, and the three things they can tell us that no fixture can.
 *
 * A fixture is a question somebody thought to ask. This is the other half: code nobody wrote for a test, which
 * therefore contains what engineers actually write rather than what an adversary would. It is the ONLY input that
 * can find a gap nobody has imagined, and the only one that cannot answer what anything MEANS — there is no oracle
 * here except the IDE's own recorded build.
 *
 * THREE QUESTIONS, ONE WALK:
 *
 *   1. THE LSP CAN READ IT      every file parses, every ST body materializes into statements, every graphical
 *                               body parses as network text, the binder links EXTENDS across files, and the
 *                               formatter round-trips (`parse(format(x)) ≡ parse(x)`).
 *   2. THE LSP INVENTS NOTHING  every error and warning it emits is one the IDE's own build also emitted; every
 *                               code is a valid identity; no document carries a duplicate (range, code).
 *   3. LOWERING IS TOTAL        nothing throws — `src/transpile/index.ts` states that invalid input ends in a
 *                               `LowerDiagnostic`, never a throw and never an invented meaning — and the reach
 *                               figures that contract quotes are what is measured.
 *
 * WHY ONE WALK. This was four (`corpus`, `build-conformance`, `warning-conformance`, `lowering-totality`) and they
 * walked the corpus four times, the first of them five times within itself — a fresh `parseSource` of all 29k files
 * per assertion. The parse is now done ONCE per project and every question asked of it; only the heavy LSP
 * diagnostic pass was already shared (`support/diagnostics.ts`), and it still is.
 *
 * It was five, and the fifth is the reason this rule is written down. `ir-coverage.test.ts` walked the corpus a
 * SECOND time to ask which IR the suite builds — the same files, the same symbol tables, the same `lowerUnit`
 * call, for a different tally. Two walks is not only slow: under load the second one blew its own 240s timeout
 * while passing in 66s alone, which reads as a failure in whatever test happened to be running. It was folded
 * into `lowering-totality`'s walk, and that walk is now folded into this one.
 *
 * ONE WALK, THREE FILES (openspec lsp-same-standard 4.4: a suite is held to 600 lines). The walk is `support/walk.ts`
 * `pass()`, cached per process — bun runs a test run's files in one process, so the three questions still share it:
 * question 1 here, question 2 `corpus-diagnostics.test.ts`, question 3 `corpus-lowering.test.ts`.
 *
 * WHAT THE CORPUS CANNOT PROVE. It contains no invalid code and only the constructs its authors happened to use, so
 * a pass here is EVIDENCE, not proof. Two throws found by review are unreachable from it and are pinned beside the
 * code that answers them (`src/transpile/lower/entry/totality.test.ts`); whether enough is being ASKED at all is
 * `test/conformance/suite.test.ts`.
 *
 * MEMORY, deliberately. The walk holds ONE project's parse results at a time and accumulates only counts and
 * failure strings. Holding all 29k at once is what a naive "parse everything first" would do.
 */
import { describe, expect, test } from "bun:test"
import { hasCorpus, LOWERING_TIMEOUT, pass } from "./support/walk.js"

// ─── question 1: the LSP can read it ─────────────────────────────────────────────────────────────────────────

describe.skipIf(!hasCorpus)("1. the LSP can read real code", () => {
  test("the corpus is present and non-trivial", () => {
    expect(pass().files).toBeGreaterThanOrEqual(1500)
  }, LOWERING_TIMEOUT)

  test("every ST-source file parses with zero declaration errors", () => {
    expect(pass().parseFailures).toEqual([])
  }, LOWERING_TIMEOUT)

  test("every ST body materializes fully into the statement tree (100%)", () => {
    expect(pass().stBodies).toBeGreaterThan(2000)
    expect(pass().materializeFailures).toEqual([])
  }, LOWERING_TIMEOUT)

  test("every graphical body is network text, read by the ST parser", () => {
    expect(pass().networkStBodies).toBe(46) // every `%LANGUAGE LD|FBD` body of the six corpora
  }, LOWERING_TIMEOUT)

  test("the binder links EXTENDS bases across files", () => {
    // Real PLC projects use inheritance — some EXTENDS must have resolved across files.
    expect(pass().extendsBases).toBeGreaterThan(0)
  }, LOWERING_TIMEOUT)

  test("the formatter round-trips every file (parse(format(x)) ≡ parse(x))", () => {
    expect(pass().formatFailures).toEqual([])
  }, LOWERING_TIMEOUT)
})
