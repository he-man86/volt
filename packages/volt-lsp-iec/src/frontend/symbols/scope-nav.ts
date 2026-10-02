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
import { childIndex, generationOf, spanIndex } from "./cache.js"

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
    const hit = s.parent === undefined ? projectLevelHit(lookupLocal(s, name)) : lookupLocal(s, name).find(binds)
    if (hit !== undefined) return { symbol: hit, foundIn: s }
    s = s.baseScope
  }
  return undefined
}

/**
 * Whether a declaration below the project's level binds its name. A `qualified_only` list's variable does not (bare);
 * nor does a VAR_EXTERNAL whose global does not exist (rule Y13, `externalGlobal`): both vendors drop it and answer
 * "Identifier 'g' not defined" at every use (`cc2_constant_and_external`, `sym_var_external_qualified_only_global`), so
 * the search goes on past it.
 */
function binds(sym: Symbol): boolean {
  if (sym.qualifiedOnly === true) return false
  return sym.varSection !== "VAR_EXTERNAL" || externalGlobal(rootOf(sym.owner), sym.name) !== undefined
}

/**
 * THE PROJECT'S LEVEL OF THE BARE-NAME SEARCH ORDER (`docs/codesys-reference/09-shadowing.md`, rule Y23): the
 * application's global variables (step 5) and its device-tree instances, then a referenced library's global variables
 * (step 7), then the application's POU and type names — a list's name among them (step 8) — then a library's (step 10),
 * then the library namespaces (step 11). Among one step, the canonical order (`incremental.ts` `canonicalize`).
 * Measured: a global before a FUNCTION of its name, read (`sym_global_before_pou_name` runs the global's 3) and called
 * (`sym_global_before_pou_name_called`: a call of an INT), both vendors 2026-10-02 — the first hit by file order had
 * answered the FUNCTION wherever its file sorted first.
 */
function projectLevelHit(hits: readonly Symbol[]): Symbol | undefined {
  let best: Symbol | undefined
  let bestStep = Infinity
  for (const h of hits) {
    if (h.qualifiedOnly === true) continue
    const step = searchStep(h)
    if (step < bestStep) {
      best = h
      bestStep = step
    }
  }
  return best
}

