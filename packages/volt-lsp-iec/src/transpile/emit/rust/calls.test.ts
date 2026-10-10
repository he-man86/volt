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
    expect(code).toContain("big: -25536,") // a typed position: no suffix, no parentheses (7.2.8, 7.2.9)
    expect(code).toContain("self.si = -128i8;")
  })

  // MODEL 3: the target a REFERENCE binds lives in the image, which is no Rust lvalue — the in-out is a COPY of it lent
  // for the call and stored back after it, taken through the null check (`lower/pointers/image-rewrite.ts`)
  test("a VAR_IN_OUT bound through a reference binds its target, checked for null first", () => {
    // Why missed (transpiler review 2026-09-15): a VAR_IN_OUT argument printed `&mut <place>` with no check, where the
    // interpreter checks the guard when it binds — and no test bound one through a reference or a pointer.
    const { pou, diagnostics } = lowerSource(
      "PROGRAM Bind\nVAR n : INT; rv : REFERENCE TO INT; adder : FB_Add; END_VAR\nrv REF= n;\nadder(v := rv);\nEND_PROGRAM\nFUNCTION_BLOCK FB_Add\nVAR_IN_OUT v : INT; END_VAR\nv := v + 1;\nEND_FUNCTION_BLOCK\n",
      "Bind",
    )
    expect(diagnostics).toEqual([])
    const code = emitRust(pou!).code
    expect(code).toContain("let mut __copy_0 = { iec_deref(self.rv); i16::from_le_bytes(__mem.ld(self.rv)) };")
    expect(code).toContain("self.adder.call(&mut __copy_0);") // FB_Add reaches no image byte of its own: no `__mem` (7.7.5)
    expect(code).toContain("let __a = self.rv; __mem.st(__a, __v.to_le_bytes());")
  })
})

// ─── the check that matters: does it actually build? ─────────────────────────
// Review of batch 3a: a PROGRAM's METHOD printed its plain arguments inline, AFTER `std::mem::replace` had moved the program
// out — `PRG_C.Bump(amount := PRG_C.runs)` read the `::new()` stand-in's 0 while the interpreter read 1. It compiled, so
// the crate check could not see it. Why missed: the recorded call passed a literal, which reads the same either side.
test("a PROGRAM's METHOD takes its arguments before the program is moved out of Programs", () => {
  const src =
    "PROGRAM P\nVAR seen : INT; END_VAR\nPRG_C();\nseen := PRG_C.Bump(amount := PRG_C.runs);\nEND_PROGRAM\n" +
    // Bump calls another PROGRAM, so it reaches `Programs` and its own program runs moved out (7.7.6)
    "PROGRAM PRG_C\nVAR runs : INT; bumps : INT; END_VAR\nruns := runs + 1;\nEND_PROGRAM\nMETHOD Bump : INT\nVAR_INPUT amount : INT; END_VAR\nPRG_D();\nbumps := bumps + amount;\nBump := bumps;\nEND_METHOD\n" +
    "PROGRAM PRG_D\nVAR n : INT; END_VAR\nn := n + 1;\nEND_PROGRAM\n"
  const { pou, diagnostics } = lowerSource(src, "P")
  expect(diagnostics).toEqual([])
  const line = emitRust(pou!).code.split("\n").find((l) => l.includes("__program.bump"))!
  expect(line.indexOf("let __arg_0 = ")).toBeGreaterThanOrEqual(0)
  expect(line.indexOf("let __arg_0 = ")).toBeLessThan(line.indexOf("std::mem::take"))
})

// 7.6.2: a setter's value is its input itself where it holds no call — `self.sq.size_set(5i16)` — and goes through a temp
// only where it does (a METHOD of the same instance in it must run before the setter's `&mut` is taken)
test("a PROPERTY setter takes a call-free value directly, a value holding a call through its temp", () => {
  const src =
    "FUNCTION_BLOCK FB_Sq\nVAR side : INT := 3; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Area : INT\nArea := side * side;\nEND_METHOD\nPROPERTY Size : INT\nGET\nSize := side;\nEND_GET\nSET\nside := Size;\nEND_SET\nEND_PROPERTY\n" +
    "PROGRAM P\nVAR sq : FB_Sq; n : INT := 2; END_VAR\nsq.Size := n + 3;\nsq.Size := sq.Area();\nEND_PROGRAM\n"
  const { pou, diagnostics } = lowerSource(src, "P")
  expect(diagnostics).toEqual([])
  const code = emitRust(pou!).code
  expect(code).toContain("self.sq.size_set(self.n.wrapping_add(3i16));")
  expect(code).toContain("let __property_")
  expect(code).toMatch(/let (__property_\d+): i16 = self\.sq\.area\(\);\n\s+self\.sq\.size_set\(\1\);/)
})

