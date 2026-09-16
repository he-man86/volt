import { describe, expect, test } from "bun:test"
import { lowerSource } from "./lower.js"
import type { IrAssign, IrIf, IrLoop } from "../ir/index.js"
import { run } from "../interp/index.js"

// {attribute 'instance-path'} (user decision 2026-09-15): the path from the project tree — the device folder, the application
// folder, then the instance hierarchy — set once at start. Without a project tree there is nothing to take it from.
test("an instance-path STRING holds Device.Application and the instance's path; refused outside a project tree", () => {
  const source =
    "PROGRAM PLC_PRG\nVAR outer : FB_Outer; direct : FB_Path; END_VAR\nouter();\nEND_PROGRAM\nFUNCTION_BLOCK FB_Outer\nVAR inner : FB_Path; END_VAR\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK FB_Path\nVAR\n\t{attribute 'instance-path'}\n\t{attribute 'noinit'}\n\tsPath : STRING(255);\nEND_VAR\nEND_FUNCTION_BLOCK\n"
  const { pou, diagnostics } = lowerSource(source, "PLC_PRG", [], "C:/work/Line1/Device/Plc Logic/Application/PLC_PRG.prg")
  expect(diagnostics).toEqual([])
  const runner = run(pou!)
  expect([runner.get("direct.sPath"), runner.get("outer.inner.sPath")]).toEqual(["Device.Application.PLC_PRG.direct", "Device.Application.PLC_PRG.outer.inner"])
  expect(lowerSource(source, "PLC_PRG").diagnostics.map((d) => d.code)).toEqual(["attr-instance-path"])
})

// Aggregate initializers (conformance `array_initializers`, `init_struct_by_field`, `init_array_of_structs`,
// `init_fb_instance_inputs`): refused outright before, so nothing modelled a field left out keeping its TYPE's value.
test("an aggregate initializer sets what it names; everything it leaves out keeps its type's initial value", () => {
  const source =
    "TYPE Pt :\nSTRUCT\n\tx : INT := 5;\n\ty : REAL;\n\ttag : STRING(8) := 'p';\nEND_STRUCT\nEND_TYPE\n" +
    "FUNCTION_BLOCK FB_S\nVAR_INPUT factor : INT := 2; offset : INT; END_VAR\nVAR_OUTPUT result : INT; END_VAR\nresult := factor * 10 + offset;\nEND_FUNCTION_BLOCK\n" +
    "PROGRAM P\nVAR\n\tpart : Pt := (y := 7);\n\tkw : Pt := STRUCT(x := 20, y := 1.5);\n\tpts : ARRAY[0..2] OF Pt := [(x := 1), (tag := 'bcdefghij')];\n" +
    "\tgrid : ARRAY[1..2, 1..3] OF INT := [1, 2(7), 4];\n\tfb : FB_S := (offset := 7);\nEND_VAR\nfb();\nEND_PROGRAM\n"
  const runner = run(ir(source, "P"))
  runner.scan()
  expect([runner.get("part.x"), runner.get("part.y"), runner.get("part.tag"), runner.get("kw.x"), runner.get("kw.tag")]).toEqual([5n, 7, "p", 20n, "p"])
  expect([runner.get("pts[0].x"), runner.get("pts[1].x"), runner.get("pts[1].tag"), runner.get("pts[2].x")]).toEqual([1n, 5n, "bcdefghi", 5n])
  expect([runner.get("grid[1, 3]"), runner.get("grid[2, 1]"), runner.get("grid[2, 2]"), runner.get("fb.result")]).toEqual([7n, 4n, 0n, 27n])
  // a field the type does not have is refused, not dropped
  expect(lowerSource(source.replace("(y := 7)", "(z := 7)"), "P").diagnostics.map((d) => d.code)).toEqual(["aggregate-init"])
})

// `p := ADR(io.y)` in an FB with `io` a VAR_IN_OUT (conformance `mem_adr_of_inout_member`) was refused outright: the pointer
// is a field and outlives the call. It is exact where the body stored it on this run; anywhere else is refused.
test("a pointer into a VAR_IN_OUT dereferences in the run that stored it; before the store, or conditionally, it is refused", () => {
  const fb = (body: string) =>
    `PROGRAM P\nVAR rec : T_IO; inst : FB_IO; END_VAR\ninst(io := rec);\nEND_PROGRAM\nTYPE T_IO : STRUCT x : INT; y : INT; END_STRUCT END_TYPE\nFUNCTION_BLOCK FB_IO\nVAR_IN_OUT io : T_IO; END_VAR\nVAR p : POINTER TO INT; flag : BOOL; END_VAR\n${body}\nEND_FUNCTION_BLOCK\n`
  const runner = run(ir(fb("p := ADR(io.y);\np^ := 99;"), "P"))
  runner.scan()
  expect([runner.get("rec.x"), runner.get("rec.y")]).toEqual([0n, 99n])
  expect(lowerSource(fb("IF flag THEN p := ADR(io.y); END_IF\np^ := 99;"), "P").diagnostics.map((d) => d.code)).toEqual(["pointer-outlives"])
})

// UNION (conformance `type_dut_union`, little-endian overlay): it had no layout at all (`layout-struct`).
test("a UNION member's store shows through every member it overlays; a write the copy cannot follow is refused", () => {
  const union = (body: string, member = "wide : DWORD;") =>
    `PROGRAM P\nVAR u : U_W; n : INT; out : WORD; inst : FB_O; END_VAR\n${body}\nEND_PROGRAM\nTYPE U_W :\nUNION\n\tword : WORD;\n\tbytes : ARRAY[1..2] OF BYTE;\n\t${member}\nEND_UNION\nEND_TYPE\nFUNCTION_BLOCK FB_O\nVAR_OUTPUT q : WORD; END_VAR\nq := 16#1234;\nEND_FUNCTION_BLOCK\n`
  const runner = run(ir(union("u.wide := 16#11223344;\nu.word := 16#ABCD;\nout := u.word;\nu.bytes[2] := 16#EE;"), "P"))
  runner.scan()
  // the DWORD's upper bytes survive the WORD store; the BYTE store shows through both wider members
  expect([runner.get("u.bytes[1]"), runner.get("u.bytes[2]"), runner.get("u.word"), runner.get("u.wide"), runner.get("out")]).toEqual([0xcdn, 0xeen, 0xeecdn, 0x1122eecdn, 0xabcdn])
  const codes = (body: string, member?: string) => lowerSource(union(body, member), "P").diagnostics.map((d) => d.code)
  expect(codes("inst(q => u.word);")).toEqual(["union-write"])
  expect(codes("FOR n := 1 TO 2 DO u.word := 1; END_FOR", "wide : REAL;")).toContain("layout-union")
})

// Interfaces (conformance `itf_*`): an interface variable had no representation (`slot-interface`), so nothing called
// through one lowered. It holds the tag of its instance, and each call dispatches once every store has lowered.
const INTERFACES =
  "INTERFACE I_Base\nMETHOD Area : INT\nEND_METHOD\nEND_INTERFACE\n" +
  "INTERFACE I_Shape EXTENDS I_Base\nPROPERTY Size : INT\nGET\nEND_GET\nSET\nEND_SET\nEND_PROPERTY\nEND_INTERFACE\n" +
  "FUNCTION_BLOCK FB_Sq IMPLEMENTS I_Shape\nVAR side : INT := 3; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Area : INT\nArea := side * side;\nEND_METHOD\nPROPERTY Size : INT\nGET\nSize := side;\nEND_GET\nSET\nside := Size;\nEND_SET\nEND_PROPERTY\n" +
  "FUNCTION_BLOCK FB_Rc IMPLEMENTS I_Base\nEND_FUNCTION_BLOCK\nMETHOD Area : INT\nArea := 7;\nEND_METHOD\n"
test("a call through an interface runs the instance it holds — a store later in the source reaches it next cycle", () => {
  const program = (vars: string, body: string) => `PROGRAM P\nVAR sq : FB_Sq; rc : FB_Rc; shapeRef : I_Shape; baseRef : I_Base; ${vars} END_VAR\n${body}\nEND_PROGRAM\n${INTERFACES}`
  const runner = run(
    ir(program(
      "found : BOOL; lost : BOOL; a1 : INT; later : INT; seen : INT; nulls : INT;",
      "IF baseRef = 0 THEN\n  nulls := nulls + 1;\nELSE\n  later := baseRef.Area();\nEND_IF\nshapeRef := sq;\na1 := shapeRef.Area();\nshapeRef.Size := 5;\nseen := shapeRef.Size;\nbaseRef := shapeRef;\nfound := __QUERYINTERFACE(baseRef, shapeRef);\nbaseRef := rc;\nlost := __QUERYINTERFACE(baseRef, shapeRef);",
    ), "P"),
  )
  runner.scan()
  runner.scan()
  // cycle 2 reaches rc through `baseRef := rc`, stored after the call; the failed query left `shapeRef` null
  expect(["nulls", "later", "a1", "seen", "sq.side", "found", "lost"].map((v) => runner.get(v))).toEqual([1n, 7n, 25n, 5n, 5n, true, false])
  const faulting = run(ir(program("n : INT;", "n := shapeRef.Area();"), "P"))
  expect(() => faulting.scan()).toThrow("holds no instance")
  // an instance passed to a FUNCTION's interface input: refused (`interface-input`) until recorded (`itf_function_input`);
  // now the routine is lent the instance for the call (design §24)
  const input = `${program("n : INT;", "n := F_Area(sq);")}FUNCTION F_Area : INT\nVAR_INPUT shape : I_Base; END_VAR\nF_Area := shape.Area() + 1;\nEND_FUNCTION\n`
  const lent = run(ir(input, "P"))
  lent.scan()
  expect(lent.get("n")).toEqual(10n)
})

// Review 2026-09-15 (declarations). A root PROGRAM's VAR_IN_OUT lowered as a field the POU owned. An `AT` variable lowered
// as plain storage — which the simulator agrees with (conformance `operand_hw_address_marker`) — even where its address
// aliases another variable's, or one FB field's address is shared by several instances. Why missed: no running fixture
// declares any of these; the declaration fixtures only prove they compile, and the one AT case holds two apart.
test("an AT variable is plain storage unless its address aliases another; a root PROGRAM owns its VAR_IN_OUT", () => {
  const codes = (source: string) => lowerSource(source, "P").diagnostics.map((d) => d.code)
  const runner = run(ir("PROGRAM P\nVAR flag AT %MX0.0 : BOOL; reg AT %MW10 : WORD; END_VAR\nreg := reg + 1;\nflag := reg = 1;\nEND_PROGRAM\n", "P"))
  runner.scan()
  expect([runner.get("reg"), runner.get("flag")]).toEqual([1n, true])
  // %MW1 is bytes 1–2 under byte addressing and 2–3 under word addressing, so %MB3 overlaps it under the one of them
  expect(codes("PROGRAM P\nVAR w AT %MW1 : WORD; b AT %MB3 : BYTE; END_VAR\nw := 1;\nEND_PROGRAM\n")).toEqual(["var-at"])
  expect(codes("PROGRAM P\nVAR x AT %I* : BOOL; y : BOOL; END_VAR\ny := TRUE;\nEND_PROGRAM\n")).toEqual(["var-at"])
  const fb = "FUNCTION_BLOCK FB_At\nVAR q AT %QW4 : WORD; END_VAR\nq := q + 1;\nEND_FUNCTION_BLOCK\n"
  expect(codes(`PROGRAM P\nVAR one : FB_At; END_VAR\none();\nEND_PROGRAM\n${fb}`)).toEqual([])
  expect(codes(`PROGRAM P\nVAR one : FB_At; two : FB_At; END_VAR\none();\ntwo();\nEND_PROGRAM\n${fb}`)).toEqual(["var-at-instances"])
  // a root PROGRAM's VAR_IN_OUT: no caller, so the harness owns it — an ordinary variable a test writes and reads
  const root = run(ir("PROGRAM P\nVAR_IN_OUT shared : INT; END_VAR\nshared := shared + 1;\nEND_PROGRAM\n", "P"))
  root.scan()
  root.scan()
  expect(root.get("shared")).toEqual(2n)
  // an ARRAY[*] stays refused: its size is the caller's array's, and there is none
  expect(codes("PROGRAM P\nVAR_IN_OUT many : ARRAY[*] OF INT; END_VAR\nmany[0] := 1;\nEND_PROGRAM\n")).toEqual(["root-inout"])
})

