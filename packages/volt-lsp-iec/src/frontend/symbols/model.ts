/**
 * THE SYMBOL TABLE'S MODEL — `Symbol` and `Scope`, and nothing computed from them (the factories and the local lookup
 * are `scope.ts`, the lazy indices `cache.ts`).
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
  CompileEnvironment,
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
  | "device"

/** The symbol kinds that are POUs — what a call or an instance names: a FUNCTION, a FUNCTION_BLOCK, a PROGRAM. */
export const POU_SYMBOL_KINDS: ReadonlySet<SymbolKind> = new Set(["function", "function_block", "program"])

/** Is `sym` a POU (`POU_SYMBOL_KINDS`)? */
export function isPouSymbol(sym: Symbol): boolean {
  return POU_SYMBOL_KINDS.has(sym.kind)
}

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
  /** Backing AST node for downstream queries — a device instance's descriptor, which is no ST. */
  ast: TopLevel | VarDecl | EnumValue | InterfaceMethod | InterfaceProperty | Method | Action | Property | DeviceInstance
}

/**
 * A DEVICE-TREE INSTANCE, from its `.device` descriptor: the device object's name is an identifier the application's code
 * may name bare (rule Y24) — the fixture project's PLC `Device` builds as `ADR(Device)` (`sym_device_instance_bare`,
 * CODESYS 2026-10-02), a corpus EtherCAT master as `EtherCAT_Master.xRestart`. The pull names each descriptor file after
 * its instance (`Device.device`), which is all the descriptor says of it: no IEC type, so a device symbol has none and
 * nothing is checked of what is read through it.
 */
export interface DeviceInstance {
  kind: "device"
  /** The instance name, as the descriptor file names it. */
  name: string
  /** The descriptor's uri. */
  uri: string
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
  /**
   * An INTERFACE's `EXTENDS` LIST (lowercased, as written), pending resolution by `linkExtends` — an interface extends
   * several (`INTERFACE I EXTENDS I_a, I_b`, rule H4), where an FB or a STRUCT names one base (`extendsName`).
   */
  interfaceExtends?: readonly string[]
  /**
   * The interfaces `interfaceExtends` resolved to, in list order — a name that resolved to nothing has no entry, so the
   * list is shorter than the names (`hasUnresolvedBase`). Linked post-pass; read through `extends.ts` `basesOf`.
   */
  interfaceBases?: Scope[]
  /** For an `enum`/`gvl` scope carrying `{attribute 'qualified_only'}`: members are NOT bare-accessible. */
  qualifiedOnly?: boolean
  /**
   * A scope whose unit DECLARES nothing — an FB whose header both vendors refuse (`FunctionBlock.headerRefused`). It
   * holds the unit's own members so its body still resolves, but it is no candidate for any lookup by name: no base
   * (`linkExtends`), as it is no type.
   */
  undeclared?: true
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
  /**
   * PROJECT ROOT ONLY: the environment the project is compiled in, as far as the builder MEASURED it — the device and
   * the project's compile settings a conditional pragma may ask (`syntax/pragmas/conditional` `CompileEnvironment`).
   * The LSP holds neither, so it is undefined there and such a condition is refused by name; the conformance harness
   * states the recording projects' (`symbols/condition-world.ts`).
   */
  environment?: CompileEnvironment
  /** For a TOP-LEVEL project child only: the URI of the file that contributed it. Set by `bindFile`, read
   *  by `unbindFile` to surgically drop one file's scopes on an incremental re-index. Undefined elsewhere. */
  defUri?: string
}
