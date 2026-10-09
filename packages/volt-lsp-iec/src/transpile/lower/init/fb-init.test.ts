/**
 * Lowering tests of `fb-init.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
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

// Recorded first (`fb_init_runs_with_declared_arguments`, `fb_init_base_and_derived`): FB_Init runs once per instance
// before the first cycle, after the fields' initial values, with bInitRetains TRUE, bInCopyCode FALSE and the arguments
// the instance is declared with — the base's FB_Init first. It was an ordinary METHOD nothing called, and the parser
// dropped `inst : FB(x := 1)`'s arguments: every instance started as if it had no FB_Init, with no diagnostic. Why
// missed: the lifecycle fixtures only checked that the signatures compile.
test("FB_Init runs once per instance before the first cycle, with its declared arguments, the base's first", () => {
  const source =
    "PROGRAM P\nVAR five : FB_Args(startValue := 5); derived : FB_Derived(startValue := 7); END_VAR\nfive();\nderived();\nEND_PROGRAM\n" +
    "FUNCTION_BLOCK FB_Args\nVAR started : INT; retains : BOOL; copyCode : BOOL; initCalls : INT; bodyRuns : INT; seenInitial : INT := 3; END_VAR\nbodyRuns := bodyRuns + 1;\nEND_FUNCTION_BLOCK\n" +
    "METHOD FB_Init : BOOL\nVAR_INPUT bInitRetains : BOOL; bInCopyCode : BOOL; startValue : INT; END_VAR\nstarted := startValue;\nretains := bInitRetains;\ncopyCode := bInCopyCode;\ninitCalls := initCalls + 1;\nseenInitial := seenInitial * 10 + startValue;\nEND_METHOD\n" +
    "FUNCTION_BLOCK FB_Base\nVAR baseStarted : INT; order : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD FB_Init : BOOL\nVAR_INPUT bInitRetains : BOOL; bInCopyCode : BOOL; startValue : INT; END_VAR\nbaseStarted := startValue;\norder := order * 10 + 1;\nEND_METHOD\n" +
    "FUNCTION_BLOCK FB_Derived EXTENDS FB_Base\nVAR derivedStarted : INT; seenBase : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD FB_Init : BOOL\nVAR_INPUT bInitRetains : BOOL; bInCopyCode : BOOL; startValue : INT; END_VAR\nderivedStarted := startValue + 100;\nseenBase := baseStarted;\norder := order * 10 + 2;\nEND_METHOD\n"
  const runner = run(ir(source, "P"))
  runner.scan()
  runner.scan()
  expect(["five.started", "five.initCalls", "five.seenInitial", "five.retains", "five.copyCode", "five.bodyRuns", "derived.order", "derived.seenBase", "derived.derivedStarted"].map((v) => runner.get(v))).toEqual([
    5n, 1n, 35n, true, false, 2n, 12n, 7n, 107n,
  ])
  const codes = (vars: string) => lowerSource(source.replace("five : FB_Args(startValue := 5);", vars), "P").diagnostics.map((d) => d.code)
  // An argument naming a variable was refused here as "not a constant"; the recording since (`fb_init_argument_from_variable`:
  // 4) gives the variable's initial value, so it lowers. Not recorded, and refused: a positional argument, an array element.
  const fromVariable = run(ir(source.replace("five : FB_Args(startValue := 5);", "n : INT := 2; five : FB_Args(startValue := n);"), "P"))
  fromVariable.scan()
  expect(fromVariable.get("five.started")).toEqual(2n)
  expect(codes("five : FB_Args(5);")).toContain("fb-init-argument")
  expect(codes("five : FB_Args(startValue := 5); many : ARRAY[1..2] OF FB_Args;")).toContain("attr-init-unreached")
})

/**
 * A HARNESS LIMIT IS NOT A WORK ITEM. `lowerUnit` lowers a POU on its own by synthesizing `inst : ThatPOU;`
 * (`rootInstance`), and that declaration passes no FB_Init argument — so an FB whose FB_Init takes one can never
 * lower as a ROOT, however complete the transpiler becomes. The vendor never sees that scaffold: measured
 * 2026-09-24, all four corpus projects build with ZERO errors while this was reporting `reach 2, sole 2` against
 * them — the best ratio on the work list, for something no amount of lowering can close.
 *
 * So it has its own code, for the reason `pointer-root-input` has one. A real bare declaration INSIDE a POU keeps
 * `fb-init-argument`, which is a genuine refusal the vendor shares.
 */
