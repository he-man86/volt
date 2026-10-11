/**
 * `once` — the one writer of the routine cache (task 1.7.8) — and a type that contains itself (task 1.8.2).
 */
import { describe, expect, test } from "bun:test"
import type { Scope } from "../../../frontend/symbols/index.js"
import { run } from "../../interp/index.js"
import type { IrRoutine } from "../../ir/index.js"
import { Lowering } from "../core/lowering.js"
import { lowerSource } from "../index.js"
import { once } from "./routines.js"

const scope = {} as Scope
const span = undefined as never
const routine = (name: string): IrRoutine => ({ name, key: name.toUpperCase(), kind: "method", locals: [], inputs: [], inouts: [], body: [] }) as never

test("once: built once and cached; a failure is refused by name on every later ask, a call reached while building as recursion", () => {
  const lw = new Lowering(scope, scope)
  let builds = 0
  const r = once(lw, "F", span, () => (builds++, routine("F")))
  expect(once(lw, "f", span, () => (builds++, routine("F")))).toBe(r!)
  expect(builds).toBe(1)
  expect(once(lw, "G", span, () => undefined)).toBeUndefined()
  expect(once(lw, "G", span, () => routine("G"))).toBeUndefined()
  // H reached again from a lowering that is not H's own: recursion through another routine, which runs
  // (`calls_functions_mutually_recursive`)
  expect(once(lw, "H", span, () => once(lw, "H", span, () => routine("H")))).toBeUndefined()
  expect(lw.diagnostics.map((d) => d.code)).toEqual(["call-body", "call-recursion"])
})

test("once: a routine reached again from its OWN lowering is `call-recursive` only when the call named it bare", () => {
  const lw = new Lowering(scope, scope)
  lw.shared.routineLowerings.set("K", lw)
  // `K(...)` in K's body: its name is its result there, refused by both vendors (`cc2_call_recursion`, `calls_method_recursive`)
  expect(once(lw, "K", span, () => once(lw, "K", span, () => routine("K"), { bare: true }))).toBeUndefined()
  // `THIS^.K(...)`: no recording refuses it
  lw.routines.delete("K")
  expect(once(lw, "K", span, () => once(lw, "K", span, () => routine("K")))).toBeUndefined()
  expect(lw.diagnostics.map((d) => d.code)).toEqual(["call-recursive", "call-recursion"])
})

test("once quiet: a built routine's failure is not refused again, and it has no recursion guard", () => {
  const lw = new Lowering(scope, scope)
  expect(once(lw, "I", span, () => undefined, { quiet: true })).toBeUndefined()
  expect(once(lw, "I", span, () => routine("I"), { quiet: true })).toBeUndefined()
  expect(once(lw, "J", span, () => once(lw, "J", span, () => routine("J"), { quiet: true }), { quiet: true })?.name).toBe("J")
  expect(lw.diagnostics).toEqual([])
  expect([...lw.routines.keys()]).toEqual(["I", "J"])
})

/**
 * A LIBRARY CALLABLE WITHOUT A BODY IS REFUSED — a signature is not an implementation.
 *
 * A library reaches lowering as a DECLARATION file, and has a body only where the library repo (`libraries/`) wrote one. `bodyStatements`
 * answers an empty statement list for that, which lowered to a routine that ran nothing — so `t1(IN := TRUE)` was a
 * no-op and `t1.Q` read FALSE forever, an INVENTED meaning rather than a missing one. 308 corpus files declare a TON,
 * TOF, CTU, R_TRIG or F_TRIG.
 *
 * An empty body is legal IEC, so emptiness alone cannot be the discriminator — PROVENANCE is, and the three cases below
 * pin all of it: a bodyless LIBRARY unit refuses, a library shipping REAL SOURCE still lowers, and a PROJECT POU with an
 * empty body still lowers and does nothing. The Standard library is no exception: its
 * elements are ordinary library units, run from the repo's ST (`test/libraries/standard.test.ts`).
 */
