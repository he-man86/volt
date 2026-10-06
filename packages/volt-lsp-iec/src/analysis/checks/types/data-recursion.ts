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
import type { Identifier, TopLevel, TypeExpr } from "../../../frontend/syntax/index.js"
import { childScopesByName, memoByProject, type Scope } from "../../../frontend/symbols/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"

interface Node {
  display: string
  edges: string[] // lowercased target node names
}

/**
 * THE COMPOSITION GRAPH, READ LAZILY — only the part reachable from the types the current document declares.
 *
 * A node is every project-level FB/struct scope under one lower-cased name (the first one's spelling is its display
 * name); its edges are, in project order, each such scope's value-nesting member types that name another node.
 *
 * This was the whole graph, built per project GENERATION: correct, and rebuilt on every rebind — before every fixture
 * of the conformance replay and on every keystroke — at ~4 ms on the fixture project, the costliest check there
 * (measured 2026-10-01). Before THAT it was rebuilt per file (85% of all check time on a 24k-file corpus). Now a
 * scope's member types are read once per Scope object (a scope's symbols are fixed when its file is bound; a rebind
 * makes new scopes), and the node lookup is the project's child-name index, which every rebind already rebuilds.
 */
const memberTargets = new WeakMap<Scope, string[]>()
function targetsOf(scope: Scope): string[] {
  let targets = memberTargets.get(scope)
  if (targets === undefined) {
    targets = []
    for (const syms of scope.symbols.values())
      for (const s of syms) {
        if (s.kind !== "var" && s.kind !== "struct_field") continue
        const target = s.typeExpr && baseTypeName(s.typeExpr)
        if (target !== undefined) targets.push(target)
      }
    memberTargets.set(scope, targets)
  }
  return targets
}

const isNodeScope = (s: Scope): boolean => s.kind === "pou" || s.kind === "struct"

interface Graph {
  has(key: string): boolean
  get(key: string): Node | undefined
}

function lazyGraph(project: Scope): Graph {
  const scopesOf = (key: string): Scope[] => childScopesByName(project, key).filter(isNodeScope)
  const has = (key: string): boolean => childScopesByName(project, key).some(isNodeScope)
  const nodes = new Map<string, Node>()
  const get = (key: string): Node | undefined => {
    const known = nodes.get(key)
    if (known !== undefined) return known
    const scopes = scopesOf(key)
    if (scopes.length === 0) return undefined
    const node: Node = { display: scopes[0]!.name, edges: [] }
    for (const scope of scopes) for (const t of targetsOf(scope)) if (has(t)) node.edges.push(t)
    nodes.set(key, node)
    return node
  }
  return { has, get }
}
/** One lazy view per project generation: the nodes a whole-project pass reads are built once, and a rebind starts empty. */
const graphOf = memoByProject(lazyGraph)

export function checkDataRecursion(ctx: CheckContext, out: DiagnosticItem[]): void {
  const graph = graphOf(ctx.project)

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
      // the IDE prints the type UPPER-CASED, whatever the declaration wrote (conformance `cc4_data_recursion`:
      // "Data recursion: DUT_C4_NODE -> DUT_C4_NODE")
      message: ctx.messages.dataRecursion(cycle.map((k) => graph.get(k)!.display.toUpperCase()).join(" -> ")),
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
function findCycle(start: string, graph: Graph): string[] | undefined {
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
