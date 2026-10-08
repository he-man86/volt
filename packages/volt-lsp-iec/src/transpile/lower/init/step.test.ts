/**
 * Lowering tests of `step.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { lowerSource } from "../index.js"

/** Lower and require success — most tests are about the SHAPE, not the failure path. */
function ir(src: string, name?: string) {
  const { pou, diagnostics } = lowerSource(src, name)
  expect(diagnostics).toEqual([])
  return pou!
}

// Review of the fixture batch — what the init step's new reach into called PROGRAMs, and the VAR_OUTPUT rule, let through.
// Why missed: every init test declared its instances in the root, once each; the output fixture bound nothing else.
test("the init step visits every called PROGRAM, refuses a moved-out read, and re-applies each instance's initializer", () => {
  const inner = "FUNCTION_BLOCK FB_In\nVAR started : INT; other : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD FB_Init : BOOL\nVAR_INPUT bInitRetains : BOOL; bInCopyCode : BOOL; startValue : INT; END_VAR\nstarted := startValue;\nEND_METHOD\n"
  const codes = (source: string) => lowerSource(source, "Root").diagnostics.map((d) => d.code)
  // a PROGRAM first reached by another program's init-slot METHOD was never visited: its FB_Init skipped (0, not 5)
  const late =
    "PROGRAM Root\nVAR seen : INT; END_VAR\nPRG_A();\nseen := PRG_A.n;\nEND_PROGRAM\n" +
    "PROGRAM PRG_A\nVAR n : INT; END_VAR\nn := n;\nEND_PROGRAM\n{attribute 'call_after_global_init_slot' := '50000'}\nMETHOD Boot\nn := PRG_B.inst.started;\nEND_METHOD\n" +
    `PROGRAM PRG_B\nVAR inst : FB_In(startValue := 5); END_VAR\nEND_PROGRAM\n${inner}`
  const lateRun = run(ir(late, "Root"))
  lateRun.scan()
  expect(lateRun.get("seen")).toEqual(5n)
  // an init-slot METHOD of an instance inside a called PROGRAM reading that program: Rust ran it moved out, reading 0
  const reentrant =
    "PROGRAM Root\nVAR seen : INT; END_VAR\nPRG_C();\nseen := PRG_C.reader.got;\nEND_PROGRAM\n" +
    "PROGRAM PRG_C\nVAR inst : FB_In(startValue := 5); reader : FB_S; END_VAR\nEND_PROGRAM\n" +
    `FUNCTION_BLOCK FB_S\nVAR got : INT; END_VAR\nEND_FUNCTION_BLOCK\n{attribute 'call_after_global_init_slot' := '50000'}\nMETHOD Boot\ngot := PRG_C.inst.started;\nEND_METHOD\n${inner}`
  expect(codes(reentrant)).toContain("call-program-reentrant")
  // a structured initializer beside FB_Init arguments (recorded `fb_init_and_structured_initializer`: applied after it) on
  // two instances of one layout: the second started from 0
  const shared =
    "PROGRAM Root\nVAR a : FB_Outer; seen : INT; o : INT; END_VAR\nPRG_D();\nseen := PRG_D.x.inner.other;\no := a.inner.other;\nEND_PROGRAM\n" +
    `PROGRAM PRG_D\nVAR x : FB_Outer; END_VAR\nEND_PROGRAM\nFUNCTION_BLOCK FB_Outer\nVAR inner : FB_In(startValue := 2) := (other := 9); END_VAR\nEND_FUNCTION_BLOCK\n${inner}`
  const sharedRun = run(ir(shared, "Root"))
  sharedRun.scan()
  expect([sharedRun.get("seen"), sharedRun.get("o")]).toEqual([9n, 9n])
  // a FUNCTION's VAR_OUTPUT beside an in-out bound to its index variable: printed E0503 (`&mut self.cursor` held) while
  // the output was lent before the call. It is copied out AFTER the call now (transpile-review 20, as CODESYS does:
  // `tr_20_output_index_moved_by_callee`), so nothing borrows `numbers[cursor]` during it: 7 lands in numbers[1], the
  // index read after the inputs ran (`callshape_output_index_before_call`).
  const both =
    "PROGRAM Root\nVAR o : FB_O; END_VAR\no();\nEND_PROGRAM\nFUNCTION_BLOCK FB_O\nVAR numbers : ARRAY[0..3] OF INT; cursor : INT; got : INT; END_VAR\ngot := F_Both(res => numbers[cursor], io := cursor, stepValue := Advance());\nEND_FUNCTION_BLOCK\n" +
    "METHOD Advance : INT\ncursor := cursor + 1;\nAdvance := cursor;\nEND_METHOD\nFUNCTION F_Both : INT\nVAR_INPUT stepValue : INT; END_VAR\nVAR_IN_OUT io : INT; END_VAR\nVAR_OUTPUT res : INT; END_VAR\nres := 7;\nEND_FUNCTION\n"
  const bothRun = run(ir(both, "Root"))
  bothRun.scan()
  expect([bothRun.get("o.numbers[0]"), bothRun.get("o.numbers[1]")]).toEqual([0n, 7n])
})

// transpile-review 23: an FB_Init argument naming a variable whose initializer does not fold was refused inside an FB, and
// passed 0 in a POU's own frame — every initializer ran after every FB_Init. CODESYS interleaves the two in declaration
// order (`tr_23_fb_init_argument_from_pending_init`: got = 4 with the variable first; `_reversed`: got = 0 with it last).
test("initializers and FB_Init interleave in declaration order, so an FB_Init argument sees the variables before it", () => {
  const target =
    "FUNCTION F_Inc : INT\nVAR_INPUT n : INT; END_VAR\nF_Inc := n + 1;\nEND_FUNCTION\n" +
    "FUNCTION_BLOCK FB_T\nVAR got : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD FB_Init : BOOL\nVAR_INPUT bInitRetains : BOOL; bInCopyCode : BOOL; v : INT; END_VAR\ngot := v;\nEND_METHOD\n"
  const holder = (decls: string) => `FUNCTION_BLOCK FB_H\nVAR\n${decls}\ngot : INT;\nEND_VAR\ngot := h.got;\nEND_FUNCTION_BLOCK\n`
  const program = (decls: string) => `PROGRAM P\nVAR\n${decls}\nfirst : FB_H; END_VAR\nfirst();\nEND_PROGRAM\n${target}`
  const got = (src: string, path: string) => {
    const runner = run(ir(src, "P"))
    runner.scan()
    return runner.get(path)
  }
  // inside an FB, the variable before the instance, then after it
  expect(got(program("") + holder("x : INT := F_Inc(3);\nh : FB_T(v := x);"), "first.got")).toBe(4n)
  expect(got(program("") + holder("h : FB_T(v := x);\nx : INT := F_Inc(3);"), "first.got")).toBe(0n)
  // in the POU's own frame
  expect(got(program("x : INT := F_Inc(3);\nh : FB_T(v := x);") + holder("h : FB_T(v := 1);"), "h.got")).toBe(4n)
})