test("an FB_Init argument the ROOT harness cannot pass is its own code, not the construct's", () => {
  const fb = "FUNCTION_BLOCK FB_NeedsInit\nVAR\n  held : INT;\nEND_VAR\nheld := held + 1;\nEND_FUNCTION_BLOCK\n" +
    "METHOD FB_Init : BOOL\nVAR_INPUT\n  bInitRetains : BOOL;\n  bInCopyCode : BOOL;\n  startValue : INT;\nEND_VAR\nheld := startValue;\nEND_METHOD\n"

  // lowered ON ITS OWN, the harness declares the instance and has nothing to pass
  const asRoot = lowerSource(fb, "FB_NeedsInit").diagnostics.map((d) => d.code)
  expect(asRoot).toContain("fb-init-root")
  expect(asRoot).not.toContain("fb-init-argument")

  // the same FB declared bare INSIDE a program is the vendor's refusal, and keeps the construct's code
  const inside = lowerSource(`PROGRAM P\nVAR\n  inst : FB_NeedsInit;\nEND_VAR\ninst();\nEND_PROGRAM\n${fb}`, "P")
  expect(inside.diagnostics.map((d) => d.code)).toContain("fb-init-argument")
})

// Recorded after the review of the FB_Init batch found both orders guessed: every FB_Init runs before any
// call_after_global_init_slot method — a holder's (`fb_init_before_slot_method_nested`: 5) and a sibling's declared
// earlier (`fb_init_before_slot_method_sibling`: 7) — and a structured initializer on an instance running FB_Init applies
// AFTER it (`fb_init_and_structured_initializer`: FB_Init saw 0, the 9 stayed). They were interleaved per instance in
// declaration order, the initializer first. Why missed: no recording combined FB_Init with either.
test("every FB_Init runs before the init-slot methods, and a structured initializer applies after FB_Init", () => {
  const writer = "FUNCTION_BLOCK FB_W\nVAR mine : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD FB_Init : BOOL\nVAR_INPUT bInitRetains : BOOL; bInCopyCode : BOOL; startValue : INT; END_VAR\ngShared := startValue;\nmine := startValue;\nEND_METHOD\n"
  const reader = "FUNCTION_BLOCK FB_R\nVAR seen : INT; END_VAR\nEND_FUNCTION_BLOCK\n{attribute 'call_after_global_init_slot' := '50000'}\nMETHOD AfterGlobalInit\nseen := gShared;\nEND_METHOD\n"
  const inner = "FUNCTION_BLOCK FB_I\nVAR started : INT; seenBefore : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD FB_Init : BOOL\nVAR_INPUT bInitRetains : BOOL; bInCopyCode : BOOL; startValue : INT; END_VAR\nseenBefore := started;\nstarted := started * 10 + startValue;\nEND_METHOD\n"
  const holder = "FUNCTION_BLOCK FB_H\nVAR inner : FB_I(startValue := 5); seen : INT; END_VAR\nEND_FUNCTION_BLOCK\n{attribute 'call_after_global_init_slot' := '50000'}\nMETHOD AfterGlobalInit\nseen := inner.started;\nEND_METHOD\n"
  const source = `PROGRAM P\nVAR reader : FB_R; writer : FB_W(startValue := 7); holder : FB_H; both : FB_I(startValue := 5) := (started := 9); END_VAR\nreader();\nwriter();\nholder();\nboth();\nEND_PROGRAM\n${writer}${reader}${inner}${holder}`
  const lowered = lowerSource(source, "P", [{ uri: "file:///project/GVL_Shared.gvl", source: "VAR_GLOBAL\n  gShared : INT;\nEND_VAR\n" }])
  expect(lowered.diagnostics).toEqual([])
  const runner = run(lowered.pou!)
  runner.scan()
  expect(["reader.seen", "holder.seen", "holder.inner.started", "both.seenBefore", "both.started"].map((v) => runner.get(v))).toEqual([7n, 5n, 5n, 0n, 9n])
  // the recording's own shape: both FBs in the GVL's file. `lowerSource` read attributes from the main source only, so the
  // reader's init-slot METHOD, declared there, never ran — the conformance case gave 0 where CODESYS gives 7
  const inGvl = lowerSource("PROGRAM P\nVAR reader : FB_R; writer : FB_W(startValue := 7); END_VAR\nreader();\nwriter();\nEND_PROGRAM\n", "P", [
    { uri: "file:///project/GVL_Shared.gvl", source: `VAR_GLOBAL\n  gShared : INT;\nEND_VAR\n${reader}${writer}` },
  ])
  expect(inGvl.diagnostics).toEqual([])
  const fromGvl = run(inGvl.pou!)
  fromGvl.scan()
  expect(fromGvl.get("reader.seen")).toEqual(7n)
})

