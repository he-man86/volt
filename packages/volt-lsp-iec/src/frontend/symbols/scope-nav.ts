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
 *   - `resolveBareEnumMember` — a bare `Member` reachable because its enum is NOT qualified_only, the asker's own
 *                       enums first; two declaring it make the name ambiguous.
 *
 * Case-insensitive (PLC convention).
 */
import { spanContains } from "../syntax/index.js"
import type { Scope, Symbol } from "./model.js"
import { isLibrarySymbol, lookupLocal } from "./scope.js"
import { isLibraryAsker, libraryRank, pickForAsker, scopeUri } from "./precedence.js"
import { childIndex } from "./cache.js"
import { ancestry } from "./extends.js"

interface LookupResult {
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
function lookupInChain(scope: Scope, name: string, askerUri: string | undefined, temps: TempReach = "all"): LookupResult | undefined {
  // an INTERFACE inherits from each base of its EXTENDS list (rule H4): the whole ancestry, nearest first
  if (scope.interfaceBases !== undefined) {
    for (const s of ancestry(scope)) {
      const hit = lookupLocal(s, name).find(binds)
      if (hit !== undefined) return { symbol: hit, foundIn: s }
    }
    return undefined
  }
  const seen = new Set<Scope>()
  let s: Scope | undefined = scope
  while (s !== undefined && !seen.has(s)) {
    seen.add(s)
    const hit =
      s.parent === undefined
        ? projectLevelHit(s, lookupLocal(s, name), askerUri)
        : s.libraryUri !== undefined
          ? namespaceHit(s, s.libraryUri, lookupLocal(s, name).filter(binds))
          : lookupLocal(s, name).find((h) => binds(h) && reaches(h, temps, s === scope))
    if (hit !== undefined) return { symbol: hit, foundIn: s }
    s = s.baseScope
  }
  return undefined
}

/**
 * WHICH VAR_TEMP A BARE NAME REACHES on a scope and its EXTENDS chain: `all` (a member path, `inst.x` / `THIS^.x`, which
 * the checks judge themselves), `own` (the scope's own, not a base's — a derived FB's body naming its base's VAR_TEMP is
 * "Identifier 'scratch' not defined" on both vendors, `var_temp_named_in_derived_body`), or `none` (from a METHOD of the
 * FB: "Identifier 'scratch' not defined", `var_temp_named_in_method`). A VAR_TEMP is storage of its own body's run.
 * An ACTION reaches its FB's own (both vendors compile it, `var_temp_named_in_action`); a PROPERTY accessor's reach is not
 * recorded, so it keeps the FB's own — an unrecorded refusal would be a false positive.
 */
type TempReach = "all" | "own" | "none"

function reaches(sym: Symbol, temps: TempReach, own: boolean): boolean {
  return sym.varSection !== "VAR_TEMP" || temps === "all" || (temps === "own" && own)
}

/** The VAR_TEMP a bare name written in `child` reaches on its parent: none from a METHOD, the FB's own from anything else. */
function parentTemps(child: Scope): TempReach {
  const parent = child.parent
  const method = child.kind === "method" && parent !== undefined && lookupLocal(parent, child.name).some((h) => h.kind === "method")
  return method ? "none" : "own"
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
function projectLevelHit(project: Scope, hits: readonly Symbol[], askerUri: string | undefined): Symbol | undefined {
  let best: Symbol[] = []
  let bestStep = Infinity
  // A LIBRARY asks by library first (rule LB3: own library > dependency > project > other), then by step: the steps above
  // are the APPLICATION's search order. Stepping first handed a library body the application's F_Help (step 8) over its
  // own (step 10), while `resolveTypeExpr`, which ranks every candidate, answered the library's own T for the same name.
  const bound = hits.filter((h) => h.qualifiedOnly !== true)
  const rankFloor = isLibraryAsker(askerUri)
    ? Math.min(...bound.map((h) => libraryRank(project, h.uri, askerUri)))
    : undefined
  for (const h of bound) {
    if (rankFloor !== undefined && libraryRank(project, h.uri, askerUri) !== rankFloor) continue
    const step = searchStep(h)
    if (step < bestStep) [best, bestStep] = [[h], step]
    else if (step === bestStep) best.push(h)
  }
  // AMONG ONE STEP, WHO IS ASKING (rules LB3, LB6, `precedence.ts`): a library's own element, then a dependency's, then the
  // URI tiebreak — the canonical order's own answer for project source, where every library ranks alike. It took the first
  // by URI for every asker, so a name written in a library whose folder sorts late meant another library's element:
  // Util's `EERRORID : ERROR` is Util's ERROR, not CAA Device Diagnosis' (`lib_ns_library_member_own_type_other_enum`).
  return pickForAsker(project, best, (h) => h.uri, askerUri)
}

/**
 * A name in a library's NAMESPACE (`Ns.X`), which holds its library's elements and its dependencies' (`library-namespaces`):
 * the library's own first, as a name written in that library would mean it (rule LB3) — `DED.ERROR` is CAA Device
 * Diagnosis' ERROR, not that of CAA Types, a dependency of it whose folder sorts first (`lib_ns_type_qualified_other_library`
 * runs DED's TIME_OUT, CODESYS 2026-10-02).
 */
function namespaceHit(ns: Scope, libraryUri: string, hits: readonly Symbol[]): Symbol | undefined {
  return pickForAsker(rootOf(ns), hits, (h) => h.uri, libraryUri)
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

/** Walk the parent chain from `start` outward; each scope is checked with its EXTENDS base chain. The file `start` sits
 *  in is who asks, where two libraries hold the name (`projectLevelHit`). */
export function lookup(start: Scope, name: string): LookupResult | undefined {
  const askerUri = scopeUri(start)
  let cur: Scope | undefined = start
  let temps: TempReach = "own"
  while (cur !== undefined) {
    const hit = lookupInChain(cur, name, askerUri, temps)
    if (hit !== undefined) return hit
    temps = parentTemps(cur)
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
  const askerUri = scopeUri(start)
  for (let cur: Scope | undefined = start; cur !== undefined; cur = cur.parent) {
    const seen = new Set<Scope>()
    for (let s: Scope | undefined = cur; s !== undefined && !seen.has(s); s = s.baseScope) {
      seen.add(s)
      const hit = projectLevelHit(rootOf(s), lookupLocal(s, name).filter((h) => UNIT_SYMBOL_KINDS.has(h.kind)), askerUri)
      if (hit !== undefined) return { symbol: hit, foundIn: s }
    }
  }
  return undefined
}

/** A member name within `scope` + its EXTENDS base chain (does NOT walk outward to parents). On the project itself,
 *  `askerUri` is who asks (`projectLevelHit`); a library namespace answers its own library first (`namespaceHit`). */
export function lookupMember(scope: Scope, name: string, askerUri: string | undefined = scopeUri(scope)): Symbol | undefined {
  return lookupInChain(scope, name, askerUri)?.symbol
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

/**
 * True when `scope` or any of its EXTENDS ancestors names a base that never resolved (`extendsName` set,
 * `baseScope` undefined) — so its inherited-member set is INCOMPLETE. Conservative member/pin checks use
 * this to skip (a member could live in the unresolved base) rather than false-positive.
 */
export function hasUnresolvedBase(scope: Scope): boolean {
  // an interface's EXTENDS list counts too: a name of it that resolved to nothing has no entry in `interfaceBases`
  return ancestry(scope).some(
    (s) =>
      (s.extendsName !== undefined && s.baseScope === undefined) ||
      (s.interfaceExtends !== undefined && (s.interfaceBases?.length ?? 0) < s.interfaceExtends.length),
  )
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
