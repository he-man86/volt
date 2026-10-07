/**
 * `ir/walk.ts` (transpile-restructure 1.2.3): `childrenOf` is total over every node kind and names exactly what each
 * holds; the walks built on it. (That the new `holdsCall` equals the old reflective one on every lowered fixture's IR is
 * `test/conformance/ir-walk.test.ts`: the fixtures are under `test/`, which `src/` does not import.)
 */
import { describe, expect, test } from "bun:test"
import { elementaryRef } from "../../frontend/types/index.js"
import type { IrCopy, IrExpr, IrFreeze, IrInvoke, Place } from "./expr.js"
import type { IrLoop, IrStmt } from "./stmt.js"
import { blocksOf, childrenOf, exitsAfter, forEachExpr, forEachStmt, holdsCall, type IrNode, loopUses, mapPlaces, somePlace } from "./walk.js"

const INT = elementaryRef("INT")
const span = { uri: "f", start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } as never
const c = (value: bigint): IrExpr => ({ kind: "const", value, type: INT, span })
const place = (slot: number, ...index: IrExpr[]): Place => ({ slot, path: index.map((i) => ({ kind: "index" as const, index: i, lower: 0n })), type: INT, span })
const load = (p: Place): IrExpr => ({ kind: "load", place: p, type: INT, span })
const invoke = (...inputs: IrExpr[]): IrInvoke => ({ kind: "invoke", routine: "F", inputs, inouts: [], type: INT, span })
const freeze: IrFreeze = { kind: "freeze", temp: place(9), value: c(9n) }
const copy: IrCopy = { kind: "copy", value: c(8n), type: INT, back: place(8), span }
const assign = (target: Place, value: IrExpr): IrStmt => ({ kind: "assign", target, value, span })
const loop = (body: IrStmt[]): IrLoop => ({ kind: "loop", init: [], test: { cond: c(1n), atEnd: false }, body, step: [], span })

/** One node of every kind the IR has, with what `childrenOf` must answer for it. */
const KINDS: Record<string, [IrNode, IrNode[]]> = {
  place: [place(0, c(1n)), [c(1n)]],
  const: [c(1n), []],
  fresh: [{ kind: "fresh", init: 0n, type: INT, span }, []],
  load: [load(place(0)), [place(0)]],
  binary: [{ kind: "binary", op: "add", left: c(1n), right: c(2n), type: INT, span }, [c(1n), c(2n)]],
  unary: [{ kind: "unary", op: "neg", operand: c(1n), type: INT, span }, [c(1n)]],
  convert: [{ kind: "convert", value: c(1n), type: INT, span }, [c(1n)]],
  builtin: [{ kind: "builtin", name: "max", args: [c(1n), c(2n)], type: INT, span }, [c(1n), c(2n)]],
  invoke: [
    { ...invoke(c(1n)), instance: place(3), order: [0, freeze], inouts: [copy], lent: [place(4)] },
    [place(3), c(1n), freeze, copy, place(4)],
  ],
  dispatch: [{ kind: "dispatch", tag: c(1n), arms: [{ tag: 1n, call: invoke() }], type: INT, span }, [c(1n), invoke()]],
  select: [{ kind: "select", tag: c(1n), arms: [{ tag: 1n, place: place(5) }], type: INT, span }, [c(1n), place(5)]],
  freeze: [freeze, [place(9), c(9n)]],
  copy: [copy, [c(8n), place(8)]],
  assign: [assign(place(0), c(1n)), [place(0), c(1n)]],
  if: [{ kind: "if", cond: c(1n), then: [assign(place(1), c(1n))], else: [assign(place(2), c(2n))], span }, [c(1n), assign(place(1), c(1n)), assign(place(2), c(2n))]],
  switch: [
    { kind: "switch", selector: c(1n), arms: [{ labels: [{ lo: 1n, hi: 1n }], body: [assign(place(1), c(1n))], span }], else: [], span },
    [c(1n), assign(place(1), c(1n))],
  ],
  loop: [{ ...loop([assign(place(1), c(1n))]), init: [assign(place(2), c(2n))] }, [assign(place(2), c(2n)), c(1n), assign(place(1), c(1n))]],
  break: [{ kind: "break", span }, []],
  continue: [{ kind: "continue", span }, []],
  return: [{ kind: "return", span }, []],
  call: [{ kind: "call", instance: place(0), fb: "FB", inouts: [place(6)], bind: { place: place(7), tag: 1n }, span }, [place(0), place(6), place(7)]],
  eval: [{ kind: "eval", value: invoke(), span }, [invoke()]],
}

