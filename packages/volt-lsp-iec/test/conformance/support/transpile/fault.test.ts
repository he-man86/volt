import { expect, test } from "bun:test"
import { lowerSource } from "../../../../src/transpile/index.js"
import { PROJECT_BASE } from "../project-libraries.js"
import { replayFault } from "./fault.js"

const lowered = (body: string) => {
  const source = `PROGRAM PLC_PRG\nVAR\n\ti : DINT;\n\tz : DINT;\nEND_VAR\n${body}\nEND_PROGRAM\n`
  const { pou } = lowerSource(source, "PLC_PRG", [], undefined, PROJECT_BASE)
  if (pou === undefined) throw new Error("the source does not lower")
  return pou
}

/**
 * A RUNAWAY CANNOT HANG THE FAULT REPLAY, and it is not a fault (transpile-restructure 2.3). A recording's error text
 * does not tell a CODESYS stop from a runaway (`arithedge_uint_div_by_zero`, a divide by zero, carries the done-flag
 * text a runaway would get), so the replay of a vendor stop ran `run()` with no guard: a runaway fixture recorded
 * without its `execSkip` hung the suite, and a guard alone would have let `toThrow()` pass on the guard's throw.
 */
test("a runaway replayed as a vendor stop fails by name — never a hang, never a fault match", () => {
  expect(() => replayFault(lowered("WHILE TRUE DO i := i + 1; END_WHILE"), 1, 1000)).toThrow("runs past the harness guard")
})

test("a scan that faults matches the vendor stop", () => {
  expect(() => replayFault(lowered("i := 1 / z;"), 1, 1000)).not.toThrow()
})

test("a scan that completes does not match the vendor stop", () => {
  expect(() => replayFault(lowered("i := i + 1;"), 3, 1000)).toThrow("completed")
})

// gate 2c: only the interpreter's runtime faults (a `RangeError`: an `IecFault`, an index or character out of range)
// are the vendor's stop. A crash of the interpreter itself — a `TypeError` on IR it cannot run — matched it too, so a
// broken interpreter silently "confirmed" every recorded stop.
test("an interpreter crash is not a fault match — it is rethrown", () => {
  const broken = { ...lowered("i := i + 1;"), body: [{ kind: "not-a-statement" }] } as unknown as Parameters<typeof replayFault>[0]
  expect(() => replayFault(broken, 1, 1000)).toThrow(TypeError)
})
