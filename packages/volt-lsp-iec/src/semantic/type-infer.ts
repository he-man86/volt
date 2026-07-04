/**
 * Shared semantic-query service over the ST tree + symbol table.
 *
 * The one place that answers "given a name / an expression, what symbol
 * or type does it denote?" so `checks/**` and `lsp/queries/**` stop
 * hand-rolling their own scope walks. Extends `type-resolver.ts` (which
 * stays the named-type → kind lookup); this module adds the project-wide
 * symbol finders and (later) expression type inference + member-chain
 * resolution built on them.
 *
 * See `openspec/changes/st-type-inference/design.md` (D6).
 */
import type { BinaryExpr, CallExpr, Expr, Literal, TypeExpr } from "../parser/ast.js";
import type { Scope, Symbol } from "./symbol-table.js";
import { lookupLocal } from "./symbol-table.js";
import { lookup as resolverLookup } from "./resolver.js";
import { resolveNamedType, resolveTypeExpr, type ResolvedKind } from "./type-resolver.js";

/**
 * Depth-first search of the project scope tree for the first symbol whose
 * name matches (case-insensitive) and passes `ok`. This is the shared core
 * that the per-query `find{Symbol,Callable,CallableType,TypeAst}` walks
 * collapsed into.
 */
export function findSymbolByName(
	project: Scope,
	name: string,
	ok?: (sym: Symbol) => boolean,
): Symbol | undefined {
	const target = name.toLowerCase();
	const stack: Scope[] = [project];
	while (stack.length > 0) {
		const sc = stack.pop() as Scope;
		for (const [, syms] of sc.symbols) {
			for (const sym of syms) {
				if (sym.name.toLowerCase() === target && (ok === undefined || ok(sym))) return sym;
			}
		}
		stack.push(...sc.children);
	}
	return undefined;
}

/** A symbol whose AST carries `varSections` (FB / PROGRAM / FUNCTION / METHOD) — i.e. has members. */
export function hasVarSections(sym: Symbol): boolean {
	return Array.isArray((sym.ast as { varSections?: ReadonlyArray<unknown> }).varSections);
}

/**
 * The enum-value symbol for a BARE reference to a non-`qualified_only` enum member
 * (`StateAutomatic`) — a global constant per IEC/CODESYS whose symbol lives in the
 * enum's own scope, off the resolver's parent chain. Lets nav (go-to-def / hover)
 * reach it. Undefined when no such member exists.
 */
export function resolveBareEnumMember(project: Scope, name: string): Symbol | undefined {
	const target = name.toLowerCase();
	for (const child of project.children) {
		if (child.kind !== "enum" || child.qualifiedOnly === true) continue;
		const syms = child.symbols.get(target);
		if (syms !== undefined && syms.length > 0) return syms[0];
	}
	return undefined;
}

/** The first symbol with members (`varSections`) matching `name`, project-wide. */
export function findMemberBearing(project: Scope, name: string): Symbol | undefined {
	return findSymbolByName(project, name, hasVarSections);
}

/**
 * Render a loosely-typed `TypeExpr`-shaped value to display text (`ARRAY OF X`,
 * `POINTER TO X`, `STRING`). Takes `unknown` because call sites read it off a
 * symbol's AST without a precise type. The shared renderer for the two
 * previously-identical copies (signature-help, vg/calls).
 *
 * NOTE: `hover.ts typeText` (typed, renders real `ARRAY[dims]` + enum values)
 * and `vg/type-env.ts renderType` (uppercases, returns undefined for unknowns)
 * have DIFFERENT contracts and deliberately stay separate — unifying them here
 * would change their output.
 */
export function renderTypeExpr(t: unknown): string {
	if (t === null || typeof t !== "object") return "?";
	const obj = t as { kind?: string; name?: { text: string }; target?: unknown; element?: unknown; wide?: boolean };
	switch (obj.kind) {
		case "named_type":
			return obj.name?.text ?? "?";
		case "array_type":
			return `ARRAY OF ${renderTypeExpr(obj.element)}`;
		case "pointer_type":
			return `POINTER TO ${renderTypeExpr(obj.target)}`;
		case "reference_type":
			return `REFERENCE TO ${renderTypeExpr(obj.target)}`;
		case "string_type":
			return obj.wide ? "WSTRING" : "STRING";
		case "implicit_enum_type":
			return "(implicit enum)";
		default:
			return "?";
	}
}

