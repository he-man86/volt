import { describe, expect, test } from "bun:test"
import { emitRust } from "./index.js"
import { lowerSource } from "../../lower/index.js"



describe("emit/rust", () => {
  test("a METHOD is an fn in its FB's impl and a FUNCTION a free fn — inputs by value, locals `let mut` per call", () => {
    const { pou, diagnostics } = lowerSource(
      "FUNCTION_BLOCK FB_M\nVAR calls : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Tick : INT\nVAR_INPUT amount : INT; END_VAR\nVAR localCount : INT; END_VAR\nlocalCount := localCount + amount;\ncalls := calls + 1;\nTick := localCount;\nEND_METHOD\nFUNCTION F_Acc : INT\nVAR_INPUT amount : INT; END_VAR\nF_Acc := amount;\nEND_FUNCTION\nPROGRAM Routines\nVAR inst : FB_M; got : INT; END_VAR\ngot := inst.Tick(amount := 3) + F_Acc(4);\nEND_PROGRAM\n",
      "Routines",
    )
    expect(diagnostics).toEqual([])
    const code = emitRust(pou!).code
    // neither body writes `amount`: no `mut` on it (7.7.1)
    expect(code).toContain("pub fn tick(&mut self, amount: i16) -> i16 {")
    expect(code).toContain("let mut local_count: i16 = 0i16;")
    expect(code).toContain("self.calls = ") // the instance's field, through `self`
    expect(code).toContain("pub fn f_acc(amount: i16) -> i16 {")
    expect(code).toContain("self.inst.tick(3i16)")
    expect(code).toContain("f_acc(4i16)")
  })

  // 7.7.1: `mut` on exactly the inputs the body writes — stored to, or lent to a writable VAR_IN_OUT — and on no other
  test("an input is `mut` only where the body writes it", () => {
    const { pou, diagnostics } = lowerSource(
      "FUNCTION Bump : INT\nVAR_IN_OUT v : INT; END_VAR\nv := v + 1;\nBump := v;\nEND_FUNCTION\nFUNCTION F : INT\nVAR_INPUT a : INT; b : INT; c : INT; END_VAR\na := a + 1;\nF := Bump(b) + c;\nEND_FUNCTION\nPROGRAM P\nVAR x : INT; END_VAR\nx := F(1, 2, 3);\nEND_PROGRAM\n",
      "P",
    )
    expect(diagnostics).toEqual([])
    expect(emitRust(pou!).code).toContain("pub fn f(mut a: i16, mut b: i16, c: i16) -> i16 {")
  })
  // 7.7.3: a result stored once, by the body's last statement, is that statement's value as the tail — no `let mut f`; and a
  // VAR_OUTPUT whose first word in the body is a store of the whole of it has no reset at entry. Read first (H), both stay.
  test("the result assigned once at the end is the tail; an output stored first has no reset at entry", () => {
    const { pou, diagnostics } = lowerSource(
      "FUNCTION F : INT\nVAR_INPUT a : INT; END_VAR\nVAR_OUTPUT o : INT; END_VAR\no := a;\nF := a + 1;\nEND_FUNCTION\nFUNCTION H : INT\nVAR_INPUT a : INT; END_VAR\nVAR_OUTPUT o : INT; END_VAR\nH := o;\no := a;\nH := H + a;\nEND_FUNCTION\nPROGRAM P\nVAR x : INT; y : INT; q : INT; END_VAR\nx := F(2, o => q);\ny := H(3, o => q);\nEND_PROGRAM\n",
      "P",
    )
    expect(diagnostics).toEqual([])
    const code = emitRust(pou!).code
    expect(code).toContain("pub fn f(a: i16, o: &mut i16) -> i16 {\n    *o = a;\n    a.wrapping_add(1i16)\n}")
    // (h is declared where it is first stored, 7.7.2)
    expect(code).toContain("pub fn h(a: i16, o: &mut i16) -> i16 {\n    *o = 0i16;\n    let mut h: i16 = *o;")
  })
  // 7.7.2: no blanket `#[allow(unused_mut, unused_variables, unused_assignments)]` — a local stored before it is read is
  // declared where it is first stored (`mut` only if stored again), and a local or in-out nobody uses is `_name`
  test("no blanket allow: a local stored first is declared where it is stored, one nobody reads is `_name`", () => {
    const { pou, diagnostics } = lowerSource(
      "FUNCTION F : INT\nVAR_INPUT a : INT; END_VAR\nVAR_IN_OUT spare : INT; END_VAR\nVAR t : INT; u : INT; dead : BOOL; END_VAR\nt := a + 1;\nu := 0;\nu := u + t;\ndead := TRUE;\nF := u;\nEND_FUNCTION\nPROGRAM P\nVAR x : INT; sv : ARRAY[0..1] OF INT; k : INT; END_VAR\nx := F(1, sv[k]);\nEND_PROGRAM\n",
      "P",
    )
    expect(diagnostics).toEqual([])
    const code = emitRust(pou!).code
    expect(code).not.toContain("#[allow(unused_mut")
    // `spare` is bound through a runtime index, which may fault: the binding is kept (7.7.9, `deadParamsOf`), its parameter unused
    expect(code).toContain("pub fn f(a: i16, _spare: &mut i16) -> i16 {\n    let t: i16 = a.wrapping_add(1i16);\n    let mut u: i16 = 0i16;\n    u = u.wrapping_add(t);\n    let _dead: bool = true;\n    u\n}")
  })
  // 7.7.3: a final IF / ELSIF / ELSE every branch of which stores the result is the tail itself (StringUtils' CharToUpper)
  test("a final IF whose every branch stores the result is the tail expression", () => {
    const { pou, diagnostics } = lowerSource(
      "FUNCTION Up : BYTE\nVAR_INPUT c : BYTE; END_VAR\nIF c >= 97 AND c <= 122 THEN\n  Up := c - 32;\nELSIF c = 0 THEN\n  Up := 1;\nELSE\n  Up := c;\nEND_IF\nEND_FUNCTION\nPROGRAM P\nVAR x : BYTE; END_VAR\nx := Up(98);\nEND_PROGRAM\n",
      "P",
    )
    expect(diagnostics).toEqual([])
    expect(emitRust(pou!).code).toContain("pub fn up(c: u8) -> u8 {\n    if (97u8..=122u8).contains(&c) {\n        c.wrapping_sub(32u8)\n    } else if c == 0u8 {\n        1u8\n    } else {\n        c\n    }\n}")
  })
})