// Recorded (`fb_init_nested_in_fb_init`, `fb_init_argument_from_variable`, `fb_init_argument_from_global`): an instance's
// FB_Init runs after those of the instances inside it (the outer's saw the inner's 5), and an argument naming a variable
// gives its value — the initial one (4, 6). Both were refused (`fb-init-order`, and `fb-init-argument` for anything not a
// constant). Why missed: the first FB_Init recordings had one level and constants only.
test("FB_Init: an inner instance's runs first, and an argument may name a variable", () => {
  const inner = "FUNCTION_BLOCK FB_In\nVAR started : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD FB_Init : BOOL\nVAR_INPUT bInitRetains : BOOL; bInCopyCode : BOOL; startValue : INT; END_VAR\nstarted := startValue;\nEND_METHOD\n"
  const outer = "FUNCTION_BLOCK FB_Out\nVAR inner : FB_In(startValue := 5); seenInner : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD FB_Init : BOOL\nVAR_INPUT bInitRetains : BOOL; bInCopyCode : BOOL; startValue : INT; END_VAR\nseenInner := inner.started;\nEND_METHOD\n"
  const source = (decls: string, extra = "") => `PROGRAM P\nVAR seed : INT := 4; ${decls} END_VAR\nseed := seed;\nEND_PROGRAM\n${inner}${outer}${extra}`
  const seedList = [{ uri: "file:///project/GVL_Seed.gvl", source: "VAR_GLOBAL\n  gSeed : INT := 6;\nEND_VAR\n" }]
  const lowered = lowerSource(source("outer : FB_Out(startValue := 1); fromVariable : FB_In(startValue := seed); fromGlobal : FB_In(startValue := gSeed);"), "P", seedList)
  expect(lowered.diagnostics).toEqual([])
  const runner = run(lowered.pou!)
  runner.scan()
  expect(["outer.seenInner", "outer.inner.started", "fromVariable.started", "fromGlobal.started"].map((v) => runner.get(v))).toEqual([5n, 5n, 4n, 6n])
  // a variable named in a declaration inside an FB means that FB's field — refused while the init step had no such place;
  // it reads the holder's field now (transpile-review 23, `tr_23_fb_init_argument_from_pending_init`)
  const holder = "FUNCTION_BLOCK FB_Holder\nVAR localSeed : INT := 3; held : FB_In(startValue := localSeed); END_VAR\nEND_FUNCTION_BLOCK\n"
  const held = run(ir(source("holder : FB_Holder;", holder), "P"))
  held.scan()
  expect(held.get("holder.held.started")).toBe(3n)
  // Review of that batch: only what the recordings cover takes a variable argument. A struct field's declaration was read
  // in the POU's scope (a local the struct cannot see), and a later or VAR_TEMP variable, or a global an FB_Init writes,
  // gave values no recording shows. (A derived FB holding FB_Init instances was refused here too, `fb-init-order`, until
  // `init_extends_field_instance` recorded its order — transpile-restructure 5.6, the test below.)
  const codes = (decls: string, extra = "") => lowerSource(source(decls, extra), "P", seedList).diagnostics.map((d) => d.code)
  expect(codes("h : ST_H;", "TYPE ST_H :\nSTRUCT\n  held : FB_In(startValue := seed);\nEND_STRUCT\nEND_TYPE\n")).toContain("fb-init-argument")
  expect(codes("fromLater : FB_In(startValue := later); later : INT := 3;")).toContain("fb-init-argument")
  expect(
    lowerSource(`PROGRAM P\nVAR_TEMP temp : INT := 4; END_VAR\nVAR a : FB_In(startValue := temp); END_VAR\ntemp := temp;\nEND_PROGRAM\n${inner}`, "P").diagnostics.map((d) => d.code),
  ).toContain("fb-init-argument")
  const globalWriter = "FUNCTION_BLOCK FB_Wg\nEND_FUNCTION_BLOCK\nMETHOD FB_Init : BOOL\nVAR_INPUT bInitRetains : BOOL; bInCopyCode : BOOL; startValue : INT; END_VAR\ngSeed := startValue;\nEND_METHOD\n"
  expect(codes("w : FB_Wg(startValue := 1); fromGlobal : FB_In(startValue := gSeed);", globalWriter)).toContain("fb-init-argument")
})

