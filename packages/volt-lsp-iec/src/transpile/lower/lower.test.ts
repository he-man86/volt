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
    // `iCount + 1` computes in DINT (integer promotion, measured against CODESYS in test/exec) and converts back
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

  test("a name that is not a frame slot says WHAT it is, using the symbol table", () => {
    const { diagnostics } = lowerSource(`
VAR_GLOBAL
  gTotal : INT;
END_VAR

PROGRAM P
VAR
  iCount : INT;
END_VAR
iCount := gTotal;
END_PROGRAM
`)
    expect(diagnostics[0]!.code).toBe("place-not-local")
    expect(diagnostics[0]!.message).toContain("gvl_var")
  })

  test("a runtime FOR step is refused rather than guessed at", () => {
    const { diagnostics } = lowerSource(wrap("FOR i := 1 TO 10 BY iCount DO i := i; END_FOR", "iCount : INT;\n  i : INT;"))
    expect(diagnostics.map((d) => d.code)).toEqual(["for-step-runtime"])
  })

  test("lowering never throws, whatever it is handed", () => {
    for (const src of ["", "PROGRAM P END_PROGRAM", wrap("iCount := ptr^;", "iCount : INT;\n  ptr : POINTER TO INT;")])
      expect(() => lowerSource(src)).not.toThrow()
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
