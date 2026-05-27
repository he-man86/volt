/**
 * Name resolution + reference scanning.
 *
 * Two complementary operations:
 *   1. `lookup(scope, name)` — find a definition. Walks scopes
 *      outward (innermost → project) and returns all matches.
 *   2. `scanReferencesInBody(body, name)` — find usages. Walks an
 *      opaque body's token list and returns every identifier token
 *      whose text matches `name` (case-insensitive). Also classifies
 *      occurrences as plain references vs call sites (`name(`).
 *
 * Together these answer the LSP queries:
 *   - go-to-definition: lookup, then return symbol.span
 *   - find-references: walk every body in the project, scan, filter
 *     by scope resolution (skip shadowed occurrences)
 *   - call-hierarchy: filter scan results to call sites only
 *
 * Identifier comparison is case-insensitive throughout.
 */
import type { Span } from "../lexer/span.js";
import type { Token } from "../lexer/tokens.js";
import type { BodySpan } from "../parser/ast.js";
import { lookupLocal, type Scope, type Symbol } from "./symbol-table.js";

// ─── Lookup ──────────────────────────────────────────────────────────

export interface LookupResult {
	symbol: Symbol;
	/** The scope where we found it (innermost match if it shadows). */
	foundIn: Scope;
}

/**
 * Walk parent chain from `start` outward. Returns the FIRST match
 * (innermost shadow wins) and the scope it was defined in. Returns
 * undefined if not found anywhere up to the root.
 *
 * For find-all-matches semantics (overloads / inheritance), call
 * `lookupAll` instead.
 */
export function lookup(start: Scope, name: string): LookupResult | undefined {
	let cur: Scope | undefined = start;
	while (cur !== undefined) {
		const hits = lookupLocal(cur, name);
		if (hits.length > 0) {
			return { symbol: hits[0] as Symbol, foundIn: cur };
		}
		cur = cur.parent;
	}
	return undefined;
}

/** Like `lookup` but returns ALL matches up the chain. Useful for inheritance lookups. */
export function lookupAll(start: Scope, name: string): LookupResult[] {
	const out: LookupResult[] = [];
	let cur: Scope | undefined = start;
	while (cur !== undefined) {
		const hits = lookupLocal(cur, name);
		for (const s of hits) out.push({ symbol: s, foundIn: cur });
		cur = cur.parent;
	}
	return out;
}

// ─── Reference scanning over opaque body tokens ──────────────────────

export interface IdentifierOccurrence {
	/** The identifier token. */
	token: Token;
	/** Span of just the identifier. */
	span: Span;
	/** True if this occurrence is immediately followed by `(` — a call site. */
	isCall: boolean;
	/** True if this occurrence is preceded by `.` — a member access (qualified). */
	isMemberAccess: boolean;
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
		});
	}
	return out;
}

// ─── Position-to-identifier lookup (LSP cursor support) ──────────────

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
