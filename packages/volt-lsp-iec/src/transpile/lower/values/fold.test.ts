/**
 * Folded constants: what lowering decides before the program runs.
 */
import { expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { lowerSource } from "../index.js"

const fb = (init: string) =>
  `FUNCTION_BLOCK FB\nVAR\n  d : LINT := ${init};\nEND_VAR\nd := d + 0;\nEND_FUNCTION_BLOCK\n` +
  "PROGRAM PLC_PRG\nVAR inst : FB; res : LINT; END_VAR\ninst();\nres := inst.d;\nEND_PROGRAM\n"
const codes = (src: string) => lowerSource(src, "PLC_PRG").diagnostics.map((d) => d.code)

test("a platform-alias conversion is refused in an initializer exactly as in a body (6.B.5 lowers both)", () => {
  // Lowering's builtins refuse `DINT_TO___XINT` as `expr-call` (the platform names are H4's, task 6.B.5). The
  // constant folder must not answer for it on its own: a fold here lowered the initializer while the same call in
  // a body stayed refused — the two paths disagreed, and the new answer had no recording behind it.
  const body = codes("PROGRAM PLC_PRG\nVAR x : LINT; END_VAR\nx := DINT_TO___XINT(5);\nEND_PROGRAM\n")
  expect(body).toContain("expr-call")
  expect(codes(fb("DINT_TO___XINT(5)"))).toContain("expr-call")
})

test("an initializer holding a platform-alias conversion is not folded statically", () => {
  // `5 + __XINT_TO_DINT(5)` is not a compile-time constant to lowering until 6.B.5 decides the platform names:
  // folding it gave `d` the static init 10 where HEAD's runtime init path refused or deferred it.
  const r = lowerSource(fb("5 + __XINT_TO_DINT(5)"), "PLC_PRG")
  const d = r.pou!.layouts.find((l) => l.name === "FB")!.fields.find((f) => f.name === "d")!
  expect(d.init).not.toBe(10n)
})

/** Lower and require success — most tests are about the SHAPE, not the failure path. */
function ir(src: string, name?: string) {
  const { pou, diagnostics } = lowerSource(src, name)
  expect(diagnostics).toEqual([])
  return pou!
}

// pro2193 sizes arrays and starts variables through qualified constants — `ARRAY[1..GVL_Constants.ChainProductsForReject]`,
// `MaxVacuums : USINT := XiUnits.MaxVacuums`, `prevState : DINT := GVL_Constants.DintSmallest`. None folded (`constEval`
// stopped at a member), so those arrays were "not a sized array", those initializers `init-not-constant`, and the slot
// then missing (`place-not-local`). Name resolution the compiled project proves — no recording. Why missed: every
// fixture's constant was bare.
test("a constant named through its GVL or its PROGRAM sizes an array, starts a variable and bounds a loop", () => {
  const gvl = [{ uri: "file:///project/GVL_Constants.gvl", source: "{attribute 'qualified_only'}\nVAR_GLOBAL CONSTANT\n  Count : INT := 3;\n  Smallest : DINT := -2147483648;\nEND_VAR\n" }]
  const source =
    "PROGRAM P\nVAR worker : FB_W; END_VAR\nworker();\nEND_PROGRAM\n" +
    "PROGRAM Units\nVAR CONSTANT\n  MaxVacuums : USINT := GVL_Constants.Count + 1;\nEND_VAR\nEND_PROGRAM\n" +
    "FUNCTION_BLOCK FB_W\nVAR\n  flags : ARRAY[1..GVL_Constants.Count] OF BOOL;\n  prevState : DINT := GVL_Constants.Smallest;\n  i : INT;\n  visits : INT;\nEND_VAR\nVAR CONSTANT\n  MaxVacuums : USINT := Units.MaxVacuums;\nEND_VAR\n" +
    "FOR i := 1 TO MaxVacuums DO\n  visits := visits + 1;\nEND_FOR\nflags[GVL_Constants.Count] := TRUE;\nEND_FUNCTION_BLOCK\n"
  const { pou, diagnostics } = lowerSource(source, "P", gvl)
  expect(diagnostics).toEqual([])
  const runner = run(pou!)
  runner.scan()
  expect([runner.get("worker.visits"), runner.get("worker.flags[3]"), runner.get("worker.prevState")]).toEqual([4n, true, -2147483648n])
})

// transpile-review-2026-09-29 task 5 (conformance `const_literal_wider_than_lint`, recorded): an all-constant integer
// expression folded at LINT, so a literal ≥ 2^63 wrapped negative — `18446744073709551615 > 5` was FALSE. CODESYS folds
// it at the literal's own width, ULINT.
test("an all-constant integer expression with a literal wider than LINT folds at ULINT, not wrapped into LINT", () => {
  const source =
    "PROGRAM P\nVAR isgt : BOOL; half : ULINT; mx : ULINT; hexgt : BOOL; hexdiv : LWORD; signbit : BOOL; END_VAR\n" +
    "isgt := 18446744073709551615 > 5;\nhalf := 18446744073709551615 / 2;\nmx := MAX(18446744073709551615, 5);\n" +
    "hexgt := 16#FFFFFFFFFFFFFFFF > 16#7FFFFFFFFFFFFFFF;\nhexdiv := 16#FFFFFFFFFFFFFFFF / 16;\nsignbit := 16#8000000000000000 > 1;\nEND_PROGRAM\n"
  const runner = run(ir(source, "P"))
  runner.scan()
  expect(["isgt", "half", "mx", "hexgt", "hexdiv", "signbit"].map((n) => runner.get(n))).toEqual([
    true, 9223372036854775807n, 18446744073709551615n, true, 1152921504606846975n, true,
  ])
})

// transpile-review-2026-09-29 task 7 (conformance `negative_literal_constant_fold`, recorded): `-5` lowered to a runtime
// negation of 5, so it counted as a VARIABLE — the all-constant fold and MIN/MAX's meet took DINT from it and wrapped
// 3000000000. CODESYS treats a negative literal as the constant it is.
test("a negative literal is a constant: the all-constant fold and MIN/MAX's meet apply", () => {
  const source =
    "PROGRAM P\nVAR a : LINT; b : LINT; c : LINT; d : LINT; e : LINT; f : LINT; h : LINT; END_VAR\n" +
    "a := MAX(-5, 3000000000);\nb := MAX(-1, 3000000000, 7);\nc := -5 + 3000000000;\nd := 3000000000 + -5;\n" +
    "e := 3000000000 - 5;\nf := -2000000000 - 2000000000;\nh := MIN(-5, 3000000000);\nEND_PROGRAM\n"
  const runner = run(ir(source, "P"))
  runner.scan()
  expect(["a", "b", "c", "d", "e", "f", "h"].map((n) => runner.get(n))).toEqual([
    3000000000n, 3000000000n, 2999999995n, 2999999995n, 2999999995n, -4000000000n, -5n,
  ])
})
