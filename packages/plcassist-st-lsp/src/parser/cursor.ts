/**
 * Token cursor for the parser.
 *
 * - Skips trivia (whitespace, comments, pragmas) automatically before
 *   every meaningful consumption. Trivia stays in the underlying
 *   token array so source-fidelity tools can still find it.
 * - Errors are collected, not thrown. A parser that doesn't find what
 *   it expects records an error and attempts to recover.
 * - Provides convenience eaters for keyword, punct, identifier — the
 *   three things parsers check most.
 */
import { isTrivia, type Keyword, type Token } from "../lexer/tokens.js";
import type { Span } from "../lexer/span.js";
import type { ParseError } from "./ast.js";

export class Cursor {
	private pos = 0;
	private readonly errors: ParseError[] = [];

	constructor(private readonly tokens: readonly Token[]) {}

	getErrors(): ParseError[] {
		return this.errors;
	}

	pushError(message: string, span: Span): void {
		this.errors.push({ message, span });
	}

	/** Current meaningful token (skipping trivia). Never returns undefined; EOF is the sentinel. */
	peek(offset = 0): Token {
		let i = this.pos;
		let seen = 0;
		while (i < this.tokens.length) {
			const t = this.tokens[i] as Token;
			if (!isTrivia(t.kind)) {
				if (seen === offset) return t;
				seen += 1;
			}
			i += 1;
			if (t.kind === "eof") return t;
		}
		// Should be unreachable — lex() always appends an eof token.
		return this.tokens[this.tokens.length - 1] as Token;
	}

	/** Advance past the next meaningful token (skipping trivia) and return it. */
	consume(): Token {
		while (this.pos < this.tokens.length) {
			const t = this.tokens[this.pos] as Token;
			this.pos += 1;
			if (!isTrivia(t.kind)) return t;
		}
		return this.tokens[this.tokens.length - 1] as Token;
	}

	/** Are we at end-of-stream? */
	atEof(): boolean {
		return this.peek().kind === "eof";
	}

	/** Save the current position; useful for backtracking on speculative parses. */
	mark(): number {
		return this.pos;
	}

	rewind(to: number): void {
		this.pos = to;
	}

	// ─── Typed eaters ──────────────────────────────────────────────

	/** Consume if the next meaningful token is the given keyword. Returns the token, else undefined. */
	eatKeyword(kw: Keyword): Token | undefined {
		const t = this.peek();
		if (t.kind === "keyword" && t.keyword === kw) {
			return this.consume();
		}
		return undefined;
	}

	/** Consume if the next meaningful token is ANY of the given keywords. */
	eatAnyKeyword(...kws: Keyword[]): Token | undefined {
		const t = this.peek();
		if (t.kind === "keyword" && t.keyword !== undefined && kws.includes(t.keyword)) {
			return this.consume();
		}
		return undefined;
	}

	/** Consume if the next meaningful token is the given punctuation literal (e.g. ":=", ";"). */
	eatPunct(text: string): Token | undefined {
		const t = this.peek();
		if (t.kind === "punct" && t.text === text) {
			return this.consume();
		}
		return undefined;
	}

	/** Consume if the next meaningful token is an identifier. */
	eatIdent(): Token | undefined {
		const t = this.peek();
		if (t.kind === "identifier") {
			return this.consume();
		}
		return undefined;
	}

	// ─── Expect variants — record an error if mismatched, don't consume ──

	expectKeyword(kw: Keyword, context: string): Token | undefined {
		const t = this.eatKeyword(kw);
		if (t === undefined) {
			const next = this.peek();
			this.pushError(`expected ${kw} ${context}, got ${describeToken(next)}`, next.span);
		}
		return t;
	}

	expectPunct(text: string, context: string): Token | undefined {
		const t = this.eatPunct(text);
		if (t === undefined) {
			const next = this.peek();
			this.pushError(
				`expected '${text}' ${context}, got ${describeToken(next)}`,
				next.span,
			);
		}
		return t;
	}

	expectIdent(context: string): Token | undefined {
		const t = this.eatIdent();
		if (t === undefined) {
			const next = this.peek();
			this.pushError(`expected identifier ${context}, got ${describeToken(next)}`, next.span);
		}
		return t;
	}

	// ─── Recovery ──────────────────────────────────────────────────

	/**
	 * Skip tokens (meaningful + trivia) until the next meaningful
	 * token is one of `anchors` (keyword) or `anchorPuncts` (punct
	 * text), or we hit EOF. Used to resume parsing after a syntax
	 * error so one bad line doesn't kill the rest of the file.
	 *
	 * Returns true if an anchor was found; false at EOF.
	 */
	recoverTo(opts: {
		keywords?: readonly Keyword[];
		puncts?: readonly string[];
	}): boolean {
		const kws = new Set<Keyword>(opts.keywords ?? []);
		const punct = new Set<string>(opts.puncts ?? []);
		while (!this.atEof()) {
			const t = this.peek();
			if (t.kind === "keyword" && t.keyword !== undefined && kws.has(t.keyword)) return true;
			if (t.kind === "punct" && punct.has(t.text)) return true;
			this.consume();
		}
		return false;
	}
}

function describeToken(t: Token): string {
	if (t.kind === "eof") return "end of input";
	if (t.kind === "keyword") return `keyword '${t.keyword ?? t.text}'`;
	if (t.kind === "identifier") return `identifier '${t.text}'`;
	if (t.kind === "punct") return `'${t.text}'`;
	return `${t.kind} '${t.text.length > 20 ? `${t.text.slice(0, 20)}…` : t.text}'`;
}