// Review 2026-09-15 (declarations), recorded first (conformance `life_*`). An FB body's VAR_STAT was a field of each
// instance where CODESYS shares one; a PROGRAM's VAR_TEMP kept its value across scans, and an FB's was refused, where both
// start over at their initial value on every run. Why missed: no running fixture declared VAR_STAT in an FB body, and
// VAR_TEMP was only ever recorded in a METHOD.
test("an FB's VAR_STAT is shared by every instance; a VAR_TEMP starts over on every run of its body", () => {
  const source =
    "PROGRAM P\nVAR first : FB_Derived; second : FB_Derived; runs : INT; END_VAR\nVAR_TEMP scratch : INT := 2; END_VAR\n" +
    "scratch := scratch + 1;\nruns := scratch;\nfirst();\nsecond();\nfirst.Peek();\nEND_PROGRAM\n" +
    "FUNCTION_BLOCK FB_Base\nVAR_STAT counter : INT; END_VAR\nVAR_TEMP baseTemp : INT := 10; END_VAR\nVAR seenBase : INT; END_VAR\nbaseTemp := baseTemp + 1;\nseenBase := baseTemp;\nEND_FUNCTION_BLOCK\n" +
    "FUNCTION_BLOCK FB_Derived EXTENDS FB_Base\nVAR_TEMP own : INT; END_VAR\nVAR seen : INT; peeked : INT; END_VAR\nown := own + 1;\ncounter := counter + own;\nseen := counter;\nSUPER^();\nEND_FUNCTION_BLOCK\n" +
    "METHOD Peek\npeeked := counter;\nEND_METHOD\n"
  const runner = run(ir(source, "P"))
  runner.scan()
  runner.scan()
  // two instances, two scans: the one counter reaches 4, read through either instance, the base body and a method alike
  // (`first.Peek()` runs after `second()`, so it sees the 4)
  expect(["first.counter", "second.counter", "first.seen", "second.seen", "first.peeked"].map((v) => runner.get(v))).toEqual([4n, 4n, 3n, 4n, 4n])
  // every temp at its initial value plus the one increment of its run — the root's, the derived body's, the base's
  expect(["runs", "first.seenBase", "second.seenBase"].map((v) => runner.get(v))).toEqual([3n, 11n, 11n])
  expect(lowerSource("PROGRAM P\nVAR_TEMP pair : ARRAY[0..1] OF INT; END_VAR\npair[0] := 1;\nEND_PROGRAM\n", "P").diagnostics.map((d) => d.code)).toEqual(["var-temp-composite"])
})

// VAR_IN_OUT CONSTANT (conformance `inout_const_*`): bound like a plain VAR_IN_OUT, so a STRING literal and a METHOD's
// own field were refused, and a write inside the callee lowered. Why missed: no fixture held the section.
test("a VAR_IN_OUT CONSTANT is lent read-only: a literal or the instance's own field as a copy, a write refused", () => {
  const source = (body: string, method = "Twice := value * 2;") =>
    `PROGRAM P\nVAR x : INT := 3; fromFn : INT; matches : BOOL; inst : FB_C; END_VAR\n${body}\nEND_PROGRAM\n` +
    "FUNCTION F_Match : BOOL\nVAR_IN_OUT CONSTANT text : STRING; END_VAR\nF_Match := text = 'abc';\nEND_FUNCTION\n" +
    "FUNCTION F_Twice : INT\nVAR_IN_OUT CONSTANT value : INT; END_VAR\nF_Twice := value * 2;\nEND_FUNCTION\n" +
    `FUNCTION_BLOCK FB_C\nVAR own : INT := 4; got : INT; END_VAR\ngot := Twice(value := own);\nEND_FUNCTION_BLOCK\nMETHOD Twice : INT\nVAR_IN_OUT CONSTANT value : INT; END_VAR\n${method}\nEND_METHOD\n`
  const runner = run(ir(source("matches := F_Match(text := 'abc');\nfromFn := F_Twice(value := x);\ninst();"), "P"))
  runner.scan()
  expect(["matches", "fromFn", "inst.got"].map((v) => runner.get(v))).toEqual([true, 6n, 8n])
  const codes = (body: string, method?: string) => lowerSource(source(body, method), "P").diagnostics.map((d) => d.code)
  // the method writes its instance while it reads the copy — which a reference would see, so it stays refused
  expect(codes("inst();", "own := 0;\nTwice := value * 2;")).toEqual(["call-inout-alias"])
  // (the METHOD holding the write lowers only when something calls it — `inst()` does)
  expect(codes("inst();", "value := 1;\nTwice := value;")).toContain("inout-constant-write")
})

// Review of the VAR_IN_OUT CONSTANT batch (2026-09-15), each finding reproduced with lowerSource or rustc: only the `:=`
// write was pinned; a parenthesised variable took the copy path past the alias check; an FB instance lent read-only was
// called through `&` (E0596); its address was refused in compiler wording no recording backs.
test("VAR_IN_OUT CONSTANT: every write form refused, `(x)` checked as x, a lent instance called and its address read", () => {
  const source = (body: string, write = "") =>
    `PROGRAM P\nVAR x : INT := 3; y : INT; inst : FB_K; END_VAR\n${body}\nEND_PROGRAM\n` +
    `FUNCTION F_W : INT\nVAR_IN_OUT CONSTANT value : INT; END_VAR\nVAR t : INT; p : POINTER TO INT; END_VAR\n${write}\nF_W := value;\nEND_FUNCTION\n` +
    "FUNCTION_BLOCK FB_K\nVAR_OUTPUT q : INT; END_VAR\nq := q + 1;\nEND_FUNCTION_BLOCK\nMETHOD Get : INT\nGet := q;\nEND_METHOD\n" +
    "FUNCTION F_Lent : INT\nVAR_IN_OUT CONSTANT lent : FB_K; END_VAR\nF_Lent := lent.Get();\nEND_FUNCTION\n"
  const codes = (body: string, write?: string) => lowerSource(source(body, write), "P").diagnostics.map((d) => d.code)
  for (const write of ["value := 1;", "t := value := 1;", "FOR value := 0 TO 2 DO\n  t := 1;\nEND_FOR"])
    expect(codes("y := F_W(value := x);", write)).toEqual(["inout-constant-write"])
  // The review had these refused as unmodelled; recorded since, CODESYS takes the address and calls the lent instance
  // (`inout_const_adr_11`, `inout_const_fb_method_12`) — so both lower, the instance lent `&mut`.
  const runner = run(ir(source("y := F_W(value := x) + F_Lent(lent := inst);", "p := ADR(value);\nt := p^;"), "P"))
  runner.scan()
  expect(runner.get("y")).toEqual(3n)
  // a store through that address is still a store into the in-out
  expect(codes("y := F_W(value := x);", "p := ADR(value);\np^ := 1;")).toEqual(["inout-constant-write"])
  const paren =
    "PROGRAM P\nVAR inst : FB_P; END_VAR\ninst();\nEND_PROGRAM\nFUNCTION_BLOCK FB_P\nVAR own : INT := 4; got : INT; END_VAR\ngot := Twice(value := (own));\nEND_FUNCTION_BLOCK\n" +
    "METHOD Twice : INT\nVAR_IN_OUT CONSTANT value : INT; END_VAR\nown := 0;\nTwice := value * 2;\nEND_METHOD\n"
  expect(lowerSource(paren, "P").diagnostics.map((d) => d.code)).toEqual(["call-inout-alias"])
})

// Interface inputs (conformance `itf_fb_input_*`, `itf_method_input_passed_on`, `itf_interface_variable_as_input`): refused as
// `interface-input`. An FB keeps the instance given — a tag in its field — and each body that calls through one is lent a
// `&mut` of the instances its callers hold (design §24). Why missed: no fixture passed an instance to an interface input.
test("an interface input is a kept tag, and each body is lent by its callers the instances it calls through", () => {
  const source =
    "PROGRAM P\nVAR sq : FB_Sq; meter : FB_Meter; outer : FB_Outer; beforeAny : INT; given : INT; leftOut : INT; END_VAR\n" +
    "meter(measured => beforeAny);\nmeter(shape := sq, measured => given);\nmeter(measured => leftOut);\nouter.Measure(shape := sq);\nEND_PROGRAM\n" +
    INTERFACES +
    "FUNCTION_BLOCK FB_Meter\nVAR_INPUT shape : I_Base; END_VAR\nVAR_OUTPUT measured : INT; END_VAR\nIF shape = 0 THEN\n  measured := -1;\nELSE\n  measured := shape.Area();\nEND_IF\nEND_FUNCTION_BLOCK\n" +
    "FUNCTION F_Ten : INT\nVAR_INPUT shape : I_Base; END_VAR\nF_Ten := shape.Area() * 10;\nEND_FUNCTION\n" +
    "FUNCTION_BLOCK FB_Outer\nVAR inner : FB_Meter; END_VAR\nVAR_OUTPUT viaFunction : INT; viaInner : INT; END_VAR\nEND_FUNCTION_BLOCK\n" +
    "METHOD Measure\nVAR_INPUT shape : I_Base; END_VAR\nviaFunction := F_Ten(shape := shape);\ninner(shape := shape);\nviaInner := inner.measured;\nEND_METHOD\n"
  const runner = run(ir(source, "P"))
  runner.scan()
  // null before any is given; then the instance given, KEPT when a later call leaves the input out; passed on by a METHOD
  expect(["beforeAny", "given", "leftOut", "outer.viaFunction", "outer.viaInner"].map((v) => runner.get(v))).toEqual([-1n, 9n, 9n, 90n, 9n])
})

// Review of the interface-input batch (2026-09-15), each reproduced in both backends: a tag naming a field of ONE FB
// instance reached another instance of the same type — through a read of that instance's interface field, and through a
// METHOD of an in-out — and answered for the wrong instance (25 for 9). Each crossing is refused now; the parent that owns
// a child and hands it its own field (the corpus's shape) still lowers, each instance its own child.
test("an interface naming an instance's own field stays with that instance: crossing is refused, not answered wrong", () => {
  const shapes = "INTERFACE I_S\nMETHOD Area : INT\nEND_METHOD\nEND_INTERFACE\nFUNCTION_BLOCK FB_S IMPLEMENTS I_S\nVAR_INPUT side : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Area : INT\nArea := side * side;\nEND_METHOD\n"
  const codes = (source: string) => lowerSource(source, "P").diagnostics.map((d) => d.code)
  const holder = "FUNCTION_BLOCK FB_X\nVAR_INPUT k : INT; shape : I_S; END_VAR\nVAR_OUTPUT mine : I_S; area : INT; END_VAR\nVAR a : FB_S; END_VAR\na(side := k);\nmine := a;\nIF shape <> 0 THEN\n  area := shape.Area();\nEND_IF\nEND_FUNCTION_BLOCK\n"
  expect(codes(`PROGRAM P\nVAR x1 : FB_X; x2 : FB_X; END_VAR\nx1(k := 3);\nx2(k := 5, shape := x1.mine);\nEND_PROGRAM\n${shapes}${holder}`)).toContain("interface-place")
  const parent =
    "FUNCTION_BLOCK FB_M\nVAR_INPUT shape : I_S; END_VAR\nVAR_OUTPUT got : INT; END_VAR\nIF shape <> 0 THEN\n  got := shape.Area();\nEND_IF\nEND_FUNCTION_BLOCK\n" +
    "FUNCTION_BLOCK FB_O\nVAR_INPUT k : INT; END_VAR\nVAR s : FB_S; m : FB_M; END_VAR\ns(side := k);\nm(shape := s);\nEND_FUNCTION_BLOCK\n"
  const runner = run(ir(`PROGRAM P\nVAR o1 : FB_O; o2 : FB_O; END_VAR\no1(k := 3);\no2(k := 5);\nEND_PROGRAM\n${shapes}${parent}`, "P"))
  runner.scan()
  expect([runner.get("o1.m.got"), runner.get("o2.m.got")]).toEqual([9n, 25n])
  const meter =
    "FUNCTION_BLOCK FB_Meter\nVAR_INPUT shape : I_S; END_VAR\nVAR_OUTPUT measured : INT; END_VAR\nIF shape <> 0 THEN\n  measured := shape.Area();\nEND_IF\nEND_FUNCTION_BLOCK\nMETHOD SetShape\nVAR_INPUT s : I_S; END_VAR\nshape := s;\nEND_METHOD\n" +
    "FUNCTION_BLOCK FB_H\nVAR_INPUT k : INT; END_VAR\nVAR sq : FB_S; END_VAR\nsq(side := k);\nEND_FUNCTION_BLOCK\nMETHOD Give\nVAR_IN_OUT m : FB_Meter; END_VAR\nm.SetShape(s := sq);\nEND_METHOD\nMETHOD Use : INT\nVAR_IN_OUT m : FB_Meter; END_VAR\nm();\nUse := m.measured;\nEND_METHOD\n"
  expect(codes(`PROGRAM P\nVAR meter : FB_Meter; a : FB_H; b : FB_H; n : INT; END_VAR\na(k := 3);\nb(k := 5);\na.Give(m := meter);\nn := b.Use(m := meter);\nEND_PROGRAM\n${shapes}${meter}`)).toContain("interface-instance-relative")
  // an FB type given an interface input from two frames (a limitation), and an instance lent to a call on itself
  expect(codes(`PROGRAM P\nVAR sq : FB_S; m : FB_M; o : FB_O; END_VAR\nsq(side := 2);\nm(shape := sq);\no(k := 4);\nEND_PROGRAM\n${shapes}${parent}`)).toContain("interface-context")
  const poke = "METHOD Poke\nVAR_INPUT shape : I_S; END_VAR\nVAR t : INT; END_VAR\nt := shape.Area();\nEND_METHOD\n"
  // (appended after FB_S's own METHOD, a METHOD of FB_S — `METHOD Area` also opens the interface's prototype)
  expect(codes(`PROGRAM P\nVAR sq : FB_S; END_VAR\nsq.Poke(shape := sq);\nEND_PROGRAM\n${shapes}${poke}`)).toContain("interface-lend-alias")
})

