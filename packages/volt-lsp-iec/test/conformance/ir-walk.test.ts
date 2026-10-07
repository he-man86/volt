/**
 * `ir/walk.ts` `holdsCall` and `callsIn`, rebuilt on the exhaustive `childrenOf` (transpile-restructure 1.2.3; `callsIn`
 * at gate 1.5c-1.6d), answer what the reflective walks they replaced answered — `holdsCall` on every expression and
 * statement, `callsIn` on every body, of every lowered fixture's IR.
 */
import { expect, test } from "bun:test"
import { type IrPou, lowerSource } from "../../src/transpile/index.js"
import { callsIn, forEachExpr, forEachStmt, holdsCall, type IrNode } from "../../src/transpile/ir/walk.js"
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
    let pou: IrPou | undefined
    try {
      const { source, gvls } = assembleFixture(t, ALL_TESTS)
      pou = lowerSource(source, "PLC_PRG", gvls, undefined, PROJECT_BASE).pou
    } catch {
      continue // a fixture lowering cannot read is the snapshot's to report, not this walk's
    }
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
