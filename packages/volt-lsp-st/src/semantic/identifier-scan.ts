/**
 * Identifier scanning over opaque body tokens — answer "where do
 * names APPEAR (not where they're defined)?"
 *
 * Bodies are stored as flat token arrays. This module walks them
 * looking for identifier tokens and classifies each occurrence:
 *
 *   - `isCall`         — immediately followed by `(`  → call site
 *   - `isMemberAccess` — preceded by `.`              → qualified ref
 *
 * Together with `resolver.ts`'s name resolution, this lets LSP
 * queries answer:
 *
 *   - find-references: walk every body in the project, scan, filter
 *     by name resolution (skip shadowed occurrences)
 *   - call-hierarchy:  filter scan results to call sites only
 *   - identifier-at-cursor: `identifierAtOffset(body, byteOffset)`
 *
 * Identifier comparison is case-insensitive (PLC convention).
 *
 * Split from `resolver.ts` because the two concerns have different
 * consumers: scope-lookup is used by every query, but body-scanning
 * is used only by reference/highlight/call-hierarchy paths.
 */
import type { Span } from "../lexer/span.js";
import type { Token } from "../lexer/tokens.js";
import type { BodySpan } from "../parser/ast.js";

export interface IdentifierOccurrence {
	/** The identifier token. */
	token: Token;
	/** Span of just the identifier. */
	span: Span;
	/** True if this occurrence is immediately followed by `(` — a call site. */
	isCall: boolean;
	/** True if this occurrence is preceded by `.` — a member access (qualified). */
	isMemberAccess: boolean;
	/**
	 * True when this identifier is the name of a named parameter in a
	 * function/FB call: `FB(paramName := value)` or `FB(paramName => dest)`.
	 * Detection rule: preceded by `(` or `,` AND followed by `:=` or `=>`.
	 * Named parameter names are not variable references — they live in the
	 * callee's declaration, not the calling scope — so unresolved-identifier
	 * must skip them.
	 */
	isNamedParam: boolean;
}

/**
 * Scan a body's token stream for identifiers matching `name`. Returns
 * every occurrence with classification info (call site vs read, member
 * access vs unqualified). The scanner skips trivia tokens but
 * otherwise treats the token stream as flat — it doesn't know about
 * nested control flow.
 */
export function scanReferencesInBody(
	body: BodySpan,
	name: string,
): IdentifierOccurrence[] {
	const target = name.toLowerCase();
	const out: IdentifierOccurrence[] = [];
	const toks = body.tokens.filter((t) => !isTrivia(t.kind));
	for (let i = 0; i < toks.length; i++) {
		const t = toks[i] as Token;
		if (t.kind !== "identifier") continue;
		if (t.text.toLowerCase() !== target) continue;
		const next = toks[i + 1];
		const prev = toks[i - 1];
		out.push({
			token: t,
			span: t.span,
			isCall: next?.kind === "punct" && next.text === "(",
			isMemberAccess: prev?.kind === "punct" && prev.text === ".",
			isNamedParam: isNamedParamPosition(prev, next),
		});
	}
	return out;
}

/** Collect every identifier occurrence in a body, regardless of name. Useful for symbol-cross-reference building. */
export function scanAllIdentifiersInBody(body: BodySpan): IdentifierOccurrence[] {
	const out: IdentifierOccurrence[] = [];
	const toks = body.tokens.filter((t) => !isTrivia(t.kind));
	for (let i = 0; i < toks.length; i++) {
		const t = toks[i] as Token;
		if (t.kind !== "identifier") continue;
		const next = toks[i + 1];
		const prev = toks[i - 1];
		out.push({
			token: t,
			span: t.span,
			isCall: next?.kind === "punct" && next.text === "(",
			isMemberAccess: prev?.kind === "punct" && prev.text === ".",
			isNamedParam: isNamedParamPosition(prev, next),
		});
	}
	return out;
}

/**
 * True when the identifier is in named-parameter position inside a call
 * argument list: preceded by `(` or `,` and followed by `:=` or `=>`.
 *
 * `FB(paramName := value)` / `FB(paramName => dest)`
 */
function isNamedParamPosition(
	prev: Token | undefined,
	next: Token | undefined,
): boolean {
	if (next?.kind !== "punct") return false;
	if (next.text !== ":=" && next.text !== "=>") return false;
	if (prev?.kind !== "punct") return false;
	return prev.text === "(" || prev.text === ",";
}

/**
 * Find the identifier token at the given source offset, scanning a
 * body. Returns undefined if no identifier covers that offset.
 *
 * The LSP layer calls this with `position → offset` translation
 * before issuing a `definition` query.
 */
export function identifierAtOffset(body: BodySpan, offset: number): Token | undefined {
	for (const t of body.tokens) {
		if (t.kind !== "identifier") continue;
		if (offset >= t.span.start && offset < t.span.end) return t;
	}
	return undefined;
}

function isTrivia(kind: Token["kind"]): boolean {
	return (
		kind === "whitespace" ||
		kind === "line_comment" ||
		kind === "block_comment" ||
		kind === "pragma"
	);
}
