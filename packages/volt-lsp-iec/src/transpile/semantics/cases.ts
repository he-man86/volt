/**
 * THE CASE-TABLE CONTRACT (design.md P3). A mirrored model ships its cases as DATA in `semantics/<model>.cases.ts`:
 * `semantics/<model>.test.ts` runs them against `semantics/`, and the twin harness under `test/conformance/` (task 1.5.15) runs the
 * same table against the Rust runtime's mirror — and checks every case that names a recording against the recording,
 * so a table cannot drift from the oracle.
 */

/** Where a case's answer was measured: a conformance fixture, the variable its recording holds the answer in, and the
 *  variable holding the input the fixture ran — both held to the recording, so neither half of a case can drift. */
export interface CaseRecording {
  readonly fixture: string
  readonly variable: string
  readonly input: string
}

/** One input and the answer the model gives for it. */
export interface Case<I, O> {
  readonly name: string
  readonly input: I
  readonly expected: O
  readonly recording?: CaseRecording
}