// transpile-restructure 5.6: an EXTENDS chain initializes PER CLASS, the base first — that class's own fields in declaration
// order (a field instance's whole init at its position), then that class's FB_Init (`init_extends_interleaving`: 1-4;
// `init_extends_field_instance`: base field 1, base FB_Init 2, `before` 3, the inner FB_Init 4, `after` 5, derived FB_Init 6,
// and without a derived FB_Init the same less the last; `_in_base`: the base's field instance before the base's FB_Init).
// Both chain sites of `fb-init-order` refused this (the whole chain's fields first, every FB_Init after, was a guess).
test("an EXTENDS chain initializes per class: its fields, a field instance's FB_Init at its position, then its FB_Init", () => {
  const fbInit = "METHOD FB_Init : BOOL\nVAR_INPUT bInitRetains : BOOL; bInCopyCode : BOOL; END_VAR\n"
  const src =
    "VAR_GLOBAL gSeq : INT; END_VAR\n" +
    "FUNCTION F_Next : INT\ngSeq := gSeq + 1;\nF_Next := gSeq;\nEND_FUNCTION\n" +
    "PROGRAM P\nVAR inst : FB_D; plain : FB_P; inBase : FB_D2; END_VAR\ninst();\nplain();\ninBase();\nEND_PROGRAM\n" +
    "FUNCTION_BLOCK FB_In\nVAR innerInit : INT; END_VAR\nEND_FUNCTION_BLOCK\n" + fbInit + "innerInit := F_Next();\nEND_METHOD\n" +
    "FUNCTION_BLOCK FB_B\nVAR baseField : INT := F_Next(); baseInit : INT; END_VAR\nEND_FUNCTION_BLOCK\n" + fbInit + "baseInit := F_Next();\nEND_METHOD\n" +
    "FUNCTION_BLOCK FB_D EXTENDS FB_B\nVAR before : INT := F_Next(); inner : FB_In; after : INT := F_Next(); derivedInit : INT; END_VAR\nEND_FUNCTION_BLOCK\n" + fbInit + "derivedInit := F_Next();\nEND_METHOD\n" +
    "FUNCTION_BLOCK FB_P EXTENDS FB_B\nVAR before : INT := F_Next(); inner : FB_In; after : INT := F_Next(); END_VAR\nEND_FUNCTION_BLOCK\n" +
    "FUNCTION_BLOCK FB_B2\nVAR baseBefore : INT := F_Next(); inner : FB_In; baseAfter : INT := F_Next(); baseInit : INT; END_VAR\nEND_FUNCTION_BLOCK\n" + fbInit + "baseInit := F_Next();\nEND_METHOD\n" +
    "FUNCTION_BLOCK FB_D2 EXTENDS FB_B2\nVAR derivedField : INT := F_Next(); derivedInit : INT; END_VAR\nEND_FUNCTION_BLOCK\n" + fbInit + "derivedInit := F_Next();\nEND_METHOD\n"
  const runner = run(ir(src, "P"))
  runner.scan()
  const read = (paths: string[]) => paths.map((v) => runner.get(v))
  expect(read(["inst.baseField", "inst.baseInit", "inst.before", "inst.inner.innerInit", "inst.after", "inst.derivedInit"])).toEqual([1n, 2n, 3n, 4n, 5n, 6n])
  expect(read(["plain.baseField", "plain.baseInit", "plain.before", "plain.inner.innerInit", "plain.after"])).toEqual([7n, 8n, 9n, 10n, 11n])
  expect(read(["inBase.baseBefore", "inBase.inner.innerInit", "inBase.baseAfter", "inBase.baseInit", "inBase.derivedField", "inBase.derivedInit"])).toEqual([12n, 13n, 14n, 15n, 16n, 17n])
})

