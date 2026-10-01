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
import { spanContains, type Expr, type Span, type TopLevel } from "../syntax/index.js"
import type { Scope, Symbol } from "./model.js"
import { isLibrarySymbol, lookupLocal } from "./scope.js"
import { pickForAsker } from "./precedence.js"
import { childIndex, memoByProject, spanIndex } from "./cache.js"

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

/** `GVL.field` → the flat project-level `gvl_var` sharing the block's uri, or undefined. Type inference and constant
 *  folding both qualify through it (it lived privately in `infer.ts`). */
export function resolveGvlMember(expr: { base: Expr; member: { name: string } }, scope: Scope, project: Scope): Symbol | undefined {
  if (expr.base.kind !== "ident_expr") return undefined
  const block = lookup(scope, expr.base.name)?.symbol
  if (block?.kind !== "gvl_block") return undefined
  return lookupLocal(project, expr.member.name).find((sym) => sym.kind === "gvl_var" && sym.uri === block.uri)
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
  return childIndex(parent).get(name.toLowerCase()) ?? []
}

/**
 * A direct child scope of `parent` by name (case-insensitive) — the qualified-navigation step.
 *
 * `askerUri` is the file asking. It matters when a name has several candidates, which a project referencing
 * two libraries that export the same element really does have: see `precedence.ts`. Omitting it still gives a
 * stable answer (the first by URI) rather than whichever was bound first — but it gives the same answer to
 * every caller, which is only right when nothing is ambiguous.
 */
export function findChildScope(parent: Scope, name: string, askerUri?: string): Scope | undefined {
  const candidates = childScopesByName(parent, name)
  if (candidates.length <= 1) return candidates[0]
  // Ranks are defined against the PROJECT's manifest map; `parent` is the project for every ambiguous case
  // (its children are the top-level units), and a nested parent simply has no library visibility to consult.
  return pickForAsker(parent, candidates, (c) => c.defUri, askerUri)
}

/**
 * Any scope in the project tree by name (case-insensitive) — the FIRST in depth-first pre-order.
 *
 * Indexed once per project generation. It was a full walk per call: ~17 ms on a 120k-scope corpus project, called by two
 * checks for every IMPLEMENTS/EXTENDS of every FB and by `scopeForUnit` for every GVL and DUT (which never has a span
 * entry) — 3.2 s of pro2193's 4.9 s diagnostic pass, and ~130 ms of every keystroke on its largest FB (2026-10-01).
 * Every mutation of the tree ends in `invalidate(project)`, which is what the generation memo checks. A scope that is not
 * a project root has no generation of its own, so it is still walked.
 */
export function findScopeByName(project: Scope, name: string): Scope | undefined {
  if (project.parent === undefined) return scopesByName(project).get(name.toLowerCase())
  return walkForScope(project, name.toLowerCase())
}

const scopesByName = memoByProject((project: Scope): Map<string, Scope> => {
  // Merged from each top-level scope's own subtree index, in child order — the same pre-order first match. A subtree's
  // index is kept by the scope's identity: an edit rebinds only its own file's scopes (new objects), so after one the
  // rebuild re-walks that file and merges the rest (~33 ms -> a few on pro2193's 120k scopes).
  const index = new Map<string, Scope>()
  for (const child of project.children)
    for (const [key, scope] of subtreeIndex(child)) if (!index.has(key)) index.set(key, scope)
  return index
})