describe("a library declaration without a body", () => {
  const BODYLESS_FB = { uri: "file:///p/Library Manager/MyLib/VendorFB.pou", source: "FUNCTION_BLOCK VendorFB\nVAR_INPUT\n\tIN : BOOL;\nEND_VAR\nVAR_OUTPUT\n\tQ : BOOL;\nEND_VAR\nEND_FUNCTION_BLOCK\n" }
  const SOURCED_FB = { uri: "file:///p/Library Manager/MyLib/RealFB.pou", source: "FUNCTION_BLOCK RealFB\nVAR_INPUT\n\tIN : BOOL;\nEND_VAR\nVAR_OUTPUT\n\tQ : BOOL;\nEND_VAR\nQ := IN;\nEND_FUNCTION_BLOCK\n" }
  const BODYLESS_FN = { uri: "file:///p/Library Manager/MyLib/VendorCalc.pou", source: "FUNCTION VendorCalc : INT\nVAR_INPUT\n\tx : INT;\nEND_VAR\nEND_FUNCTION\n" }

  test("an FB call is refused rather than run as a no-op", () => {
    const r = lowerSource("PROGRAM PLC_PRG\nVAR\n\tf : VendorFB;\n\tq : BOOL;\nEND_VAR\nf(IN := TRUE);\nq := f.Q;\nEND_PROGRAM\n", "PLC_PRG", [BODYLESS_FB])
    expect(r.pou).toBeUndefined()
    expect(r.diagnostics.map((d) => d.code)).toContain("call-library")
  })

  test("a FUNCTION call is refused rather than answering the result's default", () => {
    const r = lowerSource("PROGRAM PLC_PRG\nVAR\n\tn : INT;\nEND_VAR\nn := VendorCalc(7);\nEND_PROGRAM\n", "PLC_PRG", [BODYLESS_FN])
    expect(r.pou).toBeUndefined()
    expect(r.diagnostics.map((d) => d.code)).toContain("call-library")
  })

  test("a library that ships real source still lowers", () => {
    const r = lowerSource("PROGRAM PLC_PRG\nVAR\n\tf : RealFB;\n\tq : BOOL;\nEND_VAR\nf(IN := TRUE);\nq := f.Q;\nEND_PROGRAM\n", "PLC_PRG", [SOURCED_FB])
    expect(r.diagnostics).toEqual([])
    const p = run(r.pou!)
    p.scan()
    expect(p.get("q")).toBe(true)
  })

  test("a POU of the project's own with an empty body still lowers, and does nothing", () => {
    const r = lowerSource("FUNCTION_BLOCK Idle\nVAR_OUTPUT\n\tQ : BOOL;\nEND_VAR\nEND_FUNCTION_BLOCK\n\nPROGRAM PLC_PRG\nVAR\n\tf : Idle;\n\tq : BOOL;\nEND_VAR\nf();\nq := f.Q;\nEND_PROGRAM\n", "PLC_PRG")
    expect(r.diagnostics).toEqual([])
    const p = run(r.pou!)
    p.scan()
    expect(p.get("q")).toBe(false)
  })
})

const st = (...lines: string[]): string => lines.join("\n") + "\n"
const T = "\t"

/** The codes a source is refused with — empty when it lowers. */
const codesFor = (source: string, name = "PLC_PRG"): string[] => {
  const r = lowerSource(source, name)
  return r.pou === undefined ? r.diagnostics.map((d) => d.code) : []
}

/** A source that lowers, run one scan, read one place. */
const valueOf = (source: string, path: string, name = "PLC_PRG"): unknown => {
  const r = lowerSource(source, name)
  expect(r.diagnostics).toEqual([])
  const p = run(r.pou!)
  p.scan()
  return p.get(path)
}

