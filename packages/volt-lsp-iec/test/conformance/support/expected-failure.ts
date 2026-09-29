/**
 * A KNOWN DIVERGENCE IS AN EXPECTED FAILURE, NOT A SKIP.
 *
 * A fixture marked as not matching CODESYS — `deferred.transpile`, `deferred.lsp`, an entry in `KNOWN_DIVERGENCES` —
 * used to be a `test.todo` or a `continue`: named, counted, and never run. So the day a fix landed that closed one,
 * nothing noticed, and the mark went on excusing the fixture for a regression that reopened it. A mark that cannot
 * notice it has gone stale is the same one-way ratchet the lint rows had (`lintDrift`).
 *
 * So every marked fixture still RUNS the check an unmarked one would, and the answer is inverted: it passes while the
 * check still fails, and fails the suite — naming the fixture and the mark to delete — once the check passes.
 *
 * A check is made of HALVES because a fixture only matches when every oracle agrees: the interpreter and the emitted
 * Rust fail differently (an emitter bug shows in the Rust alone), so a fixture whose interpreter matches while its
 * Rust still does not is still diverging. A half this run could not measure (no `rustc`, or its build was filtered
 * out) is `undefined`; when every half that DID run passes and one could not, the verdict is `inconclusive` rather
 * than a guess in either direction.
 */

/** One oracle's check: throws on a mismatch, returns on a match. `undefined` = not measurable in this run. */
export type Half = (() => void) | undefined

export type ExpectedFailure =
  | { verdict: "still-diverges"; why: string }
  | { verdict: "inconclusive" }

/** The task a mark names (`… task 16: …` → `task 16`), or the mark's own opening words when it names none. */
export function markRef(mark: string): string {
  const task = /\btask (\d+(?:\.\d+)?)\b/.exec(mark)
  if (task !== null) return `task ${task[1]}`
  const words = mark.length > 60 ? `${mark.slice(0, 60)}…` : mark
  return `"${words}"`
}

/**
 * Runs `halves` and returns why the fixture still diverges — the first half that failed — or `inconclusive`. THROWS
 * when every half passed: the mark is stale, and the message names what to delete.
 */
export function expectStillDiverges(name: string, mark: string, halves: readonly Half[], oracle = "CODESYS"): ExpectedFailure {
  let unmeasured = false
  for (const half of halves) {
    if (half === undefined) {
      unmeasured = true
      continue
    }
    try {
      half()
    } catch (error) {
      return { verdict: "still-diverges", why: (error as Error).message.split("\n")[0] ?? "" }
    }
  }
  if (unmeasured) return { verdict: "inconclusive" }
  throw new Error(`fixture ${name} now matches ${oracle} — remove its divergence mark (${markRef(mark)})`)
}
