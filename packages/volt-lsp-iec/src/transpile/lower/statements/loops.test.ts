/**
 * Lowering tests of `loops.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { describe, expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import type { IrAssign, IrLoop } from "../../ir/index.js"
import { lowerSource } from "../index.js"

/** Lower and require success — most tests are about the SHAPE, not the failure path. */
function ir(src: string, name?: string) {
  const { pou, diagnostics } = lowerSource(src, name)
  expect(diagnostics).toEqual([])
  return pou!
}

const wrap = (body: string, vars = "iCount : INT;") => `PROGRAM P\nVAR\n  ${vars}\nEND_VAR\n${body}\nEND_PROGRAM\n`

describe("lower — total, never silently wrong", () => {
  // Refused (`for-step-runtime`) until recorded: a step decided at run time sets the direction (conformance
  // `callshape_for_runtime_step`). This test then claimed the step was "evaluated once" — the review of batch 3a found no
  // recording showed it, and the one made since (`callshape_for_bounds_changed_in_body`) shows the opposite: the limit
  // and the step are both read on every pass. The limit had been taken into a temp once since phase 1; no fixture's body
  // ever changed it.
  test("a FOR reads its limit and its step on every pass — a runtime step decides the direction", () => {
    const runner = run(ir(wrap("FOR i := 1 TO 10 BY iCount DO\n  visits := visits + 1;\nEND_FOR", "iCount : INT := 3;\n  i : INT;\n  visits : INT;")))
    runner.scan()
    // 1, 4, 7, 10 — then i steps past the limit, to 13
    expect([runner.get("visits"), runner.get("i")]).toEqual([4n, 13n])
    // the recording: a body that sets the limit to 4 and the step to 3 after the first pass ends after 2 passes, at 7
    const changed = run(ir(wrap("FOR i := 1 TO finalIndex BY stride DO\n  visits := visits + 1;\n  stride := 3;\n  finalIndex := 4;\nEND_FOR", "i : INT;\n  finalIndex : INT := 9;\n  stride : INT := 1;\n  visits : INT;")))
    changed.scan()
    expect([changed.get("visits"), changed.get("i")]).toEqual([2n, 7n])
    // A call in the limit was refused here, how often it ran unrecorded; the recording since (`callshape_for_limit_call`)
    // runs a PROPERTY getter 4 times for 3 passes — once per test. One in the step stays unrecorded, and refused.
    const counted = run(
      ir(
        "PROGRAM P\nVAR holder : FB_H; i : INT; passes : INT; END_VAR\nFOR i := 1 TO holder.PassLimit DO\n  passes := passes + 1;\nEND_FOR\nEND_PROGRAM\n" +
          "FUNCTION_BLOCK FB_H\nVAR reads : INT; END_VAR\nEND_FUNCTION_BLOCK\nPROPERTY PassLimit : INT\nGET\nreads := reads + 1;\nPassLimit := 3;\nEND_GET\nEND_PROPERTY\n",
        "P",
      ),
    )
    counted.scan()
    expect([counted.get("passes"), counted.get("holder.reads")]).toEqual([3n, 4n])
    expect(lowerSource(wrap("FOR i := 1 TO 5 BY F_Step() DO\n  visits := visits + 1;\nEND_FOR", "i : INT;\n  visits : INT;") + "FUNCTION F_Step : INT\nF_Step := 2;\nEND_FUNCTION\n", "P").diagnostics.map((d) => d.code)).toEqual(["for-bound-call"])
  })
})

// transpile-review 39: EXIT/CONTINUE outside any loop lowered to a `break`/`continue` with no enclosing loop — Rust E0268,
// and the interpreter "stopped the body". CODESYS refuses it: "No enclosing loop of which to exit" (`cc2_exit_outside_loop`).
test("EXIT and CONTINUE outside a loop are refused; inside one — nested in an IF — they lower", () => {
  const prg = (body: string) => `PROGRAM P\nVAR\n\tn : INT;\n\ti : INT;\nEND_VAR\n${body}\nEND_PROGRAM\n`
  const codes = (body: string) => lowerSource(prg(body), "P").diagnostics.map((d) => d.code)
  expect(codes("n := 1;\nEXIT;")).toEqual(["exit-outside-loop"])
  expect(codes("IF n = 0 THEN CONTINUE; END_IF")).toEqual(["exit-outside-loop"])
  expect(codes("FOR i := 1 TO 3 DO IF i = 2 THEN EXIT; END_IF END_FOR\nEXIT;")).toEqual(["exit-outside-loop"])
  expect(codes("FOR i := 1 TO 3 DO IF i = 2 THEN CONTINUE; END_IF n := n + 1; END_FOR")).toEqual([])
  expect(codes("WHILE n < 3 DO n := n + 1; EXIT; END_WHILE")).toEqual([])
  expect(codes("REPEAT n := n + 1; CONTINUE; UNTIL n > 3 END_REPEAT")).toEqual([])
})

