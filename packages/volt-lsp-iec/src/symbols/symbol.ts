/**
 * Symbol table & scope tree — the types + the small factories/accessors (Layer B).
 *
 * Model: a `Scope` is a named region (project / POU / method / accessor / struct / enum /
 * gvl / namespace) owning a case-insensitive name→Symbol map and a link to its parent. A
 * `Symbol` is a named declaration found while binding the AST; it carries the defining span
 * (go-to-def target), the full declaration span, and a back-reference to the AST node.
 *
 * Deliberately smaller than a full type system: no inference here (the `typeExpr` field just
 * carries what the declaration spelled — resolution to a concrete Type is layer C's job).
 * Case-insensitive names (PLC convention). Ownership: `symbols/` owns Symbol + Scope; the
 * binder (`binder.ts`) fills the tree; the navigator (`scope-nav.ts`) reads it.
 */
import type {
  Action,
  Dialect,
  EnumValue,
  InterfaceMethod,
  InterfaceProperty,
  Method,
  Property,
  Span,
  TopLevel,
  TypeExpr,
  VarDecl,
  VarSectionKind,
} from "../syntax/index.js"

export type SymbolKind =
  | "function_block"
  | "program"
  | "function"
  | "method"
  | "action"
  | "property"
  | "interface"
  | "interface_method"
  | "interface_property"
  | "type"
  | "var"
  | "method_param"
  | "struct_field"
  | "enum_value"
  | "gvl_var"
  | "gvl_block"
  | "namespace"

export interface Symbol {
  kind: SymbolKind
  name: string
  /** The defining identifier span — what LSP `definition` returns. */
  span: Span
  /** The full declaration span — what `documentSymbol` shows as the range. */
  declarationSpan: Span
  /** The scope that owns this symbol. */
  owner: Scope
  /** URI of the declaring document; "" when the parse wasn't associated with a URI (tests). */
  uri: string
  /** Declared type expression where applicable (vars, params, fields, return type, property type). */
  typeExpr?: TypeExpr
  /** VAR section kind for `var`/`gvl_var` symbols. */
  varSection?: VarSectionKind
  /** True when declared in a `CONSTANT` section — const-eval folds references to it. */
  constant?: boolean
  /**
   * True when this `gvl_var` belongs to a GVL under `{attribute 'qualified_only'}` — NOT in the
   * bare-name search path (only `GvlName.varName` resolves). Kept independent of the type system.
   */
  qualifiedOnly?: boolean
  /** Backing AST node for downstream queries. */
  ast: TopLevel | VarDecl | EnumValue | InterfaceMethod | InterfaceProperty | Method | Action | Property
}

export type ScopeKind =
  | "project"
  | "pou"
  | "method"
  | "accessor"
  | "interface"
  | "struct"
  | "enum"
  | "gvl"
  | "namespace"

export interface Scope {
  kind: ScopeKind
  /** Display name (POU/method/struct name, …). Project scope = "(project)". */
  name: string
  parent?: Scope
  /** Lowercased name → symbols. Multiple per name allowed (rare; overload via inheritance). */
  symbols: Map<string, Symbol[]>
  children: Scope[]
  span?: Span
  /** The `EXTENDS` base name (lowercased), pending resolution by `linkExtends`. */
  extendsName?: string
  /** Resolved base scope (from `EXTENDS`) — inherited members resolve through it. Linked post-pass. */
  baseScope?: Scope
  /** For an `enum`/`gvl` scope carrying `{attribute 'qualified_only'}`: members are NOT bare-accessible. */
  qualifiedOnly?: boolean
  /**
   * PROJECT ROOT ONLY: whose ST this project is. The vocabulary differs between the vendors — `__POSITION`,
   * `__POUNAME`, `__COMPARE_AND_SWAP` and `__VECTOR` are CODESYS's alone — and name resolution and type
   * inference both need to know, which is why it rides on the scope they already receive rather than
   * becoming a parameter on every path that reaches them.
   *
   * <p>REQUIRED, and it used to read "undefined means CODESYS, the superset". That is the shape of default this
   * repo does not keep: the SERVER never passed a dialect to `buildSymbolTable`, so a TwinCAT workspace analysed
   * as CODESYS and no one could see it. `computeSemanticDiagnostics` now refuses a project whose dialect does not
   * match the vendor it was asked about.</p>
   */
  dialect?: Dialect
  /** For a TOP-LEVEL project child only: the URI of the file that contributed it. Set by `bindFile`, read
   *  by `unbindFile` to surgically drop one file's scopes on an incremental re-index. Undefined elsewhere. */
  defUri?: string
  /** Lazy name→children index for `childScopesByName` — the project root has thousands of children, so a
   *  linear `.find` per lookup is an O(n) tax on the hot inference path. Rebuilt when `children` grows. */
  _childIndex?: Map<string, Scope[]>
  _childIndexLen?: number
  /** Library folder → the folders that library can SEE (itself + its manifest's DEPENDENCIES). Built by
   *  `linkExtends` on the PROJECT scope, read by `precedence.ts` to decide which of several same-named
   *  candidates a reference means. Absent when the workspace has no library manifests. */
  _libVisible?: Map<string, Set<string>>
  /** Lazy span→scope index for `scopeForUnit` (project root only). Like `_childIndex`, an incremental rebind
   *  must NULL it explicitly — a same-count file swap replaces spans without changing counts, so no length
   *  guard can detect staleness. A stale index makes `scopeForUnit` miss the rebound file's fresh spans and
   *  name-walk into a same-named sibling POU's member (cross-unit scope contamination). */
  _spanIndex?: Map<Span, Scope>
}

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
  extra?: Partial<Pick<Scope, "extendsName" | "qualifiedOnly">>,
): Scope {
  const scope: Scope = { kind, name, parent, symbols: new Map(), children: [], span, ...extra }
  parent.children.push(scope)
  return scope
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
 * True when a symbol/URI comes from a referenced-library SIGNATURE (a `Library Manager` folder) rather than
 * project source. A referenced library is a precompiled blob the consuming project never recompiles, so its
 * materialized declarations must NOT be error-checked (they'd false-positive on code CODESYS never builds).
 *
 * Normalizes `%20` FIRST: the live server keys symbols by `file://` URI (`Library%20Manager`); the corpus and
 * unit tests by raw OS path (`Library Manager`). Matching only the raw form silently disabled the guard under
 * the real LSP. Lives in layer B so BOTH types (const-eval/infer) and analysis reach the ONE source of truth —
 * do NOT re-inline `.includes("Library Manager")`; the raw match is the exact footgun this replaces.
 */
export function isLibrarySymbol(sym: { uri: string }): boolean {
  return sym.uri.replace(/%20/g, " ").includes("Library Manager")
}

/**
 * The referenced library a symbol/URI belongs to — the folder under `Library Manager/` (`Standard`, `Util` …) — or
 * undefined for project source. `%20` is normalized first, as in `isLibrarySymbol`. The transpiler's Standard gate kept
 * its own regex for this (consolidate-lsp-structure C5).
 */
export function libraryOf(sym: { uri: string }): string | undefined {
  return /Library Manager[\\/]([^\\/]+)[\\/]/.exec(sym.uri.replace(/%20/g, " "))?.[1]
}
