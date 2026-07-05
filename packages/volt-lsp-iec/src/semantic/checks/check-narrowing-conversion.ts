/**
 * Narrowing-conversion warning (st-type-inference §5) — the one
 * diagnostic the CODESYS/TwinCAT compiler emits that the LSP otherwise
 * lacks: an implicit LREAL→REAL assignment ("possible loss of
 * information"). A WARNING, not an error — the code compiles.
 *
 * Tree-only, uses the shared inference engine; conservative (both sides
 * must resolve to known elementary types) and **ON by default** since
 * 2026-07-05 — the live oracle (conformance fixture `narrowing_lreal_to_real`)
 * confirms BOTH CODESYS and TwinCAT emit this warning on LREAL→REAL. Wider
 * narrowings can be added once each is oracle-validated the same way.
 */
import type { Expr, ParseResult } from "../../parser/ast.js";
import type { Scope } from "../symbol-table.js";
import type { Vendor } from "../../reference/index.js";
import { parseStatements } from "../../parser/statements.js";
import { walkStatements } from "../../parser/ast-walk.js";
import { inferExprType } from "../type-infer.js";
import { type DiagnosticItem, getBody, findScopeForUnit } from "./_shared.js";

/** Elementary type name of an expression, or undefined. */
function elemName(expr: Expr, scope: Scope, project: Scope): string | undefined {
	const t = inferExprType(expr, scope, project);
	return t.kind === "elementary" ? t.name : undefined;
}

export function checkNarrowingConversion(
	parseResult: ParseResult,
	project: Scope,
	activeVendor: Vendor | undefined,
	out: DiagnosticItem[],
): void {
	// Mirror the compiler's exact warning text — verified live: CODESYS capitalizes "Possible", TwinCAT
	// lowercases "possible"; neither has a trailing period. (The LSP's own wording used to differ on both.)
	const possible = activeVendor === "twincat" ? "possible" : "Possible";
	for (const unit of parseResult.units) {
		const body = getBody(unit);
		if (body === undefined) continue;
		const scope = findScopeForUnit(project, unit);
		if (scope === undefined) continue;
		const parsed = parseStatements(body);
		if (!parsed.ok) continue; // tree-only
		walkStatements(parsed.statements, (s) => {
			if (s.kind !== "assign") return;
			if (s.op !== undefined) return; // set/reset/reference operators — not a value narrowing
			const target = elemName(s.target, scope, project);
			const value = elemName(s.value, scope, project);
			if (target === "REAL" && value === "LREAL") {
				out.push({
					severity: "warning",
					span: s.target.span,
					source: "volt-lsp-iec",
					code: "narrowing-conversion",
					message: `Implicit conversion from '${value}' to '${target}': ${possible} loss of information`,
				});
			}
		});
	}
}