// Corpus research (2026-09-15), each confirmed in a real project: an array bound that is the POU's or an FB's own VAR
// CONSTANT (pro2193 `ARRAY[1..numberOfXYControls]`) was "not a sized array" — bounds folded in the project scope only; a
// GVL variable named like its own list (lenze-mid `Mach1_Alarms.Alm001`) resolved to the list; a FOR step decided at run
// time was refused. Why missed: every fixture bound was a literal or a GVL constant, every list named apart from its
// variables, and every FOR step a literal.
test("bounds from a POU's own constant, a GVL variable named like its list, a FOR step decided at run time", () => {
  const source =
    "PROGRAM P\nVAR CONSTANT count : INT := 3; END_VAR\nVAR arr : ARRAY[1..count] OF INT; inst : FB_C; up : INT; down : INT; i : INT; step : INT := 2; backwards : BOOL := TRUE; END_VAR\n" +
    "arr[count] := 7;\ninst();\nFOR i := 1 TO 5 BY step DO\n  up := up + 1;\nEND_FOR\nFOR i := 5 TO 1 BY SEL(backwards, 2, -2) DO\n  down := down + i;\nEND_FOR\nEND_PROGRAM\n" +
    "FUNCTION_BLOCK FB_C\nVAR CONSTANT size : INT := 2; END_VAR\nVAR cells : ARRAY[0..size] OF INT; END_VAR\ncells[size] := 5;\nEND_FUNCTION_BLOCK\n"
  const runner = run(ir(source, "P"))
  runner.scan()
  // 1, 3, 5 counted up; 5 + 3 + 1 summed counting down
  expect(["arr[3]", "inst.cells[2]", "up", "down"].map((v) => runner.get(v))).toEqual([7n, 5n, 3n, 9n])
  const alarms = "PROGRAM P\nVAR seen : BOOL; END_VAR\nseen := Alarms.Alm001;\nEND_PROGRAM\nTYPE T_Alarms : STRUCT Alm001 : BOOL := TRUE; END_STRUCT END_TYPE\n"
  const listed = lowerSource(alarms, "P", [{ uri: "file:///project/Alarms.gvl", source: "VAR_GLOBAL\n  Alarms : T_Alarms;\nEND_VAR\n" }])
  expect(listed.diagnostics).toEqual([])
  const alarmRun = run(listed.pou!)
  alarmRun.scan()
  expect(alarmRun.get("seen")).toEqual(true)
})

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
    "INTERFACE I_P\nMETHOD Put : BOOL\nVAR_INPUT s : STRING(N); END_VAR\nEND_METHOD\nEND_INTERFACE\n" +
    "FUNCTION_BLOCK FB_P IMPLEMENTS I_P\nVAR kept : STRING(20); END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Put : BOOL\nVAR_INPUT s : STRING(N); END_VAR\nkept := s;\nPut := TRUE;\nEND_METHOD\n"
  const put = lowerSource(`PROGRAM P\nVAR CONSTANT N : INT := 3; END_VAR\nVAR fb : FB_P; r : I_P; ok : BOOL; END_VAR\nr := fb;\nok := r.Put(s := 'abcdefgh');\nEND_PROGRAM\n${keeper}`, "P", consts)
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

// Recorded first (conformance `callshape_array_star_*`, `callshape_bounds_of_sized_array`): an ARRAY[*] VAR_IN_OUT takes the
// bounds of the array it binds — passed on unchanged, per call on an FB, per dimension — and LOWER_BOUND/UPPER_BOUND are
// DINT (70002 * 40000 wraps). It was refused (`slot-array`, and LOWER_BOUND as `expr-call`). Why missed: no fixture
// declared an ARRAY[*], though pro2193 indexes them 636 times.
test("an ARRAY[*] in-out takes the bounds of the array it binds — in a FUNCTION, passed on, on an FB, in two dimensions", () => {
  const source =
    "PROGRAM P\nVAR numbers : ARRAY[-2..4] OF INT; bounds : DINT; grid : ARRAY[1..2, 0..2] OF INT; second : DINT; filler : FB_Fill; shortRow : ARRAY[1..2] OF INT; longRow : ARRAY[5..8] OF INT; " +
    "shortCount : DINT; longCount : DINT; values : ARRAY[70000..70002] OF BYTE; wide : LINT; sized : DINT; stacks : ARRAY[1..3] OF ARRAY[1..4] OF INT; END_VAR\n" +
    "bounds := F_Outer(numbers := numbers);\nsecond := F_Grid(grid := grid);\nfiller(numbers := shortRow);\nshortCount := filler.elementCount;\nfiller(numbers := longRow);\nlongCount := filler.elementCount;\n" +
    "wide := F_Wide(values := values);\nsized := LOWER_BOUND(grid, 2) * 100 + UPPER_BOUND(numbers, 1);\nstacks[2][3] := 7;\nF_Shift(rows := stacks);\nEND_PROGRAM\n" +
    "FUNCTION F_Inner : DINT\nVAR_IN_OUT numbers : ARRAY[*] OF INT; END_VAR\nnumbers[UPPER_BOUND(numbers, 1)] := 99;\nF_Inner := LOWER_BOUND(numbers, 1) * 100 + UPPER_BOUND(numbers, 1);\nEND_FUNCTION\n" +
    "FUNCTION F_Outer : DINT\nVAR_IN_OUT numbers : ARRAY[*] OF INT; END_VAR\nF_Outer := F_Inner(numbers := numbers) + 10000;\nEND_FUNCTION\n" +
    "FUNCTION F_Grid : DINT\nVAR_IN_OUT grid : ARRAY[*, *] OF INT; END_VAR\nVAR row : DINT; column : DINT; END_VAR\nFOR row := LOWER_BOUND(grid, 1) TO UPPER_BOUND(grid, 1) DO\n  FOR column := LOWER_BOUND(grid, 2) TO UPPER_BOUND(grid, 2) DO\n    grid[row, column] := DINT_TO_INT(row * 10 + column);\n  END_FOR\nEND_FOR\nF_Grid := LOWER_BOUND(grid, 2) * 10 + UPPER_BOUND(grid, 2);\nEND_FUNCTION\n" +
    "FUNCTION_BLOCK FB_Fill\nVAR_IN_OUT numbers : ARRAY[*] OF INT; END_VAR\nVAR_OUTPUT elementCount : DINT; END_VAR\nVAR index : DINT; END_VAR\nelementCount := UPPER_BOUND(numbers, 1) - LOWER_BOUND(numbers, 1) + 1;\nFOR index := LOWER_BOUND(numbers, 1) TO UPPER_BOUND(numbers, 1) DO\n  numbers[index] := DINT_TO_INT(index + elementCount * 100);\nEND_FOR\nEND_FUNCTION_BLOCK\n" +
    "FUNCTION F_Wide : LINT\nVAR_IN_OUT values : ARRAY[*] OF BYTE; END_VAR\nF_Wide := UPPER_BOUND(values, 1) * 40000;\nEND_FUNCTION\n" +
    // pro2193's shape (`ShiftStackStatusFB`): an open array of sized rows, shifted down a row
    "FUNCTION F_Shift : BOOL\nVAR_IN_OUT rows : ARRAY[*] OF ARRAY[1..4] OF INT; END_VAR\nVAR di : DINT; END_VAR\nFOR di := UPPER_BOUND(rows, 1) TO 2 BY -1 DO\n  rows[di] := rows[di - 1];\nEND_FOR\nEND_FUNCTION\n"
  const runner = run(ir(source, "P"))
  runner.scan()
  expect(["bounds", "numbers[4]", "second", "grid[2][2]", "shortCount", "longCount", "shortRow[2]", "longRow[8]", "wide", "sized", "stacks[3][3]", "stacks[2][3]"].map((v) => runner.get(v))).toEqual([
    9804n, 99n, 2n, 22n, 2n, 4n, 202n, 408n, -1494887296n, 4n, 7n, 0n,
  ])
  // a dimension that does not fold names no bound lowering knows
  expect(lowerSource(source.replace("LOWER_BOUND(grid, 2) * 100", "LOWER_BOUND(grid, shortCount) * 100"), "P").diagnostics.map((d) => d.code)).toEqual(["array-bound"])
})

