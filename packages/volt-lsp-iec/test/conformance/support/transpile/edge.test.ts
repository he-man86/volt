import { expect, test } from "bun:test"
import { lowerSource } from "../../../../src/transpile/index.js"
import { PROJECT_BASE } from "../project-libraries.js"
import { rustAccess } from "../rust-access.js"
import { interpOutcome } from "./edge.js"

/**
 * A seed the runner refuses — a path outside its array — is the HARNESS's error, so it throws; it used to sit inside the
 * fault catch and read as the program faulting (an edge outcome, compared against the Rust's).
 */
test("an edge seed the interpreter refuses throws instead of reading as a program fault", () => {
  const source = "PROGRAM PLC_PRG\nVAR\n\ta : ARRAY[0..2] OF INT;\nEND_VAR\na[0] := 1;\nEND_PROGRAM\n"
  const { pou } = lowerSource(source, "PLC_PRG", [], undefined, PROJECT_BASE)
  if (pou === undefined) throw new Error("the source does not lower")
  const p = { path: "a[5]", ...rustAccess(pou, "a[5]") }
  const plan = { paths: [], cycles: 1, variants: [{ label: "oob", seed: { p, s: { label: "1", interp: 1n, rust: "1" } } }] }
  expect(() => interpOutcome(pou, plan, 0)).toThrow("array index 5 is outside its bounds")
})
