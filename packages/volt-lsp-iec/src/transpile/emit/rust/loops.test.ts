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

  test("all three loop forms print as the same Rust shape", () => {
    const forLoop = rust("PROGRAM P\nVAR i : INT; n : INT; END_VAR\nFOR i := 1 TO 3 DO n := n + 1; END_FOR\nEND_PROGRAM\n")
    const whileLoop = rust("PROGRAM P\nVAR n : INT; END_VAR\nWHILE n < 3 DO n := n + 1; END_WHILE\nEND_PROGRAM\n")
    const repeat = rust("PROGRAM P\nVAR n : INT; END_VAR\nREPEAT n := n + 1; UNTIL n >= 3 END_REPEAT\nEND_PROGRAM\n")
    for (const code of [forLoop, whileLoop, repeat]) {
      expect(code).toContain("loop {")
      expect(code).toContain("break; }")
    }
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
 * The limit was converted to its OWN type (a no-op), so the emitted test compared the two as they were:
 * `FOR i := 1 TO hi` with `i : INT` and `hi : DINT` printed `self.i <= self.hi` — `i16 <= i32`, which rustc
 * rejects with E0308 — and lowering reported nothing. Ordinary ST that CODESYS compiles, and no recorded case
 * caught it because no fixture mixes the two widths.
 *
 * It PROMOTES rather than narrows, and that is the load-bearing half: narrowing the LIMIT into the counter's
 * type would wrap a limit the counter cannot hold (a DINT 100000 into an INT is -31072, and the loop would run
 * zero times instead of until the counter wraps). `commonType` is the promotion the binary operators already
 * use, measured.
 */
describe("emit/rust — a FOR whose limit is a different type", () => {
  test("the counter is promoted to the common type, so the comparison is same-typed", () => {
    expect(rust("PROGRAM P\nVAR\n\ti : INT;\n\thi : DINT := 5;\n\tn : INT;\nEND_VAR\nFOR i := 1 TO hi DO\n\tn := n + 1;\nEND_FOR\nEND_PROGRAM\n")).toContain("if (self.i as i32) > self.hi { break; }")
  })

  // transpile-review-2026-09-29 task 13 (conformance `for_limit_wider_than_counter_uint_expr`, recorded: 3 passes, u
  // left at 3). `n - 1` on a UINT is a DINT, so the TEST widens the counter — and the STEP reused that widened read,
  // printing `self.u = (self.u as i32).wrapping_add(1u16)`: E0308. The step adds in the counter's own type.
  test("the step adds in the counter's own type — only the test is widened", () => {
    const code = rust("PROGRAM P\nVAR\n\tn : UINT := 3;\n\tu : UINT;\n\truns : INT;\nEND_VAR\nFOR u := 0 TO n - 1 DO\n\truns := runs + 1;\nEND_FOR\nEND_PROGRAM\n")
    expect(code).toContain("if (self.u as i32) > (self.n as i32).wrapping_sub(1i32) { break; }")
    expect(code).toContain("self.u = self.u.wrapping_add(1u16);")
  })

  test("a same-typed limit is left alone — no needless cast", () => {
    expect(rust("PROGRAM P\nVAR\n\ti : INT;\n\thi : INT := 5;\n\tn : INT;\nEND_VAR\nFOR i := 1 TO hi DO\n\tn := n + 1;\nEND_FOR\nEND_PROGRAM\n")).toContain("if self.i > self.hi { break; }")
  })
})