// ─── Expression type inference (st-type-inference §2) ────────────────
//
// A lean model: the canonical type NAME (which already distinguishes
// `LREAL` from `REAL`, so `reference/type-conversion.ts` compatibility
// works directly on it), plus the member `scope` for `a.b` chains and the
// declared `typeExpr` for array-element / pointer-target descent. Every
// arm returns `UNKNOWN_TYPE` on any unresolved sub-part — a consumer acts
// only on a fully-known type, which is what keeps the checks zero-FP.

export interface InferredType {
	kind: ResolvedKind; // elementary | enum | struct | function_block | alias | unknown
	/** Canonical type name (elementary uppercased, or the named-type text). Undefined for composites/unknown. */
	name?: string;
	/** Member scope for a struct / FB / enum — the base for `a.b`. */
	scope?: Scope;
	/** Declared type expression, for descending into arrays (element) / pointers (target). */
	typeExpr?: TypeExpr;
}

export const UNKNOWN_TYPE: InferredType = { kind: "unknown" };

/** IEC type abbreviations → their canonical short form, so `TIME_OF_DAY` and `TOD` compare equal. */
const ELEM_ABBREV: Record<string, string> = {
	TIME_OF_DAY: "TOD",
	DATE_AND_TIME: "DT",
	LDATE_AND_TIME: "LDT",
	LTIME_OF_DAY: "LTOD",
};
function canonicalElem(name: string): string {
	const u = name.toUpperCase();
	return ELEM_ABBREV[u] ?? u;
}

/**
 * The underlying canonical elementary name for a type name — follows alias
 * chains (`FILENAME → STRING(255) → STRING`) and normalizes IEC abbreviations
 * (`TIME_OF_DAY → TOD`). Only meaningful when the type resolves to elementary;
 * used so compatibility compares underlying types, not alias/abbreviation names.
 */
function underlyingElementaryName(name: string, project: Scope): string {
	const r = resolveNamedType(name, project);
	if (r.kind === "alias" && r.aliasTarget !== undefined) {
		const at = r.aliasTarget;
		if (at.kind === "named_type") return underlyingElementaryName(at.name.text, project);
		if (at.kind === "string_type") return at.wide ? "WSTRING" : "STRING";
	}
	return canonicalElem(name);
}

/** Resolve a declared `TypeExpr` to an `InferredType` (name + kind + member scope). */
export function typeExprToInferred(t: TypeExpr, project: Scope): InferredType {
	switch (t.kind) {
		case "named_type": {
			const r = resolveTypeExpr(t, project);
			// For a type that resolves to elementary (directly or via an alias), use the underlying
			// canonical elementary name so aliases/abbreviations don't false-positive in compatibility.
			const name = r.kind === "elementary" ? underlyingElementaryName(t.name.text, project) : t.name.text.toUpperCase();
			return { kind: r.kind, name, scope: r.scope, typeExpr: t };
		}
		case "string_type":
			return { kind: "elementary", name: t.wide ? "WSTRING" : "STRING", typeExpr: t };
		case "implicit_enum_type":
			return { kind: "enum", typeExpr: t };
		default: // array / pointer / reference — composite; keep typeExpr for descent
			return { kind: "unknown", typeExpr: t };
	}
}

/** The enclosing POU scope (walking out through method/accessor scopes) — the home of `THIS`. */
function enclosingPou(scope: Scope): Scope | undefined {
	let s: Scope | undefined = scope;
	while (s !== undefined) {
		if (s.kind === "pou") return s;
		s = s.parent;
	}
	return undefined;
}

/** The InferredType for `THIS` — the enclosing FB carrying its member scope. */
function thisType(scope: Scope): InferredType {
	const pou = enclosingPou(scope);
	return pou !== undefined ? { kind: "function_block", scope: pou } : UNKNOWN_TYPE;
}

