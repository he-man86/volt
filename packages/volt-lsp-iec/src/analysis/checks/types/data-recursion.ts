/**
 * data-recursion (C0101 · types/). An FB or struct that contains — directly or transitively — an instance of
 * itself as a member, i.e. an infinite/circular data nesting. CODESYS: "Data Recursion: A->B->A".
 *
 * Composition graph: a node is a project FB/struct type; an edge `A → B` means `A` declares a member whose
 * type is (an array of) `B`. A `POINTER TO`/`REFERENCE TO` member does NOT nest — it's a legal way to break
 * the cycle — so those are excluded. The full graph is built from the project scope (cycles can span files),
 * but a diagnostic is emitted only for the cycle members that live in the CURRENT document, each reporting the
 * cycle path starting at itself.
 *
 * Zero-FP: only member types that resolve to another project FB/struct node create edges (elementary/library/
 * unknown/pointer/qualified types don't), so a graph edge means real value nesting — the corpus (which
 * compiles clean) has no cycles and never fires.
 */
import type { Identifier, TopLevel, TypeExpr } from "../../../syntax/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

interface Node {
  display: string
  edges: string[] // lowercased target node names
}

export function checkDataRecursion(ctx: CheckContext, out: DiagnosticItem[]): void {
  // Build the composition graph from every project FB/struct scope.
  const graph = new Map<string, Node>()
  for (const scope of ctx.project.children) {
    if (scope.kind !== "pou" && scope.kind !== "struct") continue
    const key = scope.name.toLowerCase()
    if (!graph.has(key)) graph.set(key, { display: scope.name, edges: [] })
  }
  for (const scope of ctx.project.children) {
    if (scope.kind !== "pou" && scope.kind !== "struct") continue
    const node = graph.get(scope.name.toLowerCase())!
    for (const syms of scope.symbols.values())
      for (const s of syms) {
        if (s.kind !== "var" && s.kind !== "struct_field") continue
        const target = s.typeExpr && baseTypeName(s.typeExpr)
        if (target !== undefined && graph.has(target)) node.edges.push(target)
      }
  }

  // Emit for each current-document FB/struct that participates in a cycle.
  for (const unit of ctx.parseResult.units) {
    const name = typeUnitName(unit)
    if (name === undefined || !graph.has(name.text.toLowerCase())) continue
    const cycle = findCycle(name.text.toLowerCase(), graph)
    if (cycle === undefined) continue
    out.push({
      severity: "error",
      span: name.span,
      source: SOURCE,
      code: "data-recursion",
      message: ctx.messages.dataRecursion(cycle.map((k) => graph.get(k)!.display).join("->")),
    })
  }
}

/** The base node name a member type nests (drilling arrays); undefined for pointer/reference/qualified/elementary. */
function baseTypeName(t: TypeExpr): string | undefined {
  switch (t.kind) {
    case "named_type":
      return t.qualifiers === undefined || t.qualifiers.length === 0 ? t.name.text.toLowerCase() : undefined
    case "array_type":
      return baseTypeName(t.element)
    default:
      return undefined // pointer_type / reference_type break recursion; string_type carries no node
  }
}

/** A cycle path `[start, …, start]` reachable from `start` (DFS on the current path), or undefined. */
function findCycle(start: string, graph: Map<string, Node>): string[] | undefined {
  const path: string[] = []
  const onPath = new Set<string>()
  const dfs = (n: string): string[] | undefined => {
    if (n === start && path.length > 0) return [...path, start] // returned to start
    if (onPath.has(n)) return undefined // a different cycle not through start — ignore here
    onPath.add(n)
    path.push(n)
    for (const next of graph.get(n)?.edges ?? []) {
      const found = dfs(next)
      if (found !== undefined) return found
    }
    path.pop()
    onPath.delete(n)
    return undefined
  }
  return dfs(start)
}

const STRUCTY = new Set(["struct", "union"])
/** The name identifier of an FB or struct/union type unit (a composition-graph node), else undefined. */
function typeUnitName(unit: TopLevel): Identifier | undefined {
  if (unit.kind === "function_block") return unit.name
  if (unit.kind === "type_decl" && STRUCTY.has(unit.body.kind)) return unit.name
  return undefined
}