// pro2193 sizes arrays and starts variables through qualified constants — `ARRAY[1..GVL_Constants.ChainProductsForReject]`,
// `MaxVacuums : USINT := XiUnits.MaxVacuums`, `prevState : DINT := GVL_Constants.DintSmallest`. None folded (`constEval`
// stopped at a member), so those arrays were "not a sized array", those initializers `init-not-constant`, and the slot
// then missing (`place-not-local`). Name resolution the compiled project proves — no recording. Why missed: every
// fixture's constant was bare.
test("a constant named through its GVL or its PROGRAM sizes an array, starts a variable and bounds a loop", () => {
  const gvl = [{ uri: "file:///project/GVL_Constants.gvl", source: "{attribute 'qualified_only'}\nVAR_GLOBAL CONSTANT\n  Count : INT := 3;\n  Smallest : DINT := -2147483648;\nEND_VAR\n" }]
  const source =
    "PROGRAM P\nVAR worker : FB_W; END_VAR\nworker();\nEND_PROGRAM\n" +
    "PROGRAM Units\nVAR CONSTANT\n  MaxVacuums : USINT := GVL_Constants.Count + 1;\nEND_VAR\nEND_PROGRAM\n" +
    "FUNCTION_BLOCK FB_W\nVAR\n  flags : ARRAY[1..GVL_Constants.Count] OF BOOL;\n  prevState : DINT := GVL_Constants.Smallest;\n  i : INT;\n  visits : INT;\nEND_VAR\nVAR CONSTANT\n  MaxVacuums : USINT := Units.MaxVacuums;\nEND_VAR\n" +
    "FOR i := 1 TO MaxVacuums DO\n  visits := visits + 1;\nEND_FOR\nflags[GVL_Constants.Count] := TRUE;\nEND_FUNCTION_BLOCK\n"
  const { pou, diagnostics } = lowerSource(source, "P", gvl)
  expect(diagnostics).toEqual([])
  const runner = run(pou!)
  runner.scan()
  expect([runner.get("worker.visits"), runner.get("worker.flags[3]"), runner.get("worker.prevState")]).toEqual([4n, true, -2147483648n])
})

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
  // a variable named in a declaration inside an FB means that FB's field — not a place the POU's init step has
  const holder = "FUNCTION_BLOCK FB_Holder\nVAR localSeed : INT := 3; held : FB_In(startValue := localSeed); END_VAR\nEND_FUNCTION_BLOCK\n"
  expect(lowerSource(source("holder : FB_Holder;", holder), "P").diagnostics.map((d) => d.code)).toContain("fb-init-argument")
  // Review of that batch: only what the recordings cover takes a variable argument. A struct field's declaration was read
  // in the POU's scope (a local the struct cannot see), and a later or VAR_TEMP variable, or a global an FB_Init writes,
  // gave values no recording shows; a derived FB holding FB_Init instances got an order none shows either.
  const codes = (decls: string, extra = "") => lowerSource(source(decls, extra), "P", seedList).diagnostics.map((d) => d.code)
  expect(codes("h : ST_H;", "TYPE ST_H :\nSTRUCT\n  held : FB_In(startValue := seed);\nEND_STRUCT\nEND_TYPE\n")).toContain("fb-init-argument")
  expect(codes("fromLater : FB_In(startValue := later); later : INT := 3;")).toContain("fb-init-argument")
  expect(
    lowerSource(`PROGRAM P\nVAR_TEMP temp : INT := 4; END_VAR\nVAR a : FB_In(startValue := temp); END_VAR\ntemp := temp;\nEND_PROGRAM\n${inner}`, "P").diagnostics.map((d) => d.code),
  ).toContain("fb-init-argument")
  const globalWriter = "FUNCTION_BLOCK FB_Wg\nEND_FUNCTION_BLOCK\nMETHOD FB_Init : BOOL\nVAR_INPUT bInitRetains : BOOL; bInCopyCode : BOOL; startValue : INT; END_VAR\ngSeed := startValue;\nEND_METHOD\n"
  expect(codes("w : FB_Wg(startValue := 1); fromGlobal : FB_In(startValue := gSeed);", globalWriter)).toContain("fb-init-argument")
  const derived =
    "FUNCTION_BLOCK FB_B2\nEND_FUNCTION_BLOCK\nMETHOD FB_Init : BOOL\nVAR_INPUT bInitRetains : BOOL; bInCopyCode : BOOL; startValue : INT; END_VAR\nEND_METHOD\n" +
    "FUNCTION_BLOCK FB_D2 EXTENDS FB_B2\nVAR l : FB_In(startValue := 2); END_VAR\nEND_FUNCTION_BLOCK\n"
  expect(codes("d : FB_D2(startValue := 1);", derived)).toContain("fb-init-order")
})

// Recorded (`callshape_positional_arguments` `Mixed(counter, 3)`, `callshape_array_star_of_struct` `Shift(line := points)`):
// an FB lending its own field to its own METHOD — two `&mut` of one instance. An open array is copied in and written back,
// which reads the same while the callee reaches that field only through the in-out; anything else is SUBSTITUTED, the
// routine specialized on the path from the instance (`specialize.ts`), exact however the callee reaches it.
// Why missed: every in-out test lent the callee something the caller owned apart from the instance.
test("an FB's own field lent to its own METHOD: an open array copied back, everything else substituted", () => {
  const source = (body: string, method = "target := target + amount;\nMixed := target * 10;") =>
    `PROGRAM P\nVAR user : FB_U; END_VAR\nuser();\nEND_PROGRAM\nFUNCTION_BLOCK FB_U\nVAR counter : INT := 7; result : INT; values : ARRAY[0..2] OF INT; i : INT; END_VAR\n${body}\nEND_FUNCTION_BLOCK\n` +
    `METHOD Mixed : INT\nVAR_IN_OUT target : INT; END_VAR\nVAR_INPUT amount : INT; END_VAR\n${method}\nEND_METHOD\n` +
    "METHOD Fill\nVAR_IN_OUT line : ARRAY[*] OF INT; END_VAR\nVAR k : DINT; END_VAR\nFOR k := LOWER_BOUND(line, 1) TO UPPER_BOUND(line, 1) DO\n  line[k] := DINT_TO_INT(k) + 1;\nEND_FOR\nEND_METHOD\n"
  const runner = run(ir(source("result := Mixed(counter, 3);\nFill(values);"), "P"))
  runner.scan()
  expect(["user.counter", "user.result", "user.values[2]"].map((v) => runner.get(v))).toEqual([10n, 100n, 3n])
  const codes = (body: string, method?: string) => lowerSource(source(body, method), "P").diagnostics.map((d) => d.code)
  // The callee also reads the field by name: through the in-out it sees the new value at once, which a copy would not
  // (conformance `callshape_own_field_inout_read_by_name`: 10). Substituted, both reads are the one field.
  const byName = run(ir(source("result := Mixed(counter, 3);", "target := target + amount;\nMixed := counter;"), "P"))
  byName.scan()
  expect([byName.get("user.counter"), byName.get("user.result")]).toEqual([10n, 10n])
  // a runtime index: the path from the instance is not static, so there is nothing to substitute
  expect(codes("result := Mixed(values[i], 3);")).toContain("call-inout-alias")
  // Each of these wrote a wrong value when the first cut COPIED whenever the callee did not NAME the field. Substituted,
  // each is by reference and equals its recording.
  const held = (methods: string, vars = "") =>
    `PROGRAM P\nVAR user : FB_V; END_VAR\nuser();\nEND_PROGRAM\nFUNCTION_BLOCK FB_V\nVAR n : INT; inner : FB_In; ${vars} END_VAR\n${methods.split("|")[0]}\nEND_FUNCTION_BLOCK\n${methods.split("|")[1]}` +
    "FUNCTION_BLOCK FB_In\nVAR x : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Bump\nVAR_IN_OUT v : INT; END_VAR\nv := v + 1;\nx := x + 10;\nEND_METHOD\n"
  const extra = (methods: string, vars = "") => lowerSource(held(methods, vars), "P").diagnostics.map((d) => d.code)
  const ran = (methods: string, vars = "") => {
    const runner = run(ir(held(methods, vars), "P"))
    runner.scan()
    return runner
  }
  // the same field lent to two in-outs of one call — the last write-back won (conformance `callshape_own_field_two_inouts`: 6)
  expect(ran("Two(a := n, b := n);|METHOD Two\nVAR_IN_OUT a : INT; b : INT; END_VAR\na := 5;\nb := b + 1;\nEND_METHOD\n").get("user.n")).toEqual(6n)
  // a sub-instance reached through THIS^, its METHOD writing the field by name too (conformance `callshape_inout_sub_instance_field`: 11)
  expect(ran("THIS^.inner.Bump(v := inner.x);|").get("user.inner.x")).toEqual(11n)
  // a callee that CALLS anything stays refused — here a FUNCTION given THIS^, which could reach the field through it, and
  // which a substituted place would meet as a second `&mut` of the instance
  expect(extra("M(v := n);|METHOD M\nVAR_IN_OUT v : INT; END_VAR\nv := v + 1;\nn := F_Id(k := 1);\nEND_METHOD\nFUNCTION F_Id : INT\nVAR_INPUT k : INT; END_VAR\nF_Id := k;\nEND_FUNCTION\n")).toContain("call-inout-alias")
  // Review of the narrowed cut: SUPER^ built its held list from the bound places alone, so a field bound twice was copied
  // twice (n = 101 where by reference it is 6). Why missed: the two-in-out case above went through a METHOD call only.
  const derived = (superCall: string) =>
    `PROGRAM P\nVAR d : FB_D; x : INT; y : INT; END_VAR\nd(a := x, b := y);\nEND_PROGRAM\nFUNCTION_BLOCK FB_B\nVAR_IN_OUT a : INT; b : INT; END_VAR\na := 5;\nb := b + 1;\nEND_FUNCTION_BLOCK\n` +
    `FUNCTION_BLOCK FB_D EXTENDS FB_B\nVAR n : INT := 100; m : INT := 200; END_VAR\n${superCall}\nEND_FUNCTION_BLOCK\n`
  // conformance `callshape_super_own_field_twice`: by reference n is 6, not the 101 two copies gave
  const twice = run(ir(derived("SUPER^(a := n, b := n);"), "P"))
  twice.scan()
  expect(twice.get("d.n")).toEqual(6n)
  const viaSuper = run(ir(derived("SUPER^(a := n, b := m);"), "P"))
  viaSuper.scan()
  expect([viaSuper.get("d.n"), viaSuper.get("d.m"), viaSuper.get("x")]).toEqual([5n, 201n, 0n])
})

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
  // a FUNCTION's VAR_OUTPUT beside an in-out bound to its index variable: printed E0503 (`&mut self.cursor` held)
  const both =
    "PROGRAM Root\nVAR o : FB_O; END_VAR\no();\nEND_PROGRAM\nFUNCTION_BLOCK FB_O\nVAR numbers : ARRAY[0..3] OF INT; cursor : INT; got : INT; END_VAR\ngot := F_Both(res => numbers[cursor], io := cursor, stepValue := Advance());\nEND_FUNCTION_BLOCK\n" +
    "METHOD Advance : INT\ncursor := cursor + 1;\nAdvance := cursor;\nEND_METHOD\nFUNCTION F_Both : INT\nVAR_INPUT stepValue : INT; END_VAR\nVAR_IN_OUT io : INT; END_VAR\nVAR_OUTPUT res : INT; END_VAR\nres := 7;\nEND_FUNCTION\n"
  expect(codes(both)).toContain("call-inout-order")
})

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
  const pathLowered = lowerSource(pathed, "P", [], "C:/work/Line1/Device/Plc Logic/Application/P.prg")
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

// pro2193 queries an interface as an IF's condition (`IF __QUERYINTERFACE(transferProducts, prepareTransfer) THEN`, ~30
// uses); only `found := __QUERYINTERFACE(from, into)` lowered (`expr-call`). It is that recorded query into a hidden BOOL
// taken just before the test — an ELSIF's only when reached. Why missed: the recorded case used the assignment form only.
test("__QUERYINTERFACE as an IF's or ELSIF's whole condition, or under NOT, is the recorded query taken just before the test", () => {
  const program = (vars: string, body: string) => `PROGRAM P\nVAR sq : FB_Sq; rc : FB_Rc; shapeRef : I_Shape; baseRef : I_Base; ${vars} END_VAR\n${body}\nEND_PROGRAM\n${INTERFACES}`
  const runner = run(
    ir(
      program(
        "hits : INT; misses : INT; area : INT; elsifArea : INT;",
        "baseRef := sq;\nIF __QUERYINTERFACE(baseRef, shapeRef) THEN\n  area := shapeRef.Area();\n  hits := hits + 1;\nEND_IF\n" +
          "baseRef := rc;\nIF NOT __QUERYINTERFACE(baseRef, shapeRef) THEN\n  misses := misses + 1;\nEND_IF\n" +
          "IF hits = 0 THEN\n  misses := 100;\nELSIF (__QUERYINTERFACE(baseRef, shapeRef)) THEN\n  elsifArea := 1;\nELSE\n  elsifArea := 2;\nEND_IF",
      ),
      "P",
    ),
  )
  runner.scan()
  expect(["hits", "misses", "area", "elsifArea"].map((v) => runner.get(v))).toEqual([1n, 1n, 9n, 2n])
  // the LEADING operand of OR_ELSE / AND_THEN always runs first: pro2193's `IF NOT __QUERYINTERFACE(xuUnit, xuUnitExtended)
  // OR_ELSE NOT xuUnitExtended.InSafePosForMouldEntry THEN` — the right operand reads what the query stored
  const leading = run(
    ir(program("led : INT;", "baseRef := sq;\nIF NOT __QUERYINTERFACE(baseRef, shapeRef) OR_ELSE shapeRef.Area() <> 9 THEN\n  led := 1;\nELSE\n  led := 2;\nEND_IF"), "P"),
  )
  leading.scan()
  expect(leading.get("led")).toEqual(2n)
  // as a right operand a short-circuit may skip, the query is not taken before the test
  expect(lowerSource(program("done : BOOL;", "IF done OR_ELSE __QUERYINTERFACE(baseRef, shapeRef) THEN\n  done := TRUE;\nEND_IF"), "P").diagnostics.map((d) => d.code)).toEqual(["interface-query"])
})

