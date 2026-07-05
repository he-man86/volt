/**
 * AST node types for IEC 61131-3 Structured Text.
 *
 * Discriminated unions keyed on `kind`. Every node carries a `span`
 * for LSP-style position queries.
 *
 * Coverage intent for DECLARATIONS: navigation-first. We capture
 * enough structure to answer "what's defined where", "what types do
 * these vars have", "what methods does this FB have", "what does this
 * property return". A POU body is still stored as an opaque `BodySpan`
 * token slice on the unit.
 *
 * BODIES additionally have a statement/expression AST (the "Statement
 * / Expression tree" section below), parsed on demand from a
 * `BodySpan` by `src/parser/statements.ts`. It is additive: the token
 * slice stays, and consumers opt into the tree when they need real
 * structure (member chains, call arguments, control flow) instead of a
 * flat token scan.
 */
import type { Span } from "../lexer/span.js";
import type { Keyword, Token } from "../lexer/tokens.js";

// ─── Top-level units (one per kind-named source file in the mirrored workspace) ────

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
	/** Resolved access modifier (PUBLIC / PRIVATE / PROTECTED / INTERNAL) or `undefined` if not specified. */
	accessModifier?: Keyword;
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
	/**
	 * Subrange constraint tokens for `INT(lo..hi)` — the `lo..hi` between the parens, retained (not
	 * discarded) so the type system can bound-check constants against it. Only set when the constraint is a
	 * range (contains a top-level `..`); an FB-instance initializer `FB(x := 1)` leaves this undefined.
	 * `const-eval` splits on `..` and evaluates each bound.
	 */
	subrange?: BodySpan;
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
	/** Optional default initializer — `(A, B) := A;` — CODESYS enum type default. */
	init?: BodySpan;
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

// ─── Statement / Expression tree (POU bodies) ────────────────────────
//
// Parsed on demand from a `BodySpan` by `src/parser/statements.ts`
// (statements) + `src/parser/expression.ts` (expressions). Every node
// is a discriminated union keyed on `kind` and carries a `span`, like
// the declaration nodes above. The `kind` strings are disjoint from the
// declaration/type kinds so a single node type never collides.

export type Expr =
	| IdentExpr
	| Literal
	| BinaryExpr
	| UnaryExpr
	| MemberExpr
	| IndexExpr
	| DerefExpr
	| CallExpr
	| ParenExpr
	| AssignExpr;

/** A bare name reference in an expression (`ActState`, `IMM`). */
export interface IdentExpr {
	kind: "ident_expr";
	name: string;
	span: Span;
}

/** Discriminates a literal so consumers can type it without re-lexing. */
export type LiteralKind =
	| "int"
	| "real"
	| "string"
	| "wstring"
	| "time"
	| "date"
	| "tod"
	| "datetime"
	| "typed" // `INT#5`, `16#FF` — a type-prefixed / based literal
	| "bool"
	| "address"; // `%IX0.0`

export interface Literal {
	kind: "literal";
	literalKind: LiteralKind;
	/** Source text exactly as written. */
	text: string;
	span: Span;
}

/**
 * A binary operation. `op` is the canonical operator: an uppercased
 * keyword for word operators (`AND`, `OR`, `XOR`, `MOD`, `AND_THEN`,
 * `OR_ELSE`) or the literal punctuation for symbol operators
 * (`+ - * / ** < > <= >= = <> &`).
 */
export interface BinaryExpr {
	kind: "binary";
	op: string;
	left: Expr;
	right: Expr;
	span: Span;
}

/** A prefix unary operation: `NOT`, unary `-`/`+`, or address-of `&`. */
export interface UnaryExpr {
	kind: "unary";
	op: string;
	operand: Expr;
	span: Span;
}

/** Member access `base.member` (one level; chains nest as `base`). */
export interface MemberExpr {
	kind: "member";
	base: Expr;
	member: IdentExpr;
	span: Span;
}

/** Array/subscript access `base[i]` or `base[i, j]`. */
export interface IndexExpr {
	kind: "index";
	base: Expr;
	indices: Expr[];
	span: Span;
}

/** Pointer dereference `base^`. */
export interface DerefExpr {
	kind: "deref";
	base: Expr;
	span: Span;
}

/** Function / method / FB call `callee(args)`. */
export interface CallExpr {
	kind: "call";
	callee: Expr;
	args: CallArg[];
	span: Span;
}

/**
 * One argument in a call. Positional when `param` is undefined; named
 * input when `param` is set and `output` is false (`p := v`); output
 * binding when `output` is true (`p => target`).
 */
