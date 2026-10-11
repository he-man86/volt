import { expect, test } from "bun:test"
import { lowerSource } from "../../../../src/transpile/index.js"
import { PROJECT_BASE } from "../project-libraries.js"
import { rustAccess } from "../rust-access.js"
import { compareEdge, type EdgeOutcome, edgeSeeds, interpOutcome, reachesLibm } from "./edge.js"

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

/**
 * A NaN IS COMPARED BY ITS BITS (gate 8c). Both backends keep a NaN's sign and payload since transpile-restructure 8.2, and
 * the column read every NaN as one class, so a backend that flipped a NaN's sign — the Rust's `-x` did, before
 * `iec_fneg32` — agreed with one that kept it. Seeded with the negative signalling NaN 16#FFA12345, `y := -x` is its quiet
 * 16#FFE12345 in the interpreter: a Rust answering 16#7FE12345 disagrees.
 */
test("the edge column compares a REAL NaN by its bits, sign and payload", () => {
  const source = "PROGRAM PLC_PRG\nVAR\n\tx : REAL;\n\ty : REAL;\nEND_VAR\ny := -x;\nEND_PROGRAM\n"
  const { pou } = lowerSource(source, "PLC_PRG", [], undefined, PROJECT_BASE)
  if (pou === undefined) throw new Error("the source does not lower")
  const x = { path: "x", ...rustAccess(pou, "x") }
  const y = { path: "y", ...rustAccess(pou, "y") }
  const sNaN = edgeSeeds(x.type).find((s) => s.label === "REAL#-sNaN")!
  const plan = { paths: [x, y], cycles: 1, variants: [{ label: "x=-sNaN", seed: { p: x, s: sNaN } }] }
  const rustY = (bits: number): Map<number, EdgeOutcome> => new Map([[0, { faulted: false, done: true, values: new Map([["x", String(0xffa12345)], ["y", String(bits)]]) }]])
  expect(compareEdge(pou, plan, rustY(0xffe12345)).verdict).toBe("agree")
  expect(compareEdge(pou, plan, rustY(0x7fe12345)).verdict).toBe("disagree")
})

/** The routine `iec_fn` is handed by its path (`f64::ln`) is the platform's libm as `x.ln()` is (gate 8c). */
test("a libm routine handed to iec_fn by its path reaches libm", () => {
  expect(reachesLibm("self.y = iec_narrow(iec_fn(iec_widen(self.x), f64::ln));")).toBe(true)
  expect(reachesLibm("self.y = iec_fn(self.x, f32::sqrt);")).toBe(false)
  expect(reachesLibm("self.exp = 1.0;")).toBe(false)
})