/** A bare name that names a GVL/enum/namespace/POU/struct scope (a static member base like `GVL.x`). */
function staticScopeType(project: Scope, name: string): InferredType | undefined {
	const target = name.toLowerCase();
	for (const child of project.children) {
		if (child.name.toLowerCase() !== target) continue;
		if (child.kind === "gvl" || child.kind === "enum" || child.kind === "namespace" || child.kind === "pou" || child.kind === "struct" || child.kind === "interface") {
			return { kind: child.kind === "enum" ? "enum" : "struct", scope: child };
		}
	}
	return undefined;
}

/** Infer the type of an ST expression. Bottom-up, total, `unknown` on any unresolved sub-part. */
export function inferExprType(expr: Expr, scope: Scope, project: Scope): InferredType {
	switch (expr.kind) {
		case "literal":
			return literalType(expr);
		case "ident_expr": {
			// THIS / THIS^ denote the enclosing FB instance — resolve to its member scope so
			// `THIS^.field` navigates. (THIS is a pointer-to-FB in IEC; we model it already-deref'd
			// and let the `deref` arm treat `^` on a scoped value as identity.)
			if (expr.name.toUpperCase() === "THIS") return thisType(scope);
			const sym = resolverLookup(scope, expr.name)?.symbol;
			if (sym?.typeExpr !== undefined) return typeExprToInferred(sym.typeExpr, project);
			// Static base: the name itself denotes a GVL / enum / namespace / POU scope (`GVL.field`,
			// `E_State.Idle`), not a typed variable — resolve to that scope so the chain descends.
			return staticScopeType(project, expr.name) ?? UNKNOWN_TYPE;
		}
		case "member": {
			const sym = resolveMemberChain(expr, scope, project);
			return sym?.typeExpr !== undefined ? typeExprToInferred(sym.typeExpr, project) : UNKNOWN_TYPE;
		}
		case "index": {
			const base = inferExprType(expr.base, scope, project);
			return base.typeExpr?.kind === "array_type" ? typeExprToInferred(base.typeExpr.element, project) : UNKNOWN_TYPE;
		}
		case "deref": {
			const base = inferExprType(expr.base, scope, project);
			const t = base.typeExpr;
			if (t?.kind === "pointer_type" || t?.kind === "reference_type") return typeExprToInferred(t.target, project);
			// `THIS^` (and refs already resolved to their target): dereffing a value that already
			// carries a member scope is identity.
			return base.scope !== undefined ? base : UNKNOWN_TYPE;
		}
		case "call":
			return callReturnType(expr, scope, project);
		case "unary":
			// NOT/-/+ all preserve the operand's type (NOT on WORD is a bitwise complement, not BOOL).
			return inferExprType(expr.operand, scope, project);
		case "binary":
			return binaryResultType(expr, scope, project);
		case "paren":
			return inferExprType(expr.inner, scope, project);
	}
}

/**
 * The symbol a reference chain denotes — `x`, `a.b.c`, `a.b()` — or undefined.
 * The nav primitive Phase 2 (`st-nav-chains`) consumes; here it feeds inference.
 */
export function resolveMemberChain(expr: Expr, scope: Scope, project: Scope): Symbol | undefined {
	switch (expr.kind) {
		case "ident_expr":
			return resolverLookup(scope, expr.name)?.symbol;
		case "member": {
			// Static GVL member: `GVL.field`. GVL vars live flat at project scope (not in a child
			// scope), each tagged with the block's uri — resolve the block, then its sibling var.
			const gvlMember = resolveGvlMember(expr, scope, project);
			if (gvlMember !== undefined) return gvlMember;
			const base = inferExprType(expr.base, scope, project);
			return base.scope !== undefined ? lookupLocal(base.scope, expr.member.name)[0] : undefined;
		}
		case "paren":
			return resolveMemberChain(expr.inner, scope, project);
		case "call":
			return resolveMemberChain(expr.callee, scope, project);
		default:
			return undefined;
	}
}

