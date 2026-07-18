/**
 * Scope-nav — the ONE scope-tree navigator (Layer B, B.2). Answers "where is this name?"
 * purely from scope STRUCTURE, independent of the type system (type isolation stays in layer C).
 *
 *   - `lookup`        — bare name, innermost-shadow-wins: walk parents outward, each scope + its
 *                       EXTENDS base chain. Use for go-to-definition.
 *   - `lookupMember`  — a name within one scope + its EXTENDS base chain (member access once you
 *                       already hold the member's owning scope).
 *   - `findChildScope`— a direct child scope by name (GVL block · enum type · namespace · POU),
 *                       the structural step for qualified `A.B` navigation.
 *   - `resolveBareEnumMember` — a bare `Member` reachable because its enum is NOT qualified_only.
 *
 * Case-insensitive (PLC convention).
 */
import type { Span, TopLevel } from "../syntax/index.js"
import { lookupLocal, type Scope, type Symbol } from "./symbol.js"

export interface LookupResult {
  symbol: Symbol
  /** The scope where we found it (innermost match if it shadows). */
  foundIn: Scope
}

/**
 * A name in `scope` + its EXTENDS base chain (cycle-guarded). First match wins. `qualified_only` gvl_vars
 * are skipped: this is UNQUALIFIED resolution (bare `lookup` + struct-member `lookupMember`), and a member
 * of a `{attribute 'qualified_only'}` GVL is reachable ONLY as `GvlName.member` (via `resolveGvlMember`,
 * which uses `lookupLocal` directly). Without this, a qualified-only global leaks into the bare namespace
 * and can shadow a same-named GVL block (the lenze `Mach1` collision → 197 spurious unknown-member FPs).
 */
function lookupInChain(scope: Scope, name: string): LookupResult | undefined {
  const seen = new Set<Scope>()
  let s: Scope | undefined = scope
  while (s !== undefined && !seen.has(s)) {
    seen.add(s)
    const hit = lookupLocal(s, name).find((h) => h.qualifiedOnly !== true)
    if (hit !== undefined) return { symbol: hit, foundIn: s }
    s = s.baseScope
  }
  return undefined
}

/** Walk the parent chain from `start` outward; each scope is checked with its EXTENDS base chain. */
export function lookup(start: Scope, name: string): LookupResult | undefined {
  let cur: Scope | undefined = start
  while (cur !== undefined) {
    const hit = lookupInChain(cur, name)
    if (hit !== undefined) return hit
    cur = cur.parent
  }
  return undefined
}

/** A member name within `scope` + its EXTENDS base chain (does NOT walk outward to parents). */
export function lookupMember(scope: Scope, name: string): Symbol | undefined {
  return lookupInChain(scope, name)?.symbol
}

/**
 * True when `scope` or any of its EXTENDS ancestors names a base that never resolved (`extendsName` set,
 * `baseScope` undefined) — so its inherited-member set is INCOMPLETE. Conservative member/pin checks use
 * this to skip (a member could live in the unresolved base) rather than false-positive.
 */
export function hasUnresolvedBase(scope: Scope): boolean {
  const seen = new Set<Scope>()
  let s: Scope | undefined = scope
  while (s !== undefined && !seen.has(s)) {
    seen.add(s)
    if (s.extendsName !== undefined && s.baseScope === undefined) return true
    s = s.baseScope
  }
  return false
}

/** Direct child scopes of `parent` by name (case-insensitive), via a lazy index. Multiple only on same-name
 *  collisions (rare); the index is rebuilt whenever `children` grows so a mid-build query never goes stale. */
export function childScopesByName(parent: Scope, name: string): Scope[] {
  if (parent._childIndex === undefined || parent._childIndexLen !== parent.children.length) {
    const index = new Map<string, Scope[]>()
    for (const c of parent.children) {
      const key = c.name.toLowerCase()
      const bucket = index.get(key)
      if (bucket !== undefined) bucket.push(c)
      else index.set(key, [c])
    }
    parent._childIndex = index
    parent._childIndexLen = parent.children.length
  }
  return parent._childIndex.get(name.toLowerCase()) ?? []
}

/** A direct child scope of `parent` by name (case-insensitive) — the qualified-navigation step. */
export function findChildScope(parent: Scope, name: string): Scope | undefined {
  return childScopesByName(parent, name)[0]
}

/** Any scope in the project tree by name (case-insensitive), depth-first. */
export function findScopeByName(project: Scope, name: string): Scope | undefined {
  const target = name.toLowerCase()
  const walk = (scope: Scope): Scope | undefined => {
    for (const child of scope.children) {
      if (child.name.toLowerCase() === target) return child
      const inner = walk(child)
      if (inner !== undefined) return inner
    }
    return undefined
  }
  return walk(project)
}

/**
 * The scope for a parsed unit — matched by AST-span IDENTITY (a scope's `span` IS the unit's `span`
 * object, shared at ingest by `makeScope`), which disambiguates same-named methods across FBs. Falls
 * back to a name walk for scopes built independently of the parsed unit (some tests).
 */
export function scopeForUnit(project: Scope, unit: TopLevel): Scope | undefined {
  const bySpan = spanIndex(project).get(unit.span)
  if (bySpan !== undefined) return bySpan
  const name = "name" in unit ? unit.name.text : undefined
  return name !== undefined ? findScopeByName(project, name) : undefined
}

// Called by ~13 checks × every file: a per-call DFS over the project tree (thousands of scopes) made the
// whole diagnostic pass O(files × project) — quadratic. Index span→scope ONCE per project (keyed on root
// identity, like childScopesByName / the data-recursion graph) so `scopeForUnit` is O(1).
const spanIndexCache = new WeakMap<Scope, Map<Span, Scope>>()
function spanIndex(project: Scope): Map<Span, Scope> {
  const cached = spanIndexCache.get(project)
  if (cached !== undefined) return cached
  const index = new Map<Span, Scope>()
  const visit = (scope: Scope): void => {
    for (const child of scope.children) {
      if (child.span !== undefined) index.set(child.span, child)
      visit(child)
    }
  }
  visit(project)
  spanIndexCache.set(project, index)
  return index
}

/**
 * A bare enum member (`StateAutomatic`) reachable because its enum is NOT `{attribute
 * 'qualified_only'}`. Structural + qualified_only-aware, no type inference — hence layer B.
 */
export function resolveBareEnumMember(project: Scope, name: string): Symbol | undefined {
  const target = name.toLowerCase()
  for (const child of project.children) {
    if (child.kind !== "enum" || child.qualifiedOnly === true) continue
    const syms = child.symbols.get(target)
    if (syms !== undefined && syms.length > 0) return syms[0]
  }
  return undefined
}