describe("childrenOf", () => {
  test("is total: every node kind of the IR answers, with exactly what it holds", () => {
    // the kinds of the two unions, the place, and the two binding forms — `never` in the switch makes a new kind a
    // compile error there; this makes forgetting it here a test failure
    expect(Object.keys(KINDS).sort()).toEqual(
      ["assign", "binary", "break", "builtin", "call", "const", "continue", "convert", "copy", "dispatch", "eval", "freeze", "fresh", "if", "invoke", "load", "loop", "place", "return", "select", "switch", "unary"].sort(),
    )
    for (const [kind, [node, children]] of Object.entries(KINDS)) expect([kind, childrenOf(node)]).toEqual([kind, children])
  })
  test("an unknown kind throws by name, never answers empty", () => {
    expect(() => childrenOf({ kind: "mystery", span } as never)).toThrow(/mystery/)
  })
})

describe("the walks", () => {
  const body: IrStmt[] = [assign(place(0, load(place(1))), { ...invoke(load(place(2))), instance: place(3) }), { kind: "return", span }]
  test("forEachExpr and forEachStmt visit pre-order, the root included", () => {
    const exprs: string[] = []
    forEachExpr(body, (e) => exprs.push(e.kind))
    expect(exprs).toEqual(["load", "invoke", "load"])
    const stmts: string[] = []
    forEachStmt([loop([...body])], (s) => stmts.push(s.kind))
    expect(stmts).toEqual(["loop", "assign", "return"])
  })
  test("somePlace reaches an index's place and an instance", () => {
    expect(somePlace(body, (p) => p.slot === 1)).toBe(true)
    expect(somePlace(body, (p) => p.slot === 3)).toBe(true)
    expect(somePlace(body, (p) => p.slot === 42)).toBe(false)
  })
  test("holdsCall: an invoke, a dispatch or an FB call, at any depth; a statement list too", () => {
    expect(holdsCall(body)).toBe(true)
    expect(holdsCall(KINDS.call![0])).toBe(true)
    expect(holdsCall(KINDS.dispatch![0])).toBe(true)
    expect(holdsCall([assign(place(0), c(1n))])).toBe(false)
    expect(holdsCall(load(place(0, KINDS.invoke![0] as IrExpr)))).toBe(true)
  })
  test("mapPlaces rewrites every place, innermost first, and copies the rest", () => {
    const seen: number[] = []
    const out = mapPlaces(body[0]!, (p) => (seen.push(p.slot), { ...p, slot: p.slot + 10 }))
    expect(seen).toEqual([1, 0, 3, 2]) // childrenOf's order: an invoke's instance before its inputs
    expect(out).toEqual(assign(place(10, load(place(11))), { ...invoke(load(place(12))), instance: place(13) }))
    expect(body[0]).toEqual(assign(place(0, load(place(1))), { ...invoke(load(place(2))), instance: place(3) }))
  })
  test("blocksOf, exitsAfter and loopUses", () => {
    expect(blocksOf(KINDS.if![0] as IrStmt)).toHaveLength(2)
    expect(exitsAfter(body)).toBe(false)
    expect(exitsAfter([{ kind: "if", cond: c(1n), then: [{ kind: "return", span }, assign(place(0), c(1n))], else: [], span }])).toBe(true)
    const inner = loop([{ kind: "break", span }])
    expect(loopUses(loop([inner]))).toEqual({ exits: false, continues: false })
    expect(loopUses(loop([{ kind: "if", cond: c(1n), then: [{ kind: "continue", span }], else: [{ kind: "break", span }], span }]))).toEqual({
      exits: true,
      continues: true,
    })
  })
})
