/**
 * Call-argument-mismatch (st-type-inference §4) — checks a call against
 * the callee's declared parameters:
 *   - a named input `p := v` naming a parameter the callee doesn't declare,
 *   - more positional arguments than the callee accepts,
 *   - an argument whose (elementary) type is incompatible with its parameter.
 *
 * Tree-only (uses the statement AST + shared inference); conservative by
 * design and **default OFF** until oracle-validated. Skips whenever the
 * callee is unresolvable, is a standard/library conversion, or the callee
 * FB `EXTENDS` a base (inherited params aren't in its own var sections, so
 * a name check would false-positive). Types are checked only when both the
 * argument and the parameter resolve to a known elementary type.
 */
import type { CallExpr, Expr, ParseResult, TypeExpr, VarSection } from "../../parser/ast.js";
import type { Scope } from "../symbol-table.js";
import { parseStatements } from "../../parser/statements.js";
import { walkAllExprs } from "../../parser/ast-walk.js";
import { findMemberBearing, hasVarSections, inferExprType, resolveMemberChain, typeExprToInferred } from "../type-infer.js";
import { isAssignable } from "./check-assignment-types.js";
import { getConversion } from "../../reference/type-conversion.js";
import { lookup as referenceLookup } from "../../reference/index.js";
import { type DiagnosticItem, getBody, findScopeForUnit } from "./_shared.js";

interface Callee {
	params: { name: string; typeExpr: TypeExpr }[];
	/** True when the callee FB extends a base — inherited params aren't visible here, so skip name/count. */
	hasExtends: boolean;
}

/** Resolve a call's callee to its declared input parameters, or undefined when unresolvable. */
function resolveCallee(callee: Expr, scope: Scope, project: Scope): Callee | undefined {
	const sym = resolveMemberChain(callee, scope, project);
	let ast: { varSections?: readonly VarSection[]; extends?: unknown } | undefined;
	if (sym !== undefined && hasVarSections(sym)) {
		ast = sym.ast as typeof ast; // direct callable — function / method / FB used as callee
	} else if (sym?.typeExpr?.kind === "named_type") {
		const fb = findMemberBearing(project, sym.typeExpr.name.text); // FB instance → its FB declaration
		ast = fb?.ast as typeof ast;
	}
	if (ast?.varSections === undefined) return undefined;
	const params: { name: string; typeExpr: TypeExpr }[] = [];
	for (const s of ast.varSections) {
		if (s.sectionKind !== "VAR_INPUT" && s.sectionKind !== "VAR_IN_OUT") continue;
		for (const d of s.decls) for (const id of d.names) params.push({ name: id.text, typeExpr: d.type });
	}
	return { params, hasExtends: ast.extends !== undefined };
}

export function checkCallArguments(parseResult: ParseResult, project: Scope, out: DiagnosticItem[]): void {
	for (const unit of parseResult.units) {
		const body = getBody(unit);
		if (body === undefined) continue;
		const scope = findScopeForUnit(project, unit);
		if (scope === undefined) continue;
		const parsed = parseStatements(body);
		if (!parsed.ok) continue; // tree-only — no token fallback for this new check
		walkAllExprs(parsed.statements, (e) => {
			if (e.kind !== "call") return;
			// Standard IEC functions/operators (`REPLACE`, `CONCAT`, `SEL`, conversions, …) have catalog
			// signatures that are often polymorphic/overloaded — the project symbol table's copy (if any) is
			// not authoritative. Skip any callee that resolves in the reference catalog.
			if (e.callee.kind === "ident_expr" && (referenceLookup(e.callee.name) !== undefined || getConversion(e.callee.name) !== undefined)) return;
			const callee = resolveCallee(e.callee, scope, project);
			if (callee === undefined) return;
			checkCall(e, callee, scope, project, out);
		});
	}
}

function checkCall(e: CallExpr, callee: Callee, scope: Scope, project: Scope, out: DiagnosticItem[]): void {
	const paramNames = new Set(callee.params.map((p) => p.name.toLowerCase()));

	// 1. Named input args must name a declared parameter (skip if the FB inherits params we can't see).
	if (!callee.hasExtends) {
		for (const a of e.args) {
			if (a.param !== undefined && !a.output && !paramNames.has(a.param.name.toLowerCase())) {
				out.push({
					severity: "error",
					span: a.param.span,
					source: "volt-lsp-iec",
					code: "call-argument-mismatch",
					message: `'${a.param.name}' is not a parameter of the callee.`,
				});
			}
		}
	}

	// 2. Too many positional args (only for an all-positional call; inheritance/optional make this unsafe otherwise).
	const positional = e.args.filter((a) => a.param === undefined);
	if (!callee.hasExtends && positional.length === e.args.length && callee.params.length > 0 && positional.length > callee.params.length) {
		out.push({
			severity: "error",
			span: e.span,
			source: "volt-lsp-iec",
			code: "call-argument-mismatch",
			message: `Too many arguments: the callee accepts at most ${callee.params.length}, got ${positional.length}.`,
		});
	}

	// 3. Argument-type compatibility (elementary only).
	positional.forEach((a, i) => {
		const p = callee.params[i];
		if (p !== undefined) checkArgType(a.value, p, scope, project, out);
	});
	for (const a of e.args) {
		if (a.param === undefined || a.output) continue;
		const p = callee.params.find((pp) => pp.name.toLowerCase() === a.param!.name.toLowerCase());
		if (p !== undefined) checkArgType(a.value, p, scope, project, out);
	}
}

function checkArgType(argExpr: Expr | undefined, param: { name: string; typeExpr: TypeExpr }, scope: Scope, project: Scope, out: DiagnosticItem[]): void {
	if (argExpr === undefined) return; // unconnected output (`out => ,`) — nothing to type-check
	const argT = inferExprType(argExpr, scope, project);
	if (argT.kind !== "elementary" || argT.name === undefined) return;
	const paramT = typeExprToInferred(param.typeExpr, project);
	if (paramT.kind !== "elementary" || paramT.name === undefined) return;
	if (isAssignable(paramT.name, argT.name, scope, project)) return;
	out.push({
		severity: "error",
		span: argExpr.span,
		source: "volt-lsp-iec",
		code: "call-argument-mismatch",
		message: `Argument of type ${argT.name} is not compatible with parameter '${param.name}' (${paramT.name}).`,
	});
}
