import { describe, expect, test } from "bun:test"
import { emitRust } from "./index.js"
import { lowerSource } from "../../lower/index.js"

function rust(src: string): string {
  const { pou, diagnostics } = lowerSource(src)
  expect(diagnostics).toEqual([])
  return emitRust(pou!).code
}

describe("emit/rust", () => {
  test("CONTINUE leaves the loop's body, not the loop — the step and a tail test still run", () => {
    // A bare Rust `continue` skipped both: FOR never stepped past the CONTINUE and REPEAT never tested UNTIL, where
    // CODESYS runs both (conformance `continue_in_for`, `continue_in_repeat`, recorded 2026-09-14)
    const code = rust("PROGRAM P\nVAR\n  i : INT;\n  n : INT;\nEND_VAR\nFOR i := 1 TO 5 DO\n  IF i = 3 THEN CONTINUE; END_IF\n  n := n + 1;\nEND_FOR\nEND_PROGRAM\n")
    expect(code).not.toMatch(/\bcontinue;/)
    const body = code.indexOf("break 'body_1;")
    const step = code.indexOf("self.i = self.i.wrapping_add(1i16);")
    expect(body).toBeGreaterThan(-1)
    expect(step).toBeGreaterThan(body) // the step follows the body block, where the CONTINUE lands
  })

  // 7.5.4: a head test is a Rust `while` (FOR and WHILE alike — never a `for` range: a FOR to its counter's maximum wraps,
  // `for_counter_at_type_max`), a tail test a `loop` ending in the UNTIL test
  test("a head-tested loop prints as `while`, a tail-tested one as `loop` with its test last", () => {
    const forLoop = rust("PROGRAM P\nVAR i : INT; n : INT; END_VAR\nFOR i := 1 TO 3 DO n := n + 1; END_FOR\nEND_PROGRAM\n")
    const whileLoop = rust("PROGRAM P\nVAR n : INT; END_VAR\nWHILE n < 3 DO n := n + 1; END_WHILE\nEND_PROGRAM\n")
    const repeat = rust("PROGRAM P\nVAR n : INT; END_VAR\nREPEAT n := n + 1; UNTIL n >= 3 END_REPEAT\nEND_PROGRAM\n")
    expect(forLoop).toContain("while self.i <= 3i16 {")
    expect(whileLoop).toContain("while self.n < 3i16 {")
    expect(repeat).toContain("loop {")
    expect(repeat).toContain("if self.n >= 3i16 { break; }")
    for (const code of [forLoop, whileLoop, repeat]) expect(code).not.toMatch(/'(loop|body)_\d|\n\s*\{\n/)
  })

  // 7.5.2 / 7.5.3: a body block and labels only where a CONTINUE must still step or test — EXIT is then `break 'loop_N`;
  // elsewhere EXIT is `break` and a WHILE's CONTINUE is `continue` (back to its head test)
  test("labels and a body block only where a CONTINUE precedes a step or a tail test", () => {
    const whileLoop = rust("PROGRAM P\nVAR n : INT; k : INT; END_VAR\nWHILE n < 9 DO\n  n := n + 1;\n  IF n = 2 THEN CONTINUE; END_IF\n  IF n = 7 THEN EXIT; END_IF\n  k := k + 1;\nEND_WHILE\nEND_PROGRAM\n")
    expect(whileLoop).toContain("continue;")
    expect(whileLoop).toContain("break;")
    expect(whileLoop).not.toMatch(/'(loop|body)_\d/)
    const forLoop = rust("PROGRAM P\nVAR i : INT; k : INT; END_VAR\nFOR i := 1 TO 9 DO\n  IF i = 2 THEN CONTINUE; END_IF\n  IF i = 7 THEN EXIT; END_IF\n  k := k + 1;\nEND_FOR\nEND_PROGRAM\n")
    expect(forLoop).toContain("'loop_1: while self.i <= 9i16 {")
    expect(forLoop).toContain("'body_1: {")
    expect(forLoop).toContain("break 'body_1;")
    expect(forLoop).toContain("break 'loop_1;")
    const exitOnly = rust("PROGRAM P\nVAR i : INT; END_VAR\nFOR i := 1 TO 9 DO\n  IF i = 7 THEN EXIT; END_IF\nEND_FOR\nEND_PROGRAM\n")
    expect(exitOnly).toContain("break;")
    expect(exitOnly).not.toMatch(/'(loop|body)_\d/)
  })
})

/**
 * A LOOP RUNS EVERY PASS CODESYS RUNS — there is no iteration cap in the emitted Rust (transpile-review task 27).
 *
 * A 1,000,000-pass cap used to be printed into every loop as semantics, and the two backends even counted it
 * differently: the Rust incremented before the head test, so `FOR i := 1 TO 1000000` panicked there while the
 * interpreter ran it. CODESYS has no such cap — it runs all passes of `tr_27_loop_cap_for_1000000`,
 * `_for_1000001`, `_repeat_1000001` and `_while_5000000` (recorded 2026-09-29). A runaway loop is bounded by the
 * harness that runs it (the interpreter's opt-in `loopGuard`, a process timeout), never by the program.
 */
describe("emit/rust — no iteration cap", () => {
  test("a loop carries no pass counter and no panic", () => {
    const code = rust("PROGRAM P\nVAR\n\tn : INT;\n\tgo : BOOL := TRUE;\nEND_VAR\nWHILE go DO\n\tn := n + 1;\nEND_WHILE\nEND_PROGRAM\n")
    expect(code).not.toContain("__iter_")
    expect(code).not.toContain("panic!")
  })
})

/**
 * A FOR LIMIT OF A DIFFERENT TYPE FROM THE COUNTER — the test meets the pair, as every other comparison does.
 *
 * The limit was converted to its OWN type (a no-op), so the emitted test compared the two as they were (`i16 <= i32`,
 * rustc E0308), and lowering reported nothing. The case that showed it — `FOR i := 1 TO hi` with `i : INT` and
 * `hi : DINT` — does NOT compile in CODESYS: "Cannot convert type 'DINT' to type 'INT'" (`for_limit_wider_than_counter_
 * dint_var`, `_dint_expr`, `_upper_bound`, record:exec), so it is refused (`for-limit-type`). What still meets is a pair
 * CODESYS takes: a UINT `n - 1` (promoted at run time) and a same-width sign change (compared promoted,
 * `for_limit_sign_change_uint_counter_out_of_int_range`, `_uint_limit_out_of_int_range`).
 *
 * It PROMOTES rather than narrows, and that is the load-bearing half: narrowing the LIMIT into the counter's type would
 * wrap a literal the counter cannot hold (200 into a SINT is -56, and the loop would run zero times instead of until the
 * counter wraps, `tr_36_for_literal_limit_beyond_counter`). `commonType` is the promotion the binary operators already
 * use, measured.
 */
describe("emit/rust — a FOR whose limit is a different type", () => {
  test("a typed limit that does not convert into the counter is refused, as CODESYS refuses it", () => {
    const { pou, diagnostics } = lowerSource("PROGRAM P\nVAR\n\ti : INT;\n\thi : DINT := 5;\n\tn : INT;\nEND_VAR\nFOR i := 1 TO hi DO\n\tn := n + 1;\nEND_FOR\nEND_PROGRAM\n")
    expect(pou).toBeUndefined()
    expect(diagnostics.map((d) => d.code)).toEqual(["for-limit-type"])
  })

  test("a same-width sign change is compared promoted, so the comparison is same-typed", () => {
    // CODESYS takes an INT limit on a UINT counter (`for_limit_sign_change_int_on_uint`: 3 passes, u left at 4) and
    // compares the pair promoted: from 40000 to an INT 100 it runs no pass (`for_limit_sign_change_uint_counter_out_of_
    // int_range`), where the signed type at equal width (i16) read 40000 as -25536 and ran 25637
    expect(rust("PROGRAM P\nVAR\n\tu : UINT;\n\thi : INT := 3;\n\tn : INT;\nEND_VAR\nFOR u := 1 TO hi DO\n\tn := n + 1;\nEND_FOR\nEND_PROGRAM\n")).toContain("while i32::from(self.u) <= i32::from(self.hi) {")
  })

  // transpile-review-2026-09-29 task 13 (conformance `for_limit_wider_than_counter_uint_expr`, recorded: 3 passes, u
  // left at 3). `n - 1` on a UINT is a DINT, so the TEST widens the counter — and the STEP reused that widened read,
  // printing `self.u = (self.u as i32).wrapping_add(1u16)`: E0308. The step adds in the counter's own type.
  test("the step adds in the counter's own type — only the test is widened", () => {
    const code = rust("PROGRAM P\nVAR\n\tn : UINT := 3;\n\tu : UINT;\n\truns : INT;\nEND_VAR\nFOR u := 0 TO n - 1 DO\n\truns := runs + 1;\nEND_FOR\nEND_PROGRAM\n")
    expect(code).toContain("while i32::from(self.u) <= i32::from(self.n).wrapping_sub(1i32) {")
    expect(code).toContain("self.u = self.u.wrapping_add(1u16);")
  })

  test("a same-typed limit is left alone — no needless cast", () => {
    expect(rust("PROGRAM P\nVAR\n\ti : INT;\n\thi : INT := 5;\n\tn : INT;\nEND_VAR\nFOR i := 1 TO hi DO\n\tn := n + 1;\nEND_FOR\nEND_PROGRAM\n")).toContain("while self.i <= self.hi {")
  })
})

// 7.5.8: WHILE TRUE and REPEAT … UNTIL FALSE are a plain `loop`, no `if false { break; }`; 7.5.7: a negated AND is De Morgan's OR
test("WHILE TRUE / UNTIL FALSE print no `if false { break; }`; NOT over AND prints De Morgan's OR", () => {
  const forever = rust("PROGRAM P\nVAR n : INT; END_VAR\nWHILE TRUE DO\n  n := n + 1;\n  IF n > 5 THEN EXIT; END_IF\nEND_WHILE\nREPEAT\n  n := n - 1;\n  IF n < 2 THEN EXIT; END_IF\nUNTIL FALSE\nEND_REPEAT\nEND_PROGRAM\n")
  expect(forever).not.toContain("if false")
  expect(forever).not.toContain("while true")
  const morgan = rust("PROGRAM P\nVAR i : INT; n : INT := 5; g : BOOL; END_VAR\nREPEAT\n  i := i + 1;\nUNTIL i >= n AND i > 3\nEND_REPEAT\ng := NOT (i < n AND i > 2);\nEND_PROGRAM\n")
  expect(morgan).toContain("if self.i >= self.n && self.i > 3i16 { break; }")
  expect(morgan).toContain("self.g = self.i >= self.n || self.i <= 2i16;")
})
