/**
 * AST node types for IEC 61131-3 Structured Text.
 *
 * Discriminated unions keyed on `kind`. Every node carries a `span`
 * for LSP-style position queries.
 *
 * Coverage intent: navigation-only. We capture enough structure to
 * answer "what's defined where", "what types do these vars have",
 * "what methods does this FB have", "what does this property
 * return". We deliberately do *not* parse statement-level expression
 * trees — bodies are captured as an opaque token span which a
 * later pass scans for identifier references and call sites.
 */
import type { Span } from "../lexer/span.js";
import type { Keyword, Token } from "../lexer/tokens.js";

// ─── Top-level units (one per .st file in the mirrored workspace) ────

export type TopLevel =
	| FunctionBlock
	| Program
	| Function
	| Method
	| Action
	| Property
	| Interface
	| TypeDecl
	| GlobalVarList
	| Namespace;

/**
 * NAMESPACE block — a logical grouping of POUs. Inner units are
 * captured as a flat `units` list (the namespace's own contents).
 * Source: `docs/codesys-reference/10-keywords.md`.
 */
export interface Namespace {
	kind: "namespace";
	name: Identifier;
	units: TopLevel[];
	span: Span;
}

export interface FunctionBlock {
	kind: "function_block";
	name: Identifier;
	extends?: Identifier;
	implements?: Identifier[];
	abstract?: boolean;
	final?: boolean;
	varSections: VarSection[];
	/** Opaque body — implementation tokens between VAR sections and END_FUNCTION_BLOCK. */
	body: BodySpan;
	span: Span;
}

export interface Program {
	kind: "program";
	name: Identifier;
	varSections: VarSection[];
	body: BodySpan;
	span: Span;
}

export interface Function {
	kind: "function";
	name: Identifier;
	returnType?: TypeExpr;
	varSections: VarSection[];
	body: BodySpan;
	span: Span;
}

export interface Method {
	kind: "method";
	name: Identifier;
	/** Resolved access modifier (PUBLIC / PRIVATE / PROTECTED / INTERNAL) or `undefined` if not specified. */
	accessModifier?: Keyword;
	final?: boolean;
	abstract?: boolean;
	override?: boolean;
	returnType?: TypeExpr;
	varSections: VarSection[];
	body: BodySpan;
	span: Span;
}

export interface Action {
	kind: "action";
	name: Identifier;
	body: BodySpan;
	span: Span;
}

export interface Property {
	kind: "property";
	name: Identifier;
	accessModifier?: Keyword;
	/** Data type the property reads/writes. */
	dataType: TypeExpr;
	getter?: PropertyAccessor;
	setter?: PropertyAccessor;
	span: Span;
}

export interface PropertyAccessor {
	kind: "get" | "set";
	varSections: VarSection[];
	body: BodySpan;
	span: Span;
}

export interface Interface {
	kind: "interface";
	name: Identifier;
	extends?: Identifier[];
	/** Method *signatures* declared in the interface (no bodies). */
	methods: InterfaceMethod[];
	/** Property signatures declared in the interface. */
	properties: InterfaceProperty[];
	span: Span;
}

export interface InterfaceMethod {
	kind: "interface_method";
	name: Identifier;
	returnType?: TypeExpr;
	varSections: VarSection[];
	span: Span;
}

export interface InterfaceProperty {
	kind: "interface_property";
	name: Identifier;
	dataType: TypeExpr;
	hasGetter: boolean;
	hasSetter: boolean;
	span: Span;
}

export interface TypeDecl {
	kind: "type_decl";
	name: Identifier;
	body: DutBody;
	span: Span;
}

export interface GlobalVarList {
	kind: "global_var_list";
	/** GVL files have just one VAR_GLOBAL block; we keep an array for symmetry with POUs. */
	varSections: VarSection[];
	span: Span;
}

// ─── VAR sections and declarations ───────────────────────────────────

export type VarSectionKind =
	| "VAR"
	| "VAR_INPUT"
	| "VAR_OUTPUT"
	| "VAR_IN_OUT"
	| "VAR_TEMP"
	| "VAR_STAT"
	| "VAR_INST"
	| "VAR_EXTERNAL"
	| "VAR_GLOBAL"
	| "VAR_CONFIG"
	| "VAR_ACCESS"
	| "VAR_GENERIC";

