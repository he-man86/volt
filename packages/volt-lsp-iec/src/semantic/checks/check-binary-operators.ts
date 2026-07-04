/**
 * Binary-operator type-mismatch:
 *   - `MOD` with a non-integer operand (TC: "'MOD' is not defined for 'REAL'")
 *   - arithmetic (+, -, *, /) mixing BOOL with numeric (TC: "Cannot
 *     convert type 'BOOL' to type 'INT'")
 *
 * Primary path walks the statement AST (`st-body-ast`) and infers each
 * operand's type via `type-infer.ts`, so operands of any shape (members,
 * calls, nested expressions) are covered — previously it only matched a
 * flat `lhs := a op b` of two bare identifiers. Falls back to the token
 * scan when a body doesn't parse. Conservative: an operand that infers to
 * a non-elementary / unknown type skips the check (never a false positive).
 */
import type { BinaryExpr, BodySpan, Expr, ParseResult } from "../../parser/ast.js";
import type { Scope } from "../symbol-table.js";
import { parseStatements } from "../../parser/statements.js";
import { walkAllExprs } from "../../parser/ast-walk.js";
import { inferExprType } from "../type-infer.js";
import {
	type DiagnosticItem,
	getBody,
	findScopeForUnit,
	simpleIdentifierType,
	isLexerTrivia,
} from "./_shared.js";

const ARITH_OPS = new Set(["+", "-", "*", "/"]);
const INTEGER_TYPES = new Set([
	"SINT", "USINT", "INT", "UINT", "DINT", "UDINT", "LINT", "ULINT",
	"BYTE", "WORD", "DWORD", "LWORD",
]);
const NUMERIC_TYPES = new Set([
	...INTEGER_TYPES,
	"REAL", "LREAL",
]);

/** Operand elementary type name, or undefined (skip) for non-elementary / unknown. */
function elemName(expr: Expr, scope: Scope, project: Scope): string | undefined {
	const t = inferExprType(expr, scope, project);
	return t.kind === "elementary" ? t.name : undefined;
}

export function checkBinaryOperators(
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
		if (parsed.ok) {
			walkAllExprs(parsed.statements, (e) => {
				if (e.kind !== "binary") return;
				const opText = ARITH_OPS.has(e.op) ? e.op : e.op === "MOD" ? "MOD" : undefined;
				if (opText === undefined) return;
				const aType = elemName(e.left, scope, project);
				const bType = elemName(e.right, scope, project);
				if (aType === undefined || bType === undefined) return;
				checkOperands(e, opText, aType, bType, out);
			});
			continue;
		}
		checkTokenScan(body, scope, project, out);
	}
}

/** Apply the MOD / mixed-arithmetic rules to two known operand type names. */
function checkOperands(e: BinaryExpr, opText: string, aType: string, bType: string, out: DiagnosticItem[]): void {
	if (opText === "MOD") {
		if (!INTEGER_TYPES.has(aType) || !INTEGER_TYPES.has(bType)) {
			out.push({
				severity: "error",
				span: e.span,
				source: "volt-lsp-iec",
				code: "binary-op-type-mismatch",
				message: `'MOD' is defined for integer types only — got ${aType} and ${bType}.`,
			});
		}
		return;
	}
	if (ARITH_OPS.has(opText)) {
		if (NUMERIC_TYPES.has(aType) && NUMERIC_TYPES.has(bType)) return;
		if (aType === "BOOL" || bType === "BOOL") {
			out.push({
				severity: "error",
				span: e.span,
				source: "volt-lsp-iec",
				code: "binary-op-type-mismatch",
				message: `Arithmetic '${opText}' cannot mix BOOL with numeric — got ${aType} ${opText} ${bType}.`,
			});
		}
	}
}

/** Original token-scan path — used verbatim when a body doesn't parse to a clean statement tree. */
function checkTokenScan(body: BodySpan, scope: Scope, project: Scope, out: DiagnosticItem[]): void {
	{
		const meaningful = body.tokens.filter((t) => !isLexerTrivia(t.kind));
		// Walk looking for `<lhs> := <a> <op> <b> ;` shapes (6 tokens).
		for (let i = 0; i + 5 < meaningful.length; i++) {
			const lhs = meaningful[i]!;
			const assign = meaningful[i + 1]!;
			const opA = meaningful[i + 2]!;
			const op = meaningful[i + 3]!;
			const opB = meaningful[i + 4]!;
			const semi = meaningful[i + 5]!;
			if (lhs.kind !== "identifier") continue;
			if (assign.kind !== "punct" || assign.text !== ":=") continue;
			if (opA.kind !== "identifier" || opB.kind !== "identifier") continue;
			if (semi.kind !== "punct" || semi.text !== ";") continue;

			let opText: string | undefined;
			if (op.kind === "punct" && ARITH_OPS.has(op.text)) opText = op.text;
			else if (op.kind === "keyword" && op.text.toUpperCase() === "MOD") opText = "MOD";
			if (opText === undefined) continue;

			const aType = simpleIdentifierType(scope, opA.text);
			const bType = simpleIdentifierType(scope, opB.text);
			if (aType === undefined || bType === undefined) continue;

			if (opText === "MOD") {
				if (!INTEGER_TYPES.has(aType) || !INTEGER_TYPES.has(bType)) {
					out.push({
						severity: "error",
						span: op.span,
						source: "volt-lsp-iec",
						code: "binary-op-type-mismatch",
						message: `'MOD' is defined for integer types only — got ${aType} and ${bType}.`,
					});
				}
				continue;
			}
			// Arithmetic + - * /
			if (ARITH_OPS.has(opText)) {
				const bothNumeric = NUMERIC_TYPES.has(aType) && NUMERIC_TYPES.has(bType);
				if (bothNumeric) continue;
				// One BOOL + one numeric — the common cross-type bug.
				if (aType === "BOOL" || bType === "BOOL") {
					out.push({
						severity: "error",
						span: op.span,
						source: "volt-lsp-iec",
						code: "binary-op-type-mismatch",
						message: `Arithmetic '${opText}' cannot mix BOOL with numeric — got ${aType} ${opText} ${bType}.`,
					});
				}
			}
		}
	}
}