// transpile-review 22: an instance's non-constant field initializers ran AFTER its FB_Init, so FB_Init dereferenced a
// still-null `ADR(m)` pointer, read 0 from a call-initialized field and saw its own write undone. CODESYS completes the
// implicit initialization first (`tr_22_fb_init_reads_adr_field`, `tr_22_fb_init_reads_call_field`: seen = 7, a = 100).
test("an instance's field initializers run before its FB_Init", () => {
  const fbInit = (body: string) => `METHOD FB_Init : BOOL\nVAR_INPUT bInitRetains : BOOL; bInCopyCode : BOOL; END_VAR\n${body}\nEND_METHOD\n`
  const src =
    "PROGRAM P\nVAR viaAdr : FB_Adr; called : FB_Call; END_VAR\nviaAdr();\ncalled();\nEND_PROGRAM\n" +
    "FUNCTION F_Inc : INT\nVAR_INPUT n : INT; END_VAR\nF_Inc := n + 1;\nEND_FUNCTION\n" +
    "FUNCTION_BLOCK FB_Adr\nVAR m : INT := 7; p : POINTER TO INT := ADR(m); seen : INT; END_VAR\nEND_FUNCTION_BLOCK\n" + fbInit("seen := p^;") +
    "FUNCTION_BLOCK FB_Call\nVAR a : INT := F_Inc(6); seen : INT; END_VAR\nEND_FUNCTION_BLOCK\n" + fbInit("seen := a;\na := 100;")
  const runner = run(ir(src, "P"))
  runner.scan()
  expect(["viaAdr.seen", "called.seen", "called.a"].map((v) => runner.get(v))).toEqual([7n, 7n, 100n])
})

