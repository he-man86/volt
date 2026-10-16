/**
 * Lowering tests of `temp-resets.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { lowerSource } from "../index.js"
import { ir } from "../../../../test/support/transpile.js"

// transpile-review 24: a VAR_TEMP whose initializer is not a constant was queued for the run-once init step and then
// reset to its type's zero on every run — CODESYS evaluates it on EVERY call (`var_temp_dynamic_init`: 9 then 10).
test("a VAR_TEMP with a non-constant initializer re-evaluates it on every run of its body — an FB's and a PROGRAM's", () => {
  const source =
    "PROGRAM P\nVAR inst : FB_T; g : INT := 7; fb1 : INT; fb2 : INT; fbExpr : INT; own1 : INT; own2 : INT; END_VAR\n" +
    "VAR_TEMP t : INT := g; u : INT := g * 2 + 1; END_VAR\n" +
    "inst(src := g); fb1 := inst.seen; inst(src := g + 1); fb2 := inst.seen; fbExpr := inst.seenExpr;\n" +
    "IF own1 = 0 THEN own1 := u; ELSE own2 := u; END_IF\ng := g + t;\nEND_PROGRAM\n" +
    "FUNCTION_BLOCK FB_T\nVAR_INPUT src : INT; END_VAR\nVAR_TEMP t : INT := src; u : INT := src * 2 + 1; END_VAR\nVAR seen : INT; seenExpr : INT; END_VAR\n" +
    "seen := t;\nseenExpr := u;\nEND_FUNCTION_BLOCK\n"
  const runner = run(ir(source, "P"))
  runner.scan()
  expect(["fb1", "fb2", "fbExpr", "own1", "g"].map((v) => runner.get(v))).toEqual([7n, 8n, 17n, 15n, 14n])
  runner.scan()
  expect(["fb1", "fb2", "own2", "g"].map((v) => runner.get(v))).toEqual([14n, 15n, 29n, 28n])
  // one reading a VAR_TEMP declared after it (or itself) reads a value no recording gives: refused
  const later = (init: string) => lowerSource(`PROGRAM P
VAR g : INT; rv : INT; END_VAR
VAR_TEMP ${init} END_VAR
rv := a;
END_PROGRAM
`, "P").diagnostics.map((d) => d.code)
  expect(later("a : INT := g + b; b : INT := 1;")).toEqual(["init-reads-later"])
  expect(later("b : INT := 1; a : INT := g + b;")).toEqual([])
})

// transpile-restructure 5.5: a METHOD's and a FUNCTION's VAR (their temporary section; CODESYS refuses VAR_TEMP there)
// re-evaluates a non-constant initializer on every call (`var_temp_dynamic_init_method`, `_function`: 9 then 10, an
// input's `k * 3` 6 then 15) — it was `init-not-constant`. And a VAR_TEMP ARRAY or STRUCT whose initializer has dynamic
// elements re-evaluates each per call, every other element at its static value (`var_temp_dynamic_aggregate_init`: [3, 6,
// 9] then [5, 10, 10]; (3, 4, 18) then (5, 4, 20)) — `IrFresh` of the static part, then one statement per dynamic element.
test("a routine's local and a VAR_TEMP aggregate re-evaluate their dynamic initializers on every call", () => {
  const source =
    "VAR_GLOBAL g : INT := 7; END_VAR\n" +
    "TYPE Rec :\nSTRUCT\n\ta : INT;\n\tb : INT := 4;\n\tc : INT;\nEND_STRUCT\nEND_TYPE\n" +
    "FUNCTION F_Twice : INT\nVAR_INPUT n : INT; END_VAR\nF_Twice := n * 2;\nEND_FUNCTION\n" +
    "FUNCTION F_Seen : INT\nVAR_INPUT k : INT; END_VAR\nVAR t : INT := g; viaInput : INT := k * 3; END_VAR\nF_Seen := t * 100 + viaInput;\ng := g + 1;\nEND_FUNCTION\n" +
    "FUNCTION_BLOCK FB_A\nVAR_INPUT k : INT; END_VAR\nVAR_TEMP arr : ARRAY[0..2] OF INT := [k, 0 + F_Twice(k), g]; rc : Rec := (a := k, c := F_Twice(g)); END_VAR\n" +
    "VAR r0 : INT; r1 : INT; r2 : INT; sa : INT; sb : INT; sc : INT; END_VAR\n" +
    "r0 := arr[0]; r1 := arr[1]; r2 := arr[2]; sa := rc.a; sb := rc.b; sc := rc.c;\narr[1] := 0; rc.b := 0;\nEND_FUNCTION_BLOCK\n" +
    "PROGRAM P\nVAR inst : FB_A; s1 : INT; s2 : INT; END_VAR\ns1 := F_Seen(k := 2);\ns2 := F_Seen(k := 5);\ninst(k := 3);\nEND_PROGRAM\n"
  const runner = run(ir(source, "P"))
  runner.scan()
  expect(["s1", "s2"].map((v) => runner.get(v))).toEqual([706n, 815n])
  expect(["inst.r0", "inst.r1", "inst.r2", "inst.sa", "inst.sb", "inst.sc"].map((v) => runner.get(v))).toEqual([3n, 6n, 9n, 3n, 4n, 18n])
  runner.scan()
  expect(["inst.r1", "inst.r2", "inst.sb", "inst.sc"].map((v) => runner.get(v))).toEqual([6n, 11n, 4n, 22n])
  // a local's initializer reading itself or a later local reads a value no recording gives: refused
  const local = (vars: string) =>
    lowerSource(`VAR_GLOBAL gq : INT; END_VAR\nFUNCTION F : INT\nVAR ${vars} END_VAR\nF := a;\nEND_FUNCTION\nPROGRAM P\nVAR x : INT; END_VAR\nx := F();\nEND_PROGRAM\n`, "P").diagnostics.map((d) => d.code)
  expect(local("a : INT := gq + b; b : INT := 1;")).toEqual(["init-reads-later"])
  expect(local("b : INT := 1; a : INT := gq + b;")).toEqual([])
})

// transpile-restructure 7.6.4 (design.md §3.4, step 7.6b): a VAR_TEMP is per-run storage — a local of the run of the body
// that declares it, exactly as a METHOD's VAR is, not a field the instance carries between runs. There is no reset
// statement: the run starts with it fresh at its initial value (`life_fb_var_temp_calls`, `life_program_var_temp_runs`).
test("the interpreter starts a VAR_TEMP over without a reset statement — an FB's, a PROGRAM's and a base's run by SUPER^()", () => {
  const source =
    "FUNCTION_BLOCK FB_Base\nVAR_TEMP b : INT := 3; END_VAR\nVAR baseSeen : INT; END_VAR\nb := b + 1;\nbaseSeen := b;\nEND_FUNCTION_BLOCK\n" +
    "FUNCTION_BLOCK FB_T EXTENDS FB_Base\nVAR_TEMP n : INT := 10; END_VAR\nVAR seen : INT; END_VAR\nn := n + 1;\nseen := n;\nSUPER^();\nEND_FUNCTION_BLOCK\n" +
    "PROGRAM P\nVAR inst : FB_T; own : INT; END_VAR\nVAR_TEMP t : INT := 5; END_VAR\nt := t + 1;\nown := t;\ninst();\ninst();\nEND_PROGRAM\n"
  const pou = ir(source, "P")
  // no slot holds them: the POU's VAR_TEMP is its run's local, the FB's its body's, the base's its SUPER_ routine's
  expect(pou.slots.map((s) => s.name)).toEqual(["inst", "own"])
  expect(pou.locals?.map((s) => s.name)).toEqual(["t"])
  const fb = pou.layouts.find((l) => l.name === "FB_T")!
  expect(fb.fields.map((f) => f.name)).toEqual(["baseSeen", "seen"])
  expect(fb.locals?.map((s) => [s.name, s.init])).toEqual([["n", 10n]])
  expect(pou.routines.find((r) => r.name === "FB_T.SUPER_FB_Base")!.locals.map((s) => s.name)).toEqual(["b"])
  // and nothing resets them: each body's first statement is its own first statement
  expect(pou.body[0]).toMatchObject({ kind: "assign", target: { root: "local", slot: 0 } })
  expect(fb.body![0]).toMatchObject({ kind: "assign", target: { root: "local", slot: 0 } })
  const runner = run(pou)
  for (let scan = 0; scan < 3; scan++) {
    runner.scan()
    expect(["own", "inst.seen", "inst.baseSeen"].map((v) => runner.get(v))).toEqual([6n, 11n, 4n])
  }
})

// A VAR_TEMP is never resolved to a field: through an instance path it is refused by name (`oopa_write_var_temp`:
// "'scratch' is no input of '__MAIN'"), and so are the two shapes the vendors COMPILE but whose value is not the body's — an
// ACTION reads 0 where the body stored 5, so does `THIS^.scratch` in the body itself (`var_temp_named_in_action`,
// `var_temp_named_through_this`: seen = 1 on CODESYS; niche: accepted loss, 0 occurrences in the corpora). A METHOD of its
// FB and a derived FB's body do not SEE it (both vendors: "Identifier 'scratch' not defined", `var_temp_named_in_method`,
// `var_temp_named_in_derived_body`): there the name is a global of it where one exists — the global, as recorded since
// gate 7.6b (`var_temp_named_in_method_beside_global`, the test above; this said `var-temp-outside-body`, a refusal the
// recording contradicts) — and with none it does not resolve, as the vendors say.
test("a VAR_TEMP named outside the body that declares it is refused by name, or not seen there", () => {
  const fb = (body: string, member = "") =>
    lowerSource(
      `VAR_GLOBAL scratch : INT; END_VAR\nFUNCTION_BLOCK FB_T\nVAR_TEMP scratch : INT; END_VAR\nVAR seen : INT; END_VAR\nscratch := 5;\n${body}\nEND_FUNCTION_BLOCK\n${member}` +
        "FUNCTION_BLOCK FB_D EXTENDS FB_T\nseen := scratch;\nEND_FUNCTION_BLOCK\n" +
        "PROGRAM P\nVAR inst : FB_T; d : FB_D; out : INT; END_VAR\ninst();\nout := inst.seen;\nEND_PROGRAM\n",
      "P",
    ).diagnostics.map((d) => d.code)
  expect(fb("")).toEqual([])
  expect(fb("Probe();", "METHOD Probe\nseen := scratch + 1;\nEND_METHOD\n")).toEqual([]) // the VAR_GLOBAL scratch
  expect(fb("Probe();", "ACTION Probe\nseen := scratch + 1;\nEND_ACTION\n")).toEqual(["var-temp-outside-body"])
  expect(fb("seen := THIS^.scratch + 1;")).toEqual(["var-temp-outside-body"])
  // a METHOD's own variable of that name is its own
  expect(fb("Probe();", "METHOD Probe\nVAR scratch : INT; END_VAR\nseen := scratch + 1;\nEND_METHOD\n")).toEqual([])
  const outside = (stmt: string) =>
    lowerSource(
      `FUNCTION_BLOCK FB_T\nVAR_TEMP scratch : INT; END_VAR\nscratch := 1;\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK FB_D EXTENDS FB_T\nVAR seen : INT; END_VAR\n${stmt}\nEND_FUNCTION_BLOCK\n` +
        "PROGRAM P\nVAR t : FB_T; d : FB_D; END_VAR\nd();\nt.scratch := 2;\nEND_PROGRAM\n",
      "P",
    ).diagnostics.map((d) => d.code)
  expect(outside("seen := 1;")).toEqual(["var-temp-outside-body"])
  // the derived body's `scratch` resolves to nothing ("Identifier 'scratch' not defined"), `t.scratch` is the refused path
  expect(outside("seen := scratch;")).toEqual(["place-not-local", "var-temp-outside-body"])
  // nor is a VAR_TEMP storage an address could name between runs (0 fixtures, unrecorded): `var-at`, as in a METHOD
  const at = lowerSource("PROGRAM P\nVAR out : INT; END_VAR\nVAR_TEMP w AT %MW4 : INT; END_VAR\nout := w;\nEND_PROGRAM\n", "P")
  expect(at.diagnostics.map((d) => d.code)).toEqual(["var-at"])
})

// GATE 7.6b (review of 7.6.4). Where a VAR_TEMP is not visible — a METHOD of its FB, a derived FB's body — its name is
// any other declaration of that name: a VAR_GLOBAL of it is read (recorded `var_temp_named_in_method_beside_global`,
// `var_temp_named_in_derived_body_beside_global`: seen = 41 over a global 40, both vendors build), as the LSP resolves it
// (`symbols/scope-nav.ts`). Where it is visible but holds no value of the run — an ACTION, `THIS^.` — it stays refused.
test("a VAR_TEMP's name read where the temp is not visible is the global of that name", () => {
  const lower = (source: string) => lowerSource(source, "P")
  const viaMethod = lower(
    "VAR_GLOBAL vtgm : INT := 40; END_VAR\nFUNCTION_BLOCK FB_T\nVAR_TEMP vtgm : INT; END_VAR\nVAR seen : INT; END_VAR\nvtgm := 5;\nProbe();\nEND_FUNCTION_BLOCK\n" +
      "METHOD Probe\nseen := vtgm + 1;\nEND_METHOD\nPROGRAM P\nVAR inst : FB_T; out : INT; g : INT; END_VAR\ninst();\nout := inst.seen;\ng := vtgm;\nEND_PROGRAM\n",
  )
  expect(viaMethod.diagnostics).toEqual([])
  const derived = lower(
    "VAR_GLOBAL vtgd : INT := 40; END_VAR\nFUNCTION_BLOCK FB_B\nVAR_TEMP vtgd : INT; END_VAR\nVAR seen : INT; END_VAR\nvtgd := 1;\nEND_FUNCTION_BLOCK\n" +
      "FUNCTION_BLOCK FB_D EXTENDS FB_B\nseen := vtgd + 1;\nEND_FUNCTION_BLOCK\nPROGRAM P\nVAR inst : FB_D; out : INT; g : INT; END_VAR\ninst();\nout := inst.seen;\ng := vtgd;\nEND_PROGRAM\n",
  )
  expect(derived.diagnostics).toEqual([])
  for (const pou of [viaMethod.pou!, derived.pou!]) {
    const runner = run(pou)
    runner.scan()
    expect(["out", "g"].map((v) => runner.get(v))).toEqual([41n, 40n])
  }
})

// GATE 7.6b: a base's VAR_TEMP run by `SUPER^()` starts over each run at its initializer — a constant one, and one read from
// a field, evaluated each run in the SUPER_ routine (recorded `var_temp_base_run_by_super_constant_init`: bo 8 after two
// scans; `var_temp_base_run_by_super_dynamic_init`: bo 40). Before 7.6.4 the dynamic one was queued on the derived frame
// and read 0 every run.
test("a base's VAR_TEMP run by SUPER^() starts over at its initializer, a dynamic one evaluated each run", () => {
  const pou = ir(
    "FUNCTION_BLOCK FB_C\nVAR_TEMP a : INT := 7; END_VAR\nVAR g : INT; bo : INT; END_VAR\na := a + g;\nbo := a;\ng := g + 1;\nEND_FUNCTION_BLOCK\n" +
      "FUNCTION_BLOCK FB_CD EXTENDS FB_C\nSUPER^();\nEND_FUNCTION_BLOCK\n" +
      "FUNCTION_BLOCK FB_Y\nVAR g : INT := 3; bo : INT; END_VAR\nVAR_TEMP a : INT := g * 10; END_VAR\nbo := a;\ng := g + 1;\nEND_FUNCTION_BLOCK\n" +
      "FUNCTION_BLOCK FB_YD EXTENDS FB_Y\nSUPER^();\nEND_FUNCTION_BLOCK\n" +
      "PROGRAM P\nVAR c : FB_CD; y : FB_YD; END_VAR\nc();\ny();\nEND_PROGRAM\n",
    "P",
  )
  const runner = run(pou)
  runner.scan()
  expect(["c.bo", "y.bo"].map((v) => runner.get(v))).toEqual([7n, 30n])
  runner.scan()
  expect(["c.bo", "y.bo"].map((v) => runner.get(v))).toEqual([8n, 40n])
})

// GATE 7.6b: a derived FB may declare a VAR or a VAR_TEMP named like its base's VAR_TEMP — two variables, not a duplicate
// (recorded `var_temp_base_redeclared_as_var`: sv 20, bs 4 after two scans; `_as_temp`: ds 110, bs 4; both vendors build).
test("a derived FB's VAR or VAR_TEMP named like its base's VAR_TEMP is a variable of its own", () => {
  const base = "FUNCTION_BLOCK FB_B\nVAR_TEMP sv : INT := 3; END_VAR\nVAR bs : INT; END_VAR\nsv := sv + 1;\nbs := sv;\nEND_FUNCTION_BLOCK\n"
  const asVar = run(ir(base + "FUNCTION_BLOCK FB_D EXTENDS FB_B\nVAR sv : INT; END_VAR\nsv := sv + 10;\nSUPER^();\nEND_FUNCTION_BLOCK\nPROGRAM P\nVAR d : FB_D; END_VAR\nd();\nEND_PROGRAM\n", "P"))
  asVar.scan()
  asVar.scan()
  expect(["d.sv", "d.bs"].map((v) => asVar.get(v))).toEqual([20n, 4n])
  const asTemp = run(ir(base + "FUNCTION_BLOCK FB_D EXTENDS FB_B\nVAR_TEMP sv : INT := 100; END_VAR\nVAR ds : INT; END_VAR\nsv := sv + 10;\nds := sv;\nSUPER^();\nEND_FUNCTION_BLOCK\nPROGRAM P\nVAR d : FB_D; END_VAR\nd();\nEND_PROGRAM\n", "P"))
  asTemp.scan()
  asTemp.scan()
  expect(["d.ds", "d.bs"].map((v) => asTemp.get(v))).toEqual([110n, 4n])
})

// GATE 7.6b: the address of a VAR_TEMP kept in a field (a POINTER or a REFERENCE) and read in the same run reads the temp
// (recorded `var_temp_address_kept_in_pointer_field`, `var_temp_reference_kept_in_field`: seen = 3) — the rule a pointer
// into the body's VAR_IN_OUT already has (`pointers/state.ts` `recordTarget`, `scopedTo`). Read in another run, or before
// this run's store, it names storage that is gone: refused `pointer-outlives`.
test("a field holding a VAR_TEMP's address reads it in the run that stored it, and is refused anywhere else", () => {
  const fb = (decl: string, store: string, read: string, rest = "") =>
    lowerSource(
      `FUNCTION_BLOCK FB_T\nVAR ${decl} seen : INT; END_VAR\nVAR_TEMP t : INT; END_VAR\n${rest}t := 3;\n${store}\nseen := ${read};\nEND_FUNCTION_BLOCK\n` +
        "PROGRAM P\nVAR inst : FB_T; out : INT; END_VAR\ninst();\nout := inst.seen;\nEND_PROGRAM\n",
      "P",
    )
  for (const [decl, store, read] of [
    ["p : POINTER TO INT;", "p := ADR(t);", "p^"],
    ["rf : REFERENCE TO INT;", "rf REF= t;", "rf"],
  ] as const) {
    const { pou, diagnostics } = fb(decl, store, read)
    expect(diagnostics).toEqual([])
    const runner = run(pou!)
    runner.scan()
    expect(runner.get("out")).toBe(3n)
  }
  // read before this run's store: the last run's temp
  const early = fb("p : POINTER TO INT;", "p := ADR(t);", "p^", "IF p <> 0 THEN seen := p^; END_IF\n").diagnostics.map((d) => d.code)
  expect(new Set(early)).toEqual(new Set(["pointer-outlives"]))
})
