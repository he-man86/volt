/**
 * Symbol table & scope tree for IEC 61131-3 ST.
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
 */
import type { Span } from "../lexer/span.js";
import type {
	Action,
	EnumBody,
	EnumValue,
	FunctionBlock,
	Function as FunctionAST,
	GlobalVarList,
	Interface,
	InterfaceMethod,
	InterfaceProperty,
	Method,
	ParseResult,
	Program,
	Property,
	StructBody,
	TopLevel,
	TypeDecl,
	TypeExpr,
	UnionBody,
	VarDecl,
	VarSection,
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

// ─── Build symbol tables from a ParseResult ──────────────────────────

export interface SymbolTableInput {
	/** URI of the source document. Empty string is allowed for unit tests that don't care. */
	uri: string;
	parseResult: ParseResult;
}

/**
 * Build a project scope from a set of parsed files. Each top-level
 * unit becomes a symbol in the project scope, with its own child
 * scope containing its members. The URI is propagated to every
 * symbol so cross-file LSP queries (`definition`, `references`) can
 * return `Location`s pointing at the correct file.
 *
 * Back-compat overload: accepts `ParseResult[]` for callers that
 * don't track URIs (legacy tests). Symbols get `uri: ""` in that case.
 */
export function buildSymbolTable(files: readonly SymbolTableInput[]): Scope;
export function buildSymbolTable(files: readonly ParseResult[]): Scope;
export function buildSymbolTable(
	files: readonly (SymbolTableInput | ParseResult)[],
): Scope {
	const project = createProjectScope();
	for (const file of files) {
		const isInput = "parseResult" in file && "uri" in file;
		const parseResult = isInput
			? (file as SymbolTableInput).parseResult
			: (file as ParseResult);
		const uri = isInput ? (file as SymbolTableInput).uri : "";
		// Track the most recent FB/PROGRAM/INTERFACE scope IN THIS FILE so
		// standalone methods / actions / properties that follow it can be
		// parented to it. This matches the workspace-file layout: one
		// outer POU per file, followed by its members as top-level
		// siblings after END_FUNCTION_BLOCK. Without this, method bodies
		// that reference FB member vars would surface as
		// "unresolvedIdentifier" diagnostics — the symbol table walked
		// from method scope straight to project, skipping the FB.
		let currentMemberHost: Scope | undefined;
		for (const unit of parseResult.units) {
			const newScope = ingestTopLevel(project, unit, uri, currentMemberHost);
			if (
				unit.kind === "function_block" ||
				unit.kind === "program" ||
				unit.kind === "interface"
			) {
				currentMemberHost = newScope;
			}
			// FUNCTION resets the member host — standalone members after
			// a function are unusual and we don't claim them.
			if (unit.kind === "function") currentMemberHost = undefined;
		}
	}
	return project;
}

function ingestTopLevel(
	project: Scope,
	unit: TopLevel,
	uri: string,
	memberHost?: Scope,
): Scope | undefined {
	switch (unit.kind) {
		case "function_block":
			return ingestFunctionBlock(project, unit, uri);
		case "program":
			return ingestProgram(project, unit, uri);
		case "function":
			return ingestFunction(project, unit, uri);
		case "method":
			return ingestStandaloneMethod(project, unit, uri, memberHost);
		case "action":
			return ingestStandaloneAction(project, unit, uri, memberHost);
		case "property":
			ingestStandaloneProperty(project, unit, uri, memberHost);
			return undefined;
		case "interface":
			return ingestInterface(project, unit, uri);
		case "type_decl":
			ingestTypeDecl(project, unit, uri);
			return undefined;
		case "global_var_list":
			ingestGlobalVarList(project, unit, uri);
			return undefined;
		case "namespace":
			ingestNamespace(project, unit, uri);
			return undefined;
	}
}

/**
 * NAMESPACE creates a dedicated child scope on the project and ingests
 * the namespace's inner units into that scope. Symbols inside are
 * reachable via the namespace name (e.g. `MyLib.FB_Inner`) — the
 * resolver's parent-chain walk surfaces them when looking up
 * qualified paths.
 *
 * We also define a top-level `namespace` symbol on the project scope
 * so workspace-symbol search can find the namespace name itself.
 */
function ingestNamespace(
	project: Scope,
	ns: import("../parser/ast.js").Namespace,
	uri: string,
): void {
	const nsScope: Scope = {
		kind: "namespace",
		name: ns.name.text,
		parent: project,
		symbols: new Map(),
		children: [],
		span: ns.span,
	};
	project.children.push(nsScope);
	defineSymbol(project, {
		kind: "namespace",
		name: ns.name.text,
		span: ns.name.span,
		declarationSpan: ns.span,
		owner: project,
		uri,
		ast: ns,
	} as Symbol);
	// Recurse: ingest inner units into the namespace scope rather than
	// the project root.
	for (const inner of ns.units) {
		ingestTopLevel(nsScope, inner, uri);
	}
}

function ingestFunctionBlock(project: Scope, fb: FunctionBlock, uri: string): Scope {
	const fbScope: Scope = {
		kind: "pou",
		name: fb.name.text,
		parent: project,
		symbols: new Map(),
		children: [],
		span: fb.span,
	};
	project.children.push(fbScope);
	defineSymbol(project, {
		kind: "function_block",
		name: fb.name.text,
		span: fb.name.span,
		declarationSpan: fb.span,
		owner: project,
		uri,
		ast: fb,
	});
	ingestVarSections(fbScope, fb.varSections, uri);
	return fbScope;
}

function ingestProgram(project: Scope, prg: Program, uri: string): Scope {
	const scope: Scope = {
		kind: "pou",
		name: prg.name.text,
		parent: project,
		symbols: new Map(),
		children: [],
		span: prg.span,
	};
	project.children.push(scope);
	defineSymbol(project, {
		kind: "program",
		name: prg.name.text,
		span: prg.name.span,
		declarationSpan: prg.span,
		owner: project,
		uri,
		ast: prg,
	});
	ingestVarSections(scope, prg.varSections, uri);
	return scope;
}

function ingestFunction(project: Scope, fn: FunctionAST, uri: string): Scope {
	const scope: Scope = {
		kind: "pou",
		name: fn.name.text,
		parent: project,
		symbols: new Map(),
		children: [],
		span: fn.span,
	};
	project.children.push(scope);
	defineSymbol(project, {
		kind: "function",
		name: fn.name.text,
		span: fn.name.span,
		declarationSpan: fn.span,
		owner: project,
		uri,
		...(fn.returnType !== undefined ? { typeExpr: fn.returnType } : {}),
		ast: fn,
	});
	ingestVarSections(scope, fn.varSections, uri);
	return scope;
}

function ingestStandaloneMethod(
	project: Scope,
	m: Method,
	uri: string,
	memberHost?: Scope,
): Scope {
	// Workspace-layout convention: METHODs after END_FUNCTION_BLOCK
	// belong to the preceding FB/PROGRAM. Parent the method scope to
	// that FB so the method body can resolve FB member vars; define
	// the method symbol on the FB scope (not project) so cross-method
	// calls and `fbInst.MethodName` lookups find it. Falls back to
	// project parenting only when a method legitimately stands alone
	// (single-method file with no prior POU — rare, mostly tests).
	const host = memberHost ?? project;
	const scope: Scope = {
		kind: "method",
		name: m.name.text,
		parent: host,
		symbols: new Map(),
		children: [],
		span: m.span,
	};
	host.children.push(scope);
	defineSymbol(host, {
		kind: "method",
		name: m.name.text,
		span: m.name.span,
		declarationSpan: m.span,
		owner: host,
		uri,
		...(m.returnType !== undefined ? { typeExpr: m.returnType } : {}),
		ast: m,
	});
	ingestVarSections(scope, m.varSections, uri, /* asParams */ true);
	return scope;
}

function ingestStandaloneAction(
	project: Scope,
	a: Action,
	uri: string,
	memberHost?: Scope,
): Scope {
	const host = memberHost ?? project;
	const scope: Scope = {
		kind: "method",
		name: a.name.text,
		parent: host,
		symbols: new Map(),
		children: [],
		span: a.span,
	};
	host.children.push(scope);
	defineSymbol(host, {
		kind: "action",
		name: a.name.text,
		span: a.name.span,
		declarationSpan: a.span,
		owner: host,
		uri,
		ast: a,
	});
	return scope;
}

function ingestStandaloneProperty(
	project: Scope,
	p: Property,
	uri: string,
	memberHost?: Scope,
): void {
	const host = memberHost ?? project;
	defineSymbol(host, {
		kind: "property",
		name: p.name.text,
		span: p.name.span,
		declarationSpan: p.span,
		owner: host,
		uri,
		typeExpr: p.dataType,
		ast: p,
	});
	// Each accessor (getter/setter) carries its own var sections — we
	// don't build a separate scope for them here because they're
	// rarely populated when the property's accessors are split into
	// child files.
}

function ingestInterface(project: Scope, iface: Interface, uri: string): Scope {
	const ifaceScope: Scope = {
		kind: "interface",
		name: iface.name.text,
		parent: project,
		symbols: new Map(),
		children: [],
		span: iface.span,
	};
	project.children.push(ifaceScope);
	defineSymbol(project, {
		kind: "interface",
		name: iface.name.text,
		span: iface.name.span,
		declarationSpan: iface.span,
		owner: project,
		uri,
		ast: iface,
	});
	for (const m of iface.methods) {
		defineSymbol(ifaceScope, {
			kind: "interface_method",
			name: m.name.text,
			span: m.name.span,
			declarationSpan: m.span,
			owner: ifaceScope,
			uri,
			...(m.returnType !== undefined ? { typeExpr: m.returnType } : {}),
			ast: m,
		});
	}
	for (const p of iface.properties) {
		defineSymbol(ifaceScope, {
			kind: "interface_property",
			name: p.name.text,
			span: p.name.span,
			declarationSpan: p.span,
			owner: ifaceScope,
			uri,
			typeExpr: p.dataType,
			ast: p,
		});
	}
	return ifaceScope;
}

function ingestTypeDecl(project: Scope, t: TypeDecl, uri: string): void {
	defineSymbol(project, {
		kind: "type",
		name: t.name.text,
		span: t.name.span,
		declarationSpan: t.span,
		owner: project,
		uri,
		ast: t,
	});
	switch (t.body.kind) {
		case "struct":
			ingestStruct(project, t, t.body, uri);
			break;
		case "union":
			ingestUnion(project, t, t.body, uri);
			break;
		case "enum":
			ingestEnum(project, t, t.body, uri);
			break;
		case "alias":
			// Aliases don't add members; the alias points at another type.
			break;
	}
}

function ingestStruct(project: Scope, t: TypeDecl, body: StructBody, uri: string): void {
	const scope: Scope = {
		kind: "struct",
		name: t.name.text,
		parent: project,
		symbols: new Map(),
		children: [],
		span: t.span,
	};
	project.children.push(scope);
	for (const field of body.fields) {
		ingestVarDecl(scope, field, undefined, uri, /* asField */ true);
	}
}

function ingestUnion(project: Scope, t: TypeDecl, body: UnionBody, uri: string): void {
	const scope: Scope = {
		kind: "struct", // unions have struct-shaped scopes for lookup purposes
		name: t.name.text,
		parent: project,
		symbols: new Map(),
		children: [],
		span: t.span,
	};
	project.children.push(scope);
	for (const field of body.fields) {
		ingestVarDecl(scope, field, undefined, uri, /* asField */ true);
	}
}

function ingestEnum(project: Scope, t: TypeDecl, body: EnumBody, uri: string): void {
	const scope: Scope = {
		kind: "enum",
		name: t.name.text,
		parent: project,
		symbols: new Map(),
		children: [],
		span: t.span,
	};
	project.children.push(scope);
	for (const v of body.values) {
		defineSymbol(scope, {
			kind: "enum_value",
			name: v.name.text,
			span: v.name.span,
			declarationSpan: v.span,
			owner: scope,
			uri,
			ast: v,
		});
	}
}

function ingestGlobalVarList(project: Scope, gvl: GlobalVarList, uri: string): void {
	// Register the GVL block itself as a top-level symbol named after the
	// URI's basename. This is what lets `workspace/symbol` find a GVL by
	// name, and what `GVL_Name.field` references resolve to under
	// `{attribute 'qualified_only'}`. ST has no in-source identifier for
	// the GVL block — the file basename IS the identifier per CODESYS
	// convention.
	const gvlName = gvlNameFromUri(uri);
	if (gvlName !== undefined) {
		defineSymbol(project, {
			kind: "gvl_block",
			name: gvlName,
			span: gvl.span,
			declarationSpan: gvl.span,
			owner: project,
			uri,
			ast: gvl,
		});
	}

	// GVL contents go directly into the project scope as `gvl_var`.
	for (const section of gvl.varSections) {
		for (const decl of section.decls) {
			for (const name of decl.names) {
				defineSymbol(project, {
					kind: "gvl_var",
					name: name.text,
					span: name.span,
					declarationSpan: decl.span,
					owner: project,
					uri,
					typeExpr: decl.type,
					varSection: section.sectionKind,
					ast: decl,
				});
			}
		}
	}
}

/**
 * Derive a GVL block name from its document URI: basename minus
 * extension. Returns undefined for empty / pathless URIs (test fixtures
 * that pass `""` as uri stay anonymous).
 */
function gvlNameFromUri(uri: string): string | undefined {
	if (uri.length === 0) return undefined;
	const last = uri.split("/").pop() ?? "";
	if (last.length === 0) return undefined;
	const dot = last.lastIndexOf(".");
	const name = dot > 0 ? last.slice(0, dot) : last;
	return name.length > 0 ? name : undefined;
}

function ingestVarSections(
	scope: Scope,
	sections: readonly VarSection[],
	uri: string,
	asParams = false,
): void {
	for (const section of sections) {
		for (const decl of section.decls) {
			ingestVarDecl(scope, decl, section.sectionKind, uri, false, asParams);
		}
	}
}

function ingestVarDecl(
	scope: Scope,
	decl: VarDecl,
	sectionKind: VarSectionKind | undefined,
	uri: string,
	asField: boolean,
	asParam = false,
): void {
	const kind: SymbolKind = asField
		? "struct_field"
		: asParam &&
		    (sectionKind === "VAR_INPUT" ||
		      sectionKind === "VAR_OUTPUT" ||
		      sectionKind === "VAR_IN_OUT")
		  ? "method_param"
		  : "var";
	for (const name of decl.names) {
		defineSymbol(scope, {
			kind,
			name: name.text,
			span: name.span,
			declarationSpan: decl.span,
			owner: scope,
			uri,
			typeExpr: decl.type,
			...(sectionKind !== undefined ? { varSection: sectionKind } : {}),
			ast: decl,
		});
	}
	// Implicit enumeration: `iState : (Idle, Running, Halted)` declares
	// the named variable AND introduces each enum value as a constant
	// in the enclosing scope (CODESYS "Implicit Enumeration" rule —
	// `Running` is then a valid bare identifier inside methods of the
	// owning FB). Without this, the resolver flags every enum-value
	// reference as unresolved.
	if (decl.type.kind === "implicit_enum_type") {
		for (const value of decl.type.values) {
			defineSymbol(scope, {
				kind: "enum_value",
				name: value.name.text,
				span: value.name.span,
				declarationSpan: value.name.span,
				owner: scope,
				uri,
				ast: decl,
			});
		}
	}
}
