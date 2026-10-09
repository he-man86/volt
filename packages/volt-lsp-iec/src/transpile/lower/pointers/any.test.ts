/**
 * Lowering tests of `any.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { describe, expect, test } from "bun:test"
import { lowerSource } from "../index.js"
import { run } from "../../interp/index.js"

/**
 * AN ANY ARGUMENT IS LENT LIKE ANY OTHER VAR_IN_OUT, so it passes the same guards.
 *
 * It passed NONE of them. `lowerInvoke` lowered the argument with a bare `lowerPlace` and stored it for binding,
 * skipping `through` (which dereferences a REFERENCE and refuses a write through a VAR_IN_OUT CONSTANT) and the
 * bit and global refusals that every other lent place meets. Measured 2026-09-17: a GVL variable given to an
 * `ANY_INT` input lowered with ZERO diagnostics and emitted `f(g, …, &mut g.g_val)` — `g` and a field of `g` in
 * one argument list, which rustc rejects with E0499 — while the SAME variable on a plain VAR_IN_OUT was
 * correctly refused. The guards now live in one function with two callers.
 */
describe("an ANY argument passes the guards every lent place passes", () => {
  const ANY_FN =
    "FUNCTION F_any : BOOL\nVAR_INPUT\n\tpValue : ANY_INT;\n\tstep : INT;\nEND_VAR\nF_any := TRUE;\nEND_FUNCTION\n"
  const codes = (src: string): string[] => lowerSource(src, "PLC_PRG").diagnostics.map((d) => d.code)

  test("a GLOBAL given to an ANY input is refused, as it is on a plain VAR_IN_OUT", () => {
    expect(
      codes(
        `VAR_GLOBAL\n\tgVal : DINT;\nEND_VAR\n\n${ANY_FN}\nPROGRAM PLC_PRG\nVAR\n\tdone : BOOL;\nEND_VAR\n` +
          "done := F_any(pValue := gVal, step := 5);\nEND_PROGRAM\n",
      ),
    ).toContain("call-inout-global")
  })

  test("a BIT given to an ANY input is refused, not silently widened to its whole word", () => {
    expect(
      codes(
        `${ANY_FN}\nPROGRAM PLC_PRG\nVAR\n\tw : WORD;\n\tdone : BOOL;\nEND_VAR\n` +
          "done := F_any(pValue := w.3, step := 5);\nEND_PROGRAM\n",
      ),
    ).toContain("call-inout-bit")
  })

  test("an ordinary local still lowers — the guards did not widen into a refusal of everything", () => {
    expect(
      codes(
        `${ANY_FN}\nPROGRAM PLC_PRG\nVAR\n\tn : DINT;\n\tdone : BOOL;\nEND_VAR\n` +
          "done := F_any(pValue := n, step := 5);\nEND_PROGRAM\n",
      ),
    ).toEqual([])
  })
})

/**
 * AN ANY INPUT THROUGH AN INTERFACE IS REFUSED, not answered wrongly.
 *
 * A direct call lowers a SPECIAL variant for an `ANY`/`ANY_*` VAR_INPUT: the input is a hidden DINT the call
 * fills with the argument's BYTE SIZE, and the argument is lent separately (conformance
 * `state_any_input_sizes`). `interfaceCall` lowered its arguments against the INTERFACE declaration and
 * resolved each arm WITHOUT the call expression — which is what selects that variant — so the plain routine
 * ran and the argument's VALUE was handed to an input expecting its SIZE: `Take(v := big)` with
 * `big : LREAL := 42.0` passed 42 where the body reads `v.diSize` and 8 is the answer.
 *
 * Filling the size per dispatch arm is coverage work. Being wrong about it was not.
 */
test("an ANY input through an interface is refused rather than given the argument value", () => {
  const r = lowerSource("INTERFACE I_X\nMETHOD Take : DINT\nVAR_INPUT\n\tv : ANY;\nEND_VAR\nEND_METHOD\nEND_INTERFACE\n\nFUNCTION_BLOCK FB_A IMPLEMENTS I_X\nEND_FUNCTION_BLOCK\n\nMETHOD Take : DINT\nVAR_INPUT\n\tv : ANY;\nEND_VAR\nTake := v.diSize;\nEND_METHOD\n\nPROGRAM PLC_PRG\nVAR\n\tsq : FB_A;\n\trv : I_X;\n\tn : DINT;\n\tbig : LREAL := 42.0;\nEND_VAR\nrv := sq;\nn := rv.Take(v := big);\nEND_PROGRAM\n", "PLC_PRG")
  expect(r.pou).toBeUndefined()
  expect(r.diagnostics.map((d) => d.code)).toContain("interface-any-input")
})