export interface VarSection {
	kind: "var_section";
	sectionKind: VarSectionKind;
	constant?: boolean;
	retain?: boolean;
	nonRetain?: boolean;
	persistent?: boolean;
	decls: VarDecl[];
	span: Span;
}

export interface VarDecl {
	kind: "var_decl";
	/** One declaration line can declare multiple names: `a, b, c : INT;` */
	names: Identifier[];
	type: TypeExpr;
	/** Optional initialization expression, captured as opaque tokens. */
	init?: BodySpan;
	/** `AT <address>` clause — captured as opaque tokens. */
	at?: BodySpan;
	span: Span;
}

// ─── Type expressions ────────────────────────────────────────────────

export type TypeExpr =
	| NamedType
	| ArrayType
	| ReferenceType
	| PointerType
	| StringType
	| ImplicitEnumType;

/**
 * Implicit enumeration declared inline in a variable's type:
 *   `iState : (Idle, Running, Halted) := Running;`
 *
 * Per `docs/codesys-reference/02-variables.md` and the dedicated
 * sub-page on implicit enums. The values list is captured as
 * identifiers with optional explicit numeric assignment.
 */
export interface ImplicitEnumType {
	kind: "implicit_enum_type";
	values: Array<{ name: Identifier; init?: BodySpan }>;
	span: Span;
}

export interface NamedType {
	kind: "named_type";
	name: Identifier;
	/** For namespaced/qualified types like `Tc2_Standard.TON` — captured as ident + qualifier path. */
	qualifiers?: Identifier[];
	span: Span;
}

export interface ArrayType {
	kind: "array_type";
	dims: ArrayDim[];
	element: TypeExpr;
	span: Span;
}

export interface ArrayDim {
	kind: "array_dim";
	/** Lower bound — captured as opaque tokens (could be a constant expression). */
	lower: BodySpan;
	/** Upper bound — captured as opaque tokens. */
	upper: BodySpan;
	span: Span;
}

export interface ReferenceType {
	kind: "reference_type";
	target: TypeExpr;
	span: Span;
}

export interface PointerType {
	kind: "pointer_type";
	target: TypeExpr;
	span: Span;
}

export interface StringType {
	kind: "string_type";
	wide: boolean;
	/** `STRING(80)` or `STRING[80]` — captured as opaque tokens. */
	length?: BodySpan;
	span: Span;
}

// ─── DUT bodies (under TYPE … END_TYPE) ──────────────────────────────

export type DutBody = StructBody | EnumBody | UnionBody | AliasBody;

export interface StructBody {
	kind: "struct";
	/** Struct fields look like VAR section decls (no section keyword). */
	fields: VarDecl[];
	/** Optional `EXTENDS T_Base` for OOP-style structs. */
	extends?: Identifier;
	span: Span;
}

export interface EnumBody {
	kind: "enum";
	/** Optional explicit base type — `(VAL1, VAL2) BYTE`. */
	baseType?: TypeExpr;
	values: EnumValue[];
	span: Span;
}

export interface EnumValue {
	kind: "enum_value";
	name: Identifier;
	/** Optional `:= 42` literal value, captured as opaque tokens. */
	value?: BodySpan;
	span: Span;
}

export interface UnionBody {
	kind: "union";
	fields: VarDecl[];
	span: Span;
}

export interface AliasBody {
	kind: "alias";
	target: TypeExpr;
	/** Optional `:= default` initializer for alias types, captured as opaque tokens. */
	init?: BodySpan;
	span: Span;
}

// ─── Leaves ──────────────────────────────────────────────────────────

export interface Identifier {
	kind: "identifier";
	text: string;
	span: Span;
}

/**
 * An opaque range of tokens we deliberately didn't fully parse.
 * Carries the source-text slice and the underlying tokens so later
 * passes (call-site extraction, identifier-reference scanning, type
 * resolution within initializers) can walk the tokens without
 * re-lexing.
 */
export interface BodySpan {
	kind: "body";
	tokens: Token[];
	span: Span;
}

// ─── Parse result ────────────────────────────────────────────────────

export interface ParseError {
	message: string;
	span: Span;
}

export interface ParseResult {
	units: TopLevel[];
	errors: ParseError[];
}
