/**
 * Narrowing-conversion warning (st-type-inference §5) — the one
 * diagnostic the CODESYS/TwinCAT compiler emits that the LSP otherwise
 * lacks: an implicit LREAL→REAL assignment ("possible loss of
 * information"). A WARNING, not an error — the code compiles.
 *
 * Tree-only, uses the shared inference engine; conservative (both sides
 * must resolve to known elementary types) and **default OFF**. The
 * confirmed case is LREAL→REAL (bakon: 27 compiler warnings); wider
 * narrowings can be added once oracle-validated.
 */
import type { Expr, ParseResult } from "../../parser/ast.js";
import type { Scope } from "../symbol-table.js";
import { parseStatements } from "../../parser/statements.js";
import { walkStatements } from "../../parser/ast-walk.js";
import { inferExprType } from "../type-infer.js";
import { type DiagnosticItem, getBody, findScopeForUnit } from "./_shared.js";

/** Elementary type name of an expression, or undefined. */
function elemName(expr: Expr, scope: Scope, project: Scope): string | undefined {
	const t = inferExprType(expr, scope, project);
	return t.kind === "elementary" ? t.name : undefined;
}

export function checkNarrowingConversion(parseResult: ParseResult, project: Scope, out: DiagnosticItem[]): void {
	for (const unit of parseResult.units) {
		const body = getBody(unit);
		if (body === undefined) continue;
		const scope = findScopeForUnit(project, unit);
		if (scope === undefined) continue;
		const parsed = parseStatements(body);
		if (!parsed.ok) continue; // tree-only
		walkStatements(parsed.statements, (s) => {
			if (s.kind !== "assign") return;
			const target = elemName(s.target, scope, project);
			const value = elemName(s.value, scope, project);
			if (target === "REAL" && value === "LREAL") {
				out.push({
					severity: "warning",
					span: s.target.span,
					source: "volt-lsp-iec",
					code: "narrowing-conversion",
					message: "Implicit conversion from 'LREAL' to 'REAL': possible loss of information.",
				});
			}
		});
	}
}
