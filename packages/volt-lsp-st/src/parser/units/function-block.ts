/**
 * `FUNCTION_BLOCK Name [FINAL|ABSTRACT] [EXTENDS Base] [IMPLEMENTS …]
 *  <var-sections>
 *  <body>
 *  END_FUNCTION_BLOCK`
 *
 * Modifiers `FINAL` / `ABSTRACT` may appear in either order between the
 * keyword and the name. `EXTENDS` (single base) and `IMPLEMENTS`
 * (comma list) are both optional.
 */
import type { FunctionBlock, Identifier } from "../ast.js";
import type { Cursor } from "../cursor.js";
import { collectBodyUntil, collectVarSections, identFromToken, joinSpans } from "../util.js";

export function parseFunctionBlock(c: Cursor): FunctionBlock | undefined {
	const start = c.expectKeyword("FUNCTION_BLOCK", "at start of FB");
	if (start === undefined) return undefined;

	// Optional modifiers before name: FINAL, ABSTRACT
	let isFinal = false;
	let isAbstract = false;
	while (true) {
		const mod = c.eatAnyKeyword("FINAL", "ABSTRACT");
		if (mod === undefined) break;
		if (mod.keyword === "FINAL") isFinal = true;
		if (mod.keyword === "ABSTRACT") isAbstract = true;
	}

	const nameTok = c.expectIdent("for FUNCTION_BLOCK name");
	if (nameTok === undefined) return undefined;
	const name = identFromToken(nameTok);

	// Optional EXTENDS X
	let extendsName: Identifier | undefined;
	if (c.eatKeyword("EXTENDS") !== undefined) {
		const t = c.expectIdent("after EXTENDS");
		if (t !== undefined) extendsName = identFromToken(t);
	}

	// Optional IMPLEMENTS X, Y, Z
	let implementsList: Identifier[] | undefined;
	if (c.eatKeyword("IMPLEMENTS") !== undefined) {
		implementsList = [];
		const firstIface = c.expectIdent("after IMPLEMENTS");
		if (firstIface !== undefined) implementsList.push(identFromToken(firstIface));
		while (c.eatPunct(",") !== undefined) {
			const more = c.expectIdent("in IMPLEMENTS list");
			if (more === undefined) break;
			implementsList.push(identFromToken(more));
		}
	}

	const varSections = collectVarSections(c);
	const body = collectBodyUntil(c, "END_FUNCTION_BLOCK", "function block");

	return {
		kind: "function_block",
		name,
		...(extendsName !== undefined ? { extends: extendsName } : {}),
		...(implementsList !== undefined ? { implements: implementsList } : {}),
		...(isFinal ? { final: true } : {}),
		...(isAbstract ? { abstract: true } : {}),
		varSections,
		body,
		span: joinSpans(start.span, body.span),
	};
}
