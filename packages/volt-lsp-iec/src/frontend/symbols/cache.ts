/**
 * THE LAZY INDICES OVER A SCOPE TREE, AND WHEN THEY GO STALE — one home (openspec frontend-conformance design.md §3.3
 * "cache invalidation"). Nothing here is data: every index is rebuilt from the tree on demand, so dropping one only
 * costs the rebuild. A file bound into or unbound from a project, or a reorder of its children, must `invalidate` it.
 *
 *   child index   name → children, for `childScopesByName` (the project root has thousands of children)
 *   span index    unit span → scope, for `scopeForUnit` (project root only)
 *   generation    bumped on every invalidation — the one signal a cache keyed on the project can check
 *                 (`memoByProject`): an incremental re-index keeps the SAME Scope object.
 *
 * The library visibility map (`libVisible`) is not a cache: `linkExtends` publishes it from the manifests and
 * `precedence.ts` reads it; it lives here only so no scope carries a field nobody declared in the model.
 */
import type { Span } from "../syntax/index.js"
import type { Scope } from "./model.js"

interface ScopeCache {
  childIndex?: Map<string, Scope[]>
  childIndexLen?: number
  spanIndex?: Map<Span, Scope>
  generation: number
}

const caches = new WeakMap<Scope, ScopeCache>()
const libVisibles = new WeakMap<Scope, Map<string, Set<string>>>()

function cacheOf(scope: Scope): ScopeCache {
  let c = caches.get(scope)
  if (c === undefined) caches.set(scope, (c = { generation: 0 }))
  return c
}

/**
 * The scope's children changed — drop every lazy index built over them (a length check cannot see a same-count swap,
 * and a stale span index makes `scopeForUnit` name-walk into a same-named sibling's member) and bump the generation.
 */
export function invalidate(scope: Scope): void {
  const c = cacheOf(scope)
  c.childIndex = undefined
  c.childIndexLen = undefined
  c.spanIndex = undefined
  c.generation += 1
}

/** How many times this scope has been invalidated — the key a project-wide memo checks. */
function generationOf(scope: Scope): number {
  return caches.get(scope)?.generation ?? 0
}

/** Direct children of `parent` by lower-cased name, via a lazy index rebuilt whenever `children` grows (so a
 *  mid-build query never goes stale) or the scope was invalidated. */
export function childIndex(parent: Scope): Map<string, Scope[]> {
  const c = cacheOf(parent)
  if (c.childIndex === undefined || c.childIndexLen !== parent.children.length) {
    const index = new Map<string, Scope[]>()
    for (const child of parent.children) {
      const key = child.name.toLowerCase()
      const bucket = index.get(key)
      if (bucket !== undefined) bucket.push(child)
      else index.set(key, [child])
    }
    c.childIndex = index
    c.childIndexLen = parent.children.length
  }
  return c.childIndex
}

/** Every scope under `project` by the span it was built from — built once per project generation. */
export function spanIndex(project: Scope): Map<Span, Scope> {
  const c = cacheOf(project)
  if (c.spanIndex !== undefined) return c.spanIndex
  const index = new Map<Span, Scope>()
  const visit = (scope: Scope): void => {
    for (const child of scope.children) {
      if (child.span !== undefined) index.set(child.span, child)
      visit(child)
    }
  }
  visit(project)
  return (c.spanIndex = index)
}

/** Library folder → the folders that library can SEE (itself + its manifest's DEPENDENCIES), as `linkExtends`
 *  published it on the PROJECT; undefined when the workspace has no library manifests. */
export function libVisibleOf(project: Scope): Map<string, Set<string>> | undefined {
  return libVisibles.get(project)
}

/** Publish (or, with an empty map, withdraw) the project's library visibility map. */
export function setLibVisible(project: Scope, visible: Map<string, Set<string>>): void {
  if (visible.size > 0) libVisibles.set(project, visible)
  else libVisibles.delete(project)
}

/**
 * A value computed from a whole PROJECT, remembered until the project changes — per Scope, and per generation, so an
 * incremental re-index (`bindFile` / `unbindFile` on the same Scope) recomputes it. Two checks cached on the Scope
 * alone, and in the live LSP both answered for the project as it was before the edit: a data recursion an edit
 * introduced went unreported, and a GVL an edit added was never counted ambiguous.
 */
export function memoByProject<T>(build: (project: Scope) => T): (project: Scope) => T {
  const cache = new WeakMap<Scope, { generation: number; value: T }>()
  return (project) => {
    const generation = generationOf(project)
    const hit = cache.get(project)
    if (hit !== undefined && hit.generation === generation) return hit.value
    const value = build(project)
    cache.set(project, { generation, value })
    return value
  }
}
