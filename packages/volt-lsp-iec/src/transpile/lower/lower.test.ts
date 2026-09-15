import { describe, expect, test } from "bun:test"
import { lowerSource } from "./lower.js"
import type { IrAssign, IrIf, IrLoop } from "../ir/index.js"

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

  test("every slot name is unique — two FOR loops and two chains each get their own temp", () => {
    // Temps were named by purpose alone, so a second FOR loop (or chain) duplicated `for_limit` (`chain_value`): a
    // Rust struct with two identical fields. The interpreter reads by index and never noticed; no test had two temps.
    const pou = ir(
      wrap(
        "FOR iCount := 1 TO 3 DO flag := TRUE; END_FOR\nFOR iCount := 1 TO 2 DO flag := FALSE; END_FOR\nflag S= done R= flag;\ndone S= flag R= done;",
        "iCount : INT;\n  flag : BOOL;\n  done : BOOL;",
      ),
    )
    const names = pou.slots.map((s) => s.name.toUpperCase())
    expect(pou.slots.filter((s) => s.section === "temp").length).toBe(4)
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

  test("FOR evaluates its limit ONCE, into a temp slot", () => {
    const pou = ir(wrap("FOR i := 1 TO iCount DO iCount := 0; END_FOR", "iCount : INT;\n  i : INT;"))
    expect(pou.slots.map((s) => s.section)).toEqual(["VAR", "VAR", "temp"])
    const loop = pou.body[0] as IrLoop
    expect(loop.init.length).toBe(2) // limit temp, then the control variable
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

  test("a runtime FOR step is refused rather than guessed at", () => {
    const { diagnostics } = lowerSource(wrap("FOR i := 1 TO 10 BY iCount DO i := i; END_FOR", "iCount : INT;\n  i : INT;"))
    expect(diagnostics.map((d) => d.code)).toEqual(["for-step-runtime"])
  })

  test("lowering never throws, whatever it is handed", () => {
    for (const src of ["", "PROGRAM P END_PROGRAM", wrap("iCount := ptr^;", "iCount : INT;\n  ptr : POINTER TO INT;")])
      expect(() => lowerSource(src)).not.toThrow()
  })

  test("a POU whose statements all lower is still refused when a slot has no runtime representation", () => {
    // An unused POINTER lowered cleanly and made the Rust emitter throw — every backend must take what lowering gives it.
    // A pointer has a representation since phase 3 step 6b (its one target's index); an interface variable still has none.
    const { pou, diagnostics } = lowerSource(
      "INTERFACE I_Shape\nEND_INTERFACE\n\nPROGRAM P\nVAR\n  iCount : INT;\n  shape : I_Shape;\nEND_VAR\niCount := 1;\nEND_PROGRAM\n",
      "P",
    )
    expect(pou).toBeUndefined()
    expect(diagnostics.map((d) => d.code)).toEqual(["slot-interface"])
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
    const self = "FUNCTION_BLOCK FB_S\nVAR n : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Store\nVAR_IN_OUT dest : INT; END_VAR\ndest := 1;\nEND_METHOD\nMETHOD Outer\nTHIS^.Store(dest := n);\nEND_METHOD\n"
    expect(code(`PROGRAM P\nVAR s : FB_S; END_VAR\ns.Outer();\nEND_PROGRAM\n${self}`)).toContain("call-inout-alias")
  })

  // Transpiler review 2026-09-15. Why missed: every call test passed constants or variables as arguments; the crate check
  // never held a call inside a call, where the printed Rust borrows `g` (or the one instance) twice.
  test("a routine called inside another call's arguments is refused", () => {
    const fb = "FUNCTION_BLOCK FB_B\nVAR n : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD M : INT\nVAR_INPUT k : INT; END_VAR\nn := n + k;\nM := n;\nEND_METHOD\nFUNCTION F : INT\nVAR_INPUT k : INT; END_VAR\nF := k;\nEND_FUNCTION\n"
    const code = (body: string) => lowerSource(`PROGRAM P\nVAR a : FB_B; n : INT; END_VAR\n${body}\nEND_PROGRAM\n${fb}`, "P").diagnostics.map((d) => d.code)
    expect(code("n := a.M(k := a.M(k := 1));")).toEqual(["call-nested"])
    expect(code("n := F(k := F(k := 1));")).toEqual(["call-nested"])
    expect(code("n := a.M(k := 1) + F(k := 2);")).toEqual([]) // side by side is not nested
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

  test("an FB with VAR_IN_OUT lowered on its own is refused — only a caller binds its in-out", () => {
    const { diagnostics } = lowerSource("FUNCTION_BLOCK FB_Io\nVAR_IN_OUT v : INT; END_VAR\nv := v + 1;\nEND_FUNCTION_BLOCK\n", "FB_Io")
    expect(diagnostics.map((d) => d.code)).toEqual(["root-inout"])
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
