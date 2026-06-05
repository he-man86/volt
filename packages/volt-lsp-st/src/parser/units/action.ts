/**
 * `ACTION Name <body> END_ACTION`
 *
 * Actions are the simplest unit — no return type, no modifiers, no
 * VAR sections. The body is captured opaquely up to END_ACTION.
 */
import type { Action } from "../ast.js";
import type { Cursor } from "../cursor.js";
import { collectBodyUntil, identFromToken, joinSpans } from "../util.js";

export function parseAction(c: Cursor): Action | undefined {
	const start = c.expectKeyword("ACTION", "at start of ACTION");
	if (start === undefined) return undefined;
	const nameTok = c.expectIdent("for ACTION name");
	if (nameTok === undefined) return undefined;
	const name = identFromToken(nameTok);
	const body = collectBodyUntil(c, "END_ACTION", "action");
	return {
		kind: "action",
		name,
		body,
		span: joinSpans(start.span, body.span),
	};
}
