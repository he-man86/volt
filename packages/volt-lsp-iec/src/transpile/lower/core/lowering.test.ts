/**
 * Model state kept beside the frame (`frameState`) and beside the POU's shared state (`sharedState`): what the
 * `Lowering` fields and `Shared` fields it replaced were — created empty with their owner, one per owner, never shared
 * with another (task 1.6.21).
 */
import { describe, expect, test } from "bun:test"
import type { Scope } from "../../../frontend/symbols/index.js"
import type { IrAssign } from "../../ir/index.js"
import { lowerSource } from "../index.js"
import { Lowering, frameState } from "./lowering.js"
import { newShared, sharedState } from "./shared.js"

const scope = {} as Scope

test("frameState: one state per frame, created empty at its first use and kept", () => {
  const seen = frameState(() => new Set<string>())
  const a = new Lowering(scope, scope)
  const b = new Lowering(scope, scope, a.shared)
  expect(seen(a).size).toBe(0)
  seen(a).add("X")
  expect(seen(a)).toBe(seen(a))
  expect([...seen(a)]).toEqual(["X"])
  // a second frame over the SAME shared state has its own — as a field of each `Lowering` was its own
  expect(seen(b).size).toBe(0)
})

test("sharedState: one state per POU lowering, the same from every frame that shares it", () => {
  const targets = sharedState(() => new Map<string, number>())
  const a = new Lowering(scope, scope)
  const nested = new Lowering(scope, scope, a.shared)
  const other = new Lowering(scope, scope, newShared())
  targets(a).set("P", 1)
  expect(targets(nested).get("P")).toBe(1)
  expect(targets(nested)).toBe(targets(a))
  expect(targets(other).size).toBe(0)
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
    // `iCount + 1` stored straight back into INT computes in INT (the narrow-arithmetic rule, 7.3.1: the promoted DINT
    // sum, converted back, is the same value) — so the load is the sum's operand, and it is slot 0, not a name.
    const sum = assign.value
    expect(sum.kind).toBe("binary")
    const operand = sum.kind === "binary" ? sum.left : undefined
    expect(operand?.kind === "load" && operand.place.slot).toBe(0)
  })
})

// The refusal names the capacity that did not fold, once per declaration (gate 3c review: it read 'the capacity of
// STRING does not fold here', twice).
test("string-capacity names the capacity expression, once", () => {
  const { diagnostics } = lowerSource("PROGRAM P\nVAR n : INT := 5; x : STRING(n); END_VAR\nx := 'abc';\nEND_PROGRAM\n", "P")
  const refusals = diagnostics.filter((d) => d.code === "string-capacity")
  expect(refusals.map((d) => d.message)).toEqual(["the capacity of STRING(n) does not fold here"])
})
