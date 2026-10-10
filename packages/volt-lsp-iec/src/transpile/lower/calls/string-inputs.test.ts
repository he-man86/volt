/**
 * Read-only Standard string inputs (task 7.4.6): which argument is lent, which keeps the input copy, and what a body may
 * not do with a lent one. What the lent input COMPUTES is `test/libraries/standard.test.ts`'s proof.
 */
import { describe, expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import type { IrExpr, IrInvoke, IrRoutine } from "../../ir/index.js"
import { forEachExpr } from "../../ir/walk.js"
import { lowerSource } from "../index.js"

const LIBRARY = "file:///p/Library Manager/Standard/"
const LEN_INTERNAL = "FUNCTION LEN_INTERNAL : UINT\nVAR_IN_OUT\n\tSTR : STRING(255);\nEND_VAR\nWHILE STR[LEN_INTERNAL] <> 0 DO\n\tLEN_INTERNAL := LEN_INTERNAL + 1;\nEND_WHILE\nEND_FUNCTION\n"
const LEN = "FUNCTION LEN : INT\nVAR_INPUT\n\tSTR : STRING(255);\nEND_VAR\nLEN := UINT_TO_INT(LEN_INTERNAL(STR));\nEND_FUNCTION\n"
const LEFT = `FUNCTION LEFT : STRING(255)
VAR_INPUT
	STR : STRING(255);
	SIZE : INT;
END_VAR
VAR
	i : DINT;
	n : DINT;
END_VAR
n := LIMIT(0, SIZE, UINT_TO_DINT(LEN_INTERNAL(STR)));
FOR i := 0 TO n - 1 DO
	LEFT[i] := STR[i];
END_FOR
LEFT[n] := 0;
END_FUNCTION
`
/** A Standard function whose body is given: the repo's LEN, or one that does what no repo body may. */
const standard = (body = LEN) => [
  { uri: `${LIBRARY}LEN_INTERNAL.pou`, source: LEN_INTERNAL },
  { uri: `${LIBRARY}LEN.pou`, source: body },
]

const program = (decls: string, body: string): string => `PROGRAM PLC_PRG\nVAR\n${decls}END_VAR\n${body}END_PROGRAM\n`

/** The program's calls of LEN, each with the routine it runs. */
function lenCalls(decls: string, body: string, globals = ""): { invoke: IrInvoke; routine: IrRoutine }[] {
  const { pou, diagnostics } = lowerSource(`${globals}${program(decls, body)}`, "PLC_PRG", standard())
  expect(diagnostics).toEqual([])
  const out: { invoke: IrInvoke; routine: IrRoutine }[] = []
  forEachExpr(pou!.body, (e: IrExpr) => {
    if (e.kind === "invoke") out.push({ invoke: e, routine: pou!.routines.find((r) => r.key === e.routine)! })
  })
  return out
}

describe("which argument is lent", () => {
  test("a STRING(N <= 255) variable is lent where it lies: STR is a read-only in-out of its capacity", () => {
    const [call] = lenCalls("\ttxt : STRING(10) := 'hello';\n\tn : INT;\n", "n := LEN(txt);\n")
    expect(call!.routine.name).toBe("Standard.LEN#STR&=STRING10")
    expect(call!.routine.inputs).toEqual([])
    expect(call!.routine.inouts.map((s) => [s.name, s.readOnly, s.constant, s.type.kind === "elementary" ? s.type.length : undefined])).toEqual([["STR", true, true, 10]])
    expect("kind" in call!.invoke.inouts[0]!).toBe(false)
  })

  test("a literal is lent as a copy at its own capacity", () => {
    const [call] = lenCalls("\tn : INT;\n", "n := LEN('abc');\n")
    expect(call!.routine.name).toBe("Standard.LEN#STR&=STRING3")
    expect(call!.invoke.inouts[0]).toMatchObject({ kind: "copy", value: { kind: "const", value: "abc" } })
  })

  test("a FUNCTION's result is lent as a copy at its declared capacity", () => {
    const named = "FUNCTION Named : STRING(12)\nNamed := 'twelve chars';\nEND_FUNCTION\n\n"
    const call = lenCalls("\tn : INT;\n", "n := LEN(Named());\n", named).find((c) => c.routine.name.startsWith("Standard."))
    expect(call!.routine.name).toBe("Standard.LEN#STR&=STRING12")
    expect(call!.invoke.inouts[0]).toMatchObject({ kind: "copy", value: { kind: "invoke" } })
  })

  test("anything else is lent a copy taken as the input took it: a global at its own capacity, a STRING wider than 255 or a conversion cut to the declared STRING(255)", () => {
    const gvl = "VAR_GLOBAL\n\tshared : STRING(10);\nEND_VAR\n\n"
    for (const [decls, body, variant, value] of [
      ["\tn : INT;\n", "n := LEN(shared);\n", "STRING10", "load"],
      ["\twide : STRING(300);\n\tn : INT;\n", "n := LEN(wide);\n", "STRING255", "convert"],
      ["\tn : INT;\n\ti : INT;\n", "n := LEN(INT_TO_STRING(i));\n", "STRING255", "convert"],
    ] as const) {
      const call = lenCalls(decls, body, gvl).find((c) => c.routine.name.startsWith("Standard."))
      expect(call!.routine.name).toBe(`Standard.LEN#STR&=${variant}`)
      expect(call!.routine.inputs).toEqual([])
      expect(call!.invoke.inouts[0]).toMatchObject({ kind: "copy", value: { kind: value } })
    }
    // the cut is the input's: a STRING(300) of 300 'x' counts 255
    const { pou } = lowerSource(program("\twide : STRING(300);\n\ti : INT;\n\tn : INT;\n", "FOR i := 0 TO 299 DO wide[i] := 120; END_FOR\nn := LEN(wide);\n"), "PLC_PRG", standard())
    const p = run(pou!)
    p.scan()
    expect(p.get("n")).toBe(255n)
  })

  test("a later argument's call that changes nothing leaves the string lent: LEFT(txt, LEN(txt) - 1)", () => {
    const source = program("\ttxt : STRING(10) := 'hello';\n\tres : STRING(255);\n", "res := LEFT(txt, LEN(txt) - 1);\n")
    const { pou, diagnostics } = lowerSource(source, "PLC_PRG", [...standard(), { uri: `${LIBRARY}LEFT.pou`, source: LEFT }])
    expect(diagnostics).toEqual([])
    const left: IrInvoke[] = []
    forEachExpr(pou!.body, (e: IrExpr) => {
      if (e.kind === "invoke" && e.routine.startsWith("STANDARD.LEFT#")) left.push(e)
    })
    expect(left.map((e) => [(e.order ?? []).some((o) => typeof o !== "number"), "kind" in e.inouts[0]!])).toEqual([[false, false]])
    const p = run(pou!)
    p.scan()
    expect(p.get("res")).toBe("hell")
  })

  test("a lent string a later argument's call could change is taken where it is written, and reads what the copy read", () => {
    const cut = "FUNCTION Cut : INT\nVAR_IN_OUT\n\tt : STRING(10);\nEND_VAR\nt[1] := 0;\nCut := 3;\nEND_FUNCTION\n\n"
    const source = `${cut}${program("\ttxt : STRING(10) := 'hello';\n\tres : STRING(255);\n", "res := LEFT(txt, Cut(t := txt));\n")}`
    const { pou, diagnostics } = lowerSource(source, "PLC_PRG", [...standard(), { uri: `${LIBRARY}LEFT.pou`, source: LEFT }])
    expect(diagnostics).toEqual([])
    let frozen = false
    forEachExpr(pou!.body, (e: IrExpr) => {
      if (e.kind === "invoke" && e.routine.startsWith("STANDARD.LEFT#")) frozen = (e.order ?? []).some((o) => typeof o !== "number")
    })
    expect(frozen).toBe(true)
    const p = run(pou!)
    p.scan()
    // the input copy took 'hello' before Cut cut it to 'h'
    expect([p.get("res"), p.get("txt")]).toEqual(["hel", "h"])
  })

  // Gate 7.4c (review + recording `string_input_lent_inout_wider`): a STRING VAR_IN_OUT is bound at its CALLER's capacity —
  // a STRING(12) binds `io : STRING(10)` — and CODESYS's input copy reads it at the DECLARED one: LEN(io) 10, LEFT(io, 20)
  // 'abcdefghij'. Lent as itself, the borrow read all 12 (LEN 12; the interpreter faulted on unit 11 of a STRING(10)); taken
  // where it is written, the freeze's Rust `let __input_copy_1: IecString<10> = *io;` was E0308 (`io` generic over N)
  test("a STRING VAR_IN_OUT is lent as its input copy: read at its declared capacity, a STRING(12) bound to a STRING(10) included", () => {
    const fns =
      "FUNCTION Cut : INT\nVAR_IN_OUT\n\tt : STRING(10);\nEND_VAR\nCut := 20;\nEND_FUNCTION\n\n" +
      "FUNCTION Lent : INT\nVAR_IN_OUT\n\tio : STRING(10);\nEND_VAR\nLent := LEN(io);\nEND_FUNCTION\n\n" +
      "FUNCTION Frozen : STRING(255)\nVAR_IN_OUT\n\tio : STRING(10);\nEND_VAR\nFrozen := LEFT(io, Cut(t := io));\nEND_FUNCTION\n\n"
    const source = `${fns}${program("\tv : STRING(12) := 'abcdefghijkl';\n\tn : INT;\n\tres : STRING(255);\n", "n := Lent(io := v);\nres := Frozen(io := v);\n")}`
    const { pou, diagnostics } = lowerSource(source, "PLC_PRG", [...standard(), { uri: `${LIBRARY}LEFT.pou`, source: LEFT }])
    expect(diagnostics).toEqual([])
    // in each FUNCTION the in-out is lent as a copy at its declared capacity, converted even where the types read alike —
    // LEN's as it is, LEFT's taken where it is written (Cut, written after it, is lent the in-out writable)
    const standardCalls = (fn: string): IrInvoke[] => {
      const out: IrInvoke[] = []
      forEachExpr(pou!.routines.find((r) => r.name === fn)!.body, (e: IrExpr) => {
        if (e.kind === "invoke" && e.routine.startsWith("STANDARD.")) out.push(e)
      })
      return out
    }
    expect(standardCalls("Lent").map((e) => e.inouts[0])).toMatchObject([{ kind: "copy", value: { kind: "convert", type: { length: 10 }, value: { kind: "load", place: { root: "inout" } } } }])
    expect(standardCalls("Frozen").map((e) => (e.order ?? []).find((o) => typeof o !== "number"))).toMatchObject([{ kind: "freeze", value: { kind: "convert", type: { length: 10 } } }])
    const p = run(pou!)
    p.scan()
    expect([p.get("n"), p.get("res")]).toEqual([10n, "abcdefghij"])
  })

  // Gate 7.4c (review): a lent place is bound after the inputs, so an index it faults on was reported AFTER a later
  // argument's fault — the input copy read it, and faulted, where it is written
  test("a lent string that could fault is taken where it is written when a later argument could fault too", () => {
    const lib = [...standard(), { uri: `${LIBRARY}LEFT.pou`, source: LEFT }]
    const decls = "\tarr : ARRAY[0..2] OF STRING(10);\n\ti : INT := 5;\n\tj : INT;\n\tres : STRING(255);\n"
    const faultOf = (body: string): string => {
      const { pou, diagnostics } = lowerSource(program(decls, body), "PLC_PRG", lib)
      expect(diagnostics).toEqual([])
      try {
        run(pou!).scan()
      } catch (e) {
        return e instanceof Error ? e.message : String(e)
      }
      return "no fault"
    }
    expect(faultOf("res := LEFT(arr[i], 10 / j);\n")).toBe("array index 5 is outside its bounds")
    // written after it, the division faults first, as the input copy's order has it
    expect(faultOf("res := LEFT(SIZE := 10 / j, STR := arr[i]);\n")).toBe("division by zero")
    // a later argument that cannot fault leaves it lent
    const { pou } = lowerSource(program(decls, "res := LEFT(arr[i], j);\n"), "PLC_PRG", lib)
    const frozen: boolean[] = []
    forEachExpr(pou!.body, (e: IrExpr) => {
      if (e.kind === "invoke" && e.routine.startsWith("STANDARD.LEFT#")) frozen.push((e.order ?? []).some((o) => typeof o !== "number"))
    })
    expect(frozen).toEqual([false])
  })
})

describe("what a body may not do with a lent input — refused, never a silent copy", () => {
  const codes = (body: string) => lowerSource(program("\ttxt : STRING(10);\n\tn : INT;\n", "n := LEN(txt);\n"), "PLC_PRG", standard(body)).diagnostics.map((d) => d.code)
  const declared = "FUNCTION LEN : INT\nVAR_INPUT\n\tSTR : STRING(255);\nEND_VAR\nVAR\n\tp : POINTER TO STRING(255);\nEND_VAR\n"

  test("write it, or lend it writable", () => {
    expect(codes(`${declared}STR := 'x';\nEND_FUNCTION\n`)).toContain("input-borrow-written")
    expect(codes(`${declared}STR[0] := 65;\nEND_FUNCTION\n`)).toContain("input-borrow-written")
  })

  test("take its address", () => {
    expect(codes(`${declared}p := ADR(STR);\nEND_FUNCTION\n`)).toContain("input-borrow-written")
  })
})
