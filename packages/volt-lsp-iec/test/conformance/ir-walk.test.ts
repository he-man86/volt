/**
 * `ir/walk.ts` `holdsCall` and `callsIn`, rebuilt on the exhaustive `childrenOf` (transpile-restructure 1.2.3; `callsIn`
 * at gate 1.5c-1.6d), answer what the reflective walks they replaced answered — `holdsCall` on every expression and
 * statement, `callsIn` on every body, of every lowered fixture's IR.
 */
import { expect, test } from "bun:test"
import { type IrExpr, type IrInvoke, type IrPou, lowerSource, type Place } from "../../src/transpile/index.js"
import {
  callsIn,
  findPlace,
  forEachExpr,
  forEachStmt,
  holdsCall,
  initReadChildren,
  type IrNode,
  mapPlaces,
  touchesOnlyItsOwn,
  writesOnlyLocals,
} from "../../src/transpile/ir/walk.js"
import { ALL_TESTS } from "./fixtures/index.js"
import { assembleFixture } from "./support/fixture-units.js"
import { PROJECT_BASE } from "./support/project-libraries.js"

/** The walk `holdsCall` was until 1.2.3, kept verbatim as this test's oracle. */
function reflectiveHoldsCall(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(reflectiveHoldsCall)
  if (node === null || typeof node !== "object") return false
  const kind = (node as { kind?: string }).kind
  if (kind === "invoke" || kind === "dispatch" || kind === "call") return true
  return Object.entries(node).some(([key, child]) => key !== "type" && key !== "span" && key !== "of" && reflectiveHoldsCall(child))
}

/** The walk `callsIn` was until gate 1.5c-1.6d (`lower/interfaces.ts`, then `ir/walk.ts`), kept verbatim as this test's
 *  oracle. */
function reflectiveCallsIn(node: unknown, out: unknown[] = []): unknown[] {
  if (Array.isArray(node)) {
    for (const child of node) reflectiveCallsIn(child, out)
    return out
  }
  if (node === null || typeof node !== "object") return out
  const kind = (node as { kind?: string }).kind
  if (kind === "call" || kind === "invoke") out.push(node)
  for (const [key, child] of Object.entries(node)) if (key !== "type" && key !== "of" && key !== "span" && key !== "lent") reflectiveCallsIn(child, out)
  return out
}

const bodies = (pou: IrPou): (readonly IrNode[])[] => [
  pou.body,
  pou.init ?? [],
  ...pou.routines.map((r) => r.body),
  ...pou.layouts.map((l) => l.body ?? []),
]

test("holdsCall and callsIn answer as the reflective walks did, on every lowered fixture", () => {
  let lowered = 0
  let nodes = 0
  const differ: string[] = []
  for (const t of ALL_TESTS) {
    // lowering is total: a fixture that throws fails this test by name, never drops out of the comparison
    const { source, gvls } = assembleFixture(t, ALL_TESTS)
    const pou = lowerSource(source, "PLC_PRG", gvls, undefined, PROJECT_BASE).pou
    if (pou === undefined) continue
    lowered += 1
    for (const body of bodies(pou)) {
      const check = (n: IrNode): void => {
        nodes += 1
        if (holdsCall(n) !== reflectiveHoldsCall(n)) differ.push(`${t.name}: ${"kind" in n ? n.kind : "place"}`)
      }
      forEachStmt(body, check)
      forEachExpr(body, check)
      if (holdsCall(body) !== reflectiveHoldsCall(body)) differ.push(`${t.name}: a body`)
      const calls = callsIn(body)
      const reflective = reflectiveCallsIn(body)
      if (calls.length !== reflective.length || calls.some((n, i) => n !== reflective[i])) differ.push(`${t.name}: callsIn`)
    }
  }
  expect(differ).toEqual([])
  expect(lowered).toBeGreaterThan(3000)
  expect(nodes).toBeGreaterThan(10000)
})

// ── task 1.7.4: the last reflective IR walks of lower/, each kept verbatim as its oracle ──

/** `calls/reentrancy.ts` `touchesOnlyItsOwn` until 1.7.4. */
function reflectiveTouchesOnlyItsOwn(node: unknown): boolean {
  if (Array.isArray(node)) return node.every(reflectiveTouchesOnlyItsOwn)
  if (node === null || typeof node !== "object") return true
  const n = node as { kind?: string; slot?: unknown; path?: unknown; root?: string; guard?: unknown }
  if (n.kind === "invoke" || n.kind === "dispatch" || n.kind === "call") return false
  if (typeof n.slot === "number" && Array.isArray(n.path) && (n.guard !== undefined || (n.root !== "local" && n.root !== "inout"))) return false
  return Object.entries(node).every(([key, child]) => key === "type" || key === "of" || key === "span" || reflectiveTouchesOnlyItsOwn(child))
}

/** `calls/reentrancy.ts` `writesOnlyLocals` until 1.7.4. */
function reflectiveWritesOnlyLocals(node: unknown): boolean {
  if (Array.isArray(node)) return node.every(reflectiveWritesOnlyLocals)
  if (node === null || typeof node !== "object") return true
  const n = node as { kind?: string; target?: Place }
  if (n.kind === "invoke" || n.kind === "dispatch" || n.kind === "call") return false
  if (n.kind === "assign" && n.target?.root !== "local") return false
  return Object.entries(node).every(([key, child]) => key === "type" || key === "of" || key === "span" || reflectiveWritesOnlyLocals(child))
}