// transpile-review 17, recorded (`tr_17_any_pvalue_*`): an ANY input's pValue is the argument's BYTE ADDRESS, and a
// pointer of another type reads or writes those bytes — 1065353216 through POINTER TO REAL is 1.0, BYTE 254 through
// POINTER TO SINT is -2, `pb^ := 16#FF` changes one byte of a DINT. It was dereferenced at the ARGUMENT's type (a numeric
// conversion), then refused `pointer-type`. Now (transpile-restructure 4.9, design.md §3.3 step 4e) a STORED pValue is an
// address store of each call site's argument: the argument escapes into the image and pValue is its address. Why missed:
// pValue was a tag on the hidden VAR_IN_OUT, which has no bytes to view another way.
describe("an ANY input's pValue stored into a pointer is the argument's address (RC 17)", () => {
  const NL = "\n"
  const program = (pointee: string, arg: string, init: string, body: string, result = "LREAL") =>
    [
      `FUNCTION F : ${result}`,
      "VAR_INPUT v : ANY; END_VAR",
      `VAR p : POINTER TO ${pointee}; END_VAR`,
      "p := v.pValue;",
      body,
      "END_FUNCTION",
      "PROGRAM P",
      `VAR d : ${arg} := ${init}; rv : ${result}; END_VAR`,
      "rv := F(v := d);",
      "END_PROGRAM",
      "",
    ].join(NL)
  const values = (src: string, ...names: string[]) => {
    const { pou, diagnostics } = lowerSource(src, "P")
    expect(diagnostics).toEqual([])
    const runner = run(pou!)
    runner.scan()
    return names.map((n) => runner.get(n))
  }

  test("a read through a pointer of another type reinterprets the argument's bytes", () => {
    expect(values(program("REAL", "DINT", "1065353216", "F := p^;"), "rv")).toEqual([1])
    expect(values(program("REAL", "DINT", "-1082130432", "F := p^;"), "rv")).toEqual([-1])
    expect(values(program("SINT", "BYTE", "254", "F := p^ / 2;", "DINT"), "rv")).toEqual([-1n])
    expect(values(program("INT", "UINT", "65535", "F := p^;", "DINT"), "rv")).toEqual([-1n])
    // the pointer of the argument's own type reads it as before
    expect(values(program("DINT", "DINT", "42", "F := p^;", "DINT"), "rv")).toEqual([42n])
  })

  test("a write through a narrower pointer changes only the bytes it covers", () => {
    expect(values(program("BYTE", "DINT", "16#01020304", ["p^ := 16#FF;", "F := TRUE;"].join(NL), "BOOL"), "d", "rv")).toEqual([0x010203ffn, true])
  })

  // pro2193's `Increment` and `BitLogic` (273 call sites in 41 files): `uInput.p1_Byte := input.pValue`, then the arm its
  // `diSize` picks — a UNION whose members are all pointers that hold addresses is ONE address, read at each arm's type
  test("a UNION of pointers given pValue is one address, each arm reading the argument's bytes at its own type", () => {
    const union = ["TYPE U_P :", "UNION", "pb : POINTER TO BYTE;", "pi : POINTER TO INT;", "pd : POINTER TO DINT;", "END_UNION", "END_TYPE", ""].join(NL)
    const viaUnion = (arm: string) =>
      [
        "FUNCTION F : DINT",
        "VAR_INPUT v : ANY; END_VAR",
        "VAR u : U_P; END_VAR",
        "u.pb := v.pValue;",
        `F := u.${arm}^;`,
        "END_FUNCTION",
        "PROGRAM P",
        "VAR d : DINT := 16#01020304; rv : DINT; END_VAR",
        "rv := F(v := d);",
        "END_PROGRAM",
        union,
      ].join(NL)
    expect(values(viaUnion("pb"), "rv")).toEqual([4n])
    expect(values(viaUnion("pi"), "rv")).toEqual([0x0304n])
    expect(values(viaUnion("pd"), "rv")).toEqual([0x01020304n])
  })

  test("an argument the image cannot hold keeps the tag, and a mismatched dereference stays refused", () => {
    // a FUNCTION's local is no place the image holds (no region per call)
    const local = [
      "FUNCTION F : LREAL",
      "VAR_INPUT v : ANY; END_VAR",
      "VAR p : POINTER TO REAL; END_VAR",
      "p := v.pValue;",
      "F := p^;",
      "END_FUNCTION",
      "FUNCTION G : LREAL",
      "VAR d : DINT; END_VAR",
      "G := F(v := d);",
      "END_FUNCTION",
      "PROGRAM P",
      "VAR rv : LREAL; END_VAR",
      "rv := G();",
      "END_PROGRAM",
      "",
    ].join(NL)
    expect(lowerSource(local, "P").diagnostics.map((d) => d.code)).toEqual(["pointer-type"])
    // an argument that is no place has no address: pValue is not measured
    const literal = program("REAL", "DINT", "0", "F := p^;").replace("F(v := d)", "F(v := d + 1)")
    // (and the dereference after that refused store repeats its code)
    expect([...new Set(lowerSource(literal, "P").diagnostics.map((d) => d.code))]).toEqual(["any-input"])
  })

  // Review of 4e: an argument handed by address escapes into the image, and a VAR_IN_OUT bound to an image variable is a
  // copy written back after the call — refused `call-inout-alias` when the callee reaches the image too, as this one does.
  // So once `e` is an ANY argument anywhere, a call that lends `e` to the in-out is refused even beside an unrelated `d`
  // (the tag path before lowered it). Niche: accepted loss (0 occurrences in the corpora — pro2193's `Increment` and
  // `BitLogic`, the only routines storing a pValue, declare no VAR_IN_OUT), design.md §3.3 step 4e.
  test("a VAR_IN_OUT bound to an argument that escaped through another call's pValue is refused (accepted loss)", () => {
    const src = (body: string) =>
      [
        "FUNCTION F : BOOL",
        "VAR_INPUT v : ANY; END_VAR",
        "VAR_IN_OUT io : DINT; END_VAR",
        "VAR p : POINTER TO DINT; END_VAR",
        "p := v.pValue; io := io + 1; p^ := 5; F := TRUE;",
        "END_FUNCTION",
        "PROGRAM P",
        "VAR d : DINT; e : DINT; b : BOOL; END_VAR",
        body,
        "END_PROGRAM",
        "",
      ].join(NL)
    // the in-out's variable never handed by address: it is no image place, and the call lowers
    expect(values(src("b := F(v := d, io := e);"), "d", "e")).toEqual([5n, 1n])
    // ...handed by address by a second call: the first call is refused too
    expect(lowerSource(src("b := F(v := d, io := e);" + NL + "b := F(v := e, io := e);"), "P").diagnostics.map((d) => d.code)).toEqual(["call-inout-alias"])
  })
})

