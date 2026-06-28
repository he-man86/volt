/**
 * VAR section parser. Handles all 9 VAR variants and their modifiers
 * (CONSTANT, RETAIN, NON_RETAIN, PERSISTENT).
 *
 * Grammar (simplified):
 *   VarSection := VarKw Modifiers* VarDecl* END_VAR
 *   VarKw      := VAR | VAR_INPUT | VAR_OUTPUT | VAR_IN_OUT | VAR_TEMP
 *               | VAR_STAT | VAR_INST | VAR_EXTERNAL | VAR_GLOBAL
 *               | VAR_CONFIG | VAR_ACCESS
 *   Modifier   := CONSTANT | RETAIN | NON_RETAIN | PERSISTENT
 *   VarDecl    := Name (',' Name)* ':' TypeExpr
 *                  ('AT' OpaqueAddr)?
 *                  (':=' OpaqueInit)?
 *                  ';'
 *
 * Recovery: on a bad decl line, skip to the next ';' or END_VAR so
 * one malformed var doesn't poison the rest of the section.
 */
import type { Keyword, Token } from "../lexer/tokens.js";
import {
	type Identifier,
	type VarDecl,
	type VarSection,
	type VarSectionKind,
} from "./ast.js";
import { Cursor } from "./cursor.js";
import { bodySpanFromTokens, identFromToken, joinSpans } from "./util.js";
import { parseTypeExpression } from "./type-expr.js";

const SECTION_KEYWORDS: readonly Keyword[] = [
	"VAR",
	"VAR_INPUT",
	"VAR_OUTPUT",
	"VAR_IN_OUT",
	"VAR_TEMP",
	"VAR_STAT",
	"VAR_INST",
	"VAR_EXTERNAL",
	"VAR_GLOBAL",
	"VAR_CONFIG",
	"VAR_ACCESS",
	"VAR_GENERIC",
];

/** Returns true if the next meaningful token starts a VAR section. */
export function atVarSection(c: Cursor): boolean {
	const t = c.peek();
	return (
		t.kind === "keyword" &&
		t.keyword !== undefined &&
		SECTION_KEYWORDS.includes(t.keyword)
	);
}

/** Parse a single VAR section starting at one of the section keywords. */
export function parseVarSection(c: Cursor): VarSection | undefined {
	const header = c.eatAnyKeyword(...SECTION_KEYWORDS);
	if (header === undefined) return undefined;

	const sectionKind = header.keyword as VarSectionKind;
	const section: VarSection = {
		kind: "var_section",
		sectionKind,
		decls: [],
		span: header.span,
	};

	// Modifiers — any combination of CONSTANT / RETAIN / NON_RETAIN / PERSISTENT.
	while (true) {
		const mod = c.eatAnyKeyword("CONSTANT", "RETAIN", "NON_RETAIN", "PERSISTENT");
		if (mod === undefined) break;
		if (mod.keyword === "CONSTANT") section.constant = true;
		if (mod.keyword === "RETAIN") section.retain = true;
		if (mod.keyword === "NON_RETAIN") section.nonRetain = true;
		if (mod.keyword === "PERSISTENT") section.persistent = true;
	}

	// Decls until END_VAR.
	while (!c.atEof()) {
		const endVar = c.eatKeyword("END_VAR");
		if (endVar !== undefined) {
			section.span = joinSpans(header.span, endVar.span);
			return section;
		}
		const decl = parseVarDecl(c);
		if (decl !== undefined) {
			section.decls.push(decl);
		} else {
			// Recovery — skip to ';' or END_VAR
			if (!c.recoverTo({ keywords: ["END_VAR"], puncts: [";"] })) break;
			c.eatPunct(";"); // consume the ';' anchor if that's what we landed on
		}
	}
	c.pushError("unterminated VAR section: expected END_VAR", header.span);
	return section;
}

function parseVarDecl(c: Cursor): VarDecl | undefined {
	const firstName = c.expectIdent("at start of var declaration");
	if (firstName === undefined) return undefined;
	const names: Identifier[] = [readMaybeQualifiedName(c, firstName)];

	while (c.eatPunct(",") !== undefined) {
		const more = c.expectIdent("in comma-separated var name list");
		if (more === undefined) break;
		names.push(readMaybeQualifiedName(c, more));
	}

	// `AT <address>` can appear *before* the colon (standard IEC and
	// TwinCAT memory-mapped vars like `digIn AT %I*`) or *after* the
	// type (less common but seen). We support both — capture whichever
	// fires first into `at`.
	let at: VarDecl["at"];
	const atKwBefore = c.eatKeyword("AT");
	if (atKwBefore !== undefined) {
		const tokens: Token[] = [];
		while (!c.atEof()) {
			const next = c.peek();
			if (next.kind === "punct" && (next.text === ":" || next.text === ":=" || next.text === ";")) break;
			tokens.push(c.consume());
		}
		at = bodySpanFromTokens(tokens, atKwBefore.span);
	}

	const colon = c.expectPunct(":", "after var name(s)");
	if (colon === undefined) return undefined;

	const type = parseTypeExpression(c);
	if (type === undefined) return undefined;

	// Optional `AT <address>` clause *after* the type (alternative position).
	if (at === undefined) {
		const atKw = c.eatKeyword("AT");
		if (atKw !== undefined) {
			const tokens: Token[] = [];
			while (!c.atEof()) {
				const next = c.peek();
				if (next.kind === "punct" && (next.text === ":=" || next.text === ";")) break;
				tokens.push(c.consume());
			}
			at = bodySpanFromTokens(tokens, atKw.span);
		}
	}

	// Optional `:= <init>` clause
	let init: VarDecl["init"];
	const assign = c.eatPunct(":=");
	if (assign !== undefined) {
		const tokens: Token[] = [];
		while (!c.atEof()) {
			const next = c.peek();
			if (next.kind === "punct" && next.text === ";") break;
			tokens.push(c.consume());
		}
		init = bodySpanFromTokens(tokens, assign.span);
	}

	const semi = c.expectPunct(";", "after var declaration");
	const endSpan = semi?.span ?? init?.span ?? at?.span ?? type.span;

	return {
		kind: "var_decl",
		names,
		type,
		...(init !== undefined ? { init } : {}),
		...(at !== undefined ? { at } : {}),
		span: joinSpans(firstName.span, endSpan),
	};
}

/**
 * Some VAR sections — most notably VAR_CONFIG at the GVL/file level —
 * accept dot-qualified names like `PROGRAM_NAME.var_name`. Consume the
 * `.<ident>` suffix(es) and fold the whole qualified path back into a
 * single Identifier whose `text` carries the joined name. Symbol-table
 * consumers see one symbol with the dotted text — accurate to what the
 * source declared.
 */
function readMaybeQualifiedName(c: Cursor, first: Token): Identifier {
	const parts: string[] = [first.text];
	let lastSpan = first.span;
	while (c.eatPunct(".") !== undefined) {
		const next = c.eatIdent();
		if (next === undefined) break;
		parts.push(next.text);
		lastSpan = next.span;
	}
	if (parts.length === 1) return identFromToken(first);
	return {
		kind: "identifier",
		text: parts.join("."),
		span: joinSpans(first.span, lastSpan),
	};
}
