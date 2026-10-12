/**
 * THE SCOPE NAME INDEX — a project's scopes by name (built once, updated incrementally per re-bind), the subtree index
 * under one top scope, and the scope of a parsed unit. Split from `scope-nav.ts` (openspec lsp-same-standard design.md
 * §2.2).
 */
import type { TopLevel } from "../syntax/index.js"
import { generationOf, spanIndex } from "./cache.js"
import type { Scope } from "./model.js"
import { childScopesByName, findChildScope } from "./scope-nav.js"

/**
 * Any scope in the project tree by name (case-insensitive) — the FIRST in depth-first pre-order.
 *
 * Indexed, and the index kept current per project generation. It was a full walk per call: ~17 ms on a 120k-scope corpus
 * project, called by two checks for every IMPLEMENTS/EXTENDS of every FB and by `scopeForUnit` for every GVL and DUT
 * (which never had a span entry) — 3.2 s of pro2193's 4.9 s diagnostic pass, and ~130 ms of every keystroke on its
 * largest FB (2026-10-01). Every mutation of the tree ends in `invalidate(project)`, which is what the index checks. A
 * scope that is not a project root has no generation of its own, so it is still walked.
 */
export function findScopeByName(project: Scope, name: string, askerUri?: string): Scope | undefined {
  // several TOP-LEVEL scopes of the name — two libraries' `I_Thing` — are the asker's to choose between (rule LB3), as
  // `findChildScope` chooses; without an asker, the first in pre-order as ever
  if (askerUri !== undefined && project.parent === undefined && childScopesByName(project, name).length > 1)
    return findChildScope(project, name, askerUri)
  if (project.parent === undefined) return scopesByName(project).get(name.toLowerCase())
  return walkForScope(project, name.toLowerCase())
}

/**
 * The name index, KEPT across generations: each name answers from the first top-level scope (in child order) whose subtree
 * holds it. A generation that only bound and unbound top-level scopes — an edit — re-answers just the names those scopes
 * hold; one that also reordered the survivors (`canonicalize` placing what was appended: once after a build, when the
 * library namespaces move to the front) merges the kept subtree indices afresh. Merging every subtree per generation was
 * 5 ms of each keystroke on pro2193 (2026-10-02).
 */
interface NameIndex {
  generation: number
  /** the top-level scopes, in child order, the index was last brought up to */
  order: Scope[]
  /** each of them → its subtree index as it was taken */
  parts: Map<Scope, Map<string, Scope>>
  /** name → the top-level scope whose subtree holds it, or the several that do */
  holders: Map<string, Scope | Scope[]>
  index: Map<string, Scope>
}
const nameIndexes = new WeakMap<Scope, NameIndex>()

function scopesByName(project: Scope): Map<string, Scope> {
  const generation = generationOf(project)
  let kept = nameIndexes.get(project)
  if (kept?.generation === generation) return kept.index
  if (kept === undefined) nameIndexes.set(project, (kept = buildNameIndex(project)))
  else updateNameIndex(kept, project)
  kept.generation = generation
  return kept.index
}

function buildNameIndex(project: Scope): NameIndex {
  const built: NameIndex = { generation: 0, order: [...project.children], parts: new Map(), holders: new Map(), index: new Map() }
  for (const top of project.children) {
    const part = subtreeIndex(top)
    built.parts.set(top, part)
    for (const [key, scope] of part) {
      if (!built.index.has(key)) built.index.set(key, scope)
      addHolder(built, key, top)
    }
  }
  return built
}

/** Bring `kept` up to the project's children. */
function updateNameIndex(kept: NameIndex, project: Scope): void {
  const children = project.children
  const place = new Map<Scope, number>()
  for (let i = 0; i < children.length; i++) place.set(children[i], i)
  const touched = new Set<string>()
  for (const [top, part] of kept.parts) {
    if (place.has(top) && subtreeIndex(top) === part) continue
    for (const key of part.keys()) {
      touched.add(key)
      dropHolder(kept, key, top)
    }
    kept.parts.delete(top)
  }
  let next = 0
  let reordered = false
  for (const top of children) {
    if (!kept.parts.has(top)) continue
    while (next < kept.order.length && !kept.parts.has(kept.order[next])) next++
    if (kept.order[next] !== top) {
      reordered = true
      break
    }
    next++
  }
  for (const top of children) {
    if (kept.parts.has(top)) continue
    const part = subtreeIndex(top)
    kept.parts.set(top, part)
    for (const key of part.keys()) {
      touched.add(key)
      addHolder(kept, key, top)
    }
  }
  kept.order = [...children]
  if (reordered) {
    // every shared name may have a new first holder — on a real project that is most of them (a library namespace holds
    // its library's names a second time), so they are merged afresh, in child order, as a build does
    kept.index = new Map()
    for (const top of children) for (const [key, scope] of kept.parts.get(top)!) if (!kept.index.has(key)) kept.index.set(key, scope)
    return
  }
  for (const key of touched) {
    const held = kept.holders.get(key)
    let first: Scope | undefined
    if (Array.isArray(held)) {
      for (const top of held) if (first === undefined || place.get(top)! < place.get(first)!) first = top
    } else first = held
    if (first === undefined) kept.index.delete(key)
    else kept.index.set(key, kept.parts.get(first)!.get(key)!)
  }
}

