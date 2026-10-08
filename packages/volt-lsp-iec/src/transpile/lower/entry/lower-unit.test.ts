/**
 * Lowering tests of `lower-unit.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
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

// Recorded (`fbcall_program_own_members`: calls 4, deep 40, tidied 200, doubled 8 after two cycles): a PROGRAM calling its
// own METHODs and ACTION bare runs them on its one instance. Lowered as the root it was `call-this` (~25 corpus POUs:
// `Initialize()`, `Alarms()`, `act_Assign_Errors_01_09()`). Why missed: the fixture's PROGRAM ran called from PLC_PRG,
// and every root PROGRAM a test lowered had no members.
test("a root PROGRAM calls its own METHODs and ACTIONs bare, on its one instance", () => {
  const source =
    "PROGRAM PRG_CALL_own\nVAR calls : INT; deep : INT; tidied : INT; doubled : INT; END_VAR\nBump();\nBump();\nTidy();\ndoubled := Twice(calls);\nEND_PROGRAM\n" +
    "METHOD Bump\ncalls := calls + 1;\nDeeper();\nEND_METHOD\nMETHOD Deeper\ndeep := deep + 10;\nEND_METHOD\n" +
    "METHOD Twice : INT\nVAR_INPUT n : INT; END_VAR\nTwice := n * 2;\nEND_METHOD\nACTION Tidy\ntidied := tidied + 100;\nEND_ACTION\n"
  const runner = run(ir(source, "PRG_CALL_own"))
  runner.scan()
  runner.scan()
  expect(["calls", "deep", "tidied", "doubled"].map((v) => runner.get(`PRG_CALL_own.${v}`))).toEqual([4n, 40n, 200n, 8n])
  // a PROGRAM without members keeps its variables as the POU's own slots
  const plain = run(ir("PROGRAM PRG_Plain\nVAR x : INT; END_VAR\nx := x + 1;\nEND_PROGRAM\n", "PRG_Plain"))
  plain.scan()
  expect(plain.get("x")).toEqual(1n)
  // Review of this batch — what the slot form had, kept in the instance form. An instance-path took the program's name twice
  // (`Device.Application.P.P.outer.inner`): the instance slot IS the program.
  const pathed =
    "PROGRAM P\nVAR outer : FB_Outer; END_VAR\nNop();\nEND_PROGRAM\nMETHOD Nop\nEND_METHOD\nFUNCTION_BLOCK FB_Outer\nVAR inner : FB_Path; END_VAR\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK FB_Path\nVAR\n\t{attribute 'instance-path'}\n\t{attribute 'noinit'}\n\tsPath : STRING(255);\nEND_VAR\nEND_FUNCTION_BLOCK\n"
  const pathLowered = lowerSource(pathed, "P", [], "C:/work/Line1/Device/Plc Logic/Application/P.pou")
  expect(pathLowered.diagnostics).toEqual([])
  expect(run(pathLowered.pou!).get("P.outer.inner.sPath")).toEqual("Device.Application.P.outer.inner")
  // An FB_Init argument naming the program's own VAR (recorded `fb_init_argument_from_variable`: 4) was refused once the
  // program had a METHOD; a later variable stays refused, and a global still gives its value (6).
  const inner = "FUNCTION_BLOCK FB_In\nVAR started : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD FB_Init : BOOL\nVAR_INPUT bInitRetains : BOOL; bInCopyCode : BOOL; startValue : INT; END_VAR\nstarted := startValue;\nEND_METHOD\n"
  const seedList = [{ uri: "file:///project/GVL_Seed.gvl", source: "VAR_GLOBAL\n  gSeed : INT := 6;\nEND_VAR\n" }]
  const withMethod = (decls: string, extra = "") => `PROGRAM P\nVAR seed : INT := 4; ${decls} END_VAR\nNop();\nEND_PROGRAM\nMETHOD Nop\nEND_METHOD\n${extra}${inner}`
  const argued = lowerSource(withMethod("fromVariable : FB_In(startValue := seed); fromGlobal : FB_In(startValue := gSeed);"), "P", seedList)
  expect(argued.diagnostics).toEqual([])
  const arguedRun = run(argued.pou!)
  arguedRun.scan()
  expect([arguedRun.get("P.fromVariable.started"), arguedRun.get("P.fromGlobal.started")]).toEqual([4n, 6n])
  expect(lowerSource(withMethod("fromLater : FB_In(startValue := later); later : INT := 3;"), "P", seedList).diagnostics.map((d) => d.code)).toContain("fb-init-argument")
  // A PROGRAM's own FB_Init was refused while unrecorded; recorded since (`fb_init_program_own`: 1), it leaves the program's
  // variables as they were — seed stays 4. One that calls something could still show more: refused.
  const ownInit = "METHOD FB_Init : BOOL\nVAR_INPUT bInitRetains : BOOL; bInCopyCode : BOOL; END_VAR\nseed := 100;\nEND_METHOD\n"
  const ownInitRun = run(ir(withMethod("", ownInit), "P"))
  ownInitRun.scan()
  expect(ownInitRun.get("P.seed")).toEqual(4n)
  const callingInit = "METHOD FB_Init : BOOL\nVAR_INPUT bInitRetains : BOOL; bInCopyCode : BOOL; END_VAR\nNop();\nEND_METHOD\n"
  expect(lowerSource(withMethod("", callingInit), "P").diagnostics.map((d) => d.code)).toContain("fb-init-program")
  // A PROGRAM the root CALLS is an instance among the globals, and the init step skipped it (`attr-init-unreached`): its
  // FB_Init argument from its own VAR (recorded 4), its own FB_Init (1) and its init-slot METHOD (101). Why missed: every
  // init test declared its instances in the root.
  const called =
    "PROGRAM Root\nVAR seen : INT; slot : INT; END_VAR\nPRG_Called();\nseen := PRG_Called.inst.started;\nslot := PRG_Called.n;\nEND_PROGRAM\n" +
    "PROGRAM PRG_Called\nVAR seed : INT := 4; inst : FB_In(startValue := seed); n : INT; END_VAR\nn := n + 1;\nEND_PROGRAM\n" +
    "{attribute 'call_after_global_init_slot' := '50000'}\nMETHOD Boot\nn := n + 100;\nEND_METHOD\n" +
    "METHOD FB_Init : BOOL\nVAR_INPUT bInitRetains : BOOL; bInCopyCode : BOOL; END_VAR\nn := 50;\nEND_METHOD\n" + inner
  const calledRun = run(ir(called, "Root"))
  calledRun.scan()
  expect([calledRun.get("seen"), calledRun.get("slot")]).toEqual([4n, 101n])
  // THIS^ in such a PROGRAM lowered, as its instance form has a self type; CODESYS refuses it (`fbcall_this_in_program`:
  // "Expression THIS is not allowed in this context"). Why missed: no fixture used THIS in a PROGRAM.
  const withThis = "PROGRAM P\nVAR x : INT; END_VAR\nTHIS^.x := THIS^.x + 3;\nNop();\nEND_PROGRAM\nMETHOD Nop\n;\nEND_METHOD\n"
  expect(lowerSource(withThis, "P").diagnostics.map((d) => d.code)).toContain("this-in-program")
})
