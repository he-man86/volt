import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { emitRust, rustType, snake } from "./emit.js"
import { STRING_PRELUDE } from "./prelude.js"
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
    // two borrows, never one struct borrowed twice: the instance from `prg`, the variables from `g`
    expect(emitted.code).toContain("prg.prg_writer.call(g);")
    expect(emitted.code).toContain("self.seen = g.g_shared;")
    expect(emitted.code).toContain("pub fn call(&mut self, g: &mut Globals) {")
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
    expect(code).toContain("self.i = if self.x { self.i | (1i16 << 15) } else { self.i & !(1i16 << 15) };")
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
      "PROGRAM RoutineCalls\nVAR inst : FB_R; got : INT; sink : INT; END_VAR\ngot := inst.Sum(upto := 4) + F_Twice(3);\ninst.Reset();\ninst.Store(dest := sink);\nEND_PROGRAM\nFUNCTION_BLOCK FB_R\nVAR total : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Sum : INT\nVAR_INPUT upto : INT; END_VAR\nVAR i : INT; END_VAR\nFOR i := 1 TO upto DO\n  Sum := Sum + i;\n  IF Sum > 100 THEN RETURN; END_IF\nEND_FOR\ntotal := Sum;\nEND_METHOD\nACTION Reset\ntotal := 0;\nEND_ACTION\nMETHOD Store\nVAR_IN_OUT dest : INT; END_VAR\ndest := total;\nEND_METHOD\nFUNCTION F_Twice : INT\nVAR_INPUT x : INT; END_VAR\nF_Twice := x * 2;\nEND_FUNCTION\n",
    ]
    const len = { uri: "Library Manager/Standard/LEN.fun", source: "FUNCTION LEN : INT\nVAR_INPUT\n\tSTR : STRING(255);\nEND_VAR\nEND_FUNCTION\n" }
    // Each POU's output carries the string prelude when it holds a string (emit.ts's ponytail note) — one crate of several
    // POUs keeps the first copy only.
    let preluded = false
    const crate = sources
      .map((src) => {
        const { pou, diagnostics } = lowerSource(src, undefined, [len])
        expect(diagnostics).toEqual([])
        const code = emitRust(pou!).code
        if (!code.startsWith(STRING_PRELUDE)) return code
        if (!preluded) return (preluded = true), code
        return code.slice(STRING_PRELUDE.length)
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