function searchStep(sym: Symbol): number {
  const library = isLibrarySymbol(sym)
  if (sym.kind === "gvl_var") return library ? 7 : 5
  // No vendor measurement orders a device-tree instance against a global of its name. A device has no type and the global
  // has one, and a `<proj>/Device/...` descriptor sorts before every application file, so a tie at step 5 would hide the
  // typed global behind the untyped device: the device comes after the application's globals, before a library's.
  if (sym.kind === "device") return 6
  if (sym.kind === "namespace") return library ? 11 : 8 // a library's namespace (its manifest's uri), or a source NAMESPACE block
  return library ? 10 : 8
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

/** The symbol kinds a TYPE position can name: a POU (a FUNCTION too, which a check then refuses), an interface, a type. */
const UNIT_SYMBOL_KINDS: ReadonlySet<string> = new Set(["function", "function_block", "program", "interface", "type"])

/**
 * A name in a TYPE position — `inst : POU`, `EXTENDS B`, `IMPLEMENTS I`, an enum type's name — walked outward like `lookup`,
 * but only a POU, interface or type answers it. The bare-name search order (rule Y23, `projectLevelHit`) is an
 * EXPRESSION's: `sym_global_before_pou_name` measured a READ, where a global beats a FUNCTION of its name. A type position
 * names no variable and no device, so a same-named global or device instance must not take the POU or type from it
 * (`inst : POU` beside a global `pou` is still "'POU' is of type FUNCTION and cannot be instantiated"). Among the
 * candidates, the application's before a library's (steps 8, 10), then the canonical order.
 */
export function lookupUnit(start: Scope, name: string): LookupResult | undefined {
  for (let cur: Scope | undefined = start; cur !== undefined; cur = cur.parent) {
    const seen = new Set<Scope>()
    for (let s: Scope | undefined = cur; s !== undefined && !seen.has(s); s = s.baseScope) {
      seen.add(s)
      const hit = projectLevelHit(lookupLocal(s, name).filter((h) => UNIT_SYMBOL_KINDS.has(h.kind)))
      if (hit !== undefined) return { symbol: hit, foundIn: s }
    }
  }
  return undefined
}

/** A member name within `scope` + its EXTENDS base chain (does NOT walk outward to parents). */
export function lookupMember(scope: Scope, name: string): Symbol | undefined {
  return lookupInChain(scope, name)?.symbol
}

/**
 * `.name` — what the GLOBAL namespace holds under the name (rule E33), every local passed over; undefined where TWO of
 * the project's lists declare it bare: `.gAmb` is then "There is no global definition for 'gAmb'", as a name nothing
 * declares is (`expr_global_namespace_ambiguous`, both vendors 2026-10-02 — the bare `gAmb` is "Ambiguous use of name").
 * A library's lists flatten into the project scope and repeat names (ERR_OK), so only the project's are counted, as
 * `analysis/checks/names/ambiguous-global` counts them.
 */
export function lookupGlobal(project: Scope, name: string): Symbol | undefined {
  const found = lookup(project, name)?.symbol
  if (found?.kind !== "gvl_var") return found
  const lists = new Set(
    lookupLocal(project, name)
      .filter((s) => s.kind === "gvl_var" && s.qualifiedOnly !== true && !isLibrarySymbol(s))
      .map((s) => s.uri),
  )
  return lists.size >= 2 ? undefined : found
}

/**
 * The global a `VAR_EXTERNAL` of `name` binds (rule Y13) — a list's variable reachable BARE, a referenced library's
 * included; never a `qualified_only` list's, which is reachable only as `GVL.v` and is no global for VAR_EXTERNAL either
 * ("No global definition found for VAR_EXTERNAL g", `sym_var_external_qualified_only_global`, both vendors 2026-10-02).
 * Undefined when no list declares one. Two lists declaring it is the ambiguity check's to say, not this lookup's.
 */
export function externalGlobal(project: Scope, name: string): Symbol | undefined {
  return lookupLocal(project, name).find((s) => s.kind === "gvl_var" && s.qualifiedOnly !== true)
}

/** `GVL.field` → the flat project-level `gvl_var` sharing the block's uri, or undefined. Type inference and constant
 *  folding both qualify through it (it lived privately in `infer.ts`). `.GVL.field` names the list in the global
 *  namespace only (rule E33): `ARRAY [1...L_MC1P_Constants.gc_Rec_Max]` in a lenze library, `1..` then `.L_MC1P_…`. */
export function resolveGvlMember(expr: { base: Expr; member: { name: string } }, scope: Scope, project: Scope): Symbol | undefined {
  const block = gvlBlockOf(expr.base, scope, project)
  if (block === undefined) return undefined
  return lookupLocal(project, expr.member.name).find((sym) => sym.kind === "gvl_var" && sym.uri === block.uri)
}

/**
 * The global variable list a qualifier names — `GVL` in `GVL.v`, `.GVL` in the global namespace, or `Ns.GVL` inside a
 * library's namespace (`Stu.GVL_UTF8.HALFSHIFT` builds, `sym_library_gvl_qualified_fully`) — or undefined.
 */
export function gvlBlockOf(base: Expr, scope: Scope, project: Scope): Symbol | undefined {
  if (base.kind === "member") {
    const ns = base.base.kind === "ident_expr" ? lookup(scope, base.base.name)?.symbol : undefined
    if (ns?.kind !== "namespace") return undefined
    const nsScope = findChildScope(project, ns.name, scope.defUri)
    return nsScope === undefined ? undefined : lookupLocal(nsScope, base.member.name).find((s) => s.kind === "gvl_block")
  }
  if (base.kind !== "ident_expr" && base.kind !== "global_expr") return undefined
  const block = base.kind === "global_expr" ? lookupGlobal(project, base.name.name) : lookup(scope, base.name)?.symbol
  return block?.kind === "gvl_block" ? block : undefined
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
 * Indexed, and the index kept current per project generation. It was a full walk per call: ~17 ms on a 120k-scope corpus
 * project, called by two checks for every IMPLEMENTS/EXTENDS of every FB and by `scopeForUnit` for every GVL and DUT
 * (which never had a span entry) — 3.2 s of pro2193's 4.9 s diagnostic pass, and ~130 ms of every keystroke on its
 * largest FB (2026-10-01). Every mutation of the tree ends in `invalidate(project)`, which is what the index checks. A
 * scope that is not a project root has no generation of its own, so it is still walked.
 */
export function findScopeByName(project: Scope, name: string): Scope | undefined {
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
  const named = expr.base
  if (named.kind !== "ident_expr" && named.kind !== "global_expr") return undefined
  const project = rootOf(scope)
  // `.List.Const` names the list in the global namespace only (rule E33)
  const base = named.kind === "global_expr" ? lookupGlobal(project, named.name.name) : lookup(scope, named.name)?.symbol
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