// 7.7.7: an input the body never uses and every call hands a constant is neither a parameter nor an argument — a borrowed
// `POINTER TO` input (form 2) is one: every `p^` became the hidden in-out, and each call handed the pointer a dead `0`
test("a borrowed pointer input and an unread input always handed a constant are no parameter", () => {
  const { pou, diagnostics } = lowerSource(
    "FUNCTION F_Read : INT\nVAR_INPUT p : POINTER TO INT; END_VAR\nF_Read := p^;\nEND_FUNCTION\nFUNCTION F_Two : INT\nVAR_INPUT a : INT; unused : INT; END_VAR\nF_Two := a;\nEND_FUNCTION\nFUNCTION F_Live : INT\nVAR_INPUT a : INT; unused : INT; END_VAR\nF_Live := a;\nEND_FUNCTION\nPROGRAM P\nVAR v : INT := 41; x : INT; y : INT; z : INT; END_VAR\nx := F_Read(p := ADR(v));\ny := F_Two(v, 7);\nz := F_Live(v, v) + F_Live(1, 2);\nEND_PROGRAM\n",
    "P",
  )
  expect(diagnostics).toEqual([])
  const code = emitRust(pou!).code
  expect(code).toContain("pub fn f_read(__ptr_p: &mut i16) -> i16 {")
  expect(code).toContain("self.x = f_read(&mut self.v);")
  expect(code).toContain("pub fn f_two(a: i16) -> i16 {")
  expect(code).toContain("self.y = f_two(self.v);")
  // one call hands `unused` a variable: its read is evaluated, so the parameter stays (unused, `_unused`)
  expect(code).toContain("pub fn f_live(a: i16, _unused: i16) -> i16 {")
  expect(code).toContain("f_live(self.v, self.v)")
})