// Gate 5c: the position rule in an instance's frame turned a constant field after a running initializer into a walk
// statement — and wrote the TYPE's layout to zero for it. A structured initializer on the instance (`(k := 7)`) was then
// overwritten by the type's 5 (it is applied after the instance's init, as `fb_init_and_structured_initializer` records
// for FB_Init); and every construction of the type the walk does not follow — a VAR_TEMP's reset on every run — started
// the field at 0. Why missed: no fixture puts a structured initializer, or a VAR_TEMP, on such a type.
test("the position rule in an instance keeps the instance's structured initializer and the type's own initial values", () => {
  const pre =
    "VAR_GLOBAL\ng : INT;\nEND_VAR\nFUNCTION F_Next : INT\ng := g + 1;\nF_Next := g;\nEND_FUNCTION\n" +
    "FUNCTION_BLOCK FB\nVAR x : INT := F_Next(); k : INT := 5; END_VAR\nEND_FUNCTION_BLOCK\n"
  const structured = run(ir(`${pre}PROGRAM P\nVAR i : FB := (k := 7); out : INT; END_VAR\nout := i.k;\nEND_PROGRAM\n`, "P"))
  structured.scan()
  expect(structured.get("out")).toEqual(7n)
  const inStruct =
    "FUNCTION_BLOCK FB_In\nVAR v : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD FB_Init : BOOL\nVAR_INPUT bInitRetains : BOOL; bInCopyCode : BOOL; END_VAR\nv := 3;\nEND_METHOD\n" +
    "TYPE ST :\nSTRUCT\nin : FB_In;\nlate : INT := 8;\nEND_STRUCT\nEND_TYPE\n" +
    "PROGRAM P\nVAR sv : ST := (late := 9); out : INT; END_VAR\nout := sv.late;\nEND_PROGRAM\n"
  const struct = run(ir(inStruct, "P"))
  struct.scan()
  expect(struct.get("out")).toEqual(9n)
  const temp = run(ir(`${pre}PROGRAM P\nVAR i : FB; out : INT; END_VAR\nVAR_TEMP tmp : FB; END_VAR\nout := tmp.k;\ntmp.k := 77;\nEND_PROGRAM\n`, "P"))
  temp.scan()
  expect(temp.get("out")).toEqual(5n)
  temp.scan()
  expect(temp.get("out")).toEqual(5n)
})

// Gate 5c (second review): a type's running initializer reading a field the instance's structured initializer names gave
// two answers by declaration position — the field declared before the type's first running initializer is folded with the
// structured value in place (`seen` 7), after it a position statement with the structured value re-applied at the end
// (`seen` 5). Neither is recorded (`fb_init_and_structured_initializer` covers FB_Init only): `init-reads-instance`. And an
// ENCLOSING structured initializer reaching a nested instance that runs FB_Init (`(inner := (k := 9))`) was in place at
// construction, so FB_Init saw 9 where the same value on the instance's own declaration is applied after it (seen 0,
// recorded): `fb-init-order`, as the instance's own nested structured value is. Why missed: no test put a structured
// initializer on a type with a running initializer reading the field, or one level up from an FB_Init.
test("a structured initializer a running initializer reads, or one reaching a nested FB_Init, is refused by name", () => {
  const codes = (source: string) => lowerSource(source, "P").diagnostics.map((d) => d.code)
  const pre = "VAR_GLOBAL\ng : INT;\nEND_VAR\nFUNCTION F_Next : INT\ng := g + 1;\nF_Next := g;\nEND_FUNCTION\n"
  const fb = (decls: string) => `FUNCTION_BLOCK FB\nVAR ${decls} END_VAR\nEND_FUNCTION_BLOCK\n`
  const prg = "PROGRAM P\nVAR i : FB := (k := 7); out : INT; END_VAR\ni();\nout := i.seen;\nEND_PROGRAM\n"
  expect(codes(pre + fb("x : INT := F_Next(); k : INT := 5; seen : INT := k + x - x;") + prg)).toEqual(["init-reads-instance"])
  expect(codes(pre + fb("k : INT := 5; x : INT := F_Next(); seen : INT := k + x - x;") + prg)).toEqual(["init-reads-instance"])
  expect(codes(pre + fb("k : INT := 5; x : INT := F_Next(); seen : INT := THIS^.k + x - x;") + prg)).toEqual(["init-reads-instance"])
  // a running initializer reading another field still lowers, the structured value kept (the gate 5c case above)
  const other = run(ir(pre + fb("x : INT := F_Next(); k : INT := 5; seen : INT := x;") + prg, "P"))
  other.scan()
  expect([other.get("out"), other.get("i.k")]).toEqual([1n, 7n])
  const inner =
    "FUNCTION_BLOCK Inner\nVAR k : INT; seen : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD FB_Init : BOOL\nVAR_INPUT bInitRetains : BOOL; bInCopyCode : BOOL; END_VAR\nseen := k;\nEND_METHOD\n" +
    "FUNCTION_BLOCK Outer\nVAR inner : Inner; END_VAR\nEND_FUNCTION_BLOCK\n"
  expect(codes(`${inner}PROGRAM P\nVAR o : Outer := (inner := (k := 9)); END_VAR\no();\nEND_PROGRAM\n`)).toEqual(["fb-init-order"])
  // on the instance's own declaration: applied after FB_Init (recorded, seen 0)
  const own = run(ir(`${inner}PROGRAM P\nVAR d : Inner := (k := 9); END_VAR\nd();\nEND_PROGRAM\n`, "P"))
  own.scan()
  expect([own.get("d.seen"), own.get("d.k")]).toEqual([0n, 9n])
})