// transpile-review 35: a constant FOR step was typed as the counter without wrapping (`wrapping_add(-1u8)`, E0600).
// CODESYS (`tr_35_*`): BY -1 on a BYTE counts down (n=5, b=0), BY -2 on a UINT too (n=5, u=0), BY 255 on a BYTE wraps (n=2,
// b=255); a runtime INT step on a BYTE counter and BY 300 on a SINT are build errors ("Cannot convert type 'INT' to ...").
test("a constant FOR step wraps to the counter's width and keeps its signed direction; a step that does not convert is refused", () => {
  const loop = (vars: string, body: string) => {
    const { pou, diagnostics } = lowerSource(`PROGRAM P\nVAR ${vars} n : INT; END_VAR\n${body}\nEND_PROGRAM\n`, "P")
    if (pou === undefined) return diagnostics.map((d) => d.code)
    const step = (pou.body.find((s) => s.kind === "loop") as IrLoop).step[0] as IrAssign
    const runner = run(pou)
    runner.scan()
    return [runner.get("n"), runner.get(vars.split(" ")[0]!), step.value.kind === "binary" && step.value.right.kind === "const" ? step.value.right.value : "runtime"]
  }
  expect(loop("b : BYTE;", "FOR b := 5 TO 1 BY -1 DO n := n + 1; END_FOR")).toEqual([5n, 0n, 255n])
  expect(loop("u : UINT;", "FOR u := 10 TO 2 BY -2 DO n := n + 1; END_FOR")).toEqual([5n, 0n, 65534n])
  expect(loop("b : BYTE;", "FOR b := 1 TO 10 BY 255 DO n := n + 1; END_FOR")).toEqual([2n, 255n, 255n])
  expect(loop("b : BYTE; stp : INT := -1;", "FOR b := 5 TO 1 BY stp DO n := n + 1; END_FOR")).toEqual(["for-step-type"])
  expect(loop("sc : SINT;", "FOR sc := 1 TO 10 BY 300 DO n := n + 1; END_FOR")).toEqual(["for-step-type"])
})

// transpile-review 36: a literal FOR limit was lowered in the counter's type, so `FOR small := 1 TO 200` on a SINT compared
// against -56 and ran zero passes. CODESYS (`tr_36_for_literal_limit_beyond_counter`) compares against 200 — the SINT
// counter can never pass it, so the loop runs until the EXIT guard: n=300, small=44 — the same as `TO (100 + 100)`.
test("a literal FOR limit the counter's type cannot hold is compared unnarrowed", () => {
  const body = [
    "FOR small := 1 TO 200 DO n := n + 1; IF n >= 300 THEN EXIT; END_IF END_FOR",
    "FOR small2 := 1 TO (100 + 100) DO n2 := n2 + 1; IF n2 >= 300 THEN EXIT; END_IF END_FOR",
  ].join("\n")
  const runner = run(ir(`PROGRAM P\nVAR small : SINT; n : INT; small2 : SINT; n2 : INT; END_VAR\n${body}\nEND_PROGRAM\n`, "P"))
  runner.scan()
  expect(["n", "small", "n2", "small2"].map((v) => runner.get(v))).toEqual([300n, 44n, 300n, 44n])
})