// Review of the qualified-constant / program-instance batch (adversarial verify), each reproduced before its fix. Why
// missed: the tests called the recorded shapes only — no PROPERTY on the instance, no runtime index, no body reaching the
// program, no call through an interface inside the called body; the two body-call refusals were never exercised.
test("an instance inside a PROGRAM: a PROPERTY, a runtime index, a body reaching the program and an interface call are refused", () => {
  const codes = (source: string) => lowerSource(source, "P").diagnostics.map((d) => d.code)
  const station = (extra: string) =>
    "PROGRAM PRG_S\nVAR relay : FB_R; relays : ARRAY[1..2] OF FB_R; runs : INT; END_VAR\nruns := runs + 1;\nEND_PROGRAM\n" +
    "INTERFACE I_Sq\nMETHOD Area : INT\nEND_METHOD\nEND_INTERFACE\nFUNCTION_BLOCK FB_Sq IMPLEMENTS I_Sq\nEND_FUNCTION_BLOCK\nMETHOD Area : INT\nArea := 4;\nEND_METHOD\n" +
    `FUNCTION_BLOCK FB_R\nVAR_INPUT amount : INT; END_VAR\nVAR seen : INT; square : FB_Sq; held : I_Sq; END_VAR\nheld := square;\n${extra}\nEND_FUNCTION_BLOCK\n` +
    "PROPERTY Level : INT\nGET\nLevel := amount;\nEND_GET\nEND_PROPERTY\nMETHOD Plain : INT\nPlain := amount;\nEND_METHOD\nMETHOD Reach : INT\nReach := PRG_S.runs;\nEND_METHOD\nMETHOD Through : INT\nIF held <> 0 THEN\n  Through := held.Area();\nEND_IF\nEND_METHOD\n"
  const program = (body: string, extra = "") => `PROGRAM P\nVAR n : INT; i : INT := 1; END_VAR\nPRG_S();\n${body}\nEND_PROGRAM\n${station(extra)}`
  expect(codes(program("n := PRG_S.relay.Plain();"))).toEqual([])
  // A PROPERTY there was refused here; the recording since (`callshape_program_instance_property`: 33, 34) shows the getter
  // runs on the program's instance — and that a WRITE from outside does not compile. A runtime index stays refused.
  const getter = run(ir(program("n := PRG_S.relay.Level;"), "P"))
  getter.scan()
  expect(getter.get("n")).toEqual(0n)
  expect(codes(program("PRG_S.relay.Level := 1;"))).toContain("call-program-property")
  expect(codes(program("n := PRG_S.relays[i].Level;"))).toContain("call-program-property")
  expect(codes(program("PRG_S.relays[i](amount := 1);"))).toContain("call-program-member")
  expect(codes(program("n := PRG_S.relay.Reach();"))).toContain("call-program-reentrant")
  expect(codes(program("PRG_S.relay(amount := 1);", "seen := PRG_S.runs;"))).toContain("call-program-reentrant")
  expect(codes(program("n := PRG_S.relay.Through();"))).toContain("call-program-reentrant")
})

// Review of batch 3b (4 lenses, adversarial verify), each reproduced before its fix. Why missed: the batch's tests used an
// ARRAY[*] only the recorded ways — indexed, bounded, passed on — never whole, by address, through a union, rebound under
// SUPER^, read from a METHOD, or lent as a copy; each of those lowered silently once the slice became representable.
test("review of ARRAY[*]: whole values, addresses, unions, SUPER^ rebinding, METHOD reads and copies are refused", () => {
  const codes = (source: string) => lowerSource(source, "P").diagnostics.map((d) => d.code)
  const union = "TYPE U_W :\nUNION\n\tword : WORD;\n\tbytes : ARRAY[1..2] OF BYTE;\nEND_UNION\nEND_TYPE\n"
  const program = (body: string) =>
    `PROGRAM P\nVAR row : ARRAY[2..5] OF INT; words : ARRAY[0..1] OF U_W; r : INT; END_VAR\nr := F(numbers := row, us := words);\nEND_PROGRAM\n` +
    `FUNCTION F : INT\nVAR_IN_OUT numbers : ARRAY[*] OF INT; us : ARRAY[*] OF U_W; END_VAR\nVAR tmp : ARRAY[2..5] OF INT; p : POINTER TO INT; END_VAR\n${body}\nEND_FUNCTION\n` +
    `FUNCTION G : INT\nVAR_INPUT whole : ARRAY[2..5] OF INT; END_VAR\nG := whole[2];\nEND_FUNCTION\n${union}`
  // the recorded uses still lower
  expect(codes(program("numbers[UPPER_BOUND(numbers, 1)] := 1;\nF := numbers[2];"))).toEqual([])
  // a slice clone rustc rejects, and a store that swapped the caller's array for another under the old bounds
  expect(codes(program("tmp := numbers;"))).toContain("open-array-value")
  expect(codes(program("numbers := tmp;"))).toContain("open-array-value")
  expect(codes(program("F := G(whole := numbers);"))).toContain("open-array-value")
  // the store vanished with no diagnostic
  expect(codes(program("p := ADR(numbers[2]);"))).toContain("pointer-shape")
  // the overlay walk stopped at the open index: no copy made, no refusal
  expect(codes(program("us[0].word := 16#ABCD;"))).toContain("union-write")
  // SUPER^ rebinding an open in-out overwrote the bounds the derived body indexes its own by
  const inherit = (binding: string) =>
    `PROGRAM P\nVAR d : FB_D; g : ARRAY[1..3] OF INT; h : ARRAY[10..12] OF INT; END_VAR\nd(data := g, other := h);\nEND_PROGRAM\n` +
    `FUNCTION_BLOCK FB_B\nVAR_IN_OUT data : ARRAY[*] OF INT; END_VAR\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK FB_D EXTENDS FB_B\nVAR_IN_OUT other : ARRAY[*] OF INT; END_VAR\nSUPER^(${binding});\nEND_FUNCTION_BLOCK\n`
  expect(codes(inherit("data := other"))).toContain("call-open-array")
  expect(codes(inherit("data := data"))).toEqual([])
  // a METHOD reading its FB's open in-out: which bounds it sees is not recorded
  expect(codes("PROGRAM P\nVAR m : FB_M; g : ARRAY[1..3] OF INT; END_VAR\nm(data := g);\nEND_PROGRAM\nFUNCTION_BLOCK FB_M\nVAR_IN_OUT data : ARRAY[*] OF INT; END_VAR\nVAR top : DINT; END_VAR\nPeek();\nEND_FUNCTION_BLOCK\nMETHOD Peek\ntop := UPPER_BOUND(data, 1);\nEND_METHOD\n")).toContain("array-bound")
  // a VAR_IN_OUT CONSTANT lent as a copy carries no bounds
  expect(codes("PROGRAM P\nVAR s : FB_S; n : DINT; END_VAR\nn := s.Sum(v := s.arr);\nEND_PROGRAM\nFUNCTION_BLOCK FB_S\nVAR arr : ARRAY[1..3] OF INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Sum : DINT\nVAR_IN_OUT CONSTANT v : ARRAY[*] OF INT; END_VAR\nSum := v[1];\nEND_METHOD\n")).toContain("call-open-array")
})

/** Lower and require success — most tests are about the SHAPE, not the failure path. */
function ir(src: string, name?: string) {
  const { pou, diagnostics } = lowerSource(src, name)
  expect(diagnostics).toEqual([])
  return pou!
}

const wrap = (body: string, vars = "iCount : INT;") => `PROGRAM P\nVAR\n  ${vars}\nEND_VAR\n${body}\nEND_PROGRAM\n`

describe("lower — the frame", () => {
  test("a slot without an initial value carries its type's zero in the IR — no backend picks one", () => {
    const pou = ir(wrap("iCount := 1;", "iCount : INT;\n  flag : BOOL;\n  ratio : REAL;\n  text : STRING;"))
    expect(pou.slots.map((s) => s.init)).toEqual([0n, false, 0, ""])
  })

  test("every declared variable becomes a slot carrying its RESOLVED type, not a name", () => {
    const pou = ir(`
PROGRAM P
VAR_INPUT
  Enable : BOOL;
END_VAR
VAR
  iCount : INT := 3;
  rate   : REAL;
END_VAR
iCount := iCount + 1;
END_PROGRAM
`)
    expect(pou.slots.map((s) => [s.name, s.section, s.type.kind === "elementary" ? s.type.name : s.type.kind])).toEqual([
      ["Enable", "VAR_INPUT", "BOOL"],
      ["iCount", "VAR", "INT"],
      ["rate", "VAR", "REAL"],
    ])
    // the INT's own facts ride along — no second type table for a backend to consult
    const count = pou.slots[1]!.type
    expect(count.kind === "elementary" && count.elem.bits).toBe(16)
    expect(count.kind === "elementary" && count.elem.signed).toBe(true)
  })

  test("a declared initializer is constant-folded into the slot", () => {
    const pou = ir(wrap("iCount := 0;", "iCount : INT := 2 + 3;"))
    expect(pou.slots[0]!.init).toBe(5n)
  })

  test("every slot name is unique — two chains each get their own temp", () => {
    // Temps were named by purpose alone, so a second FOR loop (or chain) duplicated `for_limit` (`chain_value`): a
    // Rust struct with two identical fields. The interpreter reads by index and never noticed; no test had two temps.
    // A FOR takes no temp since its limit is read on every pass (conformance `callshape_for_bounds_changed_in_body`), so
    // the two loops add none — the two chains still need two.
    const pou = ir(
      wrap(
        "FOR iCount := 1 TO 3 DO flag := TRUE; END_FOR\nFOR iCount := 1 TO 2 DO flag := FALSE; END_FOR\nflag S= done R= flag;\ndone S= flag R= done;",
        "iCount : INT;\n  flag : BOOL;\n  done : BOOL;",
      ),
    )
    const names = pou.slots.map((s) => s.name.toUpperCase())
    expect(pou.slots.filter((s) => s.section === "temp").length).toBe(2)
    expect(new Set(names).size).toBe(names.length)
  })

  test("a name is a slot index — the IR holds no identifiers to look up", () => {
    const pou = ir(wrap("iCount := iCount + 1;"))
    const assign = pou.body[0] as IrAssign
    expect(assign.target.slot).toBe(0)
    expect(assign.target.path).toEqual([]) // fields/indices/derefs append here later
    // `iCount + 1` computes in DINT (integer promotion, measured against CODESYS in conformance) and converts back
    // to INT on store — so the load sits under two conversions, but it is still slot 0, not a name.
    const value = assign.value
    expect(value.kind).toBe("convert")
    const sum = value.kind === "convert" ? value.value : value
    expect(sum.kind).toBe("binary")
    const operand = sum.kind === "binary" && sum.left.kind === "convert" ? sum.left.value : undefined
    expect(operand?.kind === "load" && operand.place.slot).toBe(0)
  })
})

