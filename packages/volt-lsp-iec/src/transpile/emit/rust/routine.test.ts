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
    expect(code).toContain("pub fn tick(&mut self, mut amount: i16) -> i16 {")
    expect(code).toContain("let mut local_count: i16 = 0i16;")
    expect(code).toContain("self.calls = ") // the instance's field, through `self`
    expect(code).toContain("pub fn f_acc(mut amount: i16) -> i16 {")
    expect(code).toContain("self.inst.tick(3i16)")
    expect(code).toContain("f_acc(4i16)")
  })
})