// transpile-restructure 2.6 (RC 13's transpiler half): CODESYS judges a FOR limit and step by their TYPE. A DINT
// limit on an INT counter — a variable, an expression, UPPER_BOUND, a named CONSTANT, a typed literal — is "Cannot
// convert type 'DINT' to type 'INT'" (`for_limit_wider_than_counter_dint_var`, `_dint_expr`, `_upper_bound`,
// `_dint_constant`, `_typed_literal`), and so is a DINT step that is not a bare variable (`for_step_wider_than_counter_
// dint_paren`, `_upper_bound`). Lowered, they compiled and ran. Taken: a same-width sign change (`for_limit_sign_change_
// int_on_uint`, `_uint_on_int`: 3 passes, the counter left at 4), a UINT `n - 1` on a UINT (`_uint_expr`), and an
// expression of untyped literals, asked by value (`tr_36_*`, `callshape_for_runtime_step`).
test("a typed FOR limit or step that does not convert into the counter is refused; untyped ones are asked by value", () => {
  const codes = (vars: string, body: string) => lowerSource(`PROGRAM P\nVAR ${vars} runs : INT; END_VAR\n${body}\nEND_PROGRAM\n`, "P").diagnostics.map((d) => d.code)
  const each = "DO runs := runs + 1; END_FOR"
  expect(codes("hi : DINT := 3; i : INT;", `FOR i := 1 TO hi ${each}`)).toEqual(["for-limit-type"])
  expect(codes("k : DINT := 4; i : INT;", `FOR i := 1 TO k - 1 ${each}`)).toEqual(["for-limit-type"])
  expect(codes("arr : ARRAY[0..4] OF INT; j : INT;", `FOR j := 0 TO UPPER_BOUND(arr, 1) ${each}`)).toEqual(["for-limit-type"])
  expect(codes("i : INT; END_VAR VAR CONSTANT hi : DINT := 3;", `FOR i := 1 TO hi ${each}`)).toEqual(["for-limit-type"])
  expect(codes("i : INT;", `FOR i := 1 TO DINT#5 ${each}`)).toEqual(["for-limit-type"])
  expect(codes("k : DINT := 3; i : INT;", `FOR i := 0 TO 10 BY (k - 1) ${each}`)).toEqual(["for-step-type"])
  expect(codes("arr : ARRAY[0..3] OF INT; i : INT;", `FOR i := 0 TO 10 BY UPPER_BOUND(arr, 1) ${each}`)).toEqual(["for-step-type"])
  // a typed literal step is asked by its type too, its value fitting: INT#-1 on a BYTE is "Cannot convert type 'INT' to
  // type 'BYTE'" (`for_step_typed_literal_on_narrower_counter`), where the untyped `BY -1` is taken (`tr_35_for_byte_step_minus_one`)
  expect(codes("b : BYTE;", `FOR b := 5 TO 0 BY INT#-1 ${each}`)).toEqual(["for-step-type"])
  expect(codes("b : BYTE;", `FOR b := 5 TO 0 BY -1 ${each}`)).toEqual([])
  expect(codes("b : BOOL; i : INT;", `FOR i := 0 TO 10 BY SEL(b, 2, -2) ${each}`)).toEqual([])
  expect(codes("n : UINT := 3; u : UINT;", `FOR u := 0 TO n - 1 ${each}`)).toEqual([])
  const passes = (vars: string, counter: string) => {
    const runner = run(ir(`PROGRAM P\nVAR ${vars} runs : INT; END_VAR\nFOR ${counter} := 1 TO hi ${each}\nEND_PROGRAM\n`, "P"))
    runner.scan()
    return [runner.get("runs"), runner.get(counter)]
  }
  expect(passes("hi : INT := 3; u : UINT;", "u")).toEqual([3n, 4n])
  expect(passes("hi : UINT := 3; i : INT;", "i")).toEqual([3n, 4n])
})

// transpile-restructure gate 2c: the sign-change pair, outside the INT range. CODESYS compares the counter and the limit
// PROMOTED, as an IF compares them: a UINT counter from 40000 to an INT limit of 100 runs no pass
// (`for_limit_sign_change_uint_counter_out_of_int_range`: runs 0, u 40000), and an INT counter never exceeds a UINT limit
// of 40000, so only the EXIT guard ends it (`for_limit_sign_change_uint_limit_out_of_int_range`: runs 50000, i -15537).
// Compared in the unpromoted common type (INT), 40000 read as -25536: 25637 passes, and 0.
test("a same-width sign-change FOR pair is compared promoted, as an IF compares it", () => {
  const scan = (vars: string, body: string, read: string[]) => {
    const runner = run(ir(`PROGRAM P\nVAR ${vars} END_VAR\n${body}\nEND_PROGRAM\n`, "P"), { loopGuard: 200000 })
    runner.scan()
    return read.map((v) => runner.get(v))
  }
  expect(scan("hi : INT := 100; u : UINT; runs : DINT;", "FOR u := 40000 TO hi DO runs := runs + 1; END_FOR", ["runs", "u"])).toEqual([0n, 40000n])
  expect(
    scan("hi : UINT := 40000; i : INT; runs : DINT;", "FOR i := 0 TO hi DO runs := runs + 1; IF runs >= 50000 THEN EXIT; END_IF END_FOR", ["runs", "i"]),
  ).toEqual([50000n, -15537n])
})
