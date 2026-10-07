import { describe, expect, test } from "bun:test"
import { emitRust } from "./index.js"
import { lowerSource } from "../../lower/index.js"



describe("emit/rust", () => {
  test("an FB call prints its inputs, `.call` with VAR_IN_OUT as `&mut`, then its outputs — and constants at their width", () => {
    // named: `lowerSource` otherwise lowers the FIRST runnable unit, which is the FB
    const { pou, diagnostics } = lowerSource(
      "FUNCTION_BLOCK FB_Inc\nVAR_INPUT by1 : INT; END_VAR\nVAR_IN_OUT v : INT; END_VAR\nVAR_OUTPUT done : BOOL; END_VAR\nv := v + by1;\ndone := TRUE;\nEND_FUNCTION_BLOCK\nPROGRAM Calls\nVAR inc : FB_Inc; n : INT; ok : BOOL; big : INT := 40000; si : SINT; END_VAR\ninc(by1 := 1, v := n, done => ok);\nsi := 128;\nEND_PROGRAM\n",
      "Calls",
    )
    expect(diagnostics).toEqual([])
    const code = emitRust(pou!).code
    expect(code).toContain("pub fn call(&mut self, v: &mut i16) {")
    expect(code).toContain("*v = ") // the VAR_IN_OUT parameter, written through
    expect(code).toContain("self.inc.by1 = 1i16;")
    expect(code).toContain("self.inc.call(&mut self.n);")
    expect(code).toContain("self.ok = self.inc.done;")
    // the stored value, not the literal as written — `40000i16` and `128i8` do not compile
    // PARENTHESIZED: in Rust a method call binds tighter than unary minus, so every negative constant is
    // wrapped — see `literal`. The type MINIMUMS still compile this way (`(-128i8)` keeps Rust's own
    // special case for `-128i8`, verified against rustc for all four widths).
    expect(code).toContain("big: (-25536i16),")
    expect(code).toContain("self.si = -128i8;")
  })

  test("a VAR_IN_OUT bound through a reference binds its target, checked for null first", () => {
    // Why missed (transpiler review 2026-09-15): a VAR_IN_OUT argument printed `&mut <place>` with no check, where the
    // interpreter checks the guard when it binds — and no test bound one through a reference or a pointer.
    const { pou, diagnostics } = lowerSource(
      "PROGRAM Bind\nVAR n : INT; rv : REFERENCE TO INT; adder : FB_Add; END_VAR\nrv REF= n;\nadder(v := rv);\nEND_PROGRAM\nFUNCTION_BLOCK FB_Add\nVAR_IN_OUT v : INT; END_VAR\nv := v + 1;\nEND_FUNCTION_BLOCK\n",
      "Bind",
    )
    expect(diagnostics).toEqual([])
    const code = emitRust(pou!).code
    expect(code).toContain("iec_deref(self.rv);")
    expect(code).toContain("self.adder.call(&mut self.n);")
  })
})

// ─── the check that matters: does it actually build? ─────────────────────────
// Review of batch 3a: a PROGRAM's METHOD printed its plain arguments inline, AFTER `std::mem::replace` had moved the program
// out — `PRG_C.Bump(amount := PRG_C.runs)` read the `::new()` stand-in's 0 while the interpreter read 1. It compiled, so
// the crate check could not see it. Why missed: the recorded call passed a literal, which reads the same either side.
test("a PROGRAM's METHOD takes its arguments before the program is moved out of Programs", () => {
  const src =
    "PROGRAM P\nVAR seen : INT; END_VAR\nPRG_C();\nseen := PRG_C.Bump(amount := PRG_C.runs);\nEND_PROGRAM\n" +
    "PROGRAM PRG_C\nVAR runs : INT; bumps : INT; END_VAR\nruns := runs + 1;\nEND_PROGRAM\nMETHOD Bump : INT\nVAR_INPUT amount : INT; END_VAR\nbumps := bumps + amount;\nBump := bumps;\nEND_METHOD\n"
  const { pou, diagnostics } = lowerSource(src, "P")
  expect(diagnostics).toEqual([])
  const line = emitRust(pou!).code.split("\n").find((l) => l.includes("__program.bump"))!
  expect(line.indexOf("let __arg_0 = ")).toBeGreaterThanOrEqual(0)
  expect(line.indexOf("let __arg_0 = ")).toBeLessThan(line.indexOf("std::mem::take"))
})