// 7.6.5: a scalar VAR_IN_OUT CONSTANT is a parameter by value — `value: i16` — handed the variable itself; a
// string CONSTANT stays a borrow, and a literal lent to it is `&` that literal, with no `let __copy_N` before the call
test("a scalar VAR_IN_OUT CONSTANT is taken by value; a literal lent to a CONSTANT needs no copy", () => {
  const { pou, diagnostics } = lowerSource(
    "FUNCTION Twice : INT\nVAR_IN_OUT CONSTANT\n\tv : INT;\nEND_VAR\nTwice := v * 2;\nEND_FUNCTION\nFUNCTION Same : BOOL\nVAR_IN_OUT CONSTANT\n\tt : STRING;\nEND_VAR\nSame := t = 'abc';\nEND_FUNCTION\nPROGRAM P\nVAR n : INT := 4; a : INT; b : INT; ok : BOOL; END_VAR\na := Twice(n);\nok := Same(t := 'abc');\nEND_PROGRAM\n",
    "P",
  )
  expect(diagnostics).toEqual([])
  const code = emitRust(pou!).code
  expect(code).toContain("pub fn twice(v: i16) -> i16 {")
  expect(code).toContain("    v.wrapping_mul(2i16)\n}") // read bare; the result its tail (7.7.3)
  expect(code).toContain("self.a = twice(self.n);")
  expect(code).toMatch(/self\.ok = same\(&IecString::<\d+>::lit\(b"abc"\)\);/)
  expect(code).not.toContain("__copy_")
})

// 7.6.6: an input is taken into a `let __arg_k` only where a call could show its order — up to the last input holding a
// call, in written order; that last one stays inline on a FUNCTION when nothing inline after it comes before it in the
// argument list, and a constant never needs one
test("arguments are hoisted only up to the last one holding a call", () => {
  const { pou, diagnostics } = lowerSource(
    "FUNCTION Dbl : INT\nVAR_INPUT v : INT; END_VAR\nDbl := v * 2;\nEND_FUNCTION\nFUNCTION Pair : INT\nVAR_INPUT a : INT; b : INT; END_VAR\nPair := a * 10 + b;\nEND_FUNCTION\n" +
      "PROGRAM P\nVAR n : INT := 3; x : INT; y : INT; z : INT; END_VAR\nx := Dbl(Dbl(n));\ny := Pair(Dbl(n), n);\nz := Pair(b := Dbl(n), a := n);\nEND_PROGRAM\n",
    "P",
  )
  expect(diagnostics).toEqual([])
  const code = emitRust(pou!).code
  expect(code).toContain("self.x = dbl(dbl(self.n));")
  expect(code).toContain("self.y = pair(dbl(self.n), self.n);")
  // written b then a: `a` (inline, after the call in written order) would come BEFORE it in the argument list, so the call is hoisted
  expect(code).toContain("self.z = { let __arg_1 = dbl(self.n); pair(self.n, __arg_1) };")
})

// 7.7.6: a PROGRAM is moved out of `Programs` only for a callee that reaches `Programs` itself (it is handed `prg`, and
// `prg.p.call(prg)` would borrow it twice); a callee that does not is a plain field call — no `P::new()` stand-in built
test("a PROGRAM whose callee does not reach Programs is called in place, with no `std::mem::take`", () => {
  const src =
    "PROGRAM P\nVAR seen : INT; END_VAR\nPRG_C();\nseen := PRG_C.Bump(amount := PRG_C.runs);\nPRG_C.Reset();\nPRG_E();\nEND_PROGRAM\n" +
    "PROGRAM PRG_C\nVAR runs : INT; bumps : INT; END_VAR\nruns := runs + 1;\nEND_PROGRAM\nMETHOD Bump : INT\nVAR_INPUT amount : INT; END_VAR\nbumps := bumps + amount;\nBump := bumps;\nEND_METHOD\nMETHOD Reset\nbumps := 0;\nEND_METHOD\n" +
    "PROGRAM PRG_E\nVAR k : INT; END_VAR\nPRG_C();\nk := k + 1;\nEND_PROGRAM\n"
  const { pou, diagnostics } = lowerSource(src, "P")
  expect(diagnostics).toEqual([])
  const code = emitRust(pou!).code
  expect(code).toContain("prg.prg_c.call();")
  expect(code).toContain("self.seen = prg.prg_c.bump(prg.prg_c.runs);")
  expect(code).toContain("prg.prg_c.reset();")
  // PRG_E calls PRG_C, so it reaches Programs and still runs moved out
  expect(code).toContain("{ let mut program = std::mem::take(&mut prg.prg_e); program.call(prg); prg.prg_e = program; }")
})
