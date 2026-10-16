/**
 * Folded constants: what lowering decides before the program runs.
 */
import { expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { lowerSource } from "../index.js"
import { ir } from "../../../../test/support/transpile.js"

const fb = (init: string) =>
  `FUNCTION_BLOCK FB\nVAR\n  d : LINT := ${init};\nEND_VAR\nd := d + 0;\nEND_FUNCTION_BLOCK\n` +
  "PROGRAM PLC_PRG\nVAR inst : FB; res : LINT; END_VAR\ninst();\nres := inst.d;\nEND_PROGRAM\n"
const codes = (src: string) => lowerSource(src, "PLC_PRG").diagnostics.map((d) => d.code)

// transpile-restructure 6.B.5 (1.1.10's gate: an initializer and a body answer a platform conversion alike). Recorded
// (`tr_b5_platform_conversion_initializers`, CODESYS run + both builds): `DINT_TO___XINT(5)` is 5, `__XINT_TO_DINT(7)` 7,
// `5 + __XINT_TO_DINT(5)` 10, `DINT_TO___UXINT(-1)` 18446744073709551615 — each in a VAR initializer, as in a body.
test("a platform-alias conversion in an initializer lowers as it does in a body, at the recorded value", () => {
  const body = lowerSource("PROGRAM PLC_PRG\nVAR x : LINT; END_VAR\nx := DINT_TO___XINT(5);\nEND_PROGRAM\n", "PLC_PRG")
  expect(body.diagnostics).toEqual([])
  const value = (init: string) => {
    const r = lowerSource(fb(init), "PLC_PRG")
    expect(r.diagnostics).toEqual([])
    const runner = run(r.pou!)
    runner.scan()
    return runner.get("res")
  }
  expect(value("DINT_TO___XINT(5)")).toBe(5n)
  expect(value("__XINT_TO_DINT(7)")).toBe(7n)
  expect(value("5 + __XINT_TO_DINT(5)")).toBe(10n)
  expect(codes(fb("DINT_TO___UXINT(-1)"))).toEqual([])
})

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

/** The statements of a lowered PROGRAM's body, as the IR holds them (the fold pass is the last thing lowering does). */
function body(src: string) {
  const { pou, diagnostics } = lowerSource(src)
  expect(diagnostics).toEqual([])
  return pou!.body
}

test("an all-constant expression lowers to the constant it evaluates to — a faulting one is kept for run time (7.2.2)", () => {
  const [sum, shifted, division] = body(
    "PROGRAM P\nVAR d : DINT; w : WORD; q : DINT; z : DINT := 0; END_VAR\nd := 2000000000 + 2000000000 - 1;\nw := SHL(WORD#1, 3) OR 16#4;\nq := 7 / z;\nEND_PROGRAM\n",
  )
  expect(sum!.kind === "assign" && sum!.value).toMatchObject({ kind: "const", value: -294967297n })
  expect(shifted!.kind === "assign" && shifted!.value).toMatchObject({ kind: "const", value: 12n })
  expect(division!.kind === "assign" && division!.value.kind).not.toBe("const")
  const [divByZero] = body("PROGRAM P\nVAR q : DINT; END_VAR\nq := 7 / 0;\nEND_PROGRAM\n")
  expect(divByZero!.kind === "assign" && divByZero!.value.kind).not.toBe("const")
})

test("a constant index inside its array is the element's position, its lower bound subtracted once (7.2.3)", () => {
  const [inside, outside] = body("PROGRAM P\nVAR a : ARRAY[3..7] OF INT; i : INT := 9; END_VAR\na[5] := 1;\na[i] := 2;\nEND_PROGRAM\n")
  const step = (s: (typeof inside)) => (s!.kind === "assign" ? s!.target.path[0] : undefined)
  expect(step(inside)).toMatchObject({ kind: "index", lower: 0n, index: { kind: "const", value: 2n } })
  expect(step(outside)).toMatchObject({ kind: "index", lower: 3n })
})

test("a selection is typed at its result: a constant selector picks its arm, literal arms convert one by one (7.2.7)", () => {
  const [picked, mux, sel] = body(
    "PROGRAM P\nVAR a : INT := 1; b : INT := 2; k : INT := 1; g : BOOL; x : INT; y : INT; z : INT; END_VAR\nx := SEL(FALSE, a, b);\ny := MUX(k, 10, 20, 30);\nz := SEL(g, a, b);\nEND_PROGRAM\n",
  )
  expect(picked!.kind === "assign" && picked!.value).toMatchObject({ kind: "load" })
  const arms = mux!.kind === "assign" && mux!.value.kind === "builtin" ? mux!.value.args.slice(1) : []
  expect(arms.map((a) => (a.kind === "const" && a.type.kind === "elementary" ? `${a.value} ${a.type.name}` : a.kind))).toEqual(["10 INT", "20 INT", "30 INT"])
  // INT arms are not widened and narrowed back
  expect(sel!.kind === "assign" && sel!.value).toMatchObject({ kind: "builtin", name: "sel", args: [{ kind: "load" }, { kind: "load" }, { kind: "load" }] })
})

// 7.10+7.2b gate review: a divisor is "nonzero" by the value its TYPE holds, not by the raw literal — `1.0E-46` beside a
// REAL is 0 as a REAL (the interpreter rounds it through `constValue` and faults), so its division keeps its zero check.
test("a real divisor that rounds to 0 in its type is not proven nonzero (7.2.6)", () => {
  const [tiny, real] = body("PROGRAM P\nVAR x : REAL := 1; y : REAL; z : REAL; END_VAR\ny := x / 1.0E-46;\nz := x / 0.5;\nEND_PROGRAM\n")
  expect(tiny!.kind === "assign" && tiny!.value.kind === "binary" && tiny!.value.nonzeroDivisor).toBeFalsy()
  expect(real!.kind === "assign" && real!.value.kind === "binary" && real!.value.nonzeroDivisor).toBe(true)
})
