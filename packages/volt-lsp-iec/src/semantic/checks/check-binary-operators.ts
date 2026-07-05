/**
 * Binary-operator type-mismatch:
 *   - `MOD` with a non-integer operand (TC: "'MOD' is not defined for 'REAL'")
 *   - arithmetic (+, -, *, /) mixing BOOL with numeric (TC: "Cannot
 *     convert type 'BOOL' to type 'INT'")
 *
 * Walks the statement AST (`st-body-ast`) and infers each operand's type
 * via `type-infer.ts`, so operands of any shape (members, calls, nested
 * expressions) are covered. A body that doesn't parse to a clean tree is
 * skipped (the treewalker is 100% on real code). Conservative: an operand
 * that infers to a non-elementary / unknown type skips the check.
 */
import type { BinaryExpr, Expr, ParseResult } from "../../parser/ast.js";
import type { Scope } from "../symbol-table.js";
import { parseStatements } from "../../parser/statements.js";
import { walkAllExprs } from "../../parser/ast-walk.js";
import { inferExprType } from "../type-infer.js";
import type { Vendor } from "../../reference/index.js";
import { type DiagnosticItem, cannotConvert, getBody, findScopeForUnit } from "./_shared.js";
import { isIntegerType, isNumericType } from "../type-system/elementary.js";

const ARITH_OPS = new Set(["+", "-", "*", "/"]);

/** Operand elementary type name, or undefined (skip) for non-elementary / unknown. */
function elemName(expr: Expr, scope: Scope, project: Scope): string | undefined {
	const t = inferExprType(expr, scope, project);
	return t.kind === "elementary" ? t.name : undefined;
}

export function checkBinaryOperators(
	parseResult: ParseResult,
	project: Scope,
	activeVendor: Vendor | undefined,
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
			if (e.kind !== "binary") return;
			const opText = ARITH_OPS.has(e.op) ? e.op : e.op === "MOD" ? "MOD" : undefined;
			if (opText === undefined) return;
			const aType = elemName(e.left, scope, project);
			const bType = elemName(e.right, scope, project);
			if (aType === undefined || bType === undefined) return;
			checkOperands(e, opText, aType, bType, activeVendor, out);
		});
	}
}

/** Apply the MOD / mixed-arithmetic rules to two known operand type names. */
function checkOperands(e: BinaryExpr, opText: string, aType: string, bType: string, activeVendor: Vendor | undefined, out: DiagnosticItem[]): void {
	if (opText === "MOD") {
		if (!isIntegerType(aType) || !isIntegerType(bType)) {
			// Mirror the compiler: it names the offending (non-integer) operand type. TwinCAT quotes both the
			// operator and the type (`'MOD' is not defined for 'REAL'`); CODESYS quotes neither.
			const bad = !isIntegerType(aType) ? aType : bType;
			const message = activeVendor === "twincat"
				? `'MOD' is not defined for '${bad}'`
				: `MOD is not defined for ${bad}`;
			out.push({
				severity: "error",
				span: e.span,
				source: "volt-lsp-iec",
				code: "binary-op-type-mismatch",
				message,
			});
		}
		return;
	}
	if (ARITH_OPS.has(opText)) {
		if (isNumericType(aType) && isNumericType(bType)) return;
		if (aType === "BOOL" || bType === "BOOL") {
			out.push({
				severity: "error",
				span: e.span,
				source: "volt-lsp-iec",
				code: "binary-op-type-mismatch",
				// Mirror the compiler: it reports this as an implicit-conversion failure, BOOL → the numeric
					// operand (`Cannot convert type 'BOOL' to type 'INT'`), not as an "arithmetic" complaint.
					message: cannotConvert("BOOL", aType === "BOOL" ? bType : aType),
			});
		}
	}
}
