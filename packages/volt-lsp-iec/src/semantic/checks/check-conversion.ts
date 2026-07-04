/**
 * Conversion-source-mismatch — scan each POU body for
 * `<NAME>(<simple_ident>)` patterns where `<NAME>` looks like a
 * type-conversion (`<SRC>_TO_<DST>` or `TRUNC`/`TRUNC_INT`). Resolve
 * the inner identifier; if its declared type doesn't match `<SRC>`,
 * emit an error with a suggested replacement.
 *
 * Limitations (deliberate — we don't type-check expressions):
 *   - Only simple-identifier args. `INT_TO_DINT(a + b)` is skipped.
 *   - Only resolves names visible in the project / containing POU scope.
 *   - `TO_<DST>` overloaded form is skipped (source type is "ANY").
 *   - When the inner identifier can't be resolved, we skip (so the
 *     unresolved-identifier diagnostic handles it, not us).
 */
import type { Expr, ParseResult } from "../../parser/ast.js";
import type { Scope } from "../symbol-table.js";
import { parseStatements } from "../../parser/statements.js";
import { walkAllExprs } from "../../parser/ast-walk.js";
import { inferExprType } from "../type-infer.js";
import {
	conversionsForSource,
	getConversion,
	isAcceptableSource,
} from "../../reference/type-conversion.js";
import { type DiagnosticItem, getBody, findScopeForUnit } from "./_shared.js";

/** Source-like text of a conversion argument, for the diagnostic message. */
function renderArg(expr: Expr): string {
	switch (expr.kind) {
		case "ident_expr":
			return expr.name;
		case "member":
			return `${renderArg(expr.base)}.${expr.member.name}`;
		case "index":
			return `${renderArg(expr.base)}[…]`;
		case "deref":
			return `${renderArg(expr.base)}^`;
		case "paren":
			return renderArg(expr.inner);
		default:
			return "argument";
	}
}

export function checkConversionCalls(
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
		if (!parsed.ok) continue; // body-AST is 100% on real code; skip a non-parsing body (conservative, zero-FP)
		walkAllExprs(parsed.statements, (e) => {
			if (e.kind !== "call" || e.callee.kind !== "ident_expr") return;
			const conv = getConversion(e.callee.name);
			if (conv === undefined || conv.sourceType === "ANY") return;
			if (e.args.length !== 1 || e.args[0]!.param !== undefined) return; // single positional arg
			const arg = e.args[0]!.value;
			if (arg === undefined) return;
			const t = inferExprType(arg, scope, project);
			if (t.kind !== "elementary" || t.name === undefined) return; // only elementary args
			const argType = t.name;
			if (isAcceptableSource(conv, argType)) return;
			const argText = renderArg(arg);
			const replacements = conversionsForSource(argType, conv.destType);
			const suggestion = replacements.length > 0 ? ` Use \`${replacements[0]?.name}(${argText})\` instead.` : "";
			out.push({
				severity: "error",
				span: e.callee.span,
				source: "volt-lsp-iec",
				code: "conversion-source-mismatch",
				message: `Conversion '${conv.name}' expects ${conv.sourceType}, but '${argText}' is declared ${argType}.${suggestion}`,
			});
		});
	}
}