/** `GVL.field` → the flat project-level `gvl_var` sharing the block's uri, or undefined when the base
 *  isn't a GVL block. GVL contents aren't in a child scope, so the generic member arm can't reach them. */
function resolveGvlMember(expr: { base: Expr; member: { name: string } }, scope: Scope, project: Scope): Symbol | undefined {
	if (expr.base.kind !== "ident_expr") return undefined;
	const block = resolverLookup(scope, expr.base.name)?.symbol;
	if (block?.kind !== "gvl_block") return undefined;
	for (const sym of lookupLocal(project, expr.member.name)) {
		if (sym.kind === "gvl_var" && sym.uri === block.uri) return sym;
	}
	return undefined;
}

function literalType(lit: Literal): InferredType {
	switch (lit.literalKind) {
		case "string":
			return { kind: "elementary", name: "STRING" };
		case "wstring":
			return { kind: "elementary", name: "WSTRING" };
		case "bool":
			return { kind: "elementary", name: "BOOL" };
		case "time":
			return { kind: "elementary", name: "TIME" };
		case "date":
			return { kind: "elementary", name: "DATE" };
		case "tod":
			return { kind: "elementary", name: "TOD" };
		case "datetime":
			return { kind: "elementary", name: "DT" };
		case "typed": {
			// `BYTE#170` / `INT#5` → the type prefix. `16#FF` (numeric base) has no type → skip.
			const hash = lit.text.indexOf("#");
			const prefix = hash > 0 ? lit.text.slice(0, hash) : "";
			return /^[A-Za-z_]/.test(prefix) ? { kind: "elementary", name: prefix.toUpperCase() } : UNKNOWN_TYPE;
		}
		default:
			// int / real / address literals are context-dependent — skip (matches the prior token scan).
			return UNKNOWN_TYPE;
	}
}

const COMPARISON_OPS: ReadonlySet<string> = new Set(["=", "<>", "<", ">", "<=", ">="]);

// IEC 61131-3 temporal arithmetic: a datetime minus the same datetime is a DURATION (not the
// datetime), and a datetime ± a duration stays the datetime. Names are canonical (DT/TOD/…).
const DATETIME_TYPES: ReadonlySet<string> = new Set(["DATE", "TOD", "DT", "LDATE", "LTOD", "LDT"]);
const DURATION_TYPES: ReadonlySet<string> = new Set(["TIME", "LTIME"]);
const durationFor = (name: string): string => (name.startsWith("L") ? "LTIME" : "TIME");

/** The IEC result type of temporal `+`/`-`, or undefined when the operands aren't a temporal pair. */
function temporalArithResult(op: string, l: string, r: string): string | undefined {
	if (op === "-") {
		if (DATETIME_TYPES.has(l) && l === r) return durationFor(l); // DT - DT = TIME
		if (DATETIME_TYPES.has(l) && DURATION_TYPES.has(r)) return l; // DT - TIME = DT
	}
	if (op === "+") {
		if (DATETIME_TYPES.has(l) && DURATION_TYPES.has(r)) return l; // DT + TIME = DT
		if (DURATION_TYPES.has(l) && DATETIME_TYPES.has(r)) return r; // TIME + DT = DT
	}
	return undefined;
}

function binaryResultType(e: BinaryExpr, scope: Scope, project: Scope): InferredType {
	if (COMPARISON_OPS.has(e.op)) return { kind: "elementary", name: "BOOL" };
	// Arithmetic / bitwise: conservative — only commit when both operands infer to the same named type.
	const l = inferExprType(e.left, scope, project);
	const r = inferExprType(e.right, scope, project);
	if (l.name !== undefined && r.name !== undefined) {
		const temporal = temporalArithResult(e.op, l.name, r.name);
		if (temporal !== undefined) return { kind: "elementary", name: temporal };
	}
	return l.name !== undefined && l.name === r.name ? l : UNKNOWN_TYPE;
}

function callReturnType(call: CallExpr, scope: Scope, project: Scope): InferredType {
	const sym = resolveMemberChain(call.callee, scope, project);
	return sym?.typeExpr !== undefined ? typeExprToInferred(sym.typeExpr, project) : UNKNOWN_TYPE;
}