describe("lower — semantics resolved before any backend sees them", () => {
  test("ELSIF becomes a nested IF, so a backend has one branch shape", () => {
    const pou = ir(wrap("IF iCount > 5 THEN\n  iCount := 0;\nELSIF iCount > 2 THEN\n  iCount := 1;\nELSE\n  iCount := 2;\nEND_IF"))
    const outer = pou.body[0] as IrIf
    expect(outer.kind).toBe("if")
    expect(outer.else.length).toBe(1)
    const inner = outer.else[0] as IrIf
    expect(inner.kind).toBe("if")
    expect(inner.else.length).toBe(1) // the real ELSE
  })

  test("mixing INT and REAL inserts an explicit conversion — a backend never widens on its own", () => {
    const pou = ir(wrap("rate := rate + iCount;", "iCount : INT;\n  rate : REAL;"))
    const assign = pou.body[0] as IrAssign
    const sum = assign.value
    expect(sum.kind).toBe("binary")
    if (sum.kind !== "binary") return
    expect(sum.left.kind).toBe("load") // REAL already
    expect(sum.right.kind).toBe("convert") // INT widened, explicitly
    expect(sum.right.type.kind === "elementary" && sum.right.type.name).toBe("REAL")
  })

  test("a comparison's operands meet at their own common type, not at the BOOL result", () => {
    const pou = ir(wrap("flag := iCount < rate;", "iCount : INT;\n  rate : REAL;\n  flag : BOOL;"))
    const cmp = (pou.body[0] as IrAssign).value
    expect(cmp.kind === "binary" && cmp.op).toBe("lt")
    expect(cmp.kind === "binary" && cmp.left.kind).toBe("convert") // INT → REAL
    expect(cmp.type.kind === "elementary" && cmp.type.name).toBe("BOOL")
  })

  test("all three loop forms lower to ONE shape", () => {
    const kinds = ["FOR i := 1 TO 3 DO iCount := iCount + 1; END_FOR", "WHILE iCount < 3 DO iCount := iCount + 1; END_WHILE", "REPEAT iCount := iCount + 1; UNTIL iCount >= 3 END_REPEAT"].map(
      (body) => ir(wrap(body, "iCount : INT;\n  i : INT;")).body[0]!.kind,
    )
    expect(kinds).toEqual(["loop", "loop", "loop"])
  })

  // This pinned the limit "evaluated ONCE, into a temp slot" — never recorded. The recording made in the review of batch 3a
  // (`callshape_for_bounds_changed_in_body`) shows CODESYS reads the limit and the step on every pass.
  test("FOR reads its limit on every pass — no temp holds it", () => {
    const pou = ir(wrap("FOR i := 1 TO iCount DO iCount := 0; END_FOR", "iCount : INT;\n  i : INT;"))
    expect(pou.slots.map((s) => s.section)).toEqual(["VAR", "VAR"])
    const loop = pou.body[0] as IrLoop
    expect(loop.init.length).toBe(1) // the control variable
    expect(loop.test?.atEnd).toBe(false)
    expect(loop.step.length).toBe(1)
  })

  test("REPEAT's UNTIL is negated into a keep-going test at the tail", () => {
    const loop = ir(wrap("REPEAT iCount := iCount + 1; UNTIL iCount >= 3 END_REPEAT")).body[0] as IrLoop
    expect(loop.test?.atEnd).toBe(true)
    expect(loop.test?.cond.kind).toBe("unary")
  })

  test("CASE labels become resolved constant ranges", () => {
    const pou = ir(wrap("CASE iCount OF\n  1: iCount := 0;\n  2..4: iCount := 1;\nEND_CASE"))
    const sw = pou.body[0]
    expect(sw.kind).toBe("switch")
    if (sw.kind !== "switch") return
    expect(sw.arms.map((a) => a.labels)).toEqual([[{ lo: 1n, hi: 1n }], [{ lo: 2n, hi: 4n }]])
  })
})

