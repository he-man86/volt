import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { emitRust, rustType, snake } from "./emit.js"
import { lowerSource } from "../../lower/index.js"

function rust(src: string): string {
  const { pou, diagnostics } = lowerSource(src)
  expect(diagnostics).toEqual([])
  return emitRust(pou!).code
}

const COUNTER = `
PROGRAM Counter
VAR_INPUT
  Enable : BOOL;
END_VAR
VAR
  iCount   : INT;
  MaxCount : INT := 3;
END_VAR
IF Enable AND iCount < MaxCount THEN
  iCount := iCount + 1;
END_IF
END_PROGRAM
`

describe("emit/rust", () => {
  test("field names are Rust: a keyword gets `_`, and two names that snake_case alike stay two fields", () => {
    // `pub loop: i16` and two `a_b` fields were emitted, and neither compiles (transpiler review 2026-09-14)
    const keywords = rust("PROGRAM P\nVAR\n  loop : INT;\n  match : BOOL;\nEND_VAR\nloop := 1;\nEND_PROGRAM\n")
    expect(keywords).toContain("pub loop_: i16,")
    expect(keywords).toContain("pub match_: bool,")
    expect(keywords).toContain("self.loop_ = 1i16;")
    const collide = rust("PROGRAM P\nVAR\n  aB : INT;\n  a_b : INT;\nEND_VAR\naB := 1;\na_b := 2;\nEND_PROGRAM\n")
    expect(collide).toContain("pub a_b: i16,")
    expect(collide).toContain("pub a_b_2: i16,")
    expect(collide).toContain("self.a_b = 1i16;")
    expect(collide).toContain("self.a_b_2 = 2i16;")
  })

  test("a slot without an initial value starts at its type's zero — and a WSTRING's is a WSTRING", () => {
    // `new` printed its own defaults, and gave every string `IecStr::new()`: a STRING for a WSTRING field
    const code = rust("PROGRAM P\nVAR\n  flag : BOOL;\n  wide : WSTRING;\n  ratio : REAL;\nEND_VAR\nflag := TRUE;\nEND_PROGRAM\n")
    expect(code).not.toContain("IecStr::new()")
    expect(code).toMatch(/wide: IecWString\S*::lit\(/)
  })

  test("the IEC type mapping comes from the type's own facts", () => {
    const { pou } = lowerSource("PROGRAM P\nVAR a : SINT; b : INT; c : DINT; d : BYTE; e : WORD; f : REAL; g : LREAL; h : BOOL; END_VAR\na := a;\nEND_PROGRAM\n")
    expect(pou!.slots.map((s) => rustType(s.type))).toEqual(["i8", "i16", "i32", "u8", "u16", "f32", "f64", "bool"])
  })

  test("TIME is a u32 of milliseconds and LTIME a u64 of nanoseconds — not the i64 every duration used to be", () => {
    const { pou } = lowerSource("PROGRAM P\nVAR t : TIME := T#1S500MS; lt1 : LTIME := LTIME#1NS; END_VAR\nt := t;\nEND_PROGRAM\n")
    expect(pou!.slots.map((s) => rustType(s.type))).toEqual(["u32", "u64"])
    expect(pou!.slots.map((s) => s.init)).toEqual([1500n, 1n]) // folded, in each type's unit
  })

  test("an FB call prints its inputs, `.call` with VAR_IN_OUT as `&mut`, then its outputs — and constants at their width", () => {
    // named: `lowerSource` otherwise lowers the FIRST runnable unit, which is the FB
    const { pou, diagnostics } = lowerSource(
      "FUNCTION_BLOCK FB_Inc\nVAR_INPUT by1 : INT; END_VAR\nVAR_IN_OUT v : INT; END_VAR\nVAR_OUTPUT done : BOOL; END_VAR\nv := v + by1;\ndone := TRUE;\nEND_FUNCTION_BLOCK\nPROGRAM Calls\nVAR inc : FB_Inc; n : INT; ok : BOOL; big : INT := 40000; si : SINT; END_VAR\ninc(by1 := 1, v := n, done => ok);\nsi := 128;\nEND_PROGRAM\n",
      "Calls",
    )
    expect(diagnostics).toEqual([])
    const code = emitRust(pou!).code
    expect(code).toContain("pub fn call(&mut self, v: &mut i16) {")
    expect(code).toContain("(*v) = ") // the VAR_IN_OUT parameter, written through
    expect(code).toContain("self.inc.by1 = 1i16;")
    expect(code).toContain("self.inc.call(&mut self.n);")
    expect(code).toContain("self.ok = self.inc.done;")
    // the stored value, not the literal as written — `40000i16` and `128i8` do not compile
    expect(code).toContain("big: -25536i16,")
    expect(code).toContain("self.si = -128i8;")
  })

  test("a METHOD is an fn in its FB's impl and a FUNCTION a free fn — inputs by value, locals `let mut` per call", () => {
    const { pou, diagnostics } = lowerSource(
      "FUNCTION_BLOCK FB_M\nVAR calls : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Tick : INT\nVAR_INPUT amount : INT; END_VAR\nVAR localCount : INT; END_VAR\nlocalCount := localCount + amount;\ncalls := calls + 1;\nTick := localCount;\nEND_METHOD\nFUNCTION F_Acc : INT\nVAR_INPUT amount : INT; END_VAR\nF_Acc := amount;\nEND_FUNCTION\nPROGRAM Routines\nVAR inst : FB_M; got : INT; END_VAR\ngot := inst.Tick(amount := 3) + F_Acc(4);\nEND_PROGRAM\n",
      "Routines",
    )
    expect(diagnostics).toEqual([])
    const code = emitRust(pou!).code
    expect(code).toContain("pub fn tick(&mut self, mut amount: i16) -> i16 {")
    expect(code).toContain("let mut local_count: i16 = 0i16;")
    expect(code).toContain("self.calls = ") // the instance's field, through `self`
    expect(code).toContain("pub fn f_acc(mut amount: i16) -> i16 {")
    expect(code).toContain("self.inst.tick(3i16)")
    expect(code).toContain("f_acc(4i16)")
  })

  test("globals are a `Globals` struct handed to every body as `g`; called PROGRAMs live apart in `Programs`", () => {
    const { pou, diagnostics } = lowerSource(
      "PROGRAM Main\nVAR reader : FB_Reader; seen : INT; END_VAR\nPRG_Writer();\nseen := gShared;\nreader();\nEND_PROGRAM\nVAR_GLOBAL\n  gShared : INT := 3;\nEND_VAR\nFUNCTION_BLOCK FB_Reader\nVAR_OUTPUT q : INT; END_VAR\nq := gShared;\nEND_FUNCTION_BLOCK\nPROGRAM PRG_Writer\nVAR runs : INT; END_VAR\nruns := runs + 1;\ngShared := runs;\nEND_PROGRAM\n",
      "Main",
    )
    expect(diagnostics).toEqual([])
    const emitted = emitRust(pou!)
    expect([emitted.usesGlobals, emitted.usesPrograms]).toEqual([true, true])
    expect(emitted.code).toContain("pub struct Globals {")
    expect(emitted.code).toContain("g_shared: 3i16,")
    expect(emitted.code).toContain("pub struct Programs {")
    expect(emitted.code).toContain("pub fn scan(&mut self, g: &mut Globals, prg: &mut Programs) {")
    // Every body is handed `g` and `prg`, as any body may call a PROGRAM (conformance `state_program_called_from_fb`); a
    // program runs moved out of `Programs` and back, so the call never borrows `prg` twice. This read
    // `prg.prg_writer.call(g)` while only the POU's own scan could call a program.
    expect(emitted.code).toContain("{ let mut program = std::mem::replace(&mut prg.prg_writer, PRG_Writer::new()); program.call(g, prg); prg.prg_writer = program; }")
    expect(emitted.code).toContain("self.seen = g.g_shared;")
    expect(emitted.code).toContain("pub fn call(&mut self, g: &mut Globals, prg: &mut Programs) {")
  })

  test("an enum variable is its base type and an enum value its number; THIS^ is `self`", () => {
    const { pou, diagnostics } = lowerSource(
      "PROGRAM Enums\nVAR mode : E_Mode; small : E_Small; inst : FB_This; END_VAR\nmode := E_Mode.Busy;\nsmall := Hi;\ninst.Bump();\nEND_PROGRAM\nTYPE E_Mode : (Idle, Busy := 4); END_TYPE\nTYPE E_Small : (Lo, Hi) BYTE; END_TYPE\nFUNCTION_BLOCK FB_This\nVAR n : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Bump\nTHIS^.n := THIS^.n + 1;\nEND_METHOD\n",
      "Enums",
    )
    expect(diagnostics).toEqual([])
    const code = emitRust(pou!).code
    expect(code).toContain("pub mode: i16,")
    expect(code).toContain("pub small: u8,")
    expect(code).toContain("self.mode = 4i16;")
    expect(code).toContain("self.small = 1u8;")
    expect(code).toContain("self.n = ") // THIS^.n, through `self`
  })

  test("a pointer is a usize index of its one target; every access through it checks for null first", () => {
    const { pou, diagnostics } = lowerSource(
      "PROGRAM Ptrs\nVAR iValue : INT := 7; pInt : POINTER TO INT; iCopy : INT; arr : ARRAY[0..2] OF INT; pa : POINTER TO INT; END_VAR\npInt := ADR(iValue);\niCopy := pInt^;\npa := ADR(arr[1]);\npa[1] := 5;\nEND_PROGRAM\n",
      "Ptrs",
    )
    expect(diagnostics).toEqual([])
    const code = emitRust(pou!).code
    expect(code).toContain("pub p_int: usize,")
    expect(code).toContain("self.p_int = 1;")
    expect(code).toContain("self.i_copy = { iec_deref(self.p_int); self.i_value };")
    expect(code).toContain("as usize)") // the element index crosses into the pointer explicitly
    expect(code).toContain("iec_deref(self.pa);") // a write through a pointer is checked on the line before
    expect(code).toContain('fn iec_deref(at: usize) { if at == 0 { panic!("dereference of a null pointer"); } }')
  })

  test("a VAR_IN_OUT bound through a reference binds its target, checked for null first", () => {
    // Why missed (transpiler review 2026-09-15): a VAR_IN_OUT argument printed `&mut <place>` with no check, where the
    // interpreter checks the guard when it binds — and no test bound one through a reference or a pointer.
    const { pou, diagnostics } = lowerSource(
      "PROGRAM Bind\nVAR n : INT; r : REFERENCE TO INT; adder : FB_Add; END_VAR\nr REF= n;\nadder(v := r);\nEND_PROGRAM\nFUNCTION_BLOCK FB_Add\nVAR_IN_OUT v : INT; END_VAR\nv := v + 1;\nEND_FUNCTION_BLOCK\n",
      "Bind",
    )
    expect(diagnostics).toEqual([])
    const code = emitRust(pou!).code
    expect(code).toContain("iec_deref(self.r);")
    expect(code).toContain("self.adder.call(&mut self.n);")
  })

  test("BOOL AND/OR print Rust's eager `&`/`|`; only AND_THEN/OR_ELSE short-circuit", () => {
    // Why missed (transpiler review 2026-09-15): the golden and crate sources used AND_THEN, or AND on operands without
    // a call, where `&&` and `&` give one answer — the interpreter's both-sides evaluation was never compared.
    const { pou, diagnostics } = lowerSource("PROGRAM Eager\nVAR a : BOOL; b : BOOL; c : BOOL; d : BOOL; END_VAR\nc := a AND b;\nd := a OR_ELSE b;\nEND_PROGRAM\n", "Eager")
    expect(diagnostics).toEqual([])
    const code = emitRust(pou!).code
    expect(code).toContain("self.c = (self.a & self.b);")
    expect(code).toContain("self.d = (self.a || self.b);")
  })

  test("MOD guards a zero divisor — 0, as measured, where Rust's % panics — and NOT of an INT is a u16", () => {
    const { pou, diagnostics } = lowerSource("PROGRAM M\nVAR a : INT := 7; z : INT; m : INT; w : DINT; END_VAR\nm := a MOD z;\nw := NOT a;\nEND_PROGRAM\n", "M")
    expect(diagnostics).toEqual([])
    const code = emitRust(pou!).code
    // the operands promoted to DINT first (MOD is a lifted operator), then the guard; the result narrowed back to INT
    expect(code).toContain("self.m = (({ let a = (self.a as i32); let d = (self.z as i32); if d == 0 { 0 } else { a.wrapping_rem(d) } }) as i16);")
    expect(code).toContain("self.w = ((!(self.a as u16)) as i32);")
  })

  test("ST names become snake_case fields", () => {
    expect(["iCount", "MaxCount", "PLC_Ready", "x"].map(snake)).toEqual(["i_count", "max_count", "plc_ready", "x"])
  })

  test("a POU emits as one flat struct with a scan method — no references anywhere", () => {
    const code = rust(COUNTER)
    expect(code).toContain("pub struct Counter {")
    expect(code).toContain("pub i_count: i16,")
    expect(code).toContain("pub fn scan(&mut self) {")
    expect(code).toContain("max_count: 3i16,") // the declared initial value, not Default's zero
    // The whole point of the flat-frame decision: `&mut self` is the ONLY borrow in the output.
    expect(code.match(/&mut/g)).toEqual(["&mut"])
    expect(code).not.toContain("&'")
  })

  test("IEC integers wrap at their width rather than panicking like Rust's defaults", () => {
    expect(rust(COUNTER)).toContain("wrapping_add")
  })

  test("integer negation wraps — Rust's `-` panics on a minimum — while REAL negation stays plain", () => {
    const code = rust("PROGRAM P\nVAR d : DINT; e : DINT; x : REAL; y : REAL; END_VAR\ne := -d; y := -x;\nEND_PROGRAM\n")
    expect(code).toContain("self.d.wrapping_neg()")
    expect(code).toContain("(-self.x)")
  })

  test("LIMIT prints as max-then-min, never `clamp` — Rust's clamp panics when MN > MX, CODESYS answers it", () => {
    const code = rust("PROGRAM P\nVAR x : INT; y : INT; g : BOOL; END_VAR\ny := LIMIT(100, x, 0); y := MAX(x, 1, 2); y := SEL(g, 1, 2);\nEND_PROGRAM\n")
    expect(code).not.toContain("clamp")
    expect(code).toContain(".max(")
    expect(code).toContain(".min(")
    expect(code).toContain("(if self.g {")
  })

  test("conversions print CODESYS's rules, not a bare `as` — which truncates, saturates, and has no bool", () => {
    const code = rust(
      "PROGRAM P\nVAR x : REAL; i : INT; b : BOOL; n : INT; y : REAL; d : DINT; END_VAR\ni := REAL_TO_INT(x); b := INT_TO_BOOL(n); y := BOOL_TO_REAL(b); d := TRUNC(x); i := DINT_TO_SINT(300);\nEND_PROGRAM\n",
    )
    expect(code).toContain("((self.x.round() as i64) as i16)") // rounds, then wraps through i64
    expect(code).toContain("(self.n != 0)")
    expect(code).toContain("((self.b as u8) as f32)")
    // TRUNC out of DINT range is i32::MIN (measured), so it is range-checked, not pushed through a wrapping i64
    expect(code).toContain("(self.x as f64).trunc()")
    expect(code).toContain("i32::MIN")
    expect(code).not.toContain("300i8") // an explicit conversion is a node, never an out-of-range literal
  })

  test("math computes through f64 and narrows; ABS wraps a signed minimum and is the identity on unsigned", () => {
    const code = rust(
      "PROGRAM P\nVAR x : REAL; y : REAL; i : INT; j : DINT; u : ULINT; v : ULINT; END_VAR\ny := LN(x); j := ABS(i); y := ABS(x); v := ABS(u);\nEND_PROGRAM\n",
    )
    expect(code).toContain("((self.x as f64).ln() as f32)")
    expect(code).toContain("(self.i as i32).wrapping_abs()") // promoted to DINT; `abs` would panic on the minimum
    expect(code).toContain("self.x.abs()")
    expect(code).toContain("self.v = self.u;") // u64 has no `abs`
  })

  test("EXPT is `powf` through f64, narrowed to REAL only when both arguments are REAL", () => {
    const code = rust("PROGRAM P\nVAR x : REAL; y : REAL; n : INT; z : LREAL; END_VAR\ny := EXPT(x, y); z := EXPT(x, n);\nEND_PROGRAM\n")
    expect(code).toContain("((self.x as f64).powf(self.y as f64) as f32)")
    expect(code).toContain("(((self.x as f64) as f64).powf((self.n as f64) as f64) as f64)") // one INT: LREAL
  })

  test("bit operations print Rust's own wrapping_shl/rotate_left, MUX a match, and bit access one slot's mask", () => {
    const code = rust(
      "PROGRAM P\nVAR b : BYTE; n : INT; w : WORD; x : BOOL; i : INT; k : INT; END_VAR\nw := SHL(b, n); b := ROL(b, n); x := w.3; i.15 := x; i := MUX(k, 1, 2, 3);\nEND_PROGRAM\n",
    )
    expect(code).toContain("(self.b as i32).wrapping_shl((self.n as u32))") // promoted, then Rust's own mask
    expect(code).toContain("self.b.rotate_left((self.n as u32))") // the BYTE's own width
    expect(code).toContain("(((self.w >> 3) & 1) != 0)")
    // the place named once (review 2026-09-15: printed on both sides, a call in its index ran twice)
    expect(code).toContain("{ let v = self.x; let w = &mut self.i; *w = if v { *w | (1i16 << 15) } else { *w & !(1i16 << 15) }; }")
    expect(code).toContain("_ => ") // out-of-range K picks the last input
  })

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

  test("CASE prints as a match with inclusive ranges", () => {
    const code = rust("PROGRAM P\nVAR m : INT; n : INT; END_VAR\nCASE m OF\n 1: n := 0;\n 2..4: n := 1;\nELSE\n n := 9;\nEND_CASE\nEND_PROGRAM\n")
    expect(code).toContain("1 => {")
    expect(code).toContain("2..=4 => {")
    expect(code).toContain("_ => {")
  })

  test("every emitted statement line maps back to an ST span", () => {
    const { pou } = lowerSource(COUNTER)
    const { code, sourceMap } = emitRust(pou!)
    expect(sourceMap.length).toBeGreaterThan(0)
    const lines = code.split("\n")
    for (const { line, span } of sourceMap) {
      expect(lines[line - 1]).toBeDefined()
      expect(span.startLine).toBeGreaterThan(0)
    }
    // the assignment inside the IF maps to the ST line that holds it
    const assignment = sourceMap.find(({ line }) => lines[line - 1]?.includes("i_count = "))
    expect(assignment?.span.startLine).toBe(11)
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
  expect(line.indexOf("let __arg_0 = ")).toBeLessThan(line.indexOf("std::mem::replace"))
})

// `rustc` alone, no cargo and no crate — a golden-text test proves the shape, this proves the Rust is real.
// Skipped where rustc is absent so `bun test` stays toolchain-free; CI on a Rust-equipped runner still runs it.

const rustc = Bun.which("rustc")

describe.skipIf(rustc === null)("emit/rust — compiles", () => {
  test("the emitted crate builds clean under rustc", async () => {
    const sources = [
      COUNTER,
      "PROGRAM Loops\nVAR i : INT; n : INT; w : INT; END_VAR\nFOR i := 1 TO 3 DO n := n + i; END_FOR\nWHILE w < 3 DO w := w + 1; END_WHILE\nREPEAT n := n - 1; UNTIL n <= 0 END_REPEAT\nEND_PROGRAM\n",
      "PROGRAM Branch\nVAR m : INT; n : INT; r : REAL; ok : BOOL; END_VAR\nCASE m OF\n 1: n := 0;\n 2..4: n := 1;\nELSE\n n := 9;\nEND_CASE\nok := (m > 0) AND_THEN (n < 10);\nr := m / 2;\nEND_PROGRAM\n",
      // Two temps of each kind in ONE POU. Temps were named by purpose alone, so this made two identical struct
      // fields — and no source here ever held more than one temp, so the crate check could not see it.
      "PROGRAM Temps\nVAR i : INT; j : INT; n : INT; a : BOOL; b : BOOL; c : BOOL; END_VAR\nFOR i := 1 TO 3 DO n := n + i; END_FOR\nFOR j := 1 TO 2 DO n := n - j; END_FOR\na S= b R= c;\nb S= a R= c;\nEND_PROGRAM\n",
      // STRING: a truncating store, a byte-wise compare, both conversions and a Standard function. No source here held a
      // string, so the Rust `String` it used to map to — which `self.a = self.b` MOVES out of `self` — was never built.
      "PROGRAM Strings\nVAR a : STRING(3); b : STRING := 'ab$Tc'; ok : BOOL; n : INT; END_VAR\na := b;\nok := a < b;\nb := INT_TO_STRING(n);\nn := STRING_TO_INT(b) + LEN(b);\nEND_PROGRAM\n",
      // Composites (phase 3 step 2): a nested struct copied whole, an array of structs past 32 elements (no `Default`
      // derive), a two-dimensional array, a bit of a field and an FB instance's variable — all plain owned values.
      // The PROGRAM comes first: `lowerSource` lowers the first runnable unit, and with the FB first this built only the FB.
      "PROGRAM Composites\nVAR p1 : T_Pair; p2 : T_Pair; many : ARRAY[1..40] OF T_Pt; grid : ARRAY[0..1, 0..2] OF BOOL; inst : FB_Q; i : INT := 2; END_VAR\np2 := p1;\nmany[i].x := p2.a.x + inst.q;\ngrid[1, i] := many[40].x.0;\nEND_PROGRAM\nTYPE T_Pt : STRUCT x : INT := 7; name : STRING(4); END_STRUCT END_TYPE\nTYPE T_Pair : STRUCT a : T_Pt; b : T_Pt; END_STRUCT END_TYPE\nFUNCTION_BLOCK FB_Q\nVAR_OUTPUT q : INT; END_VAR\nEND_FUNCTION_BLOCK\n",
      // Calls (phase 3 step 3): inputs and outputs around `.call(…)`, a VAR_IN_OUT as a `&mut` parameter bound to a field
      // of the caller, a nested instance called from an FB body — the borrow checker is the check.
      "PROGRAM Calls\nVAR inc : FB_Inc; outer : FB_Outer; n : INT; ok : BOOL; big : INT := 40000; si : SINT; END_VAR\ninc(by1 := 1, v := n, done => ok);\nouter();\nsi := 128;\nEND_PROGRAM\nFUNCTION_BLOCK FB_Inc\nVAR_INPUT by1 : INT; END_VAR\nVAR_IN_OUT v : INT; END_VAR\nVAR_OUTPUT done : BOOL; END_VAR\nv := v + by1;\ndone := TRUE;\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK FB_Outer\nVAR inner : FB_Inc; total : INT; END_VAR\ninner(by1 := 2, v := total);\nEND_FUNCTION_BLOCK\n",
      // Routines (phase 3 step 4): a METHOD with a result, a local, a loop temp and a RETURN; an ACTION; a METHOD with a
      // VAR_IN_OUT bound to a program field; a FUNCTION called positionally inside an expression.
      // Globals (phase 3 step 5): a GVL variable read and written through VAR_EXTERNAL, an FB and a FUNCTION reaching it,
      // and a PROGRAM called — `g` and `prg` borrowed side by side.
      "PROGRAM GlobalCalls\nVAR_EXTERNAL gCount : INT; END_VAR\nVAR reader : FB_GReader; seen : INT; END_VAR\nPRG_GWriter();\ngCount := gCount + F_GRead(1);\nreader(q => seen);\nseen := PRG_GWriter.runs;\nEND_PROGRAM\nVAR_GLOBAL\n  gCount : INT := 1;\nEND_VAR\nFUNCTION_BLOCK FB_GReader\nVAR_OUTPUT q : INT; END_VAR\nq := gCount;\nEND_FUNCTION_BLOCK\nFUNCTION F_GRead : INT\nVAR_INPUT k : INT; END_VAR\nF_GRead := gCount * k;\nEND_FUNCTION\nPROGRAM PRG_GWriter\nVAR runs : INT; END_VAR\nruns := runs + 1;\ngCount := runs;\nEND_PROGRAM\n",
      // Enums and THIS^: an enum variable of each base, a value in a CASE, a method calling another through THIS^.
      "PROGRAM EnumsAndThis\nVAR mode : E_M; small : E_S; picked : INT; inst : FB_T; END_VAR\nmode := E_M.Busy;\nsmall := E_S.Hi;\nCASE mode OF\n  E_M.Idle: picked := 0;\n  Busy: picked := 1;\nEND_CASE\ninst.Outer();\nEND_PROGRAM\nTYPE E_M : (Idle, Busy); END_TYPE\nTYPE E_S : (Lo, Hi) BYTE; END_TYPE\nFUNCTION_BLOCK FB_T\nVAR n : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Inner\nTHIS^.n := THIS^.n + 1;\nEND_METHOD\nMETHOD Outer\nTHIS^.Inner();\nEND_METHOD\n",
      // A STRING VAR_IN_OUT bound to a variable of ANOTHER capacity — `VAR_IN_OUT text : STRING` (sizeless, so 80) taking
      // a STRING(12) and a literal (conformance `xo4_inout_constant_chain`). The parameter was printed with the slot's
      // own capacity, so rustc refused the call: "expected `80`, found `12`". It is generic over the capacity now.
      // Why missed: every string in the crate check was a whole variable, never one lent to a routine.
      "PROGRAM Lent\nVAR title : STRING(12) := 'hello world'; wide : WSTRING(4) := \"ab\"; n : INT; m : INT; k : INT; END_VAR\nn := F_Width(text := title);\nm := F_Width(text := 'abc');\nk := F_Units(text := wide);\nEND_PROGRAM\nFUNCTION F_Width : INT\nVAR_IN_OUT CONSTANT text : STRING; END_VAR\nF_Width := LEN(text);\nEND_FUNCTION\nFUNCTION F_Units : INT\nVAR_IN_OUT text : WSTRING; END_VAR\nF_Units := 1;\ntext := \"zz\";\nEND_FUNCTION\n",
      // Pointers and references (phase 3 step 6b): a pointer to a variable, to array elements stepped by SIZEOF, a method
      // through a pointer to an instance, a reference bound with REF= and read and written, a null comparison.
      "PROGRAM Pointers\nVAR iValue : INT := 7; pInt : POINTER TO INT; arr : ARRAY[0..4] OF T_P; p : POINTER TO T_P; q : POINTER TO T_P; inst : FB_P; pInst : POINTER TO FB_P; target : INT; r : REFERENCE TO INT; ok : BOOL; n : INT; END_VAR\npInt := ADR(iValue);\nn := pInt^;\np := ADR(arr[1]);\nq := p + SIZEOF(T_P);\np[2].x := q^.x;\npInst := ADR(inst);\npInst^.Bump();\nr REF= target;\nr := r + 1;\nok := __ISVALIDREF(r) AND (pInt <> 0);\nEND_PROGRAM\nTYPE T_P : STRUCT x : INT; y : REAL; END_STRUCT END_TYPE\nFUNCTION_BLOCK FB_P\nVAR n : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Bump\nn := n + 1;\nEND_METHOD\n",
      "PROGRAM RoutineCalls\nVAR inst : FB_R; got : INT; sink : INT; END_VAR\ngot := inst.Sum(upto := 4) + F_Twice(3);\ninst.Reset();\ninst.Store(dest := sink);\nEND_PROGRAM\nFUNCTION_BLOCK FB_R\nVAR total : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Sum : INT\nVAR_INPUT upto : INT; END_VAR\nVAR i : INT; END_VAR\nFOR i := 1 TO upto DO\n  Sum := Sum + i;\n  IF Sum > 100 THEN RETURN; END_IF\nEND_FOR\ntotal := Sum;\nEND_METHOD\nACTION Reset\ntotal := 0;\nEND_ACTION\nMETHOD Store\nVAR_IN_OUT dest : INT; END_VAR\ndest := total;\nEND_METHOD\nFUNCTION F_Twice : INT\nVAR_INPUT x : INT; END_VAR\nF_Twice := x * 2;\nEND_FUNCTION\n",
      // Routine state (phase 3½): a METHOD's VAR_INST as a field and VAR_STAT as a global, a PROPERTY set from its own
      // getter through a temp (never a call inside the setter's arguments), and an argument left empty.
      "PROGRAM State\nVAR one : FB_SK; got : INT; seen : INT; END_VAR\ngot := one.Tick();\none.Level := one.Level + 1;\nseen := one.Level;\none(a := , b := 2);\nEND_PROGRAM\nFUNCTION_BLOCK FB_SK\nVAR_INPUT a : INT; b : INT; END_VAR\nVAR stored : INT; END_VAR\nstored := stored + a + b;\nEND_FUNCTION_BLOCK\nMETHOD Tick : INT\nVAR_INST ticks : INT := 10; END_VAR\nVAR_STAT shared : INT; END_VAR\nticks := ticks + 1;\nshared := shared + 1;\nTick := ticks + shared;\nEND_METHOD\nPROPERTY Level : INT\nGET\nLevel := stored;\nEND_GET\nSET\nstored := Level;\nEND_SET\nEND_PROPERTY\n",
      // Inheritance (phase 3½): a derived FB with inherited fields and VAR_IN_OUT, `SUPER^(…)` passing the in-out on, a
      // base body calling the override bare, and `SUPER^.M()` — each base routine an `fn` of the derived FB's `impl`.
      // Aggregate initializers (phase 3½): struct fields over `new()`, an array of structs element by element, a
      // two-dimensional array row by row, an FB instance through its inputs — `initOf` built only `new()` and `[x; N]`.
      "PROGRAM Aggregates\nVAR part : T_AP := (y := 7); pts : ARRAY[0..2] OF T_AP := [(x := 1), (tag := 'bc')]; grid : ARRAY[1..2, 1..3] OF INT := [1, 2(7), 4]; fb : FB_AS := (offset := 7); END_VAR\nfb();\nEND_PROGRAM\nTYPE T_AP : STRUCT x : INT := 5; y : REAL; tag : STRING(8) := 'p'; END_STRUCT END_TYPE\nFUNCTION_BLOCK FB_AS\nVAR_INPUT factor : INT := 2; offset : INT; END_VAR\nVAR_OUTPUT result : INT; END_VAR\nresult := factor * 10 + offset;\nEND_FUNCTION_BLOCK\n",
      // UNION (phase 3½): a store into one member copied byte by byte into the others — `u64` division and remainder.
      "PROGRAM Unions\nVAR u : U_WB; END_VAR\nu.word := 16#ABCD;\nu.bytes[1] := 16#EE;\nEND_PROGRAM\nTYPE U_WB :\nUNION\n\tword : WORD;\n\tbytes : ARRAY[0..1] OF BYTE;\n\twide : LWORD;\nEND_UNION\nEND_TYPE\n",
      // Interfaces (phase 5): a call and a property set and get dispatched on the tag, a copy between interfaces, and
      // __QUERYINTERFACE as a `match` — the arms borrow one instance field each.
      "PROGRAM Interfaces\nVAR sq : FB_Sq; rc : FB_Rc; shapeRef : I_Shape; baseRef : I_Base; found : BOOL; a1 : INT; seen : INT; END_VAR\nIF baseRef <> 0 THEN a1 := baseRef.Area(); END_IF\nshapeRef := sq;\nshapeRef.Size := 5;\nseen := shapeRef.Size;\nbaseRef := shapeRef;\nfound := __QUERYINTERFACE(baseRef, shapeRef);\nbaseRef := rc;\nEND_PROGRAM\nINTERFACE I_Base\nMETHOD Area : INT\nEND_METHOD\nEND_INTERFACE\nINTERFACE I_Shape EXTENDS I_Base\nPROPERTY Size : INT\nGET\nEND_GET\nSET\nEND_SET\nEND_PROPERTY\nEND_INTERFACE\nFUNCTION_BLOCK FB_Sq IMPLEMENTS I_Shape\nVAR side : INT := 3; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Area : INT\nArea := side * side;\nEND_METHOD\nPROPERTY Size : INT\nGET\nSize := side;\nEND_GET\nSET\nside := Size;\nEND_SET\nEND_PROPERTY\nFUNCTION_BLOCK FB_Rc IMPLEMENTS I_Base\nEND_FUNCTION_BLOCK\nMETHOD Area : INT\nArea := 7;\nEND_METHOD\n",
      // Declaration lifetimes (review 2026-09-15): an FB's VAR_STAT one field of `Globals` handed as `g`, VAR_TEMP reset
      // at the head of the body, the base's in the `SUPER^()` routine, the root's at the head of `scan`.
      "PROGRAM Lifetimes\nVAR first : FB_LD; second : FB_LD; END_VAR\nVAR_TEMP scratch : INT := 2; END_VAR\nscratch := scratch + 1;\nfirst();\nsecond();\nEND_PROGRAM\nFUNCTION_BLOCK FB_LB\nVAR_STAT counter : INT; END_VAR\nVAR_TEMP baseTemp : INT := 10; END_VAR\nbaseTemp := baseTemp + counter;\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK FB_LD EXTENDS FB_LB\nVAR_TEMP own : INT; END_VAR\nown := own + 1;\ncounter := counter + own;\nSUPER^();\nEND_FUNCTION_BLOCK\n",
      // VAR_IN_OUT CONSTANT: a `&` parameter bound to a variable, `&{ literal }`, and a method on `&mut self` reading its
      // own field through a copy — the borrow checker is the check.
      "PROGRAM InOutConstant\nVAR x : INT := 3; fromFn : INT; matches : BOOL; inst : FB_IC; END_VAR\nmatches := F_IC_Match(text := 'abc');\nfromFn := F_IC_Twice(value := x);\ninst();\nEND_PROGRAM\nFUNCTION F_IC_Match : BOOL\nVAR_IN_OUT CONSTANT text : STRING; END_VAR\nF_IC_Match := text = 'abc';\nEND_FUNCTION\nFUNCTION F_IC_Twice : INT\nVAR_IN_OUT CONSTANT value : INT; END_VAR\nF_IC_Twice := value * 2;\nEND_FUNCTION\nFUNCTION_BLOCK FB_IC\nVAR own : INT := 4; got : INT; END_VAR\ngot := Twice(value := own);\nEND_FUNCTION_BLOCK\nMETHOD Twice : INT\nVAR_IN_OUT CONSTANT value : INT; END_VAR\nTwice := value * 2;\nEND_METHOD\n",
      // Review of that batch: a copy lent beside a `&mut` of the same variable (`let` first — it was E0503), and an FB call
      // statement binding a VAR_IN_OUT CONSTANT to a variable and to a STRING literal.
      "PROGRAM LentCopies\nVAR x : INT := 3; y : INT; h : FB_LH; END_VAR\ny := F_LBoth(a := x, c := x);\nh(threshold := x, label := 'abc');\nEND_PROGRAM\nFUNCTION F_LBoth : INT\nVAR_IN_OUT a : INT; END_VAR\nVAR_IN_OUT CONSTANT c : INT; END_VAR\nF_LBoth := a + c;\nEND_FUNCTION\nFUNCTION_BLOCK FB_LH\nVAR_IN_OUT CONSTANT threshold : INT; label : STRING; END_VAR\nVAR_OUTPUT doubled : INT; matches : BOOL; END_VAR\ndoubled := threshold * 2;\nmatches := label = 'abc';\nEND_FUNCTION_BLOCK\n",
      // An FB instance lent through a VAR_IN_OUT CONSTANT is `&mut` — called and its METHOD run on it — and the address of
      // an INT one is taken and read through (recorded: `inout_const_fb_call_13`, `inout_const_adr_11`).
      "PROGRAM LentInstance\nVAR inst : FB_LI; y : INT; x : INT := 2; END_VAR\ny := F_LI(lent := inst) + F_LA(value := x);\nEND_PROGRAM\nFUNCTION_BLOCK FB_LI\nVAR_OUTPUT q : INT; END_VAR\nq := q + 1;\nEND_FUNCTION_BLOCK\nMETHOD Get : INT\nGet := q;\nEND_METHOD\nFUNCTION F_LI : INT\nVAR_IN_OUT CONSTANT lent : FB_LI; END_VAR\nlent();\nF_LI := lent.Get() + lent.q;\nEND_FUNCTION\nFUNCTION F_LA : INT\nVAR_IN_OUT CONSTANT value : INT; END_VAR\nVAR p : POINTER TO INT; END_VAR\np := ADR(value);\nF_LA := p^;\nEND_FUNCTION\n",
      // Interface inputs (design §24): an FB's kept input and a METHOD's input, each body lent `&mut` of the instance by its
      // caller — `self.meter.call(&mut self.sq)`, and passed on as `&mut (*__lent_0)`.
      "PROGRAM Lending\nVAR sq : FB_LSq; meter : FB_LMeter; outer : FB_LOuter; got : INT; END_VAR\nmeter(shape := sq, measured => got);\nouter.Measure(shape := sq);\nEND_PROGRAM\nINTERFACE I_LShape\nMETHOD Area : INT\nEND_METHOD\nEND_INTERFACE\nFUNCTION_BLOCK FB_LSq IMPLEMENTS I_LShape\nVAR side : INT := 3; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Area : INT\nArea := side * side;\nEND_METHOD\nFUNCTION_BLOCK FB_LMeter\nVAR_INPUT shape : I_LShape; END_VAR\nVAR_OUTPUT measured : INT; END_VAR\nIF shape <> 0 THEN\n  measured := shape.Area();\nEND_IF\nEND_FUNCTION_BLOCK\nFUNCTION F_LTen : INT\nVAR_INPUT shape : I_LShape; END_VAR\nF_LTen := shape.Area() * 10;\nEND_FUNCTION\nFUNCTION_BLOCK FB_LOuter\nVAR inner : FB_LMeter; END_VAR\nVAR_OUTPUT via : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Measure\nVAR_INPUT shape : I_LShape; END_VAR\nvia := F_LTen(shape := shape);\ninner(shape := shape);\nEND_METHOD\n",
      // Review of that batch: THIS^ lent to a FUNCTION's interface input (`&mut *self`, it was `&mut self`, E0596), and a
      // parent handing its own child its own field, per instance.
      "PROGRAM LendThis\nVAR o : FB_LTo; p1 : FB_LTp; p2 : FB_LTp; END_VAR\no();\np1(k := 2);\np2(k := 3);\nEND_PROGRAM\nINTERFACE I_LT\nMETHOD Area : INT\nEND_METHOD\nEND_INTERFACE\nFUNCTION_BLOCK FB_LTo IMPLEMENTS I_LT\nVAR k : INT; END_VAR\nk := F_LT(shape := THIS^);\nEND_FUNCTION_BLOCK\nMETHOD Area : INT\nArea := 4;\nEND_METHOD\nFUNCTION F_LT : INT\nVAR_INPUT shape : I_LT; END_VAR\nF_LT := shape.Area();\nEND_FUNCTION\nFUNCTION_BLOCK FB_LTs IMPLEMENTS I_LT\nVAR_INPUT side : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Area : INT\nArea := side * side;\nEND_METHOD\nFUNCTION_BLOCK FB_LTm\nVAR_INPUT shape : I_LT; END_VAR\nVAR_OUTPUT got : INT; END_VAR\nIF shape <> 0 THEN\n  got := shape.Area();\nEND_IF\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK FB_LTp\nVAR_INPUT k : INT; END_VAR\nVAR s : FB_LTs; m : FB_LTm; END_VAR\ns(side := k);\nm(shape := s);\nEND_FUNCTION_BLOCK\n",
      // A FOR step decided at run time (the direction tested with it), and a bound from the POU's own VAR CONSTANT.
      // An unsigned counter's runtime step: `0u16 <= step` was printed, a rustc lint this crate denies (review of batch 3a).
      "PROGRAM ForStep\nVAR CONSTANT count : INT := 3; END_VAR\nVAR arr : ARRAY[1..count] OF INT; i : INT; step : INT := 2; n : INT; u : UINT; stride : UINT := 2; END_VAR\nFOR i := 1 TO 5 BY step DO\n  n := n + arr[count];\nEND_FOR\nFOR u := 1 TO 5 BY stride DO\n  n := n + 1;\nEND_FOR\nEND_PROGRAM\n",
      // Call shapes (recorded): calls in arguments taken into `let`s in written order — two calls on one instance among
      // them — a defaulted input, a METHOD on a PROGRAM moved out of `Programs`, and an FB's in-out handed to its METHOD.
      "PROGRAM CallShapes\nVAR marker : FB_CSMark; reversed : INT; defaulted : INT; worker : FB_CSWork; shared : INT := 1; seen : INT; END_VAR\nreversed := F_CSPair(rightValue := marker.Mark(digit := 3), leftValue := marker.Mark(digit := 4));\nreversed := marker.Mark(digit := marker.Mark(digit := 5));\ndefaulted := marker.Combine(extra := 4);\nworker(io := shared);\nPRG_CSCount();\nseen := PRG_CSCount.Bump(amount := 10);\nEND_PROGRAM\nFUNCTION_BLOCK FB_CSMark\nVAR order : DINT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Mark : INT\nVAR_INPUT digit : INT; END_VAR\norder := order * 10 + digit;\nMark := digit;\nEND_METHOD\nMETHOD Combine : INT\nVAR_INPUT baseValue : INT := 5; extra : INT; END_VAR\nCombine := baseValue * 10 + extra;\nEND_METHOD\nFUNCTION F_CSPair : INT\nVAR_INPUT leftValue : INT; rightValue : INT; END_VAR\nF_CSPair := leftValue * 10 + rightValue;\nEND_FUNCTION\nFUNCTION_BLOCK FB_CSWork\nVAR_IN_OUT io : INT; END_VAR\nAddTen();\nEND_FUNCTION_BLOCK\nMETHOD AddTen\nio := io + 10;\nEND_METHOD\nPROGRAM PRG_CSCount\nVAR runs : INT; bumps : INT; END_VAR\nruns := runs + 1;\nEND_PROGRAM\nMETHOD Bump : INT\nVAR_INPUT amount : INT; END_VAR\nbumps := bumps + amount;\nBump := bumps + runs;\nEND_METHOD\n",
      // An FB's own field lent to its own METHOD — a scalar and an ARRAY[*] — copied in and written back after the call.
      "PROGRAM OwnField\nVAR user : FB_OU; END_VAR\nuser();\nEND_PROGRAM\n" +
        "FUNCTION_BLOCK FB_OU\nVAR counter : INT := 7; result : INT; values : ARRAY[0..2] OF INT; END_VAR\nresult := Mixed(counter, 3);\nFill(values);\nEND_FUNCTION_BLOCK\n" +
        "METHOD Mixed : INT\nVAR_IN_OUT target : INT; END_VAR\nVAR_INPUT amount : INT; END_VAR\ntarget := target + amount;\nMixed := target * 10;\nEND_METHOD\n" +
        "METHOD Fill\nVAR_IN_OUT line : ARRAY[*] OF INT; END_VAR\nVAR k : DINT; END_VAR\nFOR k := LOWER_BOUND(line, 1) TO UPPER_BOUND(line, 1) DO\n  line[k] := DINT_TO_INT(k) + 1;\nEND_FOR\nEND_METHOD\n",
      // An in-out written before a call that moves its index (recorded `callshape_inout_binding_order`): the index taken into
      // a temp among the argument lets, where it is written.
      "PROGRAM FrozenIndex\nVAR o : FB_FI; END_VAR\no();\nEND_PROGRAM\n" +
        "FUNCTION F_FITake : INT\nVAR_INPUT stepValue : INT; END_VAR\nVAR_IN_OUT boundValue : INT; END_VAR\nF_FITake := boundValue * 10 + stepValue;\nEND_FUNCTION\n" +
        "FUNCTION_BLOCK FB_FI\nVAR numbers : ARRAY[0..3] OF INT := [10, 20, 30, 40]; cursor : INT; got : INT; END_VAR\ncursor := 0;\ngot := F_FITake(boundValue := numbers[cursor], stepValue := Advance());\nEND_FUNCTION_BLOCK\n" +
        "METHOD Advance : INT\ncursor := cursor + 1;\nAdvance := cursor;\nEND_METHOD\n",
      // An FB's METHOD called from outside reaching its in-out (recorded): a dispatch on the binding the instance was last
      // called with, each call storing its tag.
      "PROGRAM LastBinding\nVAR worker : FB_LB; first : INT := 1; second : INT := 100; END_VAR\nworker(shared := first);\nworker.AddTen();\nworker(shared := second);\nworker.AddTen();\nEND_PROGRAM\n" +
        "FUNCTION_BLOCK FB_LB\nVAR_IN_OUT shared : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD AddTen\nshared := shared + 10;\nEND_METHOD\n",
      // SUPER^ binding the base's in-out to a derived one, the base body calling no override: `profile` was lent twice
      // (E0499, review of the override build); and the recorded override shape, the base body reaching the derived in-out.
      "PROGRAM SuperPass\nVAR d : FB_SPD; v : INT := 1; u : INT; o : FB_OVD; w : INT := 1; END_VAR\nd(profile := v, io := u);\no(profile := w);\nEND_PROGRAM\n" +
        "FUNCTION_BLOCK FB_SPB\nVAR_IN_OUT io : INT; END_VAR\nio := io + 1;\nEND_FUNCTION_BLOCK\n" +
        "FUNCTION_BLOCK FB_SPD EXTENDS FB_SPB\nVAR_IN_OUT profile : INT; END_VAR\nSUPER^(io := profile);\nEND_FUNCTION_BLOCK\n" +
        "FUNCTION_BLOCK FB_OVB\nVAR calls : INT; END_VAR\ncalls := calls + 1;\nHook();\nEND_FUNCTION_BLOCK\nMETHOD Hook\n;\nEND_METHOD\n" +
        "FUNCTION_BLOCK FB_OVD EXTENDS FB_OVB\nVAR_IN_OUT profile : INT; END_VAR\nSUPER^();\nEND_FUNCTION_BLOCK\nMETHOD Hook\nprofile := profile + 10;\nEND_METHOD\n",
      // A root PROGRAM calling its own METHODs and ACTION bare (recorded), lowered as its one instance.
      "PROGRAM PrgOwn\nVAR calls : INT; tidied : INT; doubled : INT; END_VAR\nBump();\nTidy();\ndoubled := Twice(calls);\nEND_PROGRAM\n" +
        "METHOD Bump\ncalls := calls + 1;\nEND_METHOD\nMETHOD Twice : INT\nVAR_INPUT n : INT; END_VAR\nTwice := n * 2;\nEND_METHOD\nACTION Tidy\ntidied := tidied + 100;\nEND_ACTION\n",
      // SUPER^ given the derived FB's own fields, its own in-outs left unused: `call` took `a`, `b` unread — denied (review).
      "PROGRAM SuperOwn\nVAR d : FB_SOD; x : INT; y : INT; END_VAR\nd(a := x, b := y);\nEND_PROGRAM\n" +
        "FUNCTION_BLOCK FB_SOB\nVAR_IN_OUT a : INT; b : INT; END_VAR\na := 5;\nb := b + 1;\nEND_FUNCTION_BLOCK\n" +
        "FUNCTION_BLOCK FB_SOD EXTENDS FB_SOB\nVAR n : INT := 100; m : INT := 200; END_VAR\nSUPER^(a := n, b := m);\nEND_FUNCTION_BLOCK\n",
      // A global read only by an FB_Init argument: `init` reads it, `scan` takes `g` without using it.
      "VAR_GLOBAL\n  gOnlyInit : INT := 6;\nEND_VAR\nPROGRAM FbInitGlobal\nVAR fromGlobal : FB_GArgs(startValue := gOnlyInit); END_VAR\nEND_PROGRAM\n" +
        "FUNCTION_BLOCK FB_GArgs\nVAR started : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD FB_Init : BOOL\nVAR_INPUT bInitRetains : BOOL; bInCopyCode : BOOL; startValue : INT; END_VAR\nstarted := startValue;\nEND_METHOD\n",
      // FB_Init (recorded): run once per instance in `init`, the base's first, with the declared argument.
      "PROGRAM FbInit\nVAR seed : INT := 5; five : FB_FArgs(startValue := seed); derived : FB_FDerived(startValue := 7); END_VAR\nfive();\nderived();\nEND_PROGRAM\n" +
        "FUNCTION_BLOCK FB_FArgs\nVAR started : INT; retains : BOOL; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD FB_Init : BOOL\nVAR_INPUT bInitRetains : BOOL; bInCopyCode : BOOL; startValue : INT; END_VAR\nstarted := startValue;\nretains := bInitRetains;\nEND_METHOD\n" +
        "FUNCTION_BLOCK FB_FBase\nVAR order : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD FB_Init : BOOL\nVAR_INPUT bInitRetains : BOOL; bInCopyCode : BOOL; startValue : INT; END_VAR\norder := order * 10 + 1;\nEND_METHOD\n" +
        "FUNCTION_BLOCK FB_FDerived EXTENDS FB_FBase\nVAR seen : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD FB_Init : BOOL\nVAR_INPUT bInitRetains : BOOL; bInCopyCode : BOOL; startValue : INT; END_VAR\nseen := startValue;\norder := order * 10 + 2;\nEND_METHOD\n",
      // Positional arguments across VAR_IN_OUT and VAR_INPUT (recorded), and a call through an interface nothing is ever
      // stored into — its panic arm typed, so the match takes a cast (it was `!`: E0605, unreachable code).
      "PROGRAM Positional\nVAR counter : INT := 7; mixed : INT; never : I_PNever; led : INT; END_VAR\nmixed := F_PMixed(counter, 3);\nIF never = 0 OR_ELSE never.Area() <> 9 THEN\n  led := 1;\nEND_IF\nIF never <> 0 THEN\n  never.Poke();\nEND_IF\nEND_PROGRAM\n" +
        "FUNCTION F_PMixed : INT\nVAR_IN_OUT target : INT; END_VAR\nVAR_INPUT amount : INT; END_VAR\ntarget := target + amount;\nF_PMixed := target * 10;\nEND_FUNCTION\n" +
        "INTERFACE I_PNever\nMETHOD Area : INT\nEND_METHOD\nMETHOD Poke\nEND_METHOD\nEND_INTERFACE\n",
      // __QUERYINTERFACE as an IF's and an ELSIF's whole condition, under NOT too: the query into a hidden BOOL before the test.
      "PROGRAM QueryIf\nVAR sq : FB_QSq; baseRef : I_QBase; shapeRef : I_QShape; side : INT; END_VAR\nbaseRef := sq;\nIF __QUERYINTERFACE(baseRef, shapeRef) THEN\n  side := shapeRef.Side();\nELSIF NOT __QUERYINTERFACE(baseRef, shapeRef) THEN\n  side := 0;\nEND_IF\nEND_PROGRAM\n" +
        "INTERFACE I_QBase\nMETHOD Area : INT\nEND_METHOD\nEND_INTERFACE\nINTERFACE I_QShape EXTENDS I_QBase\nMETHOD Side : INT\nEND_METHOD\nEND_INTERFACE\n" +
        "FUNCTION_BLOCK FB_QSq IMPLEMENTS I_QShape\nEND_FUNCTION_BLOCK\nMETHOD Area : INT\nArea := 9;\nEND_METHOD\nMETHOD Side : INT\nSide := 3;\nEND_METHOD\n",
      // An FB instance inside a PROGRAM, from outside it (recorded): a METHOD and a body call, each with the program moved out.
      "PROGRAM ProgramMember\nVAR seen : INT; count : INT; END_VAR\nPRG_PMStation();\nseen := PRG_PMStation.relay.Map();\nPRG_PMStation.relay(level := 50);\ncount := PRG_PMStation.relay.Count;\nEND_PROGRAM\n" +
        "FUNCTION_BLOCK FB_PMRelay\nVAR_INPUT level : INT; END_VAR\nVAR maps : INT; calls : INT; END_VAR\ncalls := calls + level;\nEND_FUNCTION_BLOCK\nMETHOD Map : INT\nmaps := maps + 1;\nMap := maps * 100 + calls;\nEND_METHOD\n" +
        "PROPERTY Count : INT\nGET\nCount := calls;\nEND_GET\nEND_PROPERTY\n" +
        "PROGRAM PRG_PMStation\nVAR relay : FB_PMRelay; runs : INT; END_VAR\nruns := runs + 1;\nrelay(level := runs);\nEND_PROGRAM\n",
      // ARRAY[*] in-outs (recorded): a slice with its bounds handed in beside it, passed on, a const generic for an inner
      // open dimension, an FB's bounds stored on the instance, and an open array of sized rows.
      "PROGRAM OpenArrays\nVAR numbers : ARRAY[-2..4] OF INT; bounds : DINT; grid : ARRAY[1..2, 0..2] OF INT; second : DINT; filler : FB_OFill; row : ARRAY[5..8] OF INT; stacks : ARRAY[1..3] OF ARRAY[1..4] OF INT; END_VAR\n" +
        "bounds := F_OOuter(numbers := numbers);\nsecond := F_OGrid(grid := grid);\nfiller(numbers := row);\nF_OShift(rows := stacks);\nEND_PROGRAM\n" +
        "FUNCTION F_OInner : DINT\nVAR_IN_OUT numbers : ARRAY[*] OF INT; END_VAR\nnumbers[UPPER_BOUND(numbers, 1)] := 99;\nF_OInner := LOWER_BOUND(numbers, 1) * 100 + UPPER_BOUND(numbers, 1);\nEND_FUNCTION\n" +
        "FUNCTION F_OOuter : DINT\nVAR_IN_OUT numbers : ARRAY[*] OF INT; END_VAR\nF_OOuter := F_OInner(numbers := numbers) + 10000;\nEND_FUNCTION\n" +
        "FUNCTION F_OGrid : DINT\nVAR_IN_OUT grid : ARRAY[*, *] OF INT; END_VAR\nVAR r0 : DINT; c0 : DINT; END_VAR\nFOR r0 := LOWER_BOUND(grid, 1) TO UPPER_BOUND(grid, 1) DO\n  FOR c0 := LOWER_BOUND(grid, 2) TO UPPER_BOUND(grid, 2) DO\n    grid[r0, c0] := DINT_TO_INT(r0 * 10 + c0);\n  END_FOR\nEND_FOR\nF_OGrid := UPPER_BOUND(grid, 2);\nEND_FUNCTION\n" +
        "FUNCTION_BLOCK FB_OFill\nVAR_IN_OUT numbers : ARRAY[*] OF INT; END_VAR\nVAR index : DINT; END_VAR\nFOR index := LOWER_BOUND(numbers, 1) TO UPPER_BOUND(numbers, 1) DO\n  numbers[index] := DINT_TO_INT(index);\nEND_FOR\nEND_FUNCTION_BLOCK\n" +
        "FUNCTION F_OShift : BOOL\nVAR_IN_OUT rows : ARRAY[*] OF ARRAY[1..4] OF INT; END_VAR\nVAR di : DINT; END_VAR\nFOR di := UPPER_BOUND(rows, 1) TO 2 BY -1 DO\n  rows[di] := rows[di - 1];\nEND_FOR\nEND_FUNCTION\n",
      "PROGRAM Inherit\nVAR plain : FB_ID; viaSuper : FB_IS; shared : INT; END_VAR\nplain(inBase := 7, io := shared);\nviaSuper(inBase := 5, io := shared);\nEND_PROGRAM\nFUNCTION_BLOCK FB_IB\nVAR_INPUT inBase : INT; END_VAR\nVAR_IN_OUT io : INT; END_VAR\nVAR nBase : INT; END_VAR\nnBase := nBase + 1;\nio := io + inBase;\nHook();\nEND_FUNCTION_BLOCK\nMETHOD Hook\nnBase := nBase + 10;\nEND_METHOD\nFUNCTION_BLOCK FB_ID EXTENDS FB_IB\nVAR nDerived : INT; END_VAR\nnDerived := nDerived + inBase;\nio := io + 1;\nEND_FUNCTION_BLOCK\nMETHOD Hook\nnDerived := 0;\nEND_METHOD\nFUNCTION_BLOCK FB_IS EXTENDS FB_IB\nSUPER^(inBase := inBase + 100, io := io);\nSUPER^.Hook();\nEND_FUNCTION_BLOCK\nMETHOD Hook\nnBase := nBase - 1;\nEND_METHOD\n",
    ]
    const len = { uri: "Library Manager/Standard/LEN.fun", source: "FUNCTION LEN : INT\nVAR_INPUT\n\tSTR : STRING(255);\nEND_VAR\nEND_FUNCTION\n" }
    // Each POU's output is emitted on its own — its string prelude and its `Globals` with it (emit.ts's ponytail notes) — so
    // each goes into a module of its own. One flat crate kept the first prelude only, and broke the moment a second POU
    // owned globals: two `struct Globals` (E0428), a collision of the test's namespace, not of any one POU's Rust.
    const crate = sources
      .map((src, i) => {
        const { pou, diagnostics } = lowerSource(src, undefined, [len])
        expect(diagnostics).toEqual([])
        return `pub mod pou_${i} {\n${emitRust(pou!).code}\n}`
      })
      .join("\n")

    // `--emit=metadata` type-checks and BORROW-checks without codegen — the fast form of the only question
    // this test asks. The crate name comes from the file stem, so it has to be a legal Rust identifier.
    const dir = await mkdtemp(join(tmpdir(), "volt-emit-"))
    const file = join(dir, "volt_emit_check.rs")
    await Bun.write(file, crate)
    const proc = Bun.spawnSync([
      rustc!,
      "--crate-type",
      "lib",
      "--edition",
      "2021",
      "--emit=metadata",
      "-D",
      "warnings",
      // ST has no dynamic memory: every storage form is safe Rust (design §9), and `unsafe` is forbidden outright
      "-F",
      "unsafe_code",
      "-A",
      "dead_code",
      // Generated code is not read for style: it is fully parenthesized on purpose, so precedence can never
      // be got wrong. Everything else — types, and above all the BORROW checker — is still denied.
      "-A",
      "unused_parens",
      "--out-dir",
      dir,
      file,
    ])
    const stderr = proc.stderr.toString()
    await rm(dir, { recursive: true, force: true })
    expect(stderr).toBe("")
    expect(proc.exitCode).toBe(0)
  }, 60_000)
})
