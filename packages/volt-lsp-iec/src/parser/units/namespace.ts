/**
 * `NAMESPACE Name <inner-units> END_NAMESPACE`
 *
 * Namespaces contain other top-level units recursively. Because the
 * dispatcher (`parseTopLevel`) lives in `parser.ts` and that function
 * needs to call back into us, we accept a `parseInner` callback as
 * dependency injection — keeps the import graph acyclic.
 */
import type { Namespace, TopLevel } from "../ast.js";
import type { Cursor } from "../cursor.js";
import { describeToken, identFromToken, joinSpans } from "../util.js";

export function parseNamespace(
	c: Cursor,
	parseInner: (c: Cursor) => TopLevel | undefined,
): Namespace | undefined {
	const start = c.expectKeyword("NAMESPACE", "at start of NAMESPACE");
	if (start === undefined) return undefined;
	const nameTok = c.expectIdent("for NAMESPACE name");
	if (nameTok === undefined) return undefined;
	const name = identFromToken(nameTok);

	const units: TopLevel[] = [];
	while (!c.atEof()) {
		const t = c.peek();
		if (t.kind === "keyword" && t.keyword === "END_NAMESPACE") {
			const closer = c.consume();
			return {
				kind: "namespace",
				name,
				units,
				span: joinSpans(start.span, closer.span),
			};
		}
		const inner = parseInner(c);
		if (inner !== undefined) {
			units.push(inner);
			continue;
		}
		// Unknown token inside namespace — consume one and continue.
		c.pushError(
			`unexpected ${describeToken(t)} inside NAMESPACE — expected POU, TYPE, VAR_GLOBAL, or END_NAMESPACE`,
			t.span,
		);
		c.consume();
	}
	c.pushError(`unterminated NAMESPACE: expected END_NAMESPACE`, start.span);
	return { kind: "namespace", name, units, span: start.span };
}