describe("lower — total, never silently wrong", () => {
  test("an unlowerable construct is reported with a code, and the POU does not lower", () => {
    // ADR, not MAX: MAX lowers now. ADR waits on the memory model (design §9), so it stays unlowerable for a while.
    const { pou, diagnostics } = lowerSource(wrap("iCount := ADR(iCount);"))
    expect(pou).toBeUndefined()
    expect(diagnostics.map((d) => d.code)).toEqual(["expr-call"])
    expect(diagnostics[0]!.span.startLine).toBe(5)
  })

  test("bit access through a REFERENCE names the aliasing blocker, not a bad bit index", () => {
    // pro2193 MapperInputs.fb: `slice : REFERENCE TO BYTE; bit1 := slice.0;` — phase 4, and its code must say so
    const { diagnostics } = lowerSource("PROGRAM P\nVAR_INPUT slice : REFERENCE TO BYTE; END_VAR\nVAR b : BOOL; w : WORD; END_VAR\nb := slice.0;\nEND_PROGRAM\n")
    expect(diagnostics.map((d) => d.code)).toEqual(["bit-on-reference"])
    const beyond = lowerSource("PROGRAM P\nVAR b : BOOL; w : WORD; END_VAR\nb := w.16;\nEND_PROGRAM\n")
    expect(beyond.diagnostics.map((d) => d.code)).toEqual(["bit-index"])
  })

  // This refused a project GVL variable until globals lowered (phase 3 step 5); the refusal it pins moved to a name that
  // still has no storage — a LIBRARY's global, which lowering leaves unmodelled.
  test("a name that is not a frame slot says WHAT it is, using the symbol table", () => {
    const library = { uri: "Library Manager/SomeLib/GVL_Lib.gvl", source: "VAR_GLOBAL\n  gLibCounter : INT;\nEND_VAR\n" }
    const { diagnostics } = lowerSource(
      `
PROGRAM P
VAR
  iCount : INT;
END_VAR
iCount := gLibCounter;
END_PROGRAM
`,
      "P",
      [library],
    )
    expect(diagnostics[0]!.code).toBe("place-not-local")
    expect(diagnostics[0]!.message).toContain("gvl_var")
  })

  test("a GVL variable, read directly or through VAR_EXTERNAL, is the application's storage — one slot for both", () => {
    const { pou, diagnostics } = lowerSource(`
VAR_GLOBAL
  gTotal : INT := 5;
END_VAR

PROGRAM P
VAR_EXTERNAL
  gTotal : INT;
END_VAR
VAR
  iCount : INT;
END_VAR
iCount := gTotal;
gTotal := iCount + 1;
END_PROGRAM
`)
    expect(diagnostics).toEqual([])
    expect(pou!.slots.map((s) => s.name)).toEqual(["iCount"]) // the VAR_EXTERNAL is no local copy
    expect(pou!.globals.map((s) => [s.name, s.init])).toEqual([["gTotal", 5n]])
  })

  // Refused (`for-step-runtime`) until recorded: a step decided at run time sets the direction (conformance
  // `callshape_for_runtime_step`). This test then claimed the step was "evaluated once" — the review of batch 3a found no
  // recording showed it, and the one made since (`callshape_for_bounds_changed_in_body`) shows the opposite: the limit
  // and the step are both read on every pass. The limit had been taken into a temp once since phase 1; no fixture's body
  // ever changed it.
  test("a FOR reads its limit and its step on every pass — a runtime step decides the direction", () => {
    const runner = run(ir(wrap("FOR i := 1 TO 10 BY iCount DO\n  visits := visits + 1;\nEND_FOR", "iCount : INT := 3;\n  i : INT;\n  visits : INT;")))
    runner.scan()
    // 1, 4, 7, 10 — then i steps past the limit, to 13
    expect([runner.get("visits"), runner.get("i")]).toEqual([4n, 13n])
    // the recording: a body that sets the limit to 4 and the step to 3 after the first pass ends after 2 passes, at 7
    const changed = run(ir(wrap("FOR i := 1 TO finalIndex BY stride DO\n  visits := visits + 1;\n  stride := 3;\n  finalIndex := 4;\nEND_FOR", "i : INT;\n  finalIndex : INT := 9;\n  stride : INT := 1;\n  visits : INT;")))
    changed.scan()
    expect([changed.get("visits"), changed.get("i")]).toEqual([2n, 7n])
    // A call in the limit was refused here, how often it ran unrecorded; the recording since (`callshape_for_limit_call`)
    // runs a PROPERTY getter 4 times for 3 passes — once per test. One in the step stays unrecorded, and refused.
    const counted = run(
      ir(
        "PROGRAM P\nVAR holder : FB_H; i : INT; passes : INT; END_VAR\nFOR i := 1 TO holder.PassLimit DO\n  passes := passes + 1;\nEND_FOR\nEND_PROGRAM\n" +
          "FUNCTION_BLOCK FB_H\nVAR reads : INT; END_VAR\nEND_FUNCTION_BLOCK\nPROPERTY PassLimit : INT\nGET\nreads := reads + 1;\nPassLimit := 3;\nEND_GET\nEND_PROPERTY\n",
        "P",
      ),
    )
    counted.scan()
    expect([counted.get("passes"), counted.get("holder.reads")]).toEqual([3n, 4n])
    expect(lowerSource(wrap("FOR i := 1 TO 5 BY F_Step() DO\n  visits := visits + 1;\nEND_FOR", "i : INT;\n  visits : INT;") + "FUNCTION F_Step : INT\nF_Step := 2;\nEND_FUNCTION\n", "P").diagnostics.map((d) => d.code)).toEqual(["for-bound-call"])
  })

  // Recorded (`callshape_inout_binding_order`): an in-out is bound where it is written — 201 after a call that moves its
  // index, 101 before it. Both backends bind every in-out after the inputs; where that differs, the call is refused. Why
  // missed: the argument-order recording had inputs only.
  test("an in-out is bound where it is written: after a call in an earlier argument, refused before one", () => {
    const take = "FUNCTION F_Take : INT\nVAR_INPUT stepValue : INT; END_VAR\nVAR_IN_OUT boundValue : INT; END_VAR\nF_Take := boundValue * 10 + stepValue;\nEND_FUNCTION\n"
    const program = (call: string) =>
      `PROGRAM P\nVAR o : FB_O; END_VAR\no();\nEND_PROGRAM\nFUNCTION_BLOCK FB_O\nVAR_OUTPUT got : INT; END_VAR\nVAR numbers : ARRAY[0..3] OF INT := [10, 20, 30, 40]; cursor : INT; END_VAR\ncursor := 0;\ngot := ${call};\nEND_FUNCTION_BLOCK\nMETHOD Advance : INT\ncursor := cursor + 1;\nAdvance := cursor;\nEND_METHOD\n${take}`
    const after = run(ir(program("F_Take(stepValue := Advance(), boundValue := numbers[cursor])"), "P"))
    after.scan()
    expect(after.get("o.got")).toEqual(201n)
    // Written before the call, it was refused (`call-inout-order`) — both backends bound it after the inputs. Its index is
    // now taken where it is written, which the recording shows CODESYS binding: 101.
    const before = run(ir(program("F_Take(boundValue := numbers[cursor], stepValue := Advance())"), "P"))
    before.scan()
    expect(before.get("o.got")).toEqual(101n)
    // A VAR_OUTPUT target is not an in-out. Refused here while unrecorded (review of the batch); recorded since
    // (`callshape_output_index_before_call`): its index is read after the inputs — 7 lands in numbers[1], not numbers[0].
    const output = "FUNCTION F_Out : INT\nVAR_INPUT stepValue : INT; END_VAR\nVAR_OUTPUT res : INT; END_VAR\nres := 7;\nEND_FUNCTION\n"
    const outputRun = run(ir(program("F_Out(res => numbers[cursor], stepValue := Advance())") + output, "P"))
    outputRun.scan()
    expect([outputRun.get("o.numbers[0]"), outputRun.get("o.numbers[1]")]).toEqual([10n, 7n])
    // a binding nothing can move — a constant index — lowers in either order
    const fixed = run(ir(program("F_Take(boundValue := numbers[2], stepValue := Advance())"), "P"))
    fixed.scan()
    expect(fixed.get("o.got")).toEqual(301n)
    // A pointer's target moves with the POINTER, and `p^`'s index is read from it — so the pointer's own value is frozen
    // where the in-out is written, as an index is (conformance `callshape_inout_pointer_before_call`: 101, boundValue
    // still numbers[0] after a later argument repoints p). It was refused (`call-inout-order`).
    const pointed = run(
      ir(
        "PROGRAM P\nVAR o : FB_P; END_VAR\no();\nEND_PROGRAM\nFUNCTION_BLOCK FB_P\nVAR_OUTPUT got : INT; END_VAR\nVAR numbers : ARRAY[0..1] OF INT := [10, 20]; p : POINTER TO INT; END_VAR\np := ADR(numbers[0]);\ngot := F_Take(boundValue := p^, stepValue := Repoint());\nEND_FUNCTION_BLOCK\nMETHOD Repoint : INT\np := ADR(numbers[1]);\nRepoint := 1;\nEND_METHOD\n" +
          take,
        "P",
      ),
    )
    pointed.scan()
    expect([pointed.get("o.got"), pointed.get("o.numbers[0]"), pointed.get("o.numbers[1]")]).toEqual([101n, 10n, 20n])
  })

  // An ANY_INT input's `pValue` taken into a UNION of POINTERs and the caller's variable written through the member its
  // `diSize` selects (conformance `state_any_int_pointer_increment`: 1 -> 6, 2 -> 7, 3 -> 8, 4 -> 9). Three refusals at
  // once until now — `any-input` allowed only `.diSize`, `layout-union` only measured bytes, and a pointer records ONE
  // target while the four call sites pass four variables. An ANY input a call names a VARIABLE for is a hidden
  // VAR_IN_OUT bound to it, so the routine is lowered once per argument type and form 1 is enough.
  test("an ANY input's pValue is the variable the call names, read back through a union of pointers", () => {
    const source =
      "FUNCTION F_Inc : BOOL\nVAR_INPUT input : ANY_INT; incrementBy : INT := 1; END_VAR\nVAR u : DUT_Ptrs; END_VAR\n" +
      "u.p1_Byte := input.pValue;\nCASE input.diSize OF\n1: u.p1_Sint^ := u.p1_Sint^ + TO_SINT(incrementBy);\n2: u.p2_Int^ := u.p2_Int^ + incrementBy;\n4: u.p4_Dint^ := u.p4_Dint^ + incrementBy;\n8: u.p8_Lint^ := u.p8_Lint^ + incrementBy;\nEND_CASE\nF_Inc := TRUE;\nEND_FUNCTION\n" +
      "TYPE DUT_Ptrs :\nUNION\np1_Byte : POINTER TO BYTE;\np1_Sint : POINTER TO SINT;\np2_Int : POINTER TO INT;\np4_Dint : POINTER TO DINT;\np8_Lint : POINTER TO LINT;\nEND_UNION\nEND_TYPE\n"
    const runner = run(
      ir(
        "PROGRAM P\nVAR siArg : SINT := 1; iArg : INT := 2; dArg : DINT := 3; lArg : LINT := 4; done : BOOL; END_VAR\n" +
          "done := F_Inc(siArg, 5);\ndone := F_Inc(iArg, 5);\ndone := F_Inc(dArg, 5);\ndone := F_Inc(lArg, 5);\nEND_PROGRAM\n" +
          source,
        "P",
      ),
    )
    runner.scan()
    expect(["siArg", "iArg", "dArg", "lArg", "done"].map((v) => runner.get(v))).toEqual([6n, 7n, 8n, 9n, true])
    // An ANY argument that is no variable has no address to hand on: `pValue` is refused — and the dereferences that
    // follow then have no target, which is the same refusal reported where each of them stands.
    const literal = lowerSource(`PROGRAM P\nVAR done : BOOL; END_VAR\ndone := F_Inc(7, 5);\nEND_PROGRAM\n${source}`, "P").diagnostics.map((d) => d.code)
    expect([literal[0], ...new Set(literal.slice(1))]).toEqual(["any-input", "pointer-order"])
  })

  // A referenced library's NAMESPACE, read from its `<folder>.library` manifest and bound over the units it materialized
  // (`symbols/bindLibraryNamespaces`). pro2193's `enumErrorSeverity` takes every one of its values from
  // `TO_USINT(L_IE1P.L_IE1P_SeverityLevel.…)`, which folded to nothing: the namespace resolved to nothing, and
  // `constEval` folds no call. Why missed: no fixture ever qualified a name with a library namespace.
  test("an enum value taken from a library namespace, converted, folds to the value the library declares", () => {
    const LIB = "C:/p/Device/Plc Logic/Application/Library Manager/LibSeverity"
    const libraries = [
      { uri: `${LIB}/LibSeverity.library`, source: "LIBRARY LibSeverity\nNAMESPACE LSEV\nRESOLUTION LibSeverity, 1.0.0.0 (Acme)\n" },
      { uri: `${LIB}/E_SEVERITY.enum`, source: "TYPE E_Severity :\n(\n\tLow := 2,\n\tHigh := 30\n);\nEND_TYPE\n" },
    ]
    const source =
      "TYPE E_Local :\n(\n\tQuiet := TO_USINT(LSEV.E_Severity.Low),\n\tLoud := TO_USINT(LSEV.E_Severity.High)\n) USINT;\nEND_TYPE\n" +
      "PROGRAM P\nVAR level : E_Local; n : USINT; END_VAR\nlevel := E_Local.Loud;\nn := TO_USINT(level) + TO_USINT(E_Local.Quiet);\nEND_PROGRAM\n"
    const { pou, diagnostics } = lowerSource(source, "P", libraries)
    expect(diagnostics).toEqual([])
    const runner = run(pou!)
    runner.scan()
    expect([runner.get("level"), runner.get("n")]).toEqual([30n, 32n])
    // without the manifest the namespace is not a name at all, and the enum's values do not fold — reported, never guessed
    const noManifest = lowerSource(source, "P", [libraries[1]!])
    expect(noManifest.diagnostics.map((d) => d.code)).toContain("enum-value")
  })

  test("lowering never throws, whatever it is handed", () => {
    for (const src of ["", "PROGRAM P END_PROGRAM", wrap("iCount := ptr^;", "iCount : INT;\n  ptr : POINTER TO INT;")])
      expect(() => lowerSource(src)).not.toThrow()
  })

  test("a POU whose statements all lower is still refused when a slot has no runtime representation", () => {
    // An unused POINTER lowered cleanly and made the Rust emitter throw — every backend must take what lowering gives it.
    // A pointer has a representation since phase 3 step 6b (its one target's index), an interface since phase 5 (its
    // instance's tag) — this used an unused interface variable. An array whose bounds do not fold still has none.
    const { pou, diagnostics } = lowerSource(
      "PROGRAM P\nVAR\n  iCount : INT;\n  sized : ARRAY[0..iCount] OF INT;\nEND_VAR\niCount := 1;\nEND_PROGRAM\n",
      "P",
    )
    expect(pou).toBeUndefined()
    expect(diagnostics.map((d) => d.code)).toEqual(["slot-array"])
  })

  // Transpiler review 2026-09-15. Why missed: every pointer test took the address of a whole variable or of an element with
  // the index LAST, and every one used the pointer's own target type — no test named a place with an index inside its
  // path, or a byte-sized pointer over a wider variable.
  test("an address is refused when an index before its last step is read at run time, or its type is not the pointer's", () => {
    const decls = "TYPE T_S : STRUCT x : INT; END_STRUCT END_TYPE\nPROGRAM P\nVAR arr : ARRAY[1..3] OF T_S; grid : ARRAY[1..3] OF ARRAY[1..3] OF INT; i : INT := 1; j : INT := 2; n : INT; p : POINTER TO INT; pb : POINTER TO BYTE; r : REFERENCE TO INT; END_VAR\n"
    const code = (body: string) => lowerSource(`${decls}${body}\nEND_PROGRAM\n`, "P").diagnostics.map((d) => d.code)
    expect(code("p := ADR(arr[i].x);")).toEqual(["pointer-runtime-index"])
    expect(code("p := ADR(grid[i][j]);")).toEqual(["pointer-runtime-index"])
    expect(code("r REF= arr[i].x;")).toEqual(["pointer-runtime-index"])
    expect(code("pb := ADR(n);")).toEqual(["pointer-type"])
    // still lowered: a constant index before the last step, and a runtime index as the last step
    expect(code("p := ADR(arr[2].x); n := p^;")).toEqual([])
    expect(code("p := ADR(grid[2][i]); n := p^;")).toEqual([])
  })

  // Transpiler review 2026-09-15. Why missed: every routine test called a routine that did not reach itself, so the
  // lower-once cache was always filled before a second lookup; nothing tested the lookup DURING lowering.
  test("a FUNCTION or METHOD that calls itself is refused, not lowered without end", () => {
    const code = (source: string) => lowerSource(source, "P").diagnostics.map((d) => d.code)
    expect(code("PROGRAM P\nVAR n : INT; END_VAR\nn := F_Down(3);\nEND_PROGRAM\nFUNCTION F_Down : INT\nVAR_INPUT k : INT; END_VAR\nIF k > 0 THEN F_Down := F_Down(k - 1); END_IF\nEND_FUNCTION\n")).toContain("call-recursive")
    expect(code("PROGRAM P\nVAR inst : FB_R; END_VAR\ninst.M();\nEND_PROGRAM\nFUNCTION_BLOCK FB_R\nVAR n : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD M\nn := n + 1;\nIF n < 3 THEN THIS^.M(); END_IF\nEND_METHOD\n")).toContain("call-recursive")
  })

  // Transpiler review 2026-09-15. Why missed: the globals tests read and wrote GVL variables and called a PROGRAM; none
  // declared an FB INSTANCE in a GVL, and the rustc crate check is the only thing that sees the double borrow.
  test("an FB instance declared in a GVL is refused as a call target — `g.inst.call(g)` borrows g twice", () => {
    const code = (body: string) =>
      lowerSource(`PROGRAM P\n${body}\nEND_PROGRAM\nVAR_GLOBAL\n  gInst : FB_G;\nEND_VAR\nFUNCTION_BLOCK FB_G\nVAR n : INT; END_VAR\nn := n + 1;\nEND_FUNCTION_BLOCK\nMETHOD M\nn := 0;\nEND_METHOD\n`, "P").diagnostics.map((d) => d.code)
    expect(code("gInst();")).toEqual(["call-global-instance"])
    expect(code("gInst.M();")).toEqual(["call-global-instance"])
  })

  // Transpiler review 2026-09-15. Why missed: the in-out tests bound ONE VAR_IN_OUT per call, and the alias test compared
  // it with the called instance only — never two parameters on one variable, never a METHOD reached through THIS^.
  test("a VAR_IN_OUT is refused when the call already holds its variable — through another in-out, or through THIS^", () => {
    const code = (source: string) => lowerSource(source, "P").diagnostics.map((d) => d.code)
    const two = "FUNCTION_BLOCK FB_Two\nVAR_IN_OUT a : INT; b : INT; END_VAR\na := b;\nEND_FUNCTION_BLOCK\n"
    expect(code(`PROGRAM P\nVAR pair : FB_Two; n : INT; m : INT; END_VAR\npair(a := n, b := n);\nEND_PROGRAM\n${two}`)).toEqual(["call-inout-alias"])
    expect(code(`PROGRAM P\nVAR pair : FB_Two; n : INT; m : INT; END_VAR\npair(a := n, b := m);\nEND_PROGRAM\n${two}`)).toEqual([])
    // `THIS^.Store(dest := n)` lends the instance's own field to its own METHOD. It was refused only because two `&mut` of
    // one instance cannot be printed; it lowers now — as a copy written back, or, when Store also reaches n by NAME (where
    // a copy would be stale), by substituting the path into the instance (conformance `callshape_own_field_inout_read_by_name`).
    const self = (store: string) =>
      `FUNCTION_BLOCK FB_S\nVAR n : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Store\nVAR_IN_OUT dest : INT; END_VAR\n${store}\nEND_METHOD\nMETHOD Outer\nTHIS^.Store(dest := n);\nEND_METHOD\n`
    const through = run(ir(`PROGRAM P\nVAR s : FB_S; END_VAR\ns.Outer();\nEND_PROGRAM\n${self("dest := 1;")}`, "P"))
    through.scan()
    expect(through.get("s.n")).toEqual(1n)
    const byName = run(ir(`PROGRAM P\nVAR s : FB_S; END_VAR\ns.Outer();\nEND_PROGRAM\n${self("dest := n + 1;")}`, "P"))
    byName.scan()
    expect(byName.get("s.n")).toEqual(1n)
  })

  // Transpiler review 2026-09-15. Why missed: every call test passed constants or variables as arguments; the crate check
  // never held a call inside a call, where the printed Rust borrows `g` (or the one instance) twice.
  // It was refused (`call-nested`) while the order a call's arguments run in was unmeasured. Recorded since — as written
  // (conformance `callshape_argument_order`) — each argument holding a call is taken first, in a `let`, so the same
  // instance is never borrowed twice in one argument list.
  test("a routine called inside another call's arguments runs first, where it is written", () => {
    const fb = "FUNCTION_BLOCK FB_B\nVAR n : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD M : INT\nVAR_INPUT k : INT; END_VAR\nn := n + k;\nM := n;\nEND_METHOD\nFUNCTION F : INT\nVAR_INPUT k : INT; END_VAR\nF := k;\nEND_FUNCTION\n"
    const runner = run(ir(`PROGRAM P\nVAR a : FB_B; nested : INT; twice : INT; side : INT; END_VAR\nnested := a.M(k := a.M(k := 1));\ntwice := F(k := F(k := 1));\nside := a.M(k := 1) + F(k := 2);\nEND_PROGRAM\n${fb}`, "P"))
    runner.scan()
    // the inner M adds 1 and returns 1; the outer adds that and returns 2; then M adds 1 more (3) beside F's 2
    expect(["nested", "twice", "side", "a.n"].map((v) => runner.get(v))).toEqual([2n, 1n, 5n, 3n])
  })

  // Transpiler review 2026-09-15. Why missed: the SIZEOF fixtures are a plain struct and an FB of plain variables; the
  // layout of a derived type or of an FB's VAR_IN_OUT was never recorded, and nothing asked for it.
  test("SIZEOF of a derived type or of an FB with VAR_IN_OUT is refused — neither layout is measured", () => {
    const types = "TYPE T_Base : STRUCT a : INT; END_STRUCT END_TYPE\nTYPE T_Derived EXTENDS T_Base : STRUCT b : INT; END_STRUCT END_TYPE\nFUNCTION_BLOCK FB_Io\nVAR_IN_OUT v : INT; END_VAR\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK FB_Base\nVAR a : INT; END_VAR\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK FB_Derived EXTENDS FB_Base\nVAR b : INT; END_VAR\nEND_FUNCTION_BLOCK\n"
    const code = (arg: string) => lowerSource(`PROGRAM P\nVAR n : ULINT; END_VAR\nn := SIZEOF(${arg});\nEND_PROGRAM\n${types}`, "P").diagnostics.map((d) => d.code)
    expect(code("T_Derived")).toEqual(["sizeof-unmeasured"])
    expect(code("FB_Io")).toEqual(["sizeof-unmeasured"])
    expect(code("FB_Derived")).toEqual(["sizeof-unmeasured"])
    expect(code("T_Base")).toEqual([])
  })

  // Transpiler review 2026-09-15. Why missed: the enum fixtures number values and store them; none declares the TYPE's
  // own default (`:= B` after the list), which no code read.
  test("an enum type with a default value is refused — a variable of it would start at 0", () => {
    const { diagnostics } = lowerSource("PROGRAM P\nVAR m : E_D; END_VAR\nm := m;\nEND_PROGRAM\nTYPE E_D : (Idle, Busy) := Busy; END_TYPE\n", "P")
    expect(diagnostics.map((d) => d.code)).toContain("enum-default")
  })

  // Phase 3½: every METHOD call resolves against the instance's own type — which holds only while an instance is never
  // seen through its base type. A base-typed VAR_IN_OUT bound to a derived instance would dispatch on the parameter's
  // type; that is not modelled, so it is refused, as is a SUPER^ with no base to name.
  test("a derived instance bound to a base-typed VAR_IN_OUT, and SUPER^ outside a derived FB, are refused", () => {
    const code = (source: string) => lowerSource(source, "P").diagnostics.map((d) => d.code)
    const fbs =
      "FUNCTION_BLOCK FB_B\nVAR n : INT; END_VAR\nn := n + 1;\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK FB_D EXTENDS FB_B\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK FB_Take\nVAR_IN_OUT b : FB_B; END_VAR\nVAR seen : INT; END_VAR\nseen := b.n;\nEND_FUNCTION_BLOCK\n"
    expect(code(`PROGRAM P\nVAR d : FB_D; take : FB_Take; END_VAR\ntake(b := d);\nEND_PROGRAM\n${fbs}`)).toEqual(["call-inout-derived"])
    expect(code(`PROGRAM P\nVAR b : FB_B; take : FB_Take; END_VAR\ntake(b := b);\nEND_PROGRAM\n${fbs}`)).toEqual([])
    const plain = "FUNCTION_BLOCK FB_Plain\nVAR n : INT; END_VAR\nSUPER^();\nEND_FUNCTION_BLOCK\n"
    expect(code(`PROGRAM P\nVAR x : FB_Plain; END_VAR\nx();\nEND_PROGRAM\n${plain}`)).toEqual(["call-super"])
  })

  // A METHOD's VAR_INST becomes a field when the method lowers — so a SIZEOF taken before that call and one after would
  // differ, and where CODESYS lays the variable out is not measured.
  test("SIZEOF of an FB whose METHOD has VAR_INST is refused", () => {
    const { diagnostics } = lowerSource(
      "PROGRAM P\nVAR n : ULINT; END_VAR\nn := SIZEOF(FB_K);\nEND_PROGRAM\nFUNCTION_BLOCK FB_K\nVAR x : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Tick\nVAR_INST kept : INT; END_VAR\nkept := kept + 1;\nEND_METHOD\n",
      "P",
    )
    expect(diagnostics.map((d) => d.code)).toEqual(["sizeof-unmeasured"])
  })

  // In Rust a PROGRAM runs moved out of `Programs` and back, so a program whose run reaches its own instance — here
  // through an FB it calls — would read a stand-in there. Refused, rather than read wrong.
  test("a PROGRAM whose run reaches its own instance through an FB it calls is refused", () => {
    const { diagnostics } = lowerSource(
      "PROGRAM P\nPRG_Self();\nEND_PROGRAM\nPROGRAM PRG_Self\nVAR peek : FB_Peek; runs : INT; END_VAR\nruns := runs + 1;\npeek();\nEND_PROGRAM\nFUNCTION_BLOCK FB_Peek\nVAR seen : INT; END_VAR\nseen := PRG_Self.runs;\nEND_FUNCTION_BLOCK\n",
      "P",
    )
    expect(diagnostics.map((d) => d.code)).toContain("call-program-reentrant")
  })

  // The init step reaches instances through the frame; one inside an array (or a global, or a routine's local) is where
  // the walk does not follow and its timing is unmeasured — refused, never silently left uninitialised.
  test("a call_after_global_init_slot FB inside an array is refused", () => {
    const { diagnostics } = lowerSource(
      "PROGRAM P\nVAR many : ARRAY[1..2] OF FB_I; END_VAR\nmany[1]();\nEND_PROGRAM\nFUNCTION_BLOCK FB_I\nVAR inits : INT; END_VAR\nEND_FUNCTION_BLOCK\n{attribute 'call_after_global_init_slot' := '50000'}\nMETHOD AfterGlobalInit\ninits := inits + 1;\nEND_METHOD\n",
      "P",
    )
    expect(diagnostics.map((d) => d.code)).toEqual(["attr-init-unreached"])
  })
  // An FB lowered on its own has no caller, so the harness is one: each in-out gets a variable beside the instance, bound
  // to every scan's call. The oracle for it is the CALLED shape, which is recorded — so the root must give the same values.
  test("an FB with VAR_IN_OUT lowered on its own runs on harness-owned in-outs, as a caller's binding does", () => {
    const fb = "FUNCTION_BLOCK FB_Io\nVAR_IN_OUT v : INT; END_VAR\nVAR n : INT; END_VAR\nn := n + 1;\nv := v + n;\nEND_FUNCTION_BLOCK\n"
    const root = run(ir(fb, "FB_Io"))
    const called = run(ir(`PROGRAM P\nVAR v : INT; inst : FB_Io; END_VAR\ninst(v := v);\nEND_PROGRAM\n${fb}`, "P"))
    for (let scan = 0; scan < 3; scan++) {
      root.scan()
      called.scan()
      expect(root.get("v")).toEqual(called.get("v"))
    }
    expect(root.get("v")).toEqual(6n)
    // an ARRAY[*] stays refused: only a caller's array gives it a size
    const open = lowerSource("FUNCTION_BLOCK FB_Open\nVAR_IN_OUT many : ARRAY[*] OF INT; END_VAR\nmany[0] := 1;\nEND_FUNCTION_BLOCK\n", "FB_Open")
    expect(open.diagnostics.map((d) => d.code)).toEqual(["root-inout"])
  })

  test("an initializer that does not fold is reported, never silently dropped", () => {
    // It was dropped: the slot started at its default with no diagnostic — which is how every STRING slot lost its
    // initial value (constEval folds no strings) while each string case still "lowered".
    const { diagnostics } = lowerSource(wrap("iCount := 1;", "iCount : INT;\n  other : INT := iCount;"))
    expect(diagnostics.map((d) => d.code)).toEqual(["init-not-constant"])
  })
})

