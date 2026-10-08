/**
 * THE ONE INTERPRETER ↔ RUST COMPARER — B↔C (`backends.test.ts`: a seeded run of each sampled fixture and each probe)
 * and the edge verdict (`transpile/edge.ts`: each edge variant) hand it the two backends' outcomes of one run
 * (transpile-restructure 1.8.6).
 *
 * The rule both had, each in its own loop (and `backends.test.ts` twice): a fault is an answer — one backend faulting
 * where the other ran is a difference, both faulting agree and compare no value (the messages differ by design) —
 * and a place one side printed and the other did not answer is a difference, not a place skipped. What each caller
 * still decides is its own: which places it compares, in which wire format, and what counts as the same value.
 */

/** One backend's run: whether it faulted, and each place it answered, in the caller's one wire format. */
export interface Outcome {
  faulted: boolean
  values: ReadonlyMap<string, string>
}

/** One way the two runs differ. */
export type Difference =
  | { kind: "fault"; interpreterFaulted: boolean }
  | { kind: "unanswered"; path: string; by: "interpreter" | "rust" }
  | { kind: "value"; path: string; interpreter: string; rust: string }

/**
 * The differences between the interpreter's run and the Rust's, in the order of the places compared, and how many
 * places were compared.
 *
 * `places` names them: `"rust"` is every place the Rust printed, in its order (B↔C reads the harness's output), a
 * list is exactly those places (the edge plan's). `same` is the caller's equality — exact by default; B↔C gives a
 * transcendental's REAL a few ULP, the edge run reads the Rust's NaN bits as one NaN.
 */
export function compareOutcomes(
  interpreter: Outcome,
  rust: Outcome,
  places: "rust" | readonly string[],
  same: (path: string, interpreter: string, rust: string) => boolean = (_, a, b) => a === b,
): { differences: Difference[]; compared: number } {
  if (interpreter.faulted !== rust.faulted)
    return { differences: [{ kind: "fault", interpreterFaulted: interpreter.faulted }], compared: 0 }
  if (interpreter.faulted) return { differences: [], compared: 0 }
  const differences: Difference[] = []
  let compared = 0
  for (const path of places === "rust" ? rust.values.keys() : places) {
    const want = interpreter.values.get(path)
    const got = rust.values.get(path)
    if (want === undefined) differences.push({ kind: "unanswered", path, by: "interpreter" })
    else if (got === undefined) differences.push({ kind: "unanswered", path, by: "rust" })
    else {
      compared++
      if (!same(path, want, got)) differences.push({ kind: "value", path, interpreter: want, rust: got })
    }
  }
  return { differences, compared }
}
