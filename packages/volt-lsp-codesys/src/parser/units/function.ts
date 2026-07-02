/**
 * `FUNCTION Name [: ReturnType] <var-sections> <body> END_FUNCTION`
 *
 * Functions are stateless callables — no FB-level inheritance, no
 * methods of their own. The optional return-type clause uses the
 * same TypeExpr grammar as VAR declarations.
 */
import type { Function as FunctionAST } from "../ast.js";
import type { Cursor } from "../cursor.js";
import { parseOptionalReturnType } from "../type-expr.js";
import { collectBodyUntil, collectVarSections, identFromToken, joinSpans } from "../util.js";

export function parseFunction(c: Cursor): FunctionAST | undefined {
	const start = c.expectKeyword("FUNCTION", "at start of FUNCTION");
	if (start === undefined) return undefined;
	const nameTok = c.expectIdent("for FUNCTION name");
	if (nameTok === undefined) return undefined;
	const name = identFromToken(nameTok);

	const returnType = parseOptionalReturnType(c);

	const varSections = collectVarSections(c);
	const body = collectBodyUntil(c, "END_FUNCTION", "function");

	return {
		kind: "function",
		name,
		...(returnType !== undefined ? { returnType } : {}),
		varSections,
		body,
		span: joinSpans(start.span, body.span),
	};
}
