/**
 * Lowering tests of `invoke.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
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

const wrap = (body: string, vars = "iCount : INT;") => `PROGRAM P\nVAR\n  ${vars}\nEND_VAR\n${body}\nEND_PROGRAM\n`

// Recorded first (conformance `callshape_*`): an input left out starts at its declared initial value; arguments run in the
// order written, calls and PROPERTY reads inside them included; a METHOD runs on a PROGRAM's one instance; an FB's
// VAR_IN_OUT is reached from its METHOD called from its body. Each was refused (`call-input-missing`, `call-nested`,
// `call-program-method`, `place-not-local`). Why missed: no fixture called any of these shapes.
test("left-out inputs, written argument order, a METHOD on a PROGRAM, an FB's in-out inside its METHOD", () => {
  const source =
    "PROGRAM P\nVAR marker : FB_Mark; inOrder : INT; reversed : INT; defaulted : INT; worker : FB_Work; shared : INT := 1; seen : INT; END_VAR\n" +
    "inOrder := F_Pair(leftValue := marker.Mark(digit := 1), rightValue := marker.Mark(digit := 2));\nreversed := F_Pair(rightValue := marker.Mark(digit := 3), leftValue := marker.Mark(digit := 4));\n" +
    "defaulted := marker.Combine(extra := 4);\nworker(io := shared);\nPRG_Count();\nseen := PRG_Count.Bump(amount := 10);\nEND_PROGRAM\n" +
    "FUNCTION_BLOCK FB_Mark\nVAR order : DINT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Mark : INT\nVAR_INPUT digit : INT; END_VAR\norder := order * 10 + digit;\nMark := digit;\nEND_METHOD\nMETHOD Combine : INT\nVAR_INPUT baseValue : INT := 5; extra : INT; END_VAR\nCombine := baseValue * 10 + extra;\nEND_METHOD\n" +
    "FUNCTION F_Pair : INT\nVAR_INPUT leftValue : INT; rightValue : INT; END_VAR\nF_Pair := leftValue * 10 + rightValue;\nEND_FUNCTION\n" +
    "FUNCTION_BLOCK FB_Work\nVAR_IN_OUT io : INT; END_VAR\nAddTen();\nEND_FUNCTION_BLOCK\nMETHOD AddTen\nio := io + 10;\nEND_METHOD\n" +
    "PROGRAM PRG_Count\nVAR runs : INT; bumps : INT; END_VAR\nruns := runs + 1;\nEND_PROGRAM\nMETHOD Bump : INT\nVAR_INPUT amount : INT; END_VAR\nbumps := bumps + amount;\nBump := bumps + runs;\nEND_METHOD\n"
  const runner = run(ir(source, "P"))
  runner.scan()
  expect(["inOrder", "reversed", "marker.order", "defaulted", "shared", "seen"].map((v) => runner.get(v))).toEqual([12n, 43n, 1234n, 54n, 11n, 11n])
  // From outside the FB's own run the METHOD uses the in-out's LAST binding (`callshape_inout_in_method_after_call`). Refused
  // here while that was not modelled (`call-fb-inout`); it is now: the body's own call made 11, this one 21.
  const outside = run(ir(source.replace("worker(io := shared);", "worker(io := shared);\nworker.AddTen();"), "P"))
  outside.scan()
  expect(outside.get("shared")).toEqual(21n)
})

// Review of batch 3a (4 lenses, adversarial verify), each reproduced before its fix. Why missed: the batch's tests called
// each shape once, in the spelling its recording used — never through `THIS^.child`, from a METHOD that names no in-out,
// with a local constant shadowing the one a foreign declaration folds, or with an unsigned counter.
test("review of the call shapes: a child's METHOD, a METHOD naming no in-out, foreign declarations, unsigned steps, refusals", () => {
  const codes = (source: string) => lowerSource(source, "P").diagnostics.map((d) => d.code)
  // `THIS^.inner.Get()` runs on the child, whose in-out is its own last binding — it was handed the parent's `io`
  const inner = "FUNCTION_BLOCK FB_In\nVAR_IN_OUT io : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Get : INT\nGet := io;\nEND_METHOD\n"
  const outer = "FUNCTION_BLOCK FB_Out\nVAR_IN_OUT io : INT; other : INT; END_VAR\nVAR inner : FB_In; got : INT; END_VAR\ninner(io := other);\ngot := THIS^.inner.Get();\nEND_FUNCTION_BLOCK\n"
  expect(codes(`PROGRAM P\nVAR o : FB_Out; a : INT := 1; b : INT := 100; END_VAR\no(io := a, other := b);\nEND_PROGRAM\n${outer}${inner}`)).toContain("call-fb-inout")
  // a METHOD naming none of its FB's in-outs is called from outside, whichever call is written first — every METHOD took
  // every in-out of the FB's body, and only when the body had lowered first
  const counter = "FUNCTION_BLOCK FB_W\nVAR_IN_OUT io : INT; END_VAR\nVAR k : INT; END_VAR\nio := io + 1;\nEND_FUNCTION_BLOCK\nMETHOD Count : INT\nk := k + 1;\nCount := k;\nEND_METHOD\n"
  for (const body of ["w(io := x);\nn := w.Count();", "n := w.Count();\nw(io := x);"]) {
    const runner = run(ir(`PROGRAM P\nVAR w : FB_W; x : INT; n : INT; END_VAR\n${body}\nEND_PROGRAM\n${counter}`, "P"))
    runner.scan()
    expect([runner.get("x"), runner.get("n")]).toEqual([1n, 1n])
  }
  // an interface METHOD's STRING(N) folds N where it is declared — it took the CALLER's own `N`, cutting the text to 3
  const consts = [{ uri: "file:///project/Consts.gvl", source: "VAR_GLOBAL CONSTANT\n  N : INT := 10;\nEND_VAR\n" }]
  const keeper =
    "INTERFACE I_P\nMETHOD Put : BOOL\nVAR_INPUT sv : STRING(N); END_VAR\nEND_METHOD\nEND_INTERFACE\n" +
    "FUNCTION_BLOCK FB_P IMPLEMENTS I_P\nVAR kept : STRING(20); END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Put : BOOL\nVAR_INPUT sv : STRING(N); END_VAR\nkept := sv;\nPut := TRUE;\nEND_METHOD\n"
  const put = lowerSource(`PROGRAM P\nVAR CONSTANT N : INT := 3; END_VAR\nVAR fb : FB_P; rv : I_P; ok : BOOL; END_VAR\nrv := fb;\nok := rv.Put(sv := 'abcdefgh');\nEND_PROGRAM\n${keeper}`, "P", consts)
  expect(put.diagnostics).toEqual([])
  const putRun = run(put.pou!)
  putRun.scan()
  expect(putRun.get("fb.kept")).toEqual("abcdefgh")
  // an unsigned counter's runtime step cannot be negative: one test, counting up
  const unsigned = run(ir(wrap("FOR u := 1 TO 5 BY stride DO\n  visits := visits + 1;\nEND_FOR", "u : UINT; stride : UINT := 2; visits : INT;")))
  unsigned.scan()
  expect(unsigned.get("visits")).toEqual(3n)
  // A METHOD of an instance INSIDE a PROGRAM was refused here; the recording since (`callshape_program_instance_from_outside`:
  // 303, 403) shows it runs on that instance, and it lowers with the program moved out. Refused: reaching the instance
  // through a runtime index (read on the stand-in), and a PROGRAM's METHOD reaching its own program while moved out.
  const holder = (call: string) => `PROGRAM P\nVAR n : INT; i : INT := 2; END_VAR\nn := ${call};\nEND_PROGRAM\nPROGRAM PRG_H\nVAR inner : FB_W; inners : ARRAY[1..2] OF FB_W; END_VAR\nEND_PROGRAM\n${counter}`
  const inside = run(ir(holder("PRG_H.inner.Count()"), "P"))
  inside.scan()
  expect(inside.get("n")).toEqual(1n)
  expect(codes(holder("PRG_H.inners[i].Count()"))).toEqual(["call-program-method"])
  const again = "PROGRAM PRG_R\nVAR runs : INT; END_VAR\nruns := runs + 1;\nEND_PROGRAM\nMETHOD Again : INT\nAgain := PRG_R.runs;\nEND_METHOD\n"
  expect(codes(`PROGRAM P\nVAR n : INT; END_VAR\nPRG_R();\nn := PRG_R.Again();\nEND_PROGRAM\n${again}`)).toEqual(["call-program-reentrant"])
})

// Recorded first (`callshape_positional_arguments`): positional arguments bind in declaration order across VAR_INPUT and
// VAR_IN_OUT, interleaved too (100, 315, 46). They were refused (`call-positional`) whenever the routine had an in-out —
// pro2193's `Arrays.Bool_All(result, TRUE)` — and a METHOD calling its FB's own METHOD takes the FB's in-outs, so even
// pro2193's `ManualControl(a, b)` was. Why missed: no fixture called positionally past plain inputs.
test("positional arguments bind in declaration order across VAR_INPUT and VAR_IN_OUT", () => {
  // The recording binds the FB's own field to its own METHOD, which lowering refuses on other grounds (two `&mut` of one
  // instance, `call-inout-alias`) — so the METHODs run on a child instance here, with the same parameters and values.
  const routines = (manual: string) =>
    "PROGRAM P\nVAR user : FB_U; io : INT; END_VAR\nuser(shared := io);\nEND_PROGRAM\n" +
    "FUNCTION F_Pos : INT\nVAR_INPUT leftValue : INT; rightValue : INT; END_VAR\nF_Pos := leftValue * 10 + rightValue;\nEND_FUNCTION\n" +
    `FUNCTION_BLOCK FB_U\nVAR_IN_OUT shared : INT; END_VAR\nVAR helper : FB_H; counter : INT := 7; mixedResult : INT; interleavedResult : INT; functionResult : INT; manualResult : INT; outs : INT; END_VAR\n` +
    `mixedResult := helper.Mixed(counter, 3);\ninterleavedResult := helper.Interleaved(2, counter, 5);\nfunctionResult := F_Pos(4, 6);\n${manual}\nEND_FUNCTION_BLOCK\n` +
    // pro2193's `ManualControl(a, b)`: a METHOD calling its FB's own METHOD takes the FB's in-outs, and was refused
    "METHOD Manual\nVAR_INPUT lower : INT; upper : INT; END_VAR\nmanualResult := lower * 10 + upper;\nBump();\nEND_METHOD\nMETHOD Bump\nshared := shared + 1;\nEND_METHOD\n" +
    "FUNCTION_BLOCK FB_H\nEND_FUNCTION_BLOCK\n" +
    "METHOD Mixed : INT\nVAR_IN_OUT target : INT; END_VAR\nVAR_INPUT amount : INT; END_VAR\ntarget := target + amount;\nMixed := target * 10;\nEND_METHOD\n" +
    "METHOD Interleaved : INT\nVAR_INPUT leading : INT; END_VAR\nVAR_IN_OUT target : INT; END_VAR\nVAR_INPUT trailing : INT; END_VAR\ntarget := target + 1;\nInterleaved := leading * 100 + target * 10 + trailing;\nEND_METHOD\n" +
    "METHOD WithOutput : INT\nVAR_INPUT first : INT; END_VAR\nVAR_OUTPUT given : INT; END_VAR\nVAR_INPUT second : INT; END_VAR\ngiven := first;\nWithOutput := second;\nEND_METHOD\n"
  const runner = run(ir(routines("Manual(1, 2);"), "P"))
  runner.scan()
  expect(["user.mixedResult", "user.interleavedResult", "user.functionResult", "user.counter", "user.manualResult", "io"].map((v) => runner.get(v))).toEqual([100n, 315n, 46n, 11n, 12n, 1n])
  const codes = (manual: string) => lowerSource(routines(manual), "P").diagnostics.map((d) => d.code)
  // past the parameters, and counted across a VAR_OUTPUT (how a position counts one is not recorded)
  expect(codes("Manual(1, 2, 3);")).toContain("call-positional")
  expect(codes("outs := helper.WithOutput(1, 2);")).toContain("call-positional")
})
