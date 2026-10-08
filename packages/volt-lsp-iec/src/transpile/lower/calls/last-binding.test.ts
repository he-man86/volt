/**
 * Lowering tests of `last-binding.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
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

// Recorded (`callshape_inout_in_method_after_call`: 11 then 110, `callshape_inout_method_in_later_cycle`: 21 after three
// cycles, `callshape_inout_method_before_binding`: the run stops): a METHOD called from outside its FB reaches the in-out
// the instance was LAST called with. It was refused (`call-fb-inout`). Why missed: nothing modelled a binding kept past
// the call that made it — the recordings came first (user decision 2026-09-15: build it).
test("a METHOD called from outside its FB reaches the in-out the instance was last called with", () => {
  const worker = "FUNCTION_BLOCK FB_W\nVAR_IN_OUT shared : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD AddTen\nshared := shared + 10;\nEND_METHOD\n"
  const program = (vars: string, body: string, extra = "") =>
    `PROGRAM P\nVAR worker : FB_W; first : INT := 1; second : INT := 100; ${vars} END_VAR\n${body}\nEND_PROGRAM\n${worker}${extra}`
  const after = run(ir(program("", "worker(shared := first);\nworker.AddTen();\nworker(shared := second);\nworker.AddTen();"), "P"))
  after.scan()
  expect([after.get("first"), after.get("second")]).toEqual([11n, 110n])
  const later = run(ir(program("bound : BOOL;", "IF bound THEN\n  worker.AddTen();\nELSE\n  worker(shared := first);\n  bound := TRUE;\nEND_IF"), "P"))
  later.scan()
  later.scan()
  later.scan()
  expect(later.get("first")).toEqual(21n)
  // before any call bound it: no arm — the run stops, as CODESYS's did
  const early = run(ir(program("", "worker.AddTen();\nworker(shared := first);"), "P"))
  expect(() => early.scan()).toThrow()
  const codes = (vars: string, body: string, extra = "") => lowerSource(program(vars, body, extra), "P").diagnostics.map((d) => d.code)
  // a call binding an element at a runtime index: which element the METHOD reaches later is not a place this can lend again
  expect(codes("i : INT; arr : ARRAY[0..1] OF INT;", "worker(shared := arr[i]);\nworker.AddTen();")).toContain("call-fb-inout")
  // the instance called some other way too — through a FUNCTION's VAR_IN_OUT — could hold a binding no arm lends
  const through = "FUNCTION F_Call : BOOL\nVAR_IN_OUT w : FB_W; x : INT; END_VAR\nw(shared := x);\nEND_FUNCTION\n"
  expect(codes("", "F_Call(w := worker, x := second);\nworker.AddTen();", through)).toContain("call-fb-inout")
  // Review of the build — each accepted with a stale or wrong binding, now refused:
  // an input that calls: the tag was read before it, though it could bind the instance first
  const plus = "METHOD Plus\nVAR_INPUT n : INT; END_VAR\nshared := shared + n;\nEND_METHOD\nFUNCTION F_Five : INT\nF_Five := 5;\nEND_FUNCTION\n"
  expect(codes("", "worker(shared := first);\nworker.Plus(n := F_Five());", plus)).toContain("call-fb-inout")
  // a PROGRAM's one instance bound from an FB with two instances: the tag lent whichever instance ran
  const shared =
    "PROGRAM P\nVAR x1 : FB_X; x2 : FB_X; END_VAR\nx1(bind := TRUE);\nx2(bind := TRUE);\nx1(bind := FALSE);\nEND_PROGRAM\n" +
    "FUNCTION_BLOCK FB_X\nVAR_INPUT bind : BOOL; END_VAR\nVAR a : INT := 1; END_VAR\nIF bind THEN\n  PW(shared := a);\nELSE\n  PW.AddTen();\nEND_IF\nEND_FUNCTION_BLOCK\n" +
    "PROGRAM PW\nVAR_IN_OUT shared : INT; END_VAR\nEND_PROGRAM\nMETHOD AddTen\nshared := shared + 10;\nEND_METHOD\n"
  expect(lowerSource(shared, "P").diagnostics.map((d) => d.code)).toContain("call-fb-inout")
  // SUPER^ binding the in-out to another place, and an instance copied whole: what the instance holds is not recorded
  const rebinding = "FUNCTION_BLOCK FB_D EXTENDS FB_W\nVAR other : INT := 500; END_VAR\nSUPER^(shared := other);\nEND_FUNCTION_BLOCK\n"
  expect(codes("d : FB_D;", "d(shared := first);\nd.AddTen();", rebinding)).toContain("call-fb-inout")
  expect(codes("w2 : FB_W;", "worker(shared := first);\nw2 := worker;\nw2.AddTen();")).toContain("call-fb-inout")
  // ...and with the TARGET called first (transpile-review 16, `tr_16_fb_copy_carries_inout_binding`): its own arm was
  // armed, the copied tag had none, and the METHOD faulted where CODESYS writes through the copied binding (first=11)
  expect(codes("w2 : FB_W;", "worker(shared := first);\nw2(shared := second);\nw2 := worker;\nw2.AddTen();")).toContain("call-fb-inout")
})

// Recorded (`callshape_inout_base_method_from_derived_method`: 11, `callshape_inout_base_method_from_outside_derived`: 21,
// `callshape_inout_super_method_from_override`: 11): a derived FB's METHOD reaches the BASE's in-out through a base METHOD.
// Refused (`call-fb-inout`, pro2193's ConveyorFB and AirBufferFB): a METHOD took only its own FB's declared in-outs. Why
// missed: every test of an in-out reached from a METHOD declared the in-out in the FB the METHOD belonged to.
test("a derived FB's METHOD reaches its base's in-out through a base METHOD — from the body, from outside, through SUPER^", () => {
  const base = "FUNCTION_BLOCK FB_B\nVAR_IN_OUT shared : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD AddTen\nshared := shared + 10;\nEND_METHOD\n"
  const value = (body: string, derived: string) => {
    const runner = run(ir(`PROGRAM P\nVAR d : FB_D; v : INT := 1; END_VAR\n${body}\nEND_PROGRAM\n${base}FUNCTION_BLOCK FB_D EXTENDS FB_B\n${derived}`, "P"))
    runner.scan()
    return runner.get("v")
  }
  expect(value("d(shared := v);", "Bump();\nEND_FUNCTION_BLOCK\nMETHOD Bump\nAddTen();\nEND_METHOD\n")).toEqual(11n)
  expect(value("d(shared := v);\nd.Bump();", "AddTen();\nEND_FUNCTION_BLOCK\nMETHOD Bump\nAddTen();\nEND_METHOD\n")).toEqual(21n)
  expect(value("d(shared := v);", "AddTen();\nEND_FUNCTION_BLOCK\nMETHOD AddTen\nSUPER^.AddTen();\nEND_METHOD\n")).toEqual(11n)
  // pro2193's own shape (recorded `callshape_inout_override_from_base_body`: 11, `…_from_outside_base_method`: 21): the
  // BASE's body run through SUPER^(), or a base METHOD called from outside, calls an override writing the DERIVED FB's
  // own in-out. The SUPER^ body took its base chain's in-outs only, and a METHOD its owner's: `call-fb-inout`.
  const overriding = (body: string, derived: string) => {
    const source =
      "PROGRAM P\nVAR d : FB_OD; v : INT := 1; END_VAR\n" + body + "\nEND_PROGRAM\n" +
      "FUNCTION_BLOCK FB_OB\nVAR calls : INT; END_VAR\ncalls := calls + 1;\nHook();\nEND_FUNCTION_BLOCK\nMETHOD Hook\n;\nEND_METHOD\nMETHOD Run\nHook();\nEND_METHOD\n" +
      "FUNCTION_BLOCK FB_OD EXTENDS FB_OB\nVAR_IN_OUT profile : INT; END_VAR\nSUPER^();\nEND_FUNCTION_BLOCK\nMETHOD Hook\nprofile := profile + 10;\nEND_METHOD\n" + derived
    const runner = run(ir(source, "P"))
    runner.scan()
    return runner.get("v")
  }
  expect(overriding("d(profile := v);", "")).toEqual(11n)
  expect(overriding("d(profile := v);\nd.Run();", "")).toEqual(21n)
  // Review of the override build. A base body calling no override took every derived in-out, so `SUPER^(a := extra)` lent
  // `extra` twice (E0499) — it lowers again; one that calls an override, with that argument, is refused.
  const rebound = (baseBody: string, derived: string) =>
    `PROGRAM P\nVAR d : FB_RD; v : INT := 1; w : INT := 100; END_VAR\nd(a := w, extra := v);\nEND_PROGRAM\nFUNCTION_BLOCK FB_RB\nVAR_IN_OUT a : INT; END_VAR\n${baseBody}\nEND_FUNCTION_BLOCK\nMETHOD Hook\n;\nEND_METHOD\n` +
    `FUNCTION_BLOCK FB_RD EXTENDS FB_RB\nVAR_IN_OUT extra : INT; END_VAR\nSUPER^(a := extra);\nEND_FUNCTION_BLOCK\n${derived}`
  expect(lowerSource(rebound("a := a + 1;", ""), "P").diagnostics).toEqual([])
  expect(lowerSource(rebound("Hook();", "METHOD Hook\nextra := extra + 10;\nEND_METHOD\n"), "P").diagnostics.map((d) => d.code)).toContain("call-inout-alias")
  // a base METHOD calling no override took the derived in-outs too, and faulted called before any binding: it runs
  const plain =
    "PROGRAM P\nVAR d : FB_PD; END_VAR\nd.Run();\nEND_PROGRAM\nFUNCTION_BLOCK FB_PB\nVAR calls : INT; END_VAR\ncalls := calls + 1;\nEND_FUNCTION_BLOCK\n" +
    "METHOD Hook\ncalls := calls + 1;\nEND_METHOD\nMETHOD Run\nHook();\nEND_METHOD\nFUNCTION_BLOCK FB_PD EXTENDS FB_PB\nVAR_IN_OUT profile : INT; END_VAR\nSUPER^();\nEND_FUNCTION_BLOCK\n"
  const plainRun = run(ir(plain, "P"))
  plainRun.scan()
  expect(plainRun.get("d.calls")).toEqual(1n)
  // SUPER^() inside a METHOD whose own parameter hides the FB's in-out passed the METHOD's parameter on as the FB's
  const shadow =
    "PROGRAM P\nVAR d : FB_SD; v : INT := 1; w : INT := 500; END_VAR\nd(profile := v);\nd.Again(profile := w);\nEND_PROGRAM\nFUNCTION_BLOCK FB_SB\nVAR calls : INT; END_VAR\ncalls := calls + 1;\nHook();\nEND_FUNCTION_BLOCK\nMETHOD Hook\n;\nEND_METHOD\n" +
    "FUNCTION_BLOCK FB_SD EXTENDS FB_SB\nVAR_IN_OUT profile : INT; END_VAR\nSUPER^();\nEND_FUNCTION_BLOCK\nMETHOD Hook\nprofile := profile + 10;\nEND_METHOD\nMETHOD Again\nVAR_IN_OUT profile : INT; END_VAR\nSUPER^();\nEND_METHOD\n"
  expect(lowerSource(shadow, "P").diagnostics.map((d) => d.code)).toContain("call-inout-shadowed")
  // Review: the in-out lent by an argument AND reached by the callee printed two `&mut` of it (E0499) — refused, inherited
  // or the FB's own
  const twice = "Outer();\nEND_FUNCTION_BLOCK\nMETHOD Outer\nBump2(x := shared);\nEND_METHOD\nMETHOD Bump2\nVAR_IN_OUT x : INT; END_VAR\nx := x + 1;\nAddTen();\nEND_METHOD\n"
  expect(lowerSource(`PROGRAM P\nVAR d : FB_D; v : INT := 1; END_VAR\nd(shared := v);\nEND_PROGRAM\n${base}FUNCTION_BLOCK FB_D EXTENDS FB_B\n${twice}`, "P").diagnostics.map((d) => d.code)).toContain("call-inout-alias")
})
