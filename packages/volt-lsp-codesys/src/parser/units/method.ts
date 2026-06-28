/**
 * `METHOD <stacked-modifiers> Name [: ReturnType]
 *  <var-sections>
 *  <body>
 *  END_METHOD`
 *
 * Stacked modifiers (in any order): access (PUBLIC/PRIVATE/PROTECTED/
 * INTERNAL), FINAL, ABSTRACT, OVERRIDE.
 *
 * The April 2026 regression anchor: every order combination must
 * parse cleanly — the modifier loop accepts them in any sequence and
 * sets the corresponding flag. Don't reorder the keyword list in
 * `eatAnyKeyword` without re-running the stacked-modifier corpus.
 */
import type { Method } from "../ast.js";
import type { Cursor } from "../cursor.js";
import { parseTypeExpression } from "../type-expr.js";
import { collectBodyUntil, collectVarSections, identFromToken, joinSpans } from "../util.js";

export function parseMethod(c: Cursor): Method | undefined {
	const start = c.expectKeyword("METHOD", "at start of METHOD");
	if (start === undefined) return undefined;

	let accessModifier: Method["accessModifier"];
	let isFinal = false;
	let isAbstract = false;
	let isOverride = false;
	while (true) {
		const mod = c.eatAnyKeyword(
			"PUBLIC",
			"PRIVATE",
			"PROTECTED",
			"INTERNAL",
			"FINAL",
			"ABSTRACT",
			"OVERRIDE",
		);
		if (mod === undefined) break;
		if (
			mod.keyword === "PUBLIC" ||
			mod.keyword === "PRIVATE" ||
			mod.keyword === "PROTECTED" ||
			mod.keyword === "INTERNAL"
		) {
			accessModifier = mod.keyword;
		} else if (mod.keyword === "FINAL") {
			isFinal = true;
		} else if (mod.keyword === "ABSTRACT") {
			isAbstract = true;
		} else if (mod.keyword === "OVERRIDE") {
			isOverride = true;
		}
	}

	const nameTok = c.expectIdent("for METHOD name");
	if (nameTok === undefined) return undefined;
	const name = identFromToken(nameTok);

	// Optional `: ReturnType`
	let returnType: Method["returnType"];
	if (c.eatPunct(":") !== undefined) {
		returnType = parseTypeExpression(c);
	}

	const varSections = collectVarSections(c);
	const body = collectBodyUntil(c, "END_METHOD", "method");

	return {
		kind: "method",
		name,
		...(accessModifier !== undefined ? { accessModifier } : {}),
		...(isFinal ? { final: true } : {}),
		...(isAbstract ? { abstract: true } : {}),
		...(isOverride ? { override: true } : {}),
		...(returnType !== undefined ? { returnType } : {}),
		varSections,
		body,
		span: joinSpans(start.span, body.span),
	};
}
