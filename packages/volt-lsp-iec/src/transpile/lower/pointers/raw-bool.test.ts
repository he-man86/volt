/**
 * A BOOL held as its byte (transpile-restructure 8.2, `raw-bool.ts`): which BOOLs are raw, what each measured operator
 * answers on the bytes 2, 3 and 255 (`bool_byte_ops`, `bool_byte_two_through_pointer`, record:exec 2026-10-11), and what
 * stays refused `bool-byte` by name. Both backends read a BOOL's byte as `<> 0` before, so `b = TRUE` was TRUE for a 2.
 */
import { describe, expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { emitRust } from "../../emit/rust/index.js"
import { lowerSource } from "../index.js"

const codes = (src: string, name = "P"): string[] => lowerSource(src, name).diagnostics.map((d) => d.code)

/** Lower and run one scan of `P`, then read `names`. */
function scan(src: string, names: readonly string[]): unknown[] {
  const { pou, diagnostics } = lowerSource(src, "P")
  expect(diagnostics).toEqual([])
  const r = run(pou!)
  r.scan()
  return names.map((n) => r.get(n))
}

/** A program over a BOOL `b` whose byte `k` a POINTER TO BYTE wrote, `body` after it. */
const over = (k: number, vars: string, body: string): string =>
  `PROGRAM P\nVAR b : BOOL; pb : POINTER TO BYTE; t : BOOL := TRUE; f : BOOL; ${vars} END_VAR\npb := ADR(b);\npb^ := ${k};\n${body}\nEND_PROGRAM\n`

describe("a BOOL whose address a POINTER TO BYTE holds is held as its byte, every measured operator on the byte", () => {
  test("AND / OR / XOR are the bytes' — 2 AND TRUE is 0, 2 OR FALSE 2, 255 XOR TRUE 254", () => {
    const vars = "a : BYTE; o : BYTE; x : BYTE; res : BOOL; pr : POINTER TO BYTE;"
    const body = "pr := ADR(res);\nres := b AND t; a := pr^;\nres := b OR f; o := pr^;\nres := b XOR t; x := pr^;"
    expect(scan(over(2, vars, body), ["a", "o", "x"])).toEqual([0n, 2n, 3n])
    expect(scan(over(255, vars, body), ["a", "o", "x"])).toEqual([1n, 255n, 254n])
  })

  test("NOT is bit 0 inverted, the rest cleared; = and <> compare the bytes; IF takes any byte but 0", () => {
    const vars = "n : BOOL; eqT : BOOL; neF : BOOL; taken : BOOL;"
    const body = "n := NOT b; eqT := b = TRUE; neF := b <> FALSE;\nIF b THEN taken := TRUE; END_IF"
    expect(scan(over(2, vars, body), ["n", "eqT", "neF", "taken"])).toEqual([true, false, true, true])
    expect(scan(over(3, vars, body), ["n", "eqT", "neF", "taken"])).toEqual([false, false, true, true])
  })

  test("BOOL_TO_INT and BOOL_TO_BYTE are bit 0", () => {
    const vars = "i : INT; y : BYTE;"
    expect(scan(over(2, vars, "i := BOOL_TO_INT(b); y := BOOL_TO_BYTE(b);"), ["i", "y"])).toEqual([0n, 0n])
    expect(scan(over(3, vars, "i := BOOL_TO_INT(b); y := BOOL_TO_BYTE(b);"), ["i", "y"])).toEqual([1n, 1n])
  })

  test("a copy keeps the byte — the copy is held as its byte too — and so does a FUNCTION's input", () => {
    const src =
      "FUNCTION F_Eq : BOOL\nVAR_INPUT x : BOOL; END_VAR\nF_Eq := x = TRUE;\nEND_FUNCTION\n" +
      over(2, "c : BOOL; cEqT : BOOL; cNot : BOOL; fEqT : BOOL;", "c := b; cEqT := c = TRUE; cNot := NOT c; fEqT := F_Eq(x := b);")
    expect(scan(src, ["cEqT", "cNot", "fEqT"])).toEqual([false, true, false])
    const { pou } = lowerSource(src, "P")
    expect(pou!.slots.filter((s) => s.rawBool === true).map((s) => s.name)).toEqual(["b", "c"])
    expect(pou!.routines.find((r) => r.name === "F_Eq")!.locals.filter((s) => s.rawBool === true).map((s) => s.name)).toEqual(["x"])
  })

  test("the emitted Rust holds it as a u8 and acts on the byte", () => {
    const { pou } = lowerSource(over(2, "eqT : BOOL; n : BOOL;", "eqT := b = TRUE; n := NOT b;"), "P")
    const code = emitRust(pou!).code
    expect(code).toContain("self.eq_t = u8::from_le_bytes(__mem.ld(0x1_0000_0000)) == 1u8;")
    expect(code).toContain("self.n = u8::from_le_bytes(__mem.ld(0x1_0000_0000)) & 1u8 == 0u8;")
  })

  test("a BOOL given to a POINTER TO BOOL stays a BOOL", () => {
    const { pou } = lowerSource("PROGRAM P\nVAR b : BOOL; p : POINTER TO BOOL; END_VAR\np := ADR(b);\np^ := TRUE;\nEND_PROGRAM\n", "P")
    expect(pou!.slots.some((s) => s.rawBool === true)).toBe(false)
  })
})

describe("a raw BOOL's byte read where its meaning is unmeasured is refused bool-byte", () => {
  test("a WHILE condition, an order, an unmeasured conversion, a SEL", () => {
    expect(codes(over(2, "n : INT;", "WHILE b DO n := n + 1; b := FALSE; END_WHILE"))).toEqual(["bool-byte"])
    expect(codes(over(2, "ordered : BOOL;", "ordered := b < t;"))).toEqual(["bool-byte"])
    expect(codes(over(2, "d : DINT;", "d := BOOL_TO_DINT(b);"))).toEqual(["bool-byte"])
    expect(codes(over(2, "pick : INT;", "pick := SEL(b, 1, 2);"))).toEqual(["bool-byte"])
  })

  test("a store into what no variable key names — an element", () => {
    expect(codes(over(2, "arr : ARRAY[0..1] OF BOOL;", "arr[0] := b;"))).toEqual(["bool-byte"])
  })

  test("what holds a BOOL given to a pointer that views it as laid out is no refusal: its element's type, or BOOL", () => {
    const dut = "TYPE S_B :\nSTRUCT\n\tflag : BOOL;\n\tn : INT;\nEND_STRUCT\nEND_TYPE\n"
    // `ADR(arr)` into a POINTER TO the element (bakon-nano's `I_dataArray := ADR(g_aCuttingPositions)`)
    const element = `${dut}PROGRAM P\nVAR arr : ARRAY[0..2] OF S_B; ps : POINTER TO S_B; seen : INT; END_VAR\nps := ADR(arr);\nps^.n := 7;\nseen := arr[0].n;\nEND_PROGRAM\n`
    expect(codes(element).filter((c) => c === "bool-byte")).toEqual([])
    // a POINTER TO BOOL stores 0 or 1 (lenze-mid's `startUDT := ADR(SafetyStatusUDT_Location)`)
    const bools = "TYPE S_Bits :\nSTRUCT\n\ta : BOOL;\n\tb : BOOL;\nEND_STRUCT\nEND_TYPE\nPROGRAM P\nVAR sv : S_Bits; pb : POINTER TO BOOL; END_VAR\npb := ADR(sv);\npb^ := TRUE;\nEND_PROGRAM\n"
    expect(codes(bools).filter((c) => c === "bool-byte")).toEqual([])
  })

  test("the address of what holds a BOOL given to a pointer of another type", () => {
    const src = "TYPE S_B :\nSTRUCT\n\tflag : BOOL;\n\tn : INT;\nEND_STRUCT\nEND_TYPE\nPROGRAM P\nVAR sv : S_B; pb : POINTER TO BYTE; END_VAR\npb := ADR(sv);\npb^ := 2;\nEND_PROGRAM\n"
    expect(codes(src)).toEqual(["bool-byte"])
  })
})

// gate 8c (review of step 8c): the flows and views the step lowered without a recording, recorded first (record:exec
// 2026-10-11, `bool_byte_flow_*`, `bool_pointer_over_bytes`, `bool_pointer_copied_to_byte_pointer`,
// `byte_pointer_copied_to_bool_pointer`): every one keeps the byte, as `c := b` does.
describe("an FB's input, a VAR_IN_OUT, MOVE and an ANY input carry the byte (bool_byte_flow_*)", () => {
  const q = "FUNCTION_BLOCK Q\nVAR_INPUT x : BOOL; END_VAR\nVAR_OUTPUT isT : BOOL; nx : BOOL; xInt : INT; END_VAR\nisT := x = TRUE;\nnx := NOT x;\nxInt := BOOL_TO_INT(x);\nEND_FUNCTION_BLOCK\n"
  const outs = ["q1.isT", "q1.nx", "q1.xInt"]
  test("an FB's VAR_INPUT, in the call and stored from outside", () => {
    expect(scan(q + over(2, "q1 : Q;", "q1(x := b);"), outs)).toEqual([false, true, 0n])
    expect(scan(q + over(255, "q1 : Q;", "q1(x := b);"), outs)).toEqual([false, false, 1n])
    expect(scan(q + over(255, "q1 : Q;", "q1.x := b;\nq1();"), outs)).toEqual([false, false, 1n])
  })

  test("a FUNCTION's VAR_IN_OUT and MOVE", () => {
    const io = "FUNCTION G : INT\nVAR_IN_OUT x : BOOL; END_VAR\nG := BOOL_TO_INT(x);\nIF x = TRUE THEN G := G + 10; END_IF\nEND_FUNCTION\n"
    expect(scan(io + over(255, "gi : INT;", "gi := G(x := b);"), ["gi"])).toEqual([1n])
    expect(scan(io + over(2, "gi : INT;", "gi := G(x := b);"), ["gi"])).toEqual([0n])
    expect(scan(over(2, "c : BOOL; isT : BOOL; nx : BOOL;", "c := MOVE(b);\nisT := c = TRUE;\nnx := NOT c;"), ["isT", "nx"])).toEqual([false, true])
  })

  test("an ANY input whose pValue a POINTER TO BYTE writes", () => {
    const set = "FUNCTION W : BOOL\nVAR_INPUT v : ANY; k : BYTE; END_VAR\nVAR p : POINTER TO BYTE; END_VAR\np := v.pValue;\np^ := k;\nW := TRUE;\nEND_FUNCTION\n"
    const src = `${set}PROGRAM P\nVAR b : BOOL; ok : BOOL; isT : BOOL; nx : BOOL; xInt : INT; END_VAR\nok := W(v := b, k := 255);\nisT := b = TRUE;\nnx := NOT b;\nxInt := BOOL_TO_INT(b);\nEND_PROGRAM\n`
    expect(scan(src, ["isT", "nx", "xInt"])).toEqual([false, false, 1n])
  })
})

describe("a POINTER TO BOOL over what is no BOOL's byte reads the byte (bool_pointer_over_bytes)", () => {
  const view = (decl: string, of: string): string =>
    `PROGRAM P\nVAR ${decl} p : POINTER TO BOOL; pr : POINTER TO BYTE; isT : BOOL; nx : BOOL; xInt : INT; taken : BOOL; c : BOOL; cByte : BYTE; END_VAR\n` +
    `p := ADR(${of});\nisT := p^ = TRUE;\nnx := NOT p^;\nxInt := BOOL_TO_INT(p^);\nIF p^ THEN taken := TRUE; END_IF\nc := p^;\npr := ADR(c);\ncByte := pr^;\nEND_PROGRAM\n`
  const read = ["isT", "nx", "xInt", "taken", "cByte"]
  test("a BYTE 2 and 255, a WORD 16#0205, an ARRAY OF BYTE [2, 0]", () => {
    expect(scan(view("y : BYTE := 2;", "y"), read)).toEqual([false, true, 0n, true, 2n])
    expect(scan(view("y : BYTE := 255;", "y"), read)).toEqual([false, false, 1n, true, 255n])
    expect(scan(view("w : WORD := 16#0205;", "w"), read)).toEqual([false, false, 1n, true, 5n])
    expect(scan(view("arr : ARRAY[0..1] OF BYTE := [2, 0];", "arr"), read)).toEqual([false, true, 0n, true, 2n])
  })

  test("a copy without an address of its own keeps the byte too", () => {
    const src = "PROGRAM P\nVAR y : BYTE := 2; p : POINTER TO BOOL; c : BOOL; isT : BOOL; END_VAR\np := ADR(y);\nc := p^;\nisT := c = TRUE;\nEND_PROGRAM\n"
    expect(scan(src, ["isT"])).toEqual([false])
  })

  test("a store through one writes a BOOL's 0 or 1, or a raw BOOL's byte", () => {
    const src = over(2, "y : BYTE := 7; z : BYTE := 7; p : POINTER TO BOOL;", "p := ADR(y);\np^ := TRUE;\np := ADR(z);\np^ := b;")
    expect(scan(src, ["y", "z"])).toEqual([1n, 2n])
  })
})

describe("a pointer copied across BOOL and another type is the pointer it is copied into (bool_pointer_copied_*)", () => {
  test("a POINTER TO BOOL copied into a POINTER TO BYTE: the BOOL is held as its byte", () => {
    const src = "PROGRAM P\nVAR b : BOOL; pbo : POINTER TO BOOL; pby : POINTER TO BYTE; isT : BOOL; nx : BOOL; xInt : INT; raw : BYTE; END_VAR\npbo := ADR(b);\npby := pbo;\npby^ := 2;\nisT := b = TRUE;\nnx := NOT b;\nxInt := BOOL_TO_INT(b);\nraw := pby^;\nEND_PROGRAM\n"
    expect(scan(src, ["isT", "nx", "xInt", "raw"])).toEqual([false, true, 0n, 2n])
  })

  test("a POINTER TO BYTE copied into a POINTER TO BOOL reads the byte", () => {
    const src = "PROGRAM P\nVAR y : BYTE := 2; pby : POINTER TO BYTE; pbo : POINTER TO BOOL; isT : BOOL; nx : BOOL; xInt : INT; END_VAR\npby := ADR(y);\npbo := pby;\nisT := pbo^ = TRUE;\nnx := NOT pbo^;\nxInt := BOOL_TO_INT(pbo^);\nEND_PROGRAM\n"
    expect(scan(src, ["isT", "nx", "xInt"])).toEqual([false, true, 0n])
  })
})

describe("a BOOL byte no key can follow is refused bool-byte (gate 8c)", () => {
  const dut = "TYPE S_B :\nSTRUCT\n\tflag : BOOL;\n\tn : INT;\nEND_STRUCT\nEND_TYPE\n"
  test("a POINTER TO what holds a BOOL, over other bytes", () => {
    expect(codes("PROGRAM P\nVAR d : DWORD := 16#0205; pa : POINTER TO ARRAY[0..3] OF BOOL; f : BOOL; END_VAR\npa := ADR(d);\nf := pa^[0];\nEND_PROGRAM\n")).toEqual(["bool-byte"])
  })

  test("an element's BOOL address copied into a POINTER TO BYTE", () => {
    expect(codes("PROGRAM P\nVAR arr : ARRAY[0..1] OF BOOL; pbo : POINTER TO BOOL; pby : POINTER TO BYTE; END_VAR\npbo := ADR(arr[0]);\npby := pbo;\npby^ := 2;\nEND_PROGRAM\n")).toEqual(["bool-byte"])
  })

  test("a POINTER TO a struct holding a BOOL copied into a POINTER TO BYTE", () => {
    expect(codes(`${dut}PROGRAM P\nVAR sv : S_B; ps : POINTER TO S_B; pby : POINTER TO BYTE; END_VAR\nps := ADR(sv);\npby := ps;\npby^ := 2;\nEND_PROGRAM\n`)).toEqual(["bool-byte"])
  })
})
