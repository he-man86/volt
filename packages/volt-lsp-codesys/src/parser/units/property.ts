/**
 * `PROPERTY [Access] Name : DataType <accessors> END_PROPERTY`
 *
 * Properties have GET and/or SET inline accessors. Each accessor has
 * its own VAR sections and body, terminated by END_GET / END_SET.
 *
 * Sloppy termination: many IDE exports omit END_GET/END_SET and let
 * the next GET/SET/END_PROPERTY implicitly close the prior accessor.
 * `collectAccessorBody` handles both forms — when it sees a peek
 * stopper it returns WITHOUT consuming so the outer property loop
 * can dispatch on the next keyword.
 */
import type { BodySpan, Property } from "../ast.js";
import type { Cursor } from "../cursor.js";
import type { Keyword } from "../../lexer/tokens.js";
import { parseTypeExpression } from "../type-expr.js";
import { bodySpanFromTokens, collectVarSections, describeToken, identFromToken, joinSpans } from "../util.js";

export function parseProperty(c: Cursor): Property | undefined {
	const start = c.expectKeyword("PROPERTY", "at start of PROPERTY");
	if (start === undefined) return undefined;

	const accessModifier = (() => {
		const m = c.eatAnyKeyword("PUBLIC", "PRIVATE", "PROTECTED", "INTERNAL");
		return m?.keyword;
	})();

	const nameTok = c.expectIdent("for PROPERTY name");
	if (nameTok === undefined) return undefined;
	const name = identFromToken(nameTok);

	const colon = c.expectPunct(":", "after PROPERTY name");
	if (colon === undefined) return undefined;
	const dataType = parseTypeExpression(c);
	if (dataType === undefined) return undefined;

	let getter: Property["getter"];
	let setter: Property["setter"];

	while (!c.atEof()) {
		const endProp = c.eatKeyword("END_PROPERTY");
		if (endProp !== undefined) {
			return {
				kind: "property",
				name,
				...(accessModifier !== undefined ? { accessModifier } : {}),
				dataType,
				...(getter !== undefined ? { getter } : {}),
				...(setter !== undefined ? { setter } : {}),
				span: joinSpans(start.span, endProp.span),
			};
		}
		const accessor = parseInlineAccessor(c);
		if (accessor !== undefined) {
			if (accessor.kind === "get") getter = accessor;
			else setter = accessor;
			continue;
		}
		// Unknown content inside PROPERTY — record and skip to next anchor
		const stray = c.peek();
		c.pushError(`unexpected ${describeToken(stray)} inside PROPERTY body`, stray.span);
		if (!c.recoverTo({ keywords: ["END_PROPERTY", "GET", "SET"] })) break;
	}

	c.pushError("unterminated PROPERTY: expected END_PROPERTY", start.span);
	return {
		kind: "property",
		name,
		...(accessModifier !== undefined ? { accessModifier } : {}),
		dataType,
		...(getter !== undefined ? { getter } : {}),
		...(setter !== undefined ? { setter } : {}),
		span: joinSpans(start.span, dataType.span),
	};
}

function parseInlineAccessor(c: Cursor): Property["getter"] | undefined {
	const kw = c.eatAnyKeyword("GET", "SET");
	if (kw === undefined) return undefined;
	const kind: "get" | "set" = kw.keyword === "GET" ? "get" : "set";
	const varSections = collectVarSections(c);
	const endAccessor: Keyword = kind === "get" ? "END_GET" : "END_SET";

	// Two acceptable termination patterns:
	//   1. Proper IEC-61131 form:  GET … END_GET   /  SET … END_SET
	//      We CONSUME the END_GET / END_SET as the accessor's closer.
	//   2. Sloppy form (some IDE exports omit END_GET/END_SET and let
	//      the next GET/SET/END_PROPERTY implicitly close the prior):
	//      We STOP at the next GET/SET/END_PROPERTY WITHOUT consuming,
	//      so the outer parseProperty loop can dispatch on it.
	//
	// Don't replace this with `collectBodyUntilAny` — that always
	// consumes its ender, which would swallow the next accessor's
	// opening keyword and mis-parse the rest of the property.
	const body = collectAccessorBody(c, endAccessor);
	return {
		kind,
		varSections,
		body,
		span: joinSpans(kw.span, body.span),
	};
}

function collectAccessorBody(c: Cursor, endAccessor: Keyword): BodySpan {
	const startSpan = c.peek().span;
	const { tokens, closer, stoppedAt } = c.consumeBodyUntilAny({
		consumeEnders: [endAccessor],
		peekStoppers: ["GET", "SET", "END_PROPERTY"],
	});
	if (closer !== undefined) {
		return bodySpanFromTokens(tokens, joinSpans(startSpan, closer.span));
	}
	if (stoppedAt !== undefined) {
		// Sloppy close — stop without consuming; outer recover handles.
		return bodySpanFromTokens(tokens, startSpan);
	}
	c.pushError(
		`unterminated property accessor: expected ${endAccessor} (or next GET/SET/END_PROPERTY)`,
		startSpan,
	);
	return bodySpanFromTokens(tokens, startSpan);
}
