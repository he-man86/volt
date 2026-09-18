/**
 * COLOCATED TESTS FOR `calls.ts` — aimed, not assumed.
 *
 * `calls.ts` is the largest file in `lower/` and had no test file of its own; everything lived in `lower.test.ts`,
 * which is organised by the DEFECT each case was written for rather than by what it covers. So this is not a second
 * copy of that — it targets the refusals the coverage measurement (0.6) named as reached by NOTHING: fourteen of the
 * forty unreached codes are `calls.ts`'s own, and a refusal no program produces is one nobody has shown to fire on
 * the shape it describes, or to stay quiet on the shapes it does not.
 *
 * Each test below therefore does two things: it triggers the refusal, and it shows the NEAREST legal shape still
 * lowering. A guard that refuses everything would pass the first half alone.
 */
import { describe, expect, test } from "bun:test"
import { lowerSource } from "./lower.js"
import { run } from "../interp/index.js"

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
   * FOUND BY AIMING HERE (2026-09-18). `FUNCTION_BLOCK FB_R VAR r : FB_R; END_VAR` sent `storageOf` and
   * `buildLayout` into each other until the process died with a RangeError — where this component's stated rule is
   * that invalid input ends in a LowerDiagnostic and NEVER a throw. The corpus holds no self-referential type, which
   * is exactly why `TOTALITY` never saw it: that gate walks real projects, and no real project contains this.
   *
   * CODESYS rejects the shape too, so refusing loses nothing. What was lost before was the difference between
   * "refused" and "crashed".
   */
  test("an FB declaring an instance of ITSELF is refused, not chased", () => {
    const source = st(
      "FUNCTION_BLOCK FB_R", "VAR", T + "r : FB_R;", "END_VAR", "r();", "END_FUNCTION_BLOCK", "",
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

describe("what a call may bind", () => {
  test("an FB called with a POSITIONAL argument is refused — a body call names its parameters", () => {
    const source = st(
      "FUNCTION_BLOCK FB_S", "VAR_INPUT", T + "n : INT;", "END_VAR", "END_FUNCTION_BLOCK", "",
      "PROGRAM PLC_PRG", "VAR", T + "s : FB_S;", "END_VAR", "s(5);", "END_PROGRAM",
    )
    expect(codesFor(source)).toContain("call-positional")
  })

  test("the same call naming its parameter lowers, and the input is stored before the body", () => {
    const source = st(
      "FUNCTION_BLOCK FB_S", "VAR_INPUT", T + "n : INT;", "END_VAR", "VAR_OUTPUT", T + "seen : INT;", "END_VAR",
      "seen := n;", "END_FUNCTION_BLOCK", "",
      "PROGRAM PLC_PRG", "VAR", T + "s : FB_S;", T + "a : INT;", "END_VAR", "s(n := 5);", "a := s.seen;", "END_PROGRAM",
    )
    expect(valueOf(source, "a")).toBe(5n)
  })

  test("a VAR_IN_OUT bound to a place the call ALREADY holds is refused", () => {
    // the callee would reach one variable through two names, and which write wins is not recorded
    const source = st(
      "FUNCTION_BLOCK FB_K", "VAR_IN_OUT", T + "io : INT;", "END_VAR", "io := io + 1;", "END_FUNCTION_BLOCK", "",
      "FUNCTION_BLOCK FB_O", "VAR", T + "count : INT;", T + "k : FB_K;", "END_VAR", "END_FUNCTION_BLOCK", "",
      "METHOD Bump : INT", "k(io := THIS^.count);", "Bump := count;", "END_METHOD", "",
      "PROGRAM PLC_PRG", "VAR", T + "o : FB_O;", T + "a : INT;", "END_VAR", "a := o.Bump();", "END_PROGRAM",
    )
    expect(codesFor(source)).toContain("call-inout-alias")
  })

  test("a VAR_IN_OUT bound to an ordinary variable lowers and writes back", () => {
    const source = st(
      "FUNCTION_BLOCK FB_K", "VAR_IN_OUT", T + "io : INT;", "END_VAR", "io := io + 1;", "END_FUNCTION_BLOCK", "",
      "PROGRAM PLC_PRG", "VAR", T + "n : INT := 10;", T + "k : FB_K;", "END_VAR", "k(io := n);", "END_PROGRAM",
    )
    expect(valueOf(source, "n")).toBe(11n)
  })
})