// transpile-restructure 5.8 (design.md §3.4 step 5d; M5.1.2): a STRUCT field instance's FB_Init argument resolves in the
// STRUCT's scope — an earlier field of that struct (`init_struct_field_fb_init_scope_sibling`: 4), a field before a global
// of the same name (`_shadow`: the field's 4, not the global's 11), else a global; never the declaring POU's (`_local`:
// both vendors refuse). It was lowered in the declaring POU's scope, where a struct field is no name: `fb-init-argument`.
// A LATER field of the struct is not initialized yet: `init-reads-later`. Why missed: no test declared an FB_Init argument
// on a STRUCT field.
test("a STRUCT field instance's FB_Init argument resolves in the struct's scope: earlier fields, then globals", () => {
  const target = "FUNCTION_BLOCK FB_T\nVAR got : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD FB_Init : BOOL\nVAR_INPUT bInitRetains : BOOL; bInCopyCode : BOOL; v : INT; END_VAR\ngot := v;\nEND_METHOD\n"
  const struct = (fields: string) => `TYPE DUT :\nSTRUCT\n${fields}\nEND_STRUCT\nEND_TYPE\n`
  const gvl = [{ uri: "file:///project/GVL_S.gvl", source: "VAR_GLOBAL\n  first : INT := 11;\n  gSeed : INT := 6;\nEND_VAR\n" }]
  const holderFb = "FUNCTION_BLOCK FB_H\nVAR h : DUT; END_VAR\nEND_FUNCTION_BLOCK\n"
  const source = (fields: string, decls = "rec : DUT;") => `PROGRAM P\nVAR ${decls} END_VAR\n;\nEND_PROGRAM\n${target}${struct(fields)}${holderFb}`
  const got = (fields: string, path: string, decls?: string) => {
    const lowered = lowerSource(source(fields, decls), "P", gvl)
    expect(lowered.diagnostics).toEqual([])
    const runner = run(lowered.pou!)
    runner.scan()
    return runner.get(path)
  }
  // an earlier field, named like a global: the field (`_sibling`, `_shadow`)
  expect(got("first : INT := 4;\nheld : FB_T(v := first);", "rec.held.got")).toBe(4n)
  // a global, in PLC_PRG and inside an FB (`init_struct_field_fb_init_scope`'s `viaGlobal`: 6)
  expect(got("held : FB_T(v := gSeed);", "rec.held.got")).toBe(6n)
  expect(got("held : FB_T(v := gSeed);", "holder.h.held.got", "holder : FB_H;")).toBe(6n)
  const codes = (fields: string, decls?: string) => lowerSource(source(fields, decls), "P", gvl).diagnostics.map((d) => d.code)
  // a later field of the struct: not initialized yet
  expect(codes("held : FB_T(v := last);\nlast : INT := 4;")).toEqual(["init-reads-later"])
  // a variable of the POU declaring the struct variable is no name in the struct (`_local`: both vendors refuse)
  expect(codes("held : FB_T(v := seed);", "seed : INT := 4; rec : DUT;")).toEqual(["fb-init-argument"])
  // NOT RECORDED, a conservative refusal: such a variable shadowing a GLOBAL of its name — the struct's scope would give
  // the global (6), no fixture records it (`_local` has no global of that name). niche: accepted loss (0 occurrences in
  // the corpora: every corpus FB_Init argument is a literal)
  expect(codes("held : FB_T(v := gSeed);", "gSeed : INT := 4; rec : DUT;")).toEqual(["fb-init-argument"])
})

