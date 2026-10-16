/**
 * Lowering tests of `last-binding.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { lowerSource } from "../index.js"
import { emitRust } from "../../emit/rust/index.js"
import { FAULT_TEXT } from "../../ir/faults.js"
import { IecFault } from "../../semantics/faults.js"
import { ir } from "../../../../test/support/transpile.js"

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
  // SUPER^ binding the in-out to another place: what the instance holds is not recorded
  const rebinding = "FUNCTION_BLOCK FB_D EXTENDS FB_W\nVAR other : INT := 500; END_VAR\nSUPER^(shared := other);\nEND_FUNCTION_BLOCK\n"
  expect(codes("d : FB_D;", "d(shared := first);\nd.AddTen();", rebinding)).toContain("call-fb-inout")
})

// Recorded (`callshape_inout_method_before_binding`: the application stops, no message): a METHOD reaching its FB's in-out
// before any call bound it faulted with the INTERFACE text ("call through an interface that holds no instance") — the
// dispatch on the binding tag is the interface's node, and it carried the interface's fault (transpile-review Appendix A,
// transpile-restructure 6.A.28). Its own kind now, the same text from both backends.
test("an in-out reached before any call bound it stops with its own fault, not the interface's", () => {
  const worker = "FUNCTION_BLOCK FB_W\nVAR_IN_OUT shared : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD AddTen\nshared := shared + 10;\nEND_METHOD\n"
  const source = `PROGRAM P\nVAR worker : FB_W; first : INT := 1; END_VAR\nworker.AddTen();\nworker(shared := first);\nEND_PROGRAM\n${worker}`
  const pou = ir(source, "P")
  expect(() => run(pou).scan()).toThrow(new IecFault("unbound-inout"))
  const code = emitRust(pou).code
  expect(code).toContain(`panic!(${JSON.stringify(FAULT_TEXT["unbound-inout"])})`)
  expect(code).not.toContain(FAULT_TEXT["no-instance"])
  expect(FAULT_TEXT["unbound-inout"]).not.toEqual(FAULT_TEXT["no-instance"])
})

// Recorded (`tr_16_fb_copy_carries_inout_binding`: first = 11, second = 100): `w2 := w` copies the in-out binding w holds,
// and w2's METHOD writes through it. It was refused (`call-fb-inout`), and before that faulted: the dispatch armed only the
// tags w2's own calls made, while the copy carries w's (transpile-restructure 4.8, design.md §3.3 step 4e). Why missed:
// the arms were the receiver's calls — a copy was never a way for an instance to hold a binding.
test("an FB copied whole carries its in-out binding: the copy's METHOD writes through the SOURCE's (RC 16)", () => {
  const worker = "FUNCTION_BLOCK FB_W\nVAR_IN_OUT shared : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD AddTen\nshared := shared + 10;\nEND_METHOD\n"
  const program = (vars: string, body: string, extra = "") =>
    `PROGRAM P\nVAR worker : FB_W; w2 : FB_W; first : INT := 1; second : INT := 100; ${vars} END_VAR\n${body}\nEND_PROGRAM\n${worker}${extra}`
  const values = (body: string) => {
    const runner = run(ir(program("", body), "P"))
    runner.scan()
    return [runner.get("first"), runner.get("second")]
  }
  // the fixture's shape: the target called first, then overwritten whole
  expect(values("worker(shared := first);\nw2(shared := second);\nw2 := worker;\nw2.AddTen();")).toEqual([11n, 100n])
  // the target never called: its only binding is the copied one (`tr_16_fb_copy_into_uncalled_carries_inout_binding`)
  expect(values("worker(shared := first);\nw2 := worker;\nw2.AddTen();")).toEqual([11n, 100n])
  // copied the other way: worker now holds w2's binding (`tr_16_fb_copy_reverse_carries_inout_binding`)
  expect(values("worker(shared := first);\nw2(shared := second);\nworker := w2;\nworker.AddTen();")).toEqual([1n, 110n])
  // a binding made in another frame (the holder's body) has no arm here: still refused
  const holder = "FUNCTION_BLOCK FB_H\nVAR inner : FB_W; v : INT; END_VAR\ninner(shared := v);\nEND_FUNCTION_BLOCK\n"
  const codes = lowerSource(program("h : FB_H;", "h();\nw2 := h.inner;\nw2.AddTen();", holder), "P").diagnostics.map((d) => d.code)
  expect(codes).toContain("call-fb-inout")
})

// Recorded (`tr_16_fb_copy_across_frame_instances`: x1.a = 11, x2.a = 1): a copy taken from ANOTHER instance of the same
// frame type (review of 4e). The binding `x1.inner(shared := a)` made names x1's `a`, but the tag a frame-relative call
// writes is the same in x1 and in x2, so an arm lending `a` from the RUNNING frame wrote x2.a: it lowered with no
// diagnostic and answered x1.a = 1, x2.a = 11. A binding made on another instance arms only where its places cannot
// depend on which frame instance made it (globals, or the root PROGRAM's one frame); here it is refused (`call-fb-inout`).
// Why missed: the frame guard compared frame TYPES, which was enough while every arm was the receiver's own call.
test("a binding copied from another instance of a multi-instance frame is refused, not lent from the running frame", () => {
  const worker = "FUNCTION_BLOCK FB_W\nVAR_IN_OUT shared : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD AddTen\nshared := shared + 10;\nEND_METHOD\n"
  const fbX = (method: string) =>
    `FUNCTION_BLOCK FB_X\nVAR_INPUT w2 : FB_W; END_VAR\nVAR_OUTPUT inner : FB_W; END_VAR\nVAR a : INT := 1; END_VAR\ninner(shared := a);\nEND_FUNCTION_BLOCK\n${method}`
  const codes = (body: string, method: string) =>
    lowerSource(`PROGRAM P\nVAR x1 : FB_X; x2 : FB_X; END_VAR\nx1();\nx2();\n${body}\nEND_PROGRAM\n${fbX(method)}${worker}`, "P").diagnostics.map((d) => d.code)
  // the program copies x1's inner into x2's w2, and x2's METHOD writes through it
  expect(codes("x2.w2 := x1.inner;\nx2.Use();", "METHOD Use\nw2.AddTen();\nEND_METHOD\n")).toContain("call-fb-inout")
  // the METHOD copies a peer's inner, given by reference
  expect(codes("x2.CopyFrom(src := x1);", "METHOD CopyFrom\nVAR_IN_OUT src : FB_X; END_VAR\nw2 := src.inner;\nw2.AddTen();\nEND_METHOD\n")).toContain("call-fb-inout")
  // ...or by value
  expect(codes("x2.CopyFrom(src := x1.inner);", "METHOD CopyFrom\nVAR_INPUT src : FB_W; END_VAR\nw2 := src;\nw2.AddTen();\nEND_METHOD\n")).toContain("call-fb-inout")
})

// Review of 4e (the review fix above): the copy can land in the SAME-NAMED field of another instance. The instance key is
// frame-relative — `inner` in x1 and in x2 is the one key "inner" in FB:FB_X — so x2.inner holding x1.inner's binding
// matched "the receiver's own call" and the arm lent `a` from the running frame (x2.a): it lowered with no diagnostic and
// answered a1 = 1, a2 = 11, where CODESYS writes x1.a (the same read/write rules as `tr_16_fb_copy_across_frame_instances`:
// x1.a = 11, x2.a = 1). Under a whole copy an equal key no longer proves the same instance, so every binding whose places
// are not global, made in a frame that is not single, is refused (`call-fb-inout`). Why missed: the guard compared keys,
// and the tests only copied between differently named fields (w2 vs inner).
test("a binding copied into the same-named field of another frame instance is refused", () => {
  const worker = "FUNCTION_BLOCK FB_W\nVAR_IN_OUT shared : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD AddTen\nshared := shared + 10;\nEND_METHOD\n"
  const codes = (section: string, body: string, method: string) =>
    lowerSource(
      `PROGRAM P\nVAR x1 : FB_X; x2 : FB_X; a1 : INT; a2 : INT; END_VAR\nx1();\nx2();\n${body}\na1 := x1.a;\na2 := x2.a;\nEND_PROGRAM\n` +
        `FUNCTION_BLOCK FB_X\n${section} inner : FB_W; END_VAR\nVAR a : INT := 1; END_VAR\ninner(shared := a);\nEND_FUNCTION_BLOCK\n${method}${worker}`,
      "P",
    ).diagnostics.map((d) => d.code)
  // a METHOD copies a peer's inner into its own inner
  expect(codes("VAR_OUTPUT", "x2.CopyFrom(src := x1);", "METHOD CopyFrom\nVAR_IN_OUT src : FB_X; END_VAR\ninner := src.inner;\ninner.AddTen();\nEND_METHOD\n")).toContain("call-fb-inout")
  // the program copies x1.inner into x2.inner, and x2's METHOD writes through it
  expect(codes("VAR_INPUT", "x2.inner := x1.inner;\nx2.Use();", "METHOD Use\ninner.AddTen();\nEND_METHOD\n")).toContain("call-fb-inout")
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
