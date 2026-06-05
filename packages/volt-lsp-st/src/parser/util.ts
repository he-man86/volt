/**
 * Small parser utilities shared across modules. Kept separate from
 * `cursor.ts` so the cursor stays focused on token positioning.
 */
import type { Keyword, Token } from "../lexer/tokens.js";
import type { Span } from "../lexer/span.js";
import type { BodySpan, Identifier, VarSection } from "./ast.js";
import type { Cursor } from "./cursor.js";
import { atVarSection, parseVarSection } from "./var-section.js";

/** Build a span covering the source range from `a.start` to `b.end`. */
export function joinSpans(a: Span, b: Span): Span {
	return {
		start: a.start,
		end: b.end,
		startLine: a.startLine,
		startCol: a.startCol,
		endLine: b.endLine,
		endCol: b.endCol,
	};
}

/** Convert an identifier token into an Identifier AST node. */
export function identFromToken(tok: Token): Identifier {
	return { kind: "identifier", text: tok.text, span: tok.span };
}

/**
 * Consume meaningful tokens until `pred` returns true for the next
 * one (or we hit EOF). Returns the consumed tokens. Does NOT consume
 * the terminator. Skips trivia (the cursor handles that).
 */
export function collectUntil(c: Cursor, pred: (t: Token) => boolean): Token[] {
	const out: Token[] = [];
	while (!c.atEof()) {
		const next = c.peek();
		if (pred(next)) break;
		out.push(c.consume());
	}
	return out;
}

/**
 * Build a BodySpan from a list of tokens. Falls back to `fallback`
 * span if the list is empty.
 */
export function bodySpanFromTokens(tokens: Token[], fallback: Span): BodySpan {
	if (tokens.length === 0) {
		return { kind: "body", tokens, span: fallback };
	}
	const first = tokens[0] as Token;
	const last = tokens[tokens.length - 1] as Token;
	return { kind: "body", tokens, span: joinSpans(first.span, last.span) };
}

/**
 * Consume as many consecutive VAR sections as appear at the cursor.
 * Used by every POU-shape parser — FB, PROGRAM, FUNCTION, METHOD —
 * after the header, before the body.
 */
export function collectVarSections(c: Cursor): VarSection[] {
	const sections: VarSection[] = [];
	while (atVarSection(c)) {
		const s = parseVarSection(c);
		if (s !== undefined) sections.push(s);
		else break;
	}
	return sections;
}

/**
 * Collect tokens until the named END_* keyword, consume it, return a
 * BodySpan. The terminator is consumed so the outer parser sees the
 * next unit cleanly.
 */
export function collectBodyUntil(c: Cursor, ender: Keyword, context: string): BodySpan {
	return collectBodyUntilAny(c, [ender], context);
}

/**
 * Same as <see cref="collectBodyUntil"/> but accepts multiple acceptable
 * terminators. Used by inline property accessors where either
 * END_GET/END_SET or an implicit close (next GET/SET/END_PROPERTY)
 * can terminate the body.
 */
export function collectBodyUntilAny(
	c: Cursor,
	enders: readonly Keyword[],
	context: string,
): BodySpan {
	const startSpan = c.peek().span;
	const { tokens, closer } = c.consumeBodyUntilAny({ consumeEnders: enders });
	if (closer !== undefined) {
		return bodySpanFromTokens(tokens, joinSpans(startSpan, closer.span));
	}
	c.pushError(`unterminated ${context}: expected ${enders.join(" or ")}`, startSpan);
	return bodySpanFromTokens(tokens, startSpan);
}

/** Human-readable description of a token for error messages. */
export function describeToken(t: Token): string {
	if (t.kind === "eof") return "end of input";
	if (t.kind === "keyword") return `keyword '${t.keyword ?? t.text}'`;
	if (t.kind === "identifier") return `identifier '${t.text}'`;
	if (t.kind === "punct") return `'${t.text}'`;
	return `${t.kind} '${t.text}'`;
}
