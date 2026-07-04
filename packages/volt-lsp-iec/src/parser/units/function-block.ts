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
import { collectBodyUntil, collectBodyUntilAny, collectVarSections, identFromToken, joinSpans } from "../util.js";

export function parseFunctionBlock(c: Cursor): FunctionBlock | undefined {
	const start = c.expectKeyword("FUNCTION_BLOCK", "at start of FB");
	if (start === undefined) return undefined;

	// Optional modifiers before name (any order): access (PUBLIC/PRIVATE/PROTECTED/INTERNAL),
	// FINAL, ABSTRACT — real CODESYS code writes e.g. `FUNCTION_BLOCK PUBLIC FB_X`.
	let accessModifier: FunctionBlock["accessModifier"];
	let isFinal = false;
	let isAbstract = false;
	while (true) {
		const mod = c.eatAnyKeyword("PUBLIC", "PRIVATE", "PROTECTED", "INTERNAL", "FINAL", "ABSTRACT");
		if (mod === undefined) break;
		if (mod.keyword === "PUBLIC" || mod.keyword === "PRIVATE" || mod.keyword === "PROTECTED" || mod.keyword === "INTERNAL") {
			accessModifier = mod.keyword;
		} else if (mod.keyword === "FINAL") isFinal = true;
		else if (mod.keyword === "ABSTRACT") isAbstract = true;
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

	// Some CODESYS exports terminate the FB header with a stray `;` (e.g. `FUNCTION_BLOCK X EXTENDS Y;`).
	// Consume it — otherwise collectVarSections stops at the `;`, drops every local from the symbol table,
	// and every member reference false-positives as unresolved-identifier. (Same class as the METHOD/FUNCTION
	// trailing-`;` fix.)
	c.eatPunct(";");

	const varSections = collectVarSections(c);
	// A graphical (FBD/LD) implementation body materializes as a second `FUNCTION_BLOCK` block whose
	// NETWORK content is closed by END_METHOD (not END_FUNCTION_BLOCK) — accept either for graphical bodies.
	const graphical = c.peek().kind === "identifier" && c.peek().text.toUpperCase() === "NETWORK";
	const body = graphical
		? collectBodyUntilAny(c, ["END_FUNCTION_BLOCK", "END_METHOD"], "function block")
		: collectBodyUntil(c, "END_FUNCTION_BLOCK", "function block");

	return {
		kind: "function_block",
		name,
		...(accessModifier !== undefined ? { accessModifier } : {}),
		...(extendsName !== undefined ? { extends: extendsName } : {}),
		...(implementsList !== undefined ? { implements: implementsList } : {}),
		...(isFinal ? { final: true } : {}),
		...(isAbstract ? { abstract: true } : {}),
		varSections,
		body,
		span: joinSpans(start.span, body.span),
	};
}
