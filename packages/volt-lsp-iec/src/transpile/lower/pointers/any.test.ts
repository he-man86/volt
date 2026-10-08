/**
 * Lowering tests of `any.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { describe, expect, test } from "bun:test"
import { lowerSource } from "../index.js"

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

// transpile-review 17: an ANY input's pValue was dereferenced at the ARGUMENT's type whatever the pointer's declared type,
// so a DINT read through POINTER TO REAL was a numeric conversion. CODESYS (`tr_17_any_pvalue_*`) reinterprets the bytes
// (1065353216 -> 1.0, BYTE 254 via SINT -> -1): a byte view this does not model, so a mismatched dereference is refused;
// a pointer of the argument's own type still reads it.
test("an ANY input's pValue dereferenced through a pointer of another type is refused", () => {
  const codes = (pointee: string, arg: string) =>
    lowerSource(
      `FUNCTION F : LREAL\nVAR_INPUT v : ANY; END_VAR\nVAR pr : POINTER TO ${pointee}; END_VAR\npr := v.pValue;\nF := pr^;\nEND_FUNCTION\n` +
        `PROGRAM P\nVAR d : ${arg}; rv : LREAL; END_VAR\nrv := F(v := d);\nEND_PROGRAM\n`,
      "P",
    ).diagnostics.map((d) => d.code)
  expect(codes("REAL", "DINT")).toEqual(["pointer-type"])
  expect(codes("SINT", "BYTE")).toEqual(["pointer-type"])
  expect(codes("DINT", "DINT")).toEqual([])
})