function addHolder(index: NameIndex, key: string, top: Scope): void {
  const held = index.holders.get(key)
  if (held === undefined) index.holders.set(key, top)
  else if (Array.isArray(held)) held.push(top)
  else {
    index.holders.set(key, [held, top])
  }
}

function dropHolder(index: NameIndex, key: string, top: Scope): void {
  const held = index.holders.get(key)
  if (held === top) index.holders.delete(key)
  else if (Array.isArray(held)) {
    const rest = held.filter((s) => s !== top)
    index.holders.set(key, rest.length > 1 ? rest : rest[0])
  }
}

/**
 * `top` and everything under it by lower-cased name, first in pre-order — its OWN subtree: a child whose parent is not the
 * scope holding it is an alias and is not visited.
 *
 * A library namespace's children are exactly that: ALIASES of its library's top-level scopes (`library-namespaces.ts`,
 * nothing reparented), each a project child answering through its own index. Through the namespace they answered a
 * second time — and a library namespace has no file, so it sorts to the front of the project and the alias won a bare
 * name over a project unit of the same name: `IMPLEMENTS I_Foo` checked against the library's `I_Foo`, a false
 * `missing-interface-implementation` (review of frontend-conformance 2.P, 2026-10-02). A qualified `LA.X` resolves
 * through the namespace's children, never through this index. (A source `NAMESPACE` block owns its units: they are
 * visited.)
 */
const subtrees = new WeakMap<Scope, Map<string, Scope>>()
function subtreeIndex(top: Scope): Map<string, Scope> {
  // a top-level scope's own subtree is complete when it is bound (a library namespace gains only aliases afterwards)
  const hit = subtrees.get(top)
  if (hit !== undefined) return hit
  const index = new Map<string, Scope>([[top.name.toLowerCase(), top]])
  const visit = (scope: Scope): void => {
    for (const child of scope.children) {
      if (child.parent !== scope) continue
      const key = child.name.toLowerCase()
      if (!index.has(key)) index.set(key, child)
      visit(child)
    }
  }
  visit(top)
  subtrees.set(top, index)
  return index
}

function walkForScope(scope: Scope, target: string): Scope | undefined {
  for (const child of scope.children) {
    if (child.name.toLowerCase() === target) return child
    const inner = walkForScope(child, target)
    if (inner !== undefined) return inner
  }
  return undefined
}

/**
 * The scope for a parsed unit — matched by AST-span IDENTITY (a scope's `span` IS the unit's `span`
 * object, shared at ingest by `makeScope`), which disambiguates same-named methods across FBs. Falls
 * back to a name walk for scopes built independently of the parsed unit (some tests).
 */
// Called by ~13 checks × every file: a per-call DFS over the project tree (thousands of scopes) made the whole
// diagnostic pass O(files × project) — quadratic. `cache.ts` keeps a span→scope index current through every bind and
// unbind — a stale one missed the rebound file's fresh spans and name-walked into a same-named sibling POU's scope (the
// cross-unit contamination on `didOpen`).
//
// A unit that owns no scope has none: a DUT that is an alias or refused defines its symbol on the project itself
// (`binder.ts`), and the name fallback answered it with whatever scope shared its name — a method named like the alias.
// (A GVL owns no scope either, and carries no name to fall back on.)
export function scopeForUnit(project: Scope, unit: TopLevel): Scope | undefined {
  const bySpan = spanIndex(project).get(unit.span)
  if (bySpan !== undefined) return bySpan
  if (unit.kind === "type_decl" && (unit.body.kind === "alias" || unit.body.kind === "refused")) return undefined
  const name = "name" in unit ? unit.name.text : undefined
  return name !== undefined ? findScopeByName(project, name) : undefined
}
