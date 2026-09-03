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

  test("a name is a slot index — the IR holds no identifiers to look up", () => {
    const pou = ir(wrap("iCount := iCount + 1;"))
    const assign = pou.body[0] as IrAssign
    expect(assign.target.slot).toBe(0)
    expect(assign.target.path).toEqual([]) // fields/indices/derefs append here later
    const value = assign.value
    expect(value.kind).toBe("binary")
    expect(value.kind === "binary" && value.left.kind === "load" && value.left.place.slot).toBe(0)
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
    const { pou, diagnostics } = lowerSource(wrap("iCount := Max(1, 2);"))
    expect(pou).toBeUndefined()
    expect(diagnostics.map((d) => d.code)).toEqual(["expr-call"])
    expect(diagnostics[0]!.span.startLine).toBe(5)
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
})
