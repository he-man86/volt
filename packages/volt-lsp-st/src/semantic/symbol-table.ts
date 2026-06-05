/**
 * Symbol table & scope tree — TYPES + small accessors.
 *
 * The model:
 *   - A `Scope` is a named region (project / POU / method / accessor /
 *     struct / enum) that owns a flat name → Symbol map and links to
 *     its parent scope.
 *   - A `Symbol` is a named declaration we found while walking the
 *     AST. It carries the defining span (the identifier token's
 *     range) and a back-reference to the AST node it came from.
 *   - Name lookup walks the parent chain outward (innermost first).
 *
 * This is deliberately much smaller than a full IEC type system:
 *   - No type inference. The `typeExpr` field carries whatever the
 *     declaration spelled; resolution to a concrete kind happens
 *     lazily when a query needs it.
 *   - No generics. PLC code rarely uses them; when it does, we
 *     treat the generic-bracket parts as opaque text and ignore.
 *   - No overload resolution. If two methods share a name (which is
 *     illegal in standard ST but happens via inheritance), we keep
 *     both in the scope and return all matches.
 *
 * Identifier comparison is case-insensitive (PLC convention).
 *
 * The builder (`buildSymbolTable` + ingest* functions) lives in
 * `symbol-table-build.ts` — split out because it's ~530 lines of
 * AST-walking that would dwarf these type definitions.
 */
import type { Span } from "../lexer/span.js";
import type {
	Action,
	EnumValue,
	InterfaceMethod,
	InterfaceProperty,
	Method,
	Property,
	TopLevel,
	TypeExpr,
	VarDecl,
	VarSectionKind,
} from "../parser/ast.js";

// ─── Symbol kinds ────────────────────────────────────────────────────

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
	| "namespace";

export interface Symbol {
	kind: SymbolKind;
	name: string;
	/** The defining identifier span — what LSP `definition` returns. */
	span: Span;
	/** The full declaration span — what `documentSymbol` shows as the range. */
	declarationSpan: Span;
	/** The scope that owns this symbol. */
	owner: Scope;
	/**
	 * URI of the document this symbol was declared in. Lets LSP queries
	 * return cross-file `Location` results without re-scanning the
	 * workspace. Empty string when the symbol came from a parse result
	 * that wasn't associated with a URI (e.g. in tests).
	 */
	uri: string;
	/**
	 * Declared type expression where applicable (vars, params, fields,
	 * function/method return type, property data type). For symbols
	 * that don't have a type (POUs themselves, enum values), `undefined`.
	 */
	typeExpr?: TypeExpr;
	/** VAR section kind for `var` symbols. */
	varSection?: VarSectionKind;
	/** Backing AST node (for downstream queries that need more detail). */
	ast: TopLevel | VarDecl | EnumValue | InterfaceMethod | InterfaceProperty | Method | Action | Property;
}

// ─── Scope tree ──────────────────────────────────────────────────────

export type ScopeKind =
	| "project"
	| "pou"
	| "method"
	| "accessor"
	| "interface"
	| "struct"
	| "enum"
	| "gvl"
	| "namespace";

export interface Scope {
	kind: ScopeKind;
	/** Display name (POU name, method name, struct name, …). Project scope = "(project)". */
	name: string;
	parent?: Scope;
	/** Lowercased name → symbols. Multiple symbols per name are allowed (rare; e.g. overload via inheritance). */
	symbols: Map<string, Symbol[]>;
	/** Child scopes contained within this one (a POU's methods, a struct's nested types, etc.). */
	children: Scope[];
	/** Optional span — the source range this scope covers. Project scope has no span. */
	span?: Span;
}

// ─── Accessors ───────────────────────────────────────────────────────

export function createProjectScope(): Scope {
	return {
		kind: "project",
		name: "(project)",
		symbols: new Map(),
		children: [],
	};
}

export function defineSymbol(scope: Scope, sym: Symbol): void {
	const key = sym.name.toLowerCase();
	const existing = scope.symbols.get(key);
	if (existing !== undefined) {
		existing.push(sym);
	} else {
		scope.symbols.set(key, [sym]);
	}
}

/** Look up by exact name (case-insensitive). Returns all matches in this scope only — does NOT walk parents. */
export function lookupLocal(scope: Scope, name: string): Symbol[] {
	return scope.symbols.get(name.toLowerCase()) ?? [];
}