describe("a type that contains itself", () => {
  /**
   * FOUND BY AIMING HERE (2026-09-18). `FUNCTION_BLOCK FB_R VAR rv : FB_R; END_VAR` sent `storageOf` and
   * `buildLayout` into each other until the process died with a RangeError — where this component's stated rule is
   * that invalid input ends in a LowerDiagnostic and NEVER a throw. The corpus holds no self-referential type, which
   * is exactly why `TOTALITY` never saw it: that gate walks real projects, and no real project contains this.
   *
   * CODESYS rejects the shape too, so refusing loses nothing. What was lost before was the difference between
   * "refused" and "crashed".
   */
  test("an FB declaring an instance of ITSELF is refused, not chased", () => {
    const source = st(
      "FUNCTION_BLOCK FB_R", "VAR", T + "rx : FB_R;", "END_VAR", "rx();", "END_FUNCTION_BLOCK", "",
      "PROGRAM PLC_PRG", "VAR", T + "x : FB_R;", "END_VAR", "x();", "END_PROGRAM",
    )
    expect(codesFor(source)).toContain("layout-recursive")
  })

  test("a STRUCT holding itself, and a two-step cycle through another type", () => {
    const direct = st(
      "TYPE D :", "STRUCT", T + "inner : D;", T + "n : INT;", "END_STRUCT", "END_TYPE", "",
      "PROGRAM PLC_PRG", "VAR", T + "d : D;", "END_VAR", "d.n := 1;", "END_PROGRAM",
    )
    expect(codesFor(direct)).toContain("layout-recursive")

    const indirect = st(
      "TYPE A :", "STRUCT", T + "b : B;", "END_STRUCT", "END_TYPE", "",
      "TYPE B :", "STRUCT", T + "a : A;", "END_STRUCT", "END_TYPE", "",
      "PROGRAM PLC_PRG", "VAR", T + "x : A;", "END_VAR", "END_PROGRAM",
    )
    expect(codesFor(indirect)).toContain("layout-recursive")
  })

  test("but an FB holding ANOTHER FB still lowers — the guard is about CYCLES, not nesting", () => {
    const source = st(
      "FUNCTION_BLOCK FB_Inner", "VAR_OUTPUT", T + "q : INT;", "END_VAR", "q := 5;", "END_FUNCTION_BLOCK", "",
      "FUNCTION_BLOCK FB_Outer", "VAR", T + "inner : FB_Inner;", "END_VAR", "inner();", "END_FUNCTION_BLOCK", "",
      "PROGRAM PLC_PRG", "VAR", T + "o : FB_Outer;", T + "a : INT;", "END_VAR", "o();", "a := o.inner.q;", "END_PROGRAM",
    )
    expect(valueOf(source, "a")).toBe(5n)
  })

  test("and a POINTER to its own type is legal — it is an address, not containment", () => {
    // the shape every linked list has; refusing it would refuse a construct CODESYS compiles
    const source = st(
      "TYPE Node :", "STRUCT", T + "next : POINTER TO Node;", T + "n : INT;", "END_STRUCT", "END_TYPE", "",
      "PROGRAM PLC_PRG", "VAR", T + "d : Node;", "END_VAR", "d.n := 3;", "END_PROGRAM",
    )
    expect(valueOf(source, "d.n")).toBe(3n)
  })
})

// review of 7.7.3 (gate 7.5c+7.7a): a VAR_OUTPUT's reset at entry is dead only where the first store writes over ALL of
// it — a STRING of another capacity is stored INTO the output (min(n, m) units and a 0, the rest kept), so an output
// bound through a dereference, lent the caller's own string, would keep that string's tail behind the stored text
test("a VAR_OUTPUT first stored from a STRING of another capacity keeps its reset at entry", () => {
  const { pou, diagnostics } = lowerSource(
    "FUNCTION F : INT\nVAR_INPUT sh : STRING(2); END_VAR\nVAR_OUTPUT o : STRING(5); END_VAR\no := sh;\nF := 0;\nEND_FUNCTION\nPROGRAM P\nVAR x : STRING(5) := 'wxyz'; p : POINTER TO STRING(5); res : INT; c3 : BYTE; END_VAR\np := ADR(x);\nres := F(sh := 'ab', o => p^);\nc3 := x[3];\nEND_PROGRAM\n",
    "P",
  )
  expect(diagnostics).toEqual([])
  const runner = run(pou!)
  runner.scan()
  expect([runner.get("x"), runner.get("c3")]).toEqual(["ab", 0n])
})

/** AN ABSTRACT MEMBER RUNS NOTHING A LOWERING COULD RUN (openspec abstract-member-push): the pull states an abstract
 *  member with no code `IMPLEMENTATION NONE` (abstract-member-parity: on both vendors), and lowering refuses it by name — it used to be an empty `IMPLEMENTATION ST` body,
 *  which ran an abstract base's call to its own abstract member as nothing (pro2193 `ActuatorWithAlarm_BaseFB`). */
test("a call to an abstract member (IMPLEMENTATION NONE) is refused by name, never run as an empty body", () => {
  const r = lowerSource(
    "FUNCTION_BLOCK ABSTRACT Base\nIMPLEMENTATION ST\nRun();\nEND_FUNCTION_BLOCK\n\nMETHOD PROTECTED ABSTRACT Run\nIMPLEMENTATION NONE\nEND_METHOD\n",
    "Base",
  )
  expect(r.pou).toBeUndefined()
  const refusal = r.diagnostics.find((d) => d.code === "graphical-body")
  expect(refusal?.message).toContain("is abstract: it holds no code (IMPLEMENTATION NONE)")
})
