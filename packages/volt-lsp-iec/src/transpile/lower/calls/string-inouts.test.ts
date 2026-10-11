/**
 * A STRING VAR_IN_OUT bound wider than it declares (transpile-restructure 8.2, step 8e): the caller's buffer seen through
 * its declared capacity — the variant, the view's reads, its stores, and what is refused. The values are the recordings'
 * (`string_inout_wider_*`, `wstring_inout_wider`, `string_inout_narrower`); `test/conformance` holds both backends to them.
 */
import { describe, expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { emitRust } from "../../emit/rust/index.js"
import type { IrExpr, IrRoutine, IrStmt } from "../../ir/index.js"
import { forEachExpr } from "../../ir/walk.js"
import { lowerSource } from "../index.js"

const program = (decls: string, body: string): string => `PROGRAM PLC_PRG\nVAR\n${decls}END_VAR\n${body}END_PROGRAM\n`
/** A FUNCTION `name` returning `ret`, with one `io : STRING(10)` in-out (and `inputs`), whose body is `body`. */
const fn = (name: string, ret: string, body: string, inputs = ""): string =>
  `FUNCTION ${name} : ${ret}\n${inputs === "" ? "" : `VAR_INPUT\n${inputs}END_VAR\n`}VAR_IN_OUT\n\tio : STRING(10);\nEND_VAR\n${body}END_FUNCTION\n\n`

function lowered(source: string) {
  const { pou, diagnostics } = lowerSource(source, "PLC_PRG")
  expect(diagnostics).toEqual([])
  return pou!
}

const routine = (pou: { routines: readonly IrRoutine[] }, name: string): IrRoutine => pou.routines.find((r) => r.name === name)!
const length = (t: { kind: string; length?: number } | undefined): number | undefined => (t?.kind === "elementary" ? t.length : undefined)

describe("the view: a variant per bound capacity", () => {
  const source =
    fn("F_Unit", "BYTE", "F_Unit := io[k];\n", "\tk : INT;\n") +
    fn("F_Copy", "STRING(20)", "F_Copy := io;\n") +
    fn("F_Same", "BOOL", "F_Same := io = 'abcdefghij';\n") +
    fn("F_Size", "DINT", "F_Size := SIZEOF(io);\n") +
    program(
      "\tv : STRING(12) := 'abcdefghijkl';\n\town : STRING(10) := 'abcdefghij';\n\tk : INT := 11;\n\tunit11 : BYTE;\n\tcopied : STRING(20);\n\tsame : BOOL;\n\tsize : DINT;\n\townCopy : STRING(20);\n",
      "unit11 := F_Unit(k := k, io := v);\ncopied := F_Copy(io := v);\nsame := F_Same(io := v);\nsize := F_Size(io := v);\nownCopy := F_Copy(io := own);\n",
    )

  test("bound wider, the routine is lowered for the caller's capacity: the slot holds it, reads and SIZEOF the declared", () => {
    const pou = lowered(source)
    expect(routine(pou, "F_Copy#IO@=STRING12").inouts.map((s) => [length(s.type), length(s.readAs), length(s.declared)])).toEqual([[12, 10, 10]])
    // bound at its own capacity, the routine is the one it always was
    expect(routine(pou, "F_Copy").inouts.map((s) => [length(s.type), s.readAs])).toEqual([[10, undefined]])
  })

  test("the interpreter: unit 11 is the caller's, a copy and SIZEOF the declared, a comparison in place (recorded)", () => {
    const p = run(lowered(source))
    p.scan()
    expect([p.get("unit11"), p.get("copied"), p.get("same"), p.get("size"), p.get("ownCopy")]).toEqual([108n, "abcdefghij", false, 11n, "abcdefghij"])
  })

  test("a comparison's operand is the load itself; every other read the view's copy", () => {
    const pou = lowered(source)
    const reads: string[] = []
    for (const name of ["F_Same#IO@=STRING12", "F_Copy#IO@=STRING12"])
      forEachExpr(routine(pou, name).body, (e: IrExpr) => {
        if (e.kind === "binary" && e.op === "eq") reads.push(`${name} eq ${e.left.kind}`)
        if (e.kind === "convert" && e.value.kind === "load" && e.value.place.root === "inout") reads.push(`${name} convert`)
      })
    expect(reads).toEqual(["F_Same#IO@=STRING12 eq load", "F_Copy#IO@=STRING12 convert"])
  })

  test("the Rust: the variant prints apart, its copy `io.to::<10>()`, its comparison on the caller's units", () => {
    const code = emitRust(lowered(source)).code
    expect(code.match(/pub fn f_copy\w*<const N_IO: usize>\(io: &mut IecString<N_IO>\)/g)).toHaveLength(2)
    expect(code).toContain("io.to::<10>()")
    expect(code).toMatch(/pub fn f_same\w*<const N_IO: usize>\(io: &mut IecString<N_IO>\) -> bool \{\n {4}io\.units\(\) == b"abcdefghij"/)
  })
})

describe("a whole store through the view writes within the declared capacity", () => {
  const source =
    fn("F_Store", "BOOL", "io := 'XYZXYZXYZXYZXYZ';\nF_Store := TRUE;\n") +
    fn("F_SetUnit", "BOOL", "io[k] := 81;\nF_SetUnit := TRUE;\n", "\tk : INT;\n") +
    program(
      "\tlong : STRING(12) := 'abcdefghijkl';\n\tunitSet : STRING(12) := 'abcdefghijkl';\n\tk : INT := 11;\n\tlong10 : BYTE;\n\tlong11 : BYTE;\n\tok : BOOL;\n",
      "ok := F_Store(io := long);\nok := F_SetUnit(k := k, io := unitSet);\nlong10 := long[10];\nlong11 := long[11];\n",
    )

  test("the store's target is typed at the declared capacity; `io[k] :=` at the caller's", () => {
    const pou = lowered(source)
    const targets = (name: string): (number | undefined)[] =>
      routine(pou, name).body.flatMap((s: IrStmt) => (s.kind === "assign" && s.target.root === "inout" ? [length(s.target.type)] : []))
    expect([targets("F_Store#IO@=STRING12"), targets("F_SetUnit#IO@=STRING12")]).toEqual([[10], [12]])
  })

  test("the interpreter: 'XYZXYZXYZX', a 0 at [10], the caller's 'l' at [11]; io[11] := 81 the caller's (recorded)", () => {
    const p = run(lowered(source))
    p.scan()
    expect([p.get("long"), p.get("long10"), p.get("long11"), p.get("unitSet")]).toEqual(["XYZXYZXYZX", 0n, 108n, "abcdefghijkQ"])
  })

  test("the Rust: `store_within::<10, _>`, printed on demand; `set_char` on the caller's buffer", () => {
    const code = emitRust(lowered(source)).code
    // the literal is typed at the target's capacity, as any store types it — min(15, 10) units either way
    expect(code).toContain("io.store_within::<10, _>(&IecString::<10>::lit(")
    expect(code).toContain("pub fn store_within<const D: usize, const M: usize>")
    expect(code).toContain("io.set_char(i64::from(k), 81u8);")
    expect(emitRust(lowered(program("\ttxt : STRING(10);\n", "txt := 'ab';\n"))).code).not.toContain("store_within")
  })
})

describe("refused by name", () => {
  const codes = (source: string): string[] => lowerSource(source, "PLC_PRG").diagnostics.map((d) => d.code)

  test("narrower does not build (`string_inout_narrower`): call-inout-short — a CONSTANT one is read as it is", () => {
    expect(codes(fn("F_Copy", "STRING(20)", "F_Copy := io;\n") + program("\tv : STRING(4) := 'abcd';\n\tc : STRING(20);\n", "c := F_Copy(io := v);\n"))).toEqual(["call-inout-short"])
    const constant = "FUNCTION F_Width : INT\nVAR_IN_OUT CONSTANT\n\ttext : STRING;\nEND_VAR\nF_Width := 1;\nEND_FUNCTION\n\n"
    expect(codes(constant + program("\tv : STRING(12) := 'abc';\n\tn : INT;\n", "n := F_Width(text := v);\n"))).toEqual([])
  })

  test("an FB's string in-out bound wider: call-inout-capacity (its one body serves every instance)", () => {
    const block = "FUNCTION_BLOCK FB_Io\nVAR_IN_OUT\n\tio : STRING(10);\nEND_VAR\nVAR_OUTPUT\n\tn : BYTE;\nEND_VAR\nn := io[0];\nEND_FUNCTION_BLOCK\n\n"
    expect(codes(block + program("\tv : STRING(12) := 'abcdefghijkl';\n\tf : FB_Io;\n", "f(io := v);\n"))).toEqual(["call-inout-capacity"])
  })
})
