/**
 * SCOPES, MADE AND READ — the one scope factory, symbol definition, the local lookup and the project root's dialect.
 * The model (`Symbol`, `Scope`) is `model.ts`; the lazy indices over it are `cache.ts`.
 */
import type { Dialect, Span } from "../syntax/index.js"
import { isLibraryUri } from "../library/index.js"
import type { Scope, ScopeKind, Symbol } from "./model.js"

export function createProjectScope(dialect: Dialect): Scope {
  return { kind: "project", name: "(project)", symbols: new Map(), children: [], dialect }
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
