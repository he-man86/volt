import { expect, test } from "bun:test"
import { lowerSource } from "../../../../src/transpile/index.js"
import { PROJECT_BASE } from "../project-libraries.js"
import { rustAccess } from "../rust-access.js"
import { compareEdge, type EdgeOutcome, interpOutcome } from "./edge.js"

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

/**
 * A VARIANT THE INTERPRETER'S LOOP GUARD GIVES UP ON IS NOT AN AGREEMENT. It was skipped without being counted, so a
 * row read `edge: "agree"` while resting on fewer variants than its plan — and on NONE where the guard gave up on all
 * of them (the five runaway fixtures, transpile-restructure 2a). The count travels with the verdict, and a plan with
 * no answered variant is `not-run`.
 */
test("edge variants the interpreter's loop guard gives up on are counted, and none answered is not-run", () => {
  const source = "PROGRAM PLC_PRG\nVAR\n\ti : DINT;\n\tn : DINT;\nEND_VAR\nWHILE i < n DO i := i + 1; END_WHILE\nEND_PROGRAM\n"
  const { pou } = lowerSource(source, "PLC_PRG", [], undefined, PROJECT_BASE)
  if (pou === undefined) throw new Error("the source does not lower")
  const n = { path: "n", ...rustAccess(pou, "n") }
  const i = { path: "i", ...rustAccess(pou, "i") }
  const seed = (v: bigint) => ({ p: n, s: { label: String(v), interp: v, rust: String(v) } })
  const plan = { paths: [i, n], cycles: 1, variants: [{ label: "n=MAX", seed: seed(2147483647n) }, { label: "n=1", seed: seed(1n) }] }
  const rust = new Map<number, EdgeOutcome>([
    [0, { faulted: false, done: true, values: new Map([["i", "2147483647"], ["n", "2147483647"]]) }],
    [1, { faulted: false, done: true, values: new Map([["i", "1"], ["n", "1"]]) }],
  ])
  expect(interpOutcome(pou, plan, 0).gaveUp).toBe(true)
  expect(compareEdge(pou, plan, rust)).toEqual({ verdict: "agree", unanswered: 1 })
  const runaway = { ...plan, variants: [plan.variants[0]!] }
  expect(compareEdge(pou, runaway, rust)).toEqual({ verdict: "not-run", unanswered: 1 })
})