/** `top` and everything under it by lower-cased name, first in pre-order. */
const subtrees = new WeakMap<Scope, { size: number; index: Map<string, Scope> }>()
function subtreeIndex(top: Scope): Map<string, Scope> {
  const hit = subtrees.get(top)
  // A top-level scope's subtree is complete when it is bound; the one scope that gains children afterwards is a library
  // namespace (`bindLibraryNamespaces` fills it right after `makeScope`), so a changed child count rebuilds it.
  if (hit !== undefined && hit.size === top.children.length) return hit.index
  const index = new Map<string, Scope>([[top.name.toLowerCase(), top]])
  const visit = (scope: Scope): void => {
    for (const child of scope.children) {
      const key = child.name.toLowerCase()
      if (!index.has(key)) index.set(key, child)
      visit(child)
    }
  }
  visit(top)
  subtrees.set(top, { size: top.children.length, index })
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
// diagnostic pass O(files × project) — quadratic. `cache.ts` indexes span→scope ONCE per project generation, and
// `bindFile`/`unbindFile` invalidate it on every incremental rebind — without that a stale index misses the rebound
// file's fresh spans and name-walks into a same-named sibling POU's scope (the cross-unit contamination on `didOpen`).
export function scopeForUnit(project: Scope, unit: TopLevel): Scope | undefined {
  const bySpan = spanIndex(project).get(unit.span)
  if (bySpan !== undefined) return bySpan
  const name = "name" in unit ? unit.name.text : undefined
  return name !== undefined ? findScopeByName(project, name) : undefined
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

/** The POU scope `scope` sits in (itself when it is one), walking outward — undefined outside any POU. */
export function enclosingPou(scope: Scope): Scope | undefined {
  let s: Scope | undefined = scope
  while (s !== undefined) {
    if (s.kind === "pou") return s
    s = s.parent
  }
  return undefined
}

/** The project root `scope` hangs off. */
export const rootOf = (scope: Scope): Scope => (scope.parent === undefined ? scope : rootOf(scope.parent))

/**
 * `List.Const` / `Program.Const` — the variable a qualified name reaches through its global variable list or its
 * PROGRAM, or undefined. A library's are not reached: its declarations may be partial (the constant folder reads its
 * value, `const/fold`).
 */
export function resolveQualifiedConst(expr: Extract<Expr, { kind: "member" }>, scope: Scope): Symbol | undefined {
  if (expr.base.kind !== "ident_expr") return undefined
  const project = rootOf(scope)
  const base = lookup(scope, expr.base.name)?.symbol
  if (base === undefined || isLibrarySymbol(base)) return undefined
  const programScope = base.kind === "program" ? findChildScope(project, base.name) : undefined
  const target =
    base.kind === "gvl_block" ? resolveGvlMember(expr, scope, project) : programScope && lookupMember(programScope, expr.member.name)
  return target === undefined || isLibrarySymbol(target) ? undefined : target
}

/**
 * Every symbol a name at `scope` can reach, in the order a lookup meets them: `scope` and its EXTENDS bases, then —
 * `outward` — each enclosing scope with its bases in turn. Duplicates are the caller's to drop (the first one met
 * is the one a lookup answers with). Each base chain is cycle-guarded.
 */
export function* visibleNames(scope: Scope, outward: boolean): Generator<Symbol> {
  for (let s: Scope | undefined = scope; s !== undefined; s = outward ? s.parent : undefined) {
    const seen = new Set<Scope>()
    for (let b: Scope | undefined = s; b !== undefined && !seen.has(b); b = b.baseScope) {
      seen.add(b)
      for (const list of b.symbols.values()) yield* list
    }
  }
}

/**
 * The symbol whose DEFINING identifier span covers `offset` in the document `uri` — a cursor on a declaration. The
 * offset is a position in ONE document, so only what that document declares is searched: its project-level symbols
 * (tagged by `uri`) and its own scope subtrees (project children tagged by `defUri`). Walking the whole project tree
 * was an O(project) tax on the go-to-definition hot path, and a document-local offset can fall inside another file's
 * span.
 */
export function symbolDefinedAt(project: Scope, uri: string, offset: number): Symbol | undefined {
  for (const syms of project.symbols.values())
    for (const s of syms) if (s.uri === uri && spanContains(s.span, offset)) return s
  const walk = (scope: Scope): Symbol | undefined => {
    for (const syms of scope.symbols.values()) for (const s of syms) if (spanContains(s.span, offset)) return s
    for (const child of scope.children) {
      const inner = walk(child)
      if (inner !== undefined) return inner
    }
    return undefined
  }
  for (const child of project.children)
    if (child.defUri === uri) {
      const found = walk(child)
      if (found !== undefined) return found
    }
  return undefined
}