// gate 5d review: what the struct-scope lowering (5.8) let through unrecorded or wrong. Why missed: the 5.8 test above
// declared the struct variable bare, its arguments as bare names of elementary fields.
test("a STRUCT field instance's FB_Init argument: refused where the struct's scope gives no recorded answer", () => {
  const target = "FUNCTION_BLOCK FB_T\nVAR got : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD FB_Init : BOOL\nVAR_INPUT bInitRetains : BOOL; bInCopyCode : BOOL; v : INT; END_VAR\ngot := v;\nEND_METHOD\n"
  const struct = (name: string, fields: string) => `TYPE ${name} :\nSTRUCT\n${fields}\nEND_STRUCT\nEND_TYPE\n`
  const gvl = [{ uri: "file:///project/GVL_S.gvl", source: "VAR_GLOBAL CONSTANT\n  first : INT := 11;\nEND_VAR\n" }]
  const lowered = (decls: string, more = "", fields = "first : INT := 4;\nheld : FB_T(v := first);") =>
    lowerSource(`PROGRAM P\nVAR ${decls} END_VAR\n;\nEND_PROGRAM\n${target}${struct("DUT", fields)}${more}`, "P", gvl)
  const codes = (decls: string, more?: string, fields?: string) => lowered(decls, more, fields).diagnostics.map((d) => d.code)
  // an ENCLOSING structured initializer setting the sibling the argument reads: whether FB_Init sees it is not recorded
  // (on an FB instance's own declaration it is applied after FB_Init, `fb_init_and_structured_initializer`) — it saw 7/9
  expect(codes("rec : DUT := (first := 7);")).toEqual(["fb-init-order"])
  expect(codes("holder : FB_H;", "FUNCTION_BLOCK FB_H\nVAR rr : DUT := (first := 9); END_VAR\nEND_FUNCTION_BLOCK\n")).toEqual(["fb-init-order"])
  expect(codes("o : DUT_O;", struct("DUT_O", "inner : DUT := (first := 9);"))).toEqual(["fb-init-order"])
  // ...one setting another field still lowers: the sibling's 4
  const other = lowered("rec : DUT := (spare := 7);", "", "first : INT := 4;\nspare : INT;\nheld : FB_T(v := first);")
  expect(other.diagnostics).toEqual([])
  const r = run(other.pou!)
  r.scan()
  expect(r.get("rec.held.got")).toBe(4n)
  // an EXPRESSION naming anything is not judged in the struct's scope (the global constant's 11, a POU constant the struct
  // cannot see): `fb-init-argument`, as design.md §3.4 step 5d keeps any expression
  expect(codes("rec : DUT;", "", "first : INT := 4;\nheld : FB_T(v := first + 0);")).toEqual(["fb-init-argument"])
  expect(codes("rec : DUT;", "", "first : INT := 4;\nheld : FB_T(v := -first);")).toEqual(["fb-init-argument"])
  expect(codes("rec : DUT; END_VAR VAR CONSTANT seed : INT := 4;", "", "held : FB_T(v := seed + 0);")).toEqual(["fb-init-argument"])
  // ...a literal one still folds
  const literal = lowered("rec : DUT;", "", "held : FB_T(v := -3 + 1);")
  expect(literal.diagnostics).toEqual([])
  const l = run(literal.pou!)
  l.scan()
  expect(l.get("rec.held.got")).toBe(-2n)
  // a sibling that is not an elementary value (a STRUCT, an FB instance) is no argument for an INT input
  expect(codes("rec : DUT;", struct("DUT2", "a : INT := 1;"), "first : DUT2;\nheld : FB_T(v := first);")).toEqual(["fb-init-argument"])
  expect(codes("rec : DUT;", "", "first : FB_T(v := 3);\nheld : FB_T(v := first);")).toEqual(["fb-init-argument"])
})