/**
 * AN ANY INPUT GIVEN A REFERENCE TO IS GIVEN THE REFERENCED VARIABLE (transpile-restructure 4.13 (e)). The variant was
 * lowered for the REFERENCE's own type, so its hidden VAR_IN_OUT was a reference the call bound an INT to (rustc E0308),
 * and a `pValue` stored into a pointer asked the reference's byte size (`any-input`). Recorded: conformance
 * `any_input_given_reference` (diSize 2, `pValue^` 5).
 */
describe("an ANY input given a REFERENCE TO", () => {
  const FN = "FUNCTION F : DINT\nVAR_INPUT v : ANY; END_VAR\nVAR_OUTPUT seen : INT; END_VAR\nVAR pi : POINTER TO INT; END_VAR\nF := v.diSize;\npi := v.pValue;\nseen := pi^;\nEND_FUNCTION\n"
  const SIZE = "FUNCTION G : DINT\nVAR_INPUT v : ANY; END_VAR\nG := v.diSize;\nEND_FUNCTION\n"
  test("is the referenced variable: its size, and its value through pValue", () => {
    const { pou, diagnostics } = lowerSource(`PROGRAM P\nVAR x : INT := 5; rx : REFERENCE TO INT; n : DINT; seen : INT; END_VAR\nrx REF= x;\nn := F(v := rx, seen => seen);\nEND_PROGRAM\n\n${FN}`, "P")
    expect(diagnostics).toEqual([])
    const p = run(pou!)
    p.scan()
    expect([p.get("n"), p.get("seen")]).toEqual([2n, 5n])
  })
  test("the variant's hidden VAR_IN_OUT has the referenced type, not the reference's", () => {
    const { pou, diagnostics } = lowerSource(`PROGRAM P\nVAR x : INT := 5; rx : REFERENCE TO INT; n : DINT; END_VAR\nrx REF= x;\nn := G(rx);\nEND_PROGRAM\n\n${SIZE}`, "P")
    expect(diagnostics).toEqual([])
    const hidden = pou!.routines.flatMap((r) => r.inouts).filter((s) => s.name.startsWith("__any_"))
    expect(hidden.map((s) => s.type.kind === "elementary" && s.type.name)).toEqual(["INT"])
  })
})
