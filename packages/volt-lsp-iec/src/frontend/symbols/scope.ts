/**
 * SCOPES, MADE AND READ — the one scope factory, symbol definition, the local lookup and the project root's dialect.
 * The model (`Symbol`, `Scope`) is `model.ts`; the lazy indices over it are `cache.ts`.
 */
import type { CompileEnvironment, Dialect, Span } from "../syntax/index.js"
import { isLibraryUri } from "../library/index.js"
import type { Scope, ScopeKind, Symbol } from "./model.js"
import { entered } from "./cache.js"

export function createProjectScope(dialect: Dialect, environment?: CompileEnvironment): Scope {
  const project: Scope = { kind: "project", name: "(project)", symbols: new Map(), children: [], dialect }
  if (environment !== undefined) project.environment = environment
  return project
}

/** The dialect of a bound PROJECT ROOT. Throws rather than guessing: every caller here has the project scope
 *  `buildSymbolTable` returned, and a scope without one is a scope that never went through it. */
export function dialectOf(project: Scope): Dialect {
  if (project.dialect === undefined) throw new Error("scope carries no dialect — it is not a bound project root")
  return project.dialect
}

/**
 * The ONE scope factory: create a child scope and register it under `parent`. Every ingest*
 * uses this — no ad-hoc scope object literals scattered through the binder.
 */
export function makeScope(
  parent: Scope,
  kind: ScopeKind,
  name: string,
  span: Span,
  extra?: Partial<Pick<Scope, "extendsName" | "qualifiedOnly" | "undeclared">>,
): Scope {
  const scope: Scope = { kind, name, parent, symbols: new Map(), children: [], span, ...extra }
  parent.children.push(scope)
  entered(scope)
  return scope
}

/**
 * A scope that hangs off `parent` for lookups but is NOT one of its children — a scope a consumer builds for its own
 * resolution (a network's wires) and the project must not see.
 */
export function localScope(parent: Scope, kind: ScopeKind, name: string, span: Span): Scope {
  return { kind, name, parent, symbols: new Map(), children: [], span }
}

export function defineSymbol(scope: Scope, sym: Symbol): void {
  const key = sym.name.toLowerCase()
  const existing = scope.symbols.get(key)
  if (existing !== undefined) existing.push(sym)
  else scope.symbols.set(key, [sym])
  if (scope.kind === "project") {
    let book = projectKeys.get(scope)
    if (book === undefined) projectKeys.set(scope, (book = { byUri: new Map(), unsorted: new Set() }))
    let keys = book.byUri.get(sym.uri)
    if (keys === undefined) book.byUri.set(sym.uri, (keys = new Set()))
    keys.add(key)
    book.unsorted.add(key)
  }
}

/**
 * Two facts about a PROJECT ROOT's symbol table, kept as symbols are defined so a rebind costs the file and not the
 * project (measured 2026-10-01 on pro2193's 11k keys: filtering every key 1.5 ms, re-sorting every array ~4 ms):
 *   byUri     which keys each uri has defined — `unbindFile` visits a file's own keys
 *   unsorted  which keys gained a symbol since the last canonical sort — `relink` sorts only those (an unbind filters,
 *             which keeps an array's order)
 * Every project symbol is defined through `defineSymbol`; nothing else writes `project.symbols` but `unbindFile` itself.
 */
const projectKeys = new WeakMap<Scope, { byUri: Map<string, Set<string>>; unsorted: Set<string> }>()

/** The keys that gained a symbol since the last call, forgotten as they are handed over — the caller sorts them. */
export function takeUnsortedKeys(project: Scope): ReadonlySet<string> {
  const book = projectKeys.get(project)
  if (book === undefined) return new Set()
  const keys = book.unsorted
  book.unsorted = new Set()
  return keys
}

/** The keys `uri` defined on `project`, forgotten as they are handed over — the caller is removing them. */
export function takeProjectKeys(project: Scope, uri: string): ReadonlySet<string> {
  const byUri = projectKeys.get(project)?.byUri
  const keys = byUri?.get(uri)
  byUri?.delete(uri)
  return keys ?? new Set()
}

/** Look up by exact name (case-insensitive), THIS scope only — does NOT walk parents or EXTENDS. */
export function lookupLocal(scope: Scope, name: string): Symbol[] {
  return scope.symbols.get(name.toLowerCase()) ?? []
}

/**
 * True when a symbol comes from a referenced-library SIGNATURE (a `Library Manager` folder) rather than project source —
 * the path rule is `library/path.ts` `isLibraryUri`. A referenced library is a precompiled blob the consuming project
 * never recompiles, so its materialized declarations must NOT be error-checked.
 */
export function isLibrarySymbol(sym: { uri: string }): boolean {
  return isLibraryUri(sym.uri)
}