/** The Standard library as the bridge materializes it (`Library Manager/Standard/LEN.fun`) — only what these call. */
const STANDARD_LEN = {
  uri: "Device/Plc Logic/Application/Library Manager/Standard/LEN.fun",
  source: "FUNCTION LEN : INT\nVAR_INPUT\n\tSTR : STRING(255);\nEND_VAR\nEND_FUNCTION\n",
}

describe("lower — STRING (design §18)", () => {
  test("a STRING slot carries its capacity — 80 when sizeless, as measured", () => {
    const pou = ir(wrap("iCount := 1;", "iCount : INT;\n  plain : STRING;\n  five : STRING(5);"))
    expect(pou.slots.slice(1).map((s) => s.type.kind === "elementary" && s.type.length)).toEqual([80, 5])
  })

  test("a string initializer is folded into the slot with its measured escapes decoded", () => {
    const pou = ir(wrap("iCount := 1;", "iCount : INT;\n  text : STRING := 'x$Ty$$z$N$41$'';"))
    expect(pou.slots[1]!.init).toBe("x\ty$z\nA'")
  })

  test("an escape not measured is refused, not guessed", () => {
    const { diagnostics } = lowerSource(wrap("text := '$Q';", "text : STRING;"))
    expect(diagnostics.map((d) => d.code)).toEqual(["string-escape"])
  })

  test("two STRINGs compare as they are — no conversion to one capacity, which would cut the longer one", () => {
    const pou = ir(wrap("same := short3 = plain;", "short3 : STRING(3);\n  plain : STRING;\n  same : BOOL;"))
    const compare = (pou.body[0] as IrAssign).value
    expect(compare.kind === "binary" && [compare.left.kind, compare.right.kind]).toEqual(["load", "load"])
  })

  test("a Standard string function binds only to the referenced library's own declaration", () => {
    const src = wrap("n := LEN(text);", "text : STRING;\n  n : INT;")
    // no library referenced → no LEN
    expect(lowerSource(src).diagnostics.map((d) => d.code)).toEqual(["expr-call"])
    // a project FUNCTION that happens to be called LEN is not the library's
    const own = `FUNCTION LEN : INT\nVAR_INPUT\n  STR : STRING(255);\nEND_VAR\nLEN := 7;\nEND_FUNCTION\n${src}`
    expect(lowerSource(own, "P").diagnostics.map((d) => d.code)).toEqual(["expr-call"])

    const { pou, diagnostics } = lowerSource(src, undefined, [STANDARD_LEN])
    expect(diagnostics).toEqual([])
    const call = (pou!.body[0] as IrAssign).value
    expect(call.kind === "builtin" && call.name).toBe("len")
    // the argument takes the library's STRING(255) — which is where a STRING(300) is cut on the way in
    const arg = call.kind === "builtin" ? call.args[0]! : undefined
    expect(arg?.type.kind === "elementary" && arg.type.length).toBe(255)
  })

  test("a sizeless WSTRING holds 80, like STRING, and its four-digit escape is one UTF-16 unit", () => {
    // This first asserted a non-ASCII WSTRING literal is refused, pending `wstring_code_units`; that case has been
    // recorded — "h$00E9llo" equals "héllo", one unit per character — so the premise no longer holds.
    const pou = ir(wrap("iCount := 1;", "iCount : INT;\n  wide : WSTRING := \"h$00E9llo\";"))
    expect(pou.slots[1]!.type.kind === "elementary" && pou.slots[1]!.type.length).toBe(80)
    expect(pou.slots[1]!.init).toBe("héllo")
  })

  test("a non-ASCII character typed into a STRING is refused — which byte it becomes is not measured", () => {
    const { diagnostics } = lowerSource(wrap("iCount := 1;", "iCount : INT;\n  text : STRING := 'héllo';"))
    expect(diagnostics.map((d) => d.code)).toEqual(["string-non-ascii"])
  })

  test("code CODESYS does not compile gets no meaning — `**` and `&` are refused, not mapped to an operator", () => {
    // This slot used to assert that LEN(WSTRING) is refused. That code does not compile in CODESYS, and the transpiler's
    // input is code that does (src/transpile/index.ts) — so the refusal and its test went; `**` and `&` had been given
    // IR meanings for the same non-existent input.
    for (const op of ["**", "&"]) {
      const { diagnostics } = lowerSource(wrap(`iCount := iCount ${op} 2;`))
      expect(diagnostics.map((d) => d.code)).toEqual(["binary-op"])
    }
  })
})
