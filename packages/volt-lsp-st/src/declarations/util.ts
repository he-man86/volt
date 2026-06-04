/**
 * Small parser utilities shared across modules. Kept separate from
 * `cursor.ts` so the cursor stays focused on token positioning.
 */
import type { Token } from "../lexer/tokens.js";
import type { Span } from "../lexer/span.js";
import type { BodySpan, Identifier } from "./ast.js";
import type { Cursor } from "./cursor.js";

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
