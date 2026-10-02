/**
 * THE INDICES OVER A SCOPE TREE, AND WHEN THEY GO STALE — one home (openspec frontend-conformance design.md §3.3
 * "cache invalidation"). Nothing here is data: every index answers exactly what a walk of the tree would. A file bound
 * into or unbound from a project, or a reorder of its children, must `invalidate` it.
 *
 *   child index   name → children, for `childScopesByName`; LAZY under any scope but a project root
 *   generation    bumped on every invalidation — the one signal a cache keyed on the project can check
 *                 (`memoByProject`): an incremental re-index keeps the SAME Scope object.
 *
 * TWO INDICES OF A PROJECT ROOT ARE KEPT rather than rebuilt per generation, because a rebind must cost the file and not
 * the project (openspec frontend-conformance 2.P.2; on pro2193's 7.5k top-level and 120k scopes the rebuilds were 8 ms
 * and 1.5 ms of every keystroke, 2026-10-02):
 *
 *   span index    unit span → scope, for `scopeForUnit` — a scope enters as `makeScope` creates it, a top-level subtree
 *                 leaves as `unbindFile` drops it
 *   child index   of the project — a top-level scope enters its bucket as it is made (appended: the bucket stays in
 *                 child order), leaves as it is unbound, and moves as `canonicalize` moves it (`placedTopLevel`)
 *
 * They are kept by the ONLY three things that change a project's children — `makeScope`, `unbindFile`, `canonicalize` —
 * and a kept child index that disagrees with the children in size throws: it would mean a fourth.
 *
 * The library visibility map (`libVisible`) is not a cache: `linkExtends` publishes it from the manifests and
 * `precedence.ts` reads it; it lives here only so no scope carries a field nobody declared in the model.
 */
import type { Span } from "../syntax/index.js"
import type { Scope } from "./model.js"

interface ScopeCache {
  childIndex?: Map<string, Scope[]>
  childIndexLen?: number
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
 * The scope's children changed — drop every lazy index built over them (a length check cannot see a same-count swap)
 * and bump the generation. A project root's kept indices stay: the change itself kept them current.
 */
export function invalidate(scope: Scope): void {
  const c = cacheOf(scope)
  if (scope.kind !== "project") {
    c.childIndex = undefined
    c.childIndexLen = undefined
  }
  c.generation += 1
}

/** How many times this scope has been invalidated — the key a project-wide memo checks. */
export function generationOf(scope: Scope): number {
  return caches.get(scope)?.generation ?? 0
}

/** Direct children of `parent` by lower-cased name, in child order. Under any scope but a project root, a lazy index
 *  rebuilt whenever `children` grows (so a mid-build query never goes stale) or the scope was invalidated. */
export function childIndex(parent: Scope): Map<string, Scope[]> {
  const c = cacheOf(parent)
  if (parent.kind === "project" && c.childIndex !== undefined) {
    if (c.childIndexLen !== parent.children.length)
      throw new Error(
        `the project's child index holds ${c.childIndexLen} scopes and the project ${parent.children.length}: its children changed outside makeScope / unbindFile / canonicalize`,
      )
    return c.childIndex
  }
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

/** Every scope under each project root by the span it was built from — kept (see the header). */
const spanIndexes = new WeakMap<Scope, Map<Span, Scope>>()
/** Each project root's top-level scopes appended since its last `canonicalize` — a suffix of its children, in order. */
const appendedTopLevel = new WeakMap<Scope, Scope[]>()

/** Every scope under `project` by the span it was built from. */
export function spanIndex(project: Scope): ReadonlyMap<Span, Scope> {
  return spanIndexes.get(project) ?? new Map()
}

/** `scope` was just made and appended to its parent's children (`makeScope`). */
export function entered(scope: Scope): void {
  let root = scope
  while (root.parent !== undefined) root = root.parent
  if (root.kind !== "project") return
  if (scope.span !== undefined) {
    let index = spanIndexes.get(root)
    if (index === undefined) spanIndexes.set(root, (index = new Map()))
    index.set(scope.span, scope)
  }
  if (scope.parent !== root) return
  let appended = appendedTopLevel.get(root)
  if (appended === undefined) appendedTopLevel.set(root, (appended = []))
  appended.push(scope)
  const c = cacheOf(root)
  if (c.childIndex !== undefined) {
    // a new bucket array rather than a push: a caller may still hold the old one
    const key = scope.name.toLowerCase()
    c.childIndex.set(key, [...(c.childIndex.get(key) ?? []), scope])
    c.childIndexLen! += 1
  }
}

/** Top-level `top` and its subtree were taken out of `project`'s children (`unbindFile`). */
export function left(project: Scope, top: Scope): void {
  const index = spanIndexes.get(project)
  if (index !== undefined) {
    const visit = (scope: Scope): void => {
      if (scope.span !== undefined && index.get(scope.span) === scope) index.delete(scope.span)
      for (const child of scope.children) visit(child)
    }
    visit(top)
  }
  const appended = appendedTopLevel.get(project)
  const at = appended?.lastIndexOf(top) ?? -1
  if (at >= 0) appended!.splice(at, 1)
  const c = cacheOf(project)
  if (c.childIndex !== undefined) {
    const key = top.name.toLowerCase()
    const bucket = c.childIndex.get(key)!.filter((s) => s !== top)
    if (bucket.length === 0) c.childIndex.delete(key)
    else c.childIndex.set(key, bucket)
    c.childIndexLen! -= 1
  }
}

/** The top-level scopes appended since the last call — the suffix `canonicalize` has to place — forgotten as handed over. */
export function takeAppended(project: Scope): Scope[] {
  const appended = appendedTopLevel.get(project) ?? []
  appendedTopLevel.set(project, [])
  return appended
}

/**
 * `canonicalize` moved top-level scopes: `moved` were each re-inserted in `byPlace` order (after every scope that sorts
 * equal), or — `"all"` — the children were sorted whole. The child index follows: each moved scope goes where the same
 * insertion puts it in its bucket, which is in child order already; a whole sort rebuilds it.
 */
export function placedTopLevel(
  project: Scope,
  moved: readonly Scope[] | "all",
  byPlace: (a: Scope, b: Scope) => number,
): void {
  const c = cacheOf(project)
  if (c.childIndex === undefined) return
  if (moved === "all") {
    c.childIndex = undefined
    c.childIndexLen = undefined
    return
  }
  const index = c.childIndex
  for (const scope of moved) {
    const key = scope.name.toLowerCase()
    index.set(key, index.get(key)!.filter((s) => s !== scope))
  }
  for (const scope of moved) {
    const key = scope.name.toLowerCase()
    const bucket = [...index.get(key)!]
    let lo = 0
    let hi = bucket.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (byPlace(bucket[mid], scope) <= 0) lo = mid + 1
      else hi = mid
    }
    bucket.splice(lo, 0, scope)
    index.set(key, bucket)
  }
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
