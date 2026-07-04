/**
 * Pointer-deref applied to a non-pointer — flag `x^` where `x` is not a
 * pointer, mirroring TC's `'^' is not defined for type ...` compile error.
 *
 * Walks the statement AST (`st-body-ast`) and inspects the deref base's
 * declared type via `type-infer.ts`, so any base shape is covered (`x^`,
 * `obj.field^`, `arr[i]^`, `p^^`). A `POINTER TO …` base is the one legal
 * case and is skipped; every other concrete type (elementary, string,
 * array, reference, enum) is flagged, matching the compiler. A base whose
 * type can't be determined (`THIS`, unresolved, computed) is skipped, so
 * there are no false positives.
 */
import type { Expr, ParseResult } from "../../parser/ast.js";
import type { Scope } from "../symbol-table.js";
import { parseStatements } from "../../parser/statements.js";
import { walkAllExprs } from "../../parser/ast-walk.js";
import { inferExprType } from "../type-infer.js";
import { type DiagnosticItem, getBody, findScopeForUnit } from "./_shared.js";

/** Source-like text of a deref base, for the diagnostic message. */
function renderBase(expr: Expr): string {
	switch (expr.kind) {
		case "ident_expr":
			return expr.name;
		case "member":
			return `${renderBase(expr.base)}.${expr.member.name}`;
		case "index":
			return `${renderBase(expr.base)}[…]`;
		case "paren":
			return renderBase(expr.inner);
		default:
			return "expression";
	}
}

export function checkDerefOnNonPointer(
	parseResult: ParseResult,
	project: Scope,
	out: DiagnosticItem[],
): void {
	for (const unit of parseResult.units) {
		const body = getBody(unit);
		if (body === undefined) continue;
		const scope = findScopeForUnit(project, unit);
		if (scope === undefined) continue;

		const parsed = parseStatements(body);
		if (!parsed.ok) continue; // body-AST is 100% on real code; skip a non-parsing body (conservative)
		walkAllExprs(parsed.statements, (e) => {
			if (e.kind !== "deref") return;
			const te = inferExprType(e.base, scope, project).typeExpr;
			if (te === undefined) return; // THIS / unresolved / computed base — can't decide, skip
			if (te.kind === "pointer_type") return; // the one legal case
			let label: string;
			switch (te.kind) {
				case "named_type": label = te.name.text; break;
				case "string_type": label = te.wide ? "WSTRING" : "STRING"; break;
				case "array_type": label = "ARRAY"; break;
				case "reference_type": label = "REFERENCE"; break;
				case "implicit_enum_type": label = "(implicit enum)"; break;
				default: return;
			}
			out.push({
				severity: "error",
				span: e.span,
				source: "volt-lsp-iec",
				code: "deref-non-pointer",
				message: `Cannot dereference '${renderBase(e.base)}': '${label}' is not a pointer type.`,
			});
		});
	}
}
