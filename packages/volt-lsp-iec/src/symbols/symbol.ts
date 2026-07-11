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
  /** Lazy name→children index for `childScopesByName` — the project root has thousands of children, so a
   *  linear `.find` per lookup is an O(n) tax on the hot inference path. Rebuilt when `children` grows. */
  _childIndex?: Map<string, Scope[]>
  _childIndexLen?: number
}

export function createProjectScope(): Scope {
  return { kind: "project", name: "(project)", symbols: new Map(), children: [] }
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
