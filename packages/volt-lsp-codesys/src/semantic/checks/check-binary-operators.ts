/**
 * Binary-operator type-mismatch — narrow coverage of the specific
 * gaps the conformance harness flagged:
 *   - `MOD` with non-integer operand (TC: "'MOD' is not defined for 'REAL'")
 *   - arithmetic (+, -, *, /) mixing BOOL with numeric (TC: "Cannot
 *     convert type 'BOOL' to type 'INT'")
 *
 * Conservative: skips when either operand isn't a single identifier
 * (literals, conversion calls, nested expressions) — too easy to
 * false-positive without full expression typing.
 */
import type { ParseResult } from "../../parser/ast.js";
import type { Scope } from "../symbol-table.js";
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
						source: "volt-lsp-codesys",
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
						source: "volt-lsp-codesys",
						code: "binary-op-type-mismatch",
						message: `Arithmetic '${opText}' cannot mix BOOL with numeric — got ${aType} ${opText} ${bType}.`,
					});
				}
			}
		}
	}
}