export interface CallArg {
	kind: "call_arg";
	param?: IdentExpr;
	output: boolean;
	/** The argument value, or undefined for an unconnected output (`out => ,` / `out => )`) —
	 *  CODESYS lets you name an output but route it nowhere. */
	value?: Expr;
	span: Span;
}

/** Parenthesised sub-expression — kept so spans/formatting round-trip. */
export interface ParenExpr {
	kind: "paren";
	inner: Expr;
	span: Span;
}

/** CODESYS inline assignment used as an expression: `(x := value)` assigns and yields `value`.
 *  Only appears inside parentheses (e.g. `IF (r := Compute()) THEN`). */
export interface AssignExpr {
	kind: "assign_expr";
	target: Expr;
	value: Expr;
	span: Span;
}

// ── Statements ──

export type Statement =
	| Assignment
	| CallStatement
	| IfStatement
	| CaseStatement
	| ForStatement
	| WhileStatement
	| RepeatStatement
	| ReturnStatement
	| ExitStatement
	| ContinueStatement
	| TryStatement
	| ExprStatement
	| EmptyStatement;

/** An ordered list of statements — a body or a nested block. */
export type StatementList = Statement[];

/** `target := value;` (target may be a member/index/deref l-value). */
export interface Assignment {
	kind: "assign";
	target: Expr;
	value: Expr;
	/** The assignment operator when it is NOT plain `:=` — the IEC set/reset/reference forms
	 *  `S=` (set), `R=` (reset), `REF=` (reference). Undefined for `:=`. These carry different
	 *  semantics (BOOL latch / reference bind), so type checks treat them separately. */
	op?: "S=" | "R=" | "REF=";
	/** Intermediate l-values of a chained assignment `a := b := c` — here `[b]`, with target `a` and
	 *  value `c` (all receive `c`'s value per CODESYS). Undefined/empty for a plain assignment. */
	chained?: Expr[];
	span: Span;
}

/** A call used as a statement: `Increment.State(...);`. */
export interface CallStatement {
	kind: "call_stmt";
	call: CallExpr;
	span: Span;
}

/** A bare expression terminated by `;` — a no-op read CODESYS tolerates (`fb.Status.Flag;`, often a
 *  placeholder written elsewhere). Not a call and not an assignment. */
export interface ExprStatement {
	kind: "expr_stmt";
	expr: Expr;
	span: Span;
}

/** CODESYS exception handling: `__TRY … __CATCH(e) … __FINALLY … __ENDTRY`. Catch and finally
 *  are each optional (at least one is present in valid code). */
export interface TryStatement {
	kind: "try";
	tryBody: StatementList;
	/** The `__CATCH(…)` argument — an l-value expression receiving the exception code. */
	catchVar?: Expr;
	catchBody?: StatementList;
	finallyBody?: StatementList;
	span: Span;
}

export interface IfStatement {
	kind: "if";
	/** `IF` plus each `ELSIF` — evaluated in order. */
	branches: IfBranch[];
	elseBody?: StatementList;
	span: Span;
}

export interface IfBranch {
	kind: "if_branch";
	cond: Expr;
	body: StatementList;
	span: Span;
}

export interface CaseStatement {
	kind: "case";
	selector: Expr;
	arms: CaseArm[];
	elseBody?: StatementList;
	span: Span;
}

export interface CaseArm {
	kind: "case_arm";
	labels: CaseLabel[];
	body: StatementList;
	span: Span;
}

/** A CASE label: a single value, or a range when `upper` is set (`1..5`). */
export interface CaseLabel {
	kind: "case_label";
	value: Expr;
	upper?: Expr;
	span: Span;
}

export interface ForStatement {
	kind: "for";
	controlVar: Expr;
	from: Expr;
	to: Expr;
	by?: Expr;
	body: StatementList;
	span: Span;
}

export interface WhileStatement {
	kind: "while";
	cond: Expr;
	body: StatementList;
	span: Span;
}

export interface RepeatStatement {
	kind: "repeat";
	body: StatementList;
	until: Expr;
	span: Span;
}

export interface ReturnStatement {
	kind: "return";
	span: Span;
}

export interface ExitStatement {
	kind: "exit";
	span: Span;
}

export interface ContinueStatement {
	kind: "continue";
	span: Span;
}

/** A lone `;` — kept so statement counts/spans stay faithful. */
export interface EmptyStatement {
	kind: "empty";
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