/** `calls/specialize.ts` `mapPlaces` until 1.7.4. */
function reflectiveMapPlaces<T>(node: T, f: (p: Place) => Place): T {
  const isPlaceLike = (n: object): n is Place => typeof (n as { slot?: unknown }).slot === "number" && Array.isArray((n as { path?: unknown }).path)
  if (Array.isArray(node)) return node.map((child) => reflectiveMapPlaces(child, f)) as unknown as T
  if (node === null || typeof node !== "object") return node
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(node)) out[key] = key === "type" || key === "span" || key === "of" ? child : reflectiveMapPlaces(child, f)
  return (isPlaceLike(node) ? f(out as unknown as Place) : out) as unknown as T
}

/** `init/sequence.ts` `reads` (with `readsInvoke`, `readsPlace`) until 1.7.4. */
function handReads(e: IrExpr, onPlace: (place: Place) => string | undefined): string | undefined {
  const walk = (x: IrExpr): string | undefined => handReads(x, onPlace)
  const first = (xs: readonly IrExpr[]): string | undefined => xs.reduce<string | undefined>((f, x) => f ?? walk(x), undefined)
  const readsPlace = (place: Place): string | undefined => {
    for (const access of place.path)
      if (access.kind === "index") {
        const inside = handReads(access.index, onPlace)
        if (inside !== undefined) return inside
      }
    if (place.guard !== undefined) {
      const through = readsPlace(place.guard)
      if (through !== undefined) return through
    }
    return onPlace(place)
  }
  const readsInvoke = (x: IrInvoke): string | undefined => {
    const inputs = x.inputs.reduce<string | undefined>((f, i) => f ?? handReads(i, onPlace), undefined)
    if (inputs !== undefined) return inputs
    const bound = x.inouts.reduce<string | undefined>((f, io) => f ?? ("kind" in io && io.kind === "copy" ? handReads(io.value, onPlace) : readsPlace(io as Place)), undefined)
    if (bound !== undefined) return bound
    return x.instance === undefined ? undefined : readsPlace(x.instance)
  }
  switch (e.kind) {
    case "load":
      return readsPlace(e.place)
    case "convert":
      return walk(e.value)
    case "unary":
      return walk(e.operand)
    case "binary":
      return walk(e.left) ?? walk(e.right)
    case "builtin":
      return first(e.args)
    case "invoke":
      return readsInvoke(e)
    case "dispatch":
      return walk(e.tag) ?? e.arms.reduce<string | undefined>((f, a) => f ?? readsInvoke(a.call), undefined)
    default:
      return undefined
  }
}

/** The order a read walk tests places in: every place it reaches, by its rendering, none answering. */
const visitOrder = (walk: (onPlace: (p: Place) => string | undefined) => unknown): string[] => {
  const seen: string[] = []
  walk((p) => void seen.push(`${p.root ?? ""}:${p.slot}:${p.path.length}:${p.guard === undefined ? "" : "g"}`))
  return seen
}

test("touchesOnlyItsOwn, writesOnlyLocals, mapPlaces and the init read walk answer as the walks they replaced (1.7.4)", () => {
  let lowered = 0
  let exprs = 0
  const differ: string[] = []
  // a rewrite that moves every place, so a place the walk missed shows
  const bump = (p: Place): Place => ({ ...p, slot: p.slot + 1000 })
  for (const t of ALL_TESTS) {
    // lowering is total: a fixture that throws fails this test by name, never drops out of the comparison
    const { source, gvls } = assembleFixture(t, ALL_TESTS)
    const pou = lowerSource(source, "PLC_PRG", gvls, undefined, PROJECT_BASE).pou
    if (pou === undefined) continue
    lowered += 1
    for (const body of bodies(pou)) {
      if (touchesOnlyItsOwn(body) !== reflectiveTouchesOnlyItsOwn(body)) differ.push(`${t.name}: touchesOnlyItsOwn`)
      if (writesOnlyLocals(body) !== reflectiveWritesOnlyLocals(body)) differ.push(`${t.name}: writesOnlyLocals`)
      const mapped = body.map((s) => mapPlaces(s, bump))
      if (!Bun.deepEquals(mapped, reflectiveMapPlaces(body, bump))) differ.push(`${t.name}: mapPlaces`)
      forEachStmt(body, (s) => {
        if (touchesOnlyItsOwn(s) !== reflectiveTouchesOnlyItsOwn(s)) differ.push(`${t.name}: touchesOnlyItsOwn ${s.kind}`)
        if (writesOnlyLocals(s) !== reflectiveWritesOnlyLocals(s)) differ.push(`${t.name}: writesOnlyLocals ${s.kind}`)
      })
      forEachExpr(body, (e) => {
        exprs += 1
        const now = visitOrder((onPlace) => findPlace(e, onPlace, initReadChildren))
        const then = visitOrder((onPlace) => handReads(e, onPlace))
        if (now.join(",") !== then.join(",")) differ.push(`${t.name}: reads ${e.kind}`)
      })
    }
  }
  expect(differ).toEqual([])
  expect(lowered).toBeGreaterThan(3000)
  expect(exprs).toBeGreaterThan(10000)
})
