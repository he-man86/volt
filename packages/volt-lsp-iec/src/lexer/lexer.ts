/**
 * IEC 61131-3 Structured Text lexer — hand-written state machine.
 *
 * Emits *all* tokens including trivia (whitespace, comments, pragma
 * blocks). The parser filters trivia by default; refactoring / format
 * tools that care about source fidelity get them.
 *
 * Position tracking: line/col are advanced incrementally as `pos`
 * moves so we don't rescan the source for every token span. Lines are
 * 1-based, columns 0-based (matches the LSP convention).
 */
import { spanFromOffsets, type Span } from "./span.js";
import {
	ALL_KEYWORDS,
	MULTI_CHAR_PUNCT,
	SINGLE_CHAR_PUNCT,
	type Keyword,
	type Token,
	type TokenKind,
} from "./tokens.js";

// Keyword lookup — upper-cased key → canonical keyword.
const KEYWORD_MAP: Map<string, Keyword> = new Map(
	ALL_KEYWORDS.map((k) => [k, k]),
);

// Identifier prefixes that introduce a `#`-suffixed literal.
const TIME_PREFIXES = new Set(["T", "TIME", "LTIME"]);
const DATE_PREFIXES = new Set(["D", "DATE", "LDATE"]);
const TOD_PREFIXES = new Set([
	"TOD",
	"TIME_OF_DAY",
	"LTOD",
	"LTIME_OF_DAY",
]);
const DATETIME_PREFIXES = new Set([
	"DT",
	"DATE_AND_TIME",
	"LDT",
	"LDATE_AND_TIME",
]);
// Typed-literal prefixes (`INT#42`, `REAL#1.5`, `BOOL#TRUE`). These
// look like an identifier followed by `#` followed by a literal body.
// We lex the whole thing as a single `typed_lit` token.
const TYPED_PREFIXES = new Set([
	"BOOL",
	"BYTE",
	"WORD",
	"DWORD",
	"LWORD",
	"SINT",
	"INT",
	"DINT",
	"LINT",
	"USINT",
	"UINT",
	"UDINT",
	"ULINT",
	"REAL",
	"LREAL",
	"CHAR",
	"WCHAR",
]);

export function lex(src: string): Token[] {
	const tokens: Token[] = [];
	let pos = 0;
	const len = src.length;
	let line = 1; // 1-based
	let col = 0; // 0-based, matches LSP

	function peek(offset = 0): string {
		return pos + offset < len ? (src[pos + offset] as string) : "";
	}

	function advance(n: number): void {
		for (let i = 0; i < n && pos < len; i++) {
			if (src[pos] === "\n") {
				line += 1;
				col = 0;
			} else {
				col += 1;
			}
			pos += 1;
		}
	}

	function spanFrom(start: number, startLine: number, startCol: number): Span {
		return {
			start,
			end: pos,
			startLine,
			startCol,
			endLine: line,
			endCol: col,
		};
	}

	function emit(
		kind: TokenKind,
		start: number,
		startLine: number,
		startCol: number,
		extra?: Partial<Token>,
	): void {
		tokens.push({
			kind,
			text: src.slice(start, pos),
			span: spanFrom(start, startLine, startCol),
			...extra,
		});
	}

	while (pos < len) {
		const startPos = pos;
		const startLine = line;
		const startCol = col;
		const ch = peek();

		// ─── Whitespace ────────────────────────────────────────────
		if (isWhitespace(ch)) {
			while (pos < len && isWhitespace(peek())) advance(1);
			emit("whitespace", startPos, startLine, startCol);
			continue;
		}

		// ─── Line comment ──────────────────────────────────────────
		if (ch === "/" && peek(1) === "/") {
			while (pos < len && peek() !== "\n") advance(1);
			emit("line_comment", startPos, startLine, startCol);
			continue;
		}

		// ─── Block comment (nestable) ──────────────────────────────
		if (ch === "(" && peek(1) === "*") {
			advance(2);
			let depth = 1;
			while (pos < len && depth > 0) {
				if (peek() === "(" && peek(1) === "*") {
					advance(2);
					depth += 1;
				} else if (peek() === "*" && peek(1) === ")") {
					advance(2);
					depth -= 1;
				} else {
					advance(1);
				}
			}
			emit("block_comment", startPos, startLine, startCol);
			continue;
		}

		// ─── Pragma block ──────────────────────────────────────────
		// `{attribute 'qualified_only'}` etc. We lex as opaque text;
		// the parser can decode contents later if needed. Pragmas can
		// span lines in practice; we look for the matching `}`.
		if (ch === "{") {
			advance(1);
			while (pos < len && peek() !== "}") advance(1);
			if (peek() === "}") advance(1);
			emit("pragma", startPos, startLine, startCol);
			continue;
		}

		// ─── String literal (single-quoted, IEC STRING) ────────────
		if (ch === "'") {
			lexQuotedString("'");
			emit("string_lit", startPos, startLine, startCol);
			continue;
		}

		// ─── WString literal (double-quoted, IEC WSTRING) ──────────
		if (ch === '"') {
			lexQuotedString('"');
			emit("wstring_lit", startPos, startLine, startCol);
			continue;
		}

		// ─── Number-with-radix `16#FF`, `8#77`, `2#1010` ───────────
		// CODESYS allows underscores as separators within numeric
		// literals: `1_000_000`, `16#FFFF_FFFF`. We accept `_` adjacent
		// to digits as part of the literal text; consumers strip
		// underscores when computing the numeric value.
		if (isDigit(ch)) {
			const radixCheckStart = pos;
			while (pos < len && (isDigit(peek()) || peek() === "_")) advance(1);
			if (peek() === "#") {
				// `<base>#<digits>` — base must be 2/8/16, but we let
				// the parser validate; lexer just captures the run.
				advance(1);
				while (pos < len && (isHexDigit(peek()) || peek() === "_")) advance(1);
				emit("int_lit", radixCheckStart, startLine, startCol);
				continue;
			}
			// Otherwise rewind and let the real-number path handle
			// fractional/exponent forms. We use the offsets-based span
			// helper here because we've already advanced past the
			// integer part.
			pos = radixCheckStart;
			line = startLine;
			col = startCol;
			lexNumber();
			// lexNumber emits its own token, so continue.
			continue;
		}

		// ─── Identifier or keyword (and #-suffixed literal forms) ──
		if (isIdentStart(ch)) {
			while (pos < len && isIdentCont(peek())) advance(1);
			const text = src.slice(startPos, pos);
			const upper = text.toUpperCase();

			// Check for #-suffixed literal forms: T#10ms, DATE#…,
			// TOD#…, DT#…, INT#42, …
			if (peek() === "#") {
				if (TIME_PREFIXES.has(upper)) {
					advance(1);
					lexTimeLiteralBody();
					emit("time_lit", startPos, startLine, startCol);
					continue;
				}
				if (DATE_PREFIXES.has(upper)) {
					advance(1);
					lexDateLiteralBody();
					emit("date_lit", startPos, startLine, startCol);
					continue;
				}
				if (TOD_PREFIXES.has(upper)) {
					advance(1);
					lexTodLiteralBody();
					emit("tod_lit", startPos, startLine, startCol);
					continue;
				}
				if (DATETIME_PREFIXES.has(upper)) {
					advance(1);
					lexDatetimeLiteralBody();
					emit("datetime_lit", startPos, startLine, startCol);
					continue;
				}
				if (TYPED_PREFIXES.has(upper)) {
					advance(1);
					lexTypedLiteralBody();
					emit("typed_lit", startPos, startLine, startCol);
					continue;
				}
				// Unrecognized prefix before `#`: fall through and let
				// the identifier stand; the `#` becomes an unknown token.
			}

			// ─── ExST assignment operators: S=, R=, REF= ──────────────
			// Per docs/codesys-reference/01-languages-and-editors.md, ExST
			// extends ST with Set (`S=`), Reset (`R=`), and reference-
			// rebind (`REF=`) assignment operators. They're a single
			// token. We recognize them only when the identifier IS
			// exactly the operator stem AND the next char is `=` (not
			// `=>` or `==`) — otherwise leave the identifier intact.
			if ((upper === "S" || upper === "R" || upper === "REF") && peek() === "=" && peek(1) !== ">" && peek(1) !== "=") {
				advance(1);
				emit("punct", startPos, startLine, startCol);
				continue;
			}

			const keyword = KEYWORD_MAP.get(upper);
			if (keyword !== undefined) {
				emit("keyword", startPos, startLine, startCol, { keyword });
			} else {
				emit("identifier", startPos, startLine, startCol);
			}
			continue;
		}

		// ─── %-prefix address literal ──────────────────────────────
		// Per docs/codesys-reference/05-operands.md:
		//   %<area><size>?<position>[.<bit>]
		//   <area> ∈ {I, Q, M} ; <size> ∈ {X, B, W, D, L}
		//   <position> = digits (or `*` for incomplete; or multi-segment
		//   `2.5.7.1` for device-config-dependent forms)
		//   Examples: %IX0.0, %Q7.5, %IW215, %QB7, %MD48, %I*, %IW2.5.7.1
		// Recognized as a single `address_lit` token to keep parser
		// rules simple. We're permissive on the body content — only
		// the leading `%` + area letter is required.
		if (ch === "%" && isAddressAreaChar(peek(1))) {
			advance(1); // %
			advance(1); // area letter
			// Optional size character (X/B/W/D/L)
			if (isAddressSizeChar(peek())) advance(1);
			// Body: digits, dots, optional `*` for incomplete address.
			while (pos < len) {
				const c = peek();
				if (isDigit(c) || c === "." || c === "*") {
					advance(1);
				} else {
					break;
				}
			}
			emit("address_lit", startPos, startLine, startCol);
			continue;
		}

		// ─── Backtick-quoted identifier (CODESYS extension) ────────
		// Per docs/codesys-reference/08-identifiers.md, names enclosed
		// in backticks (acute accent U+00B4 per spec; ASCII `` ` ``
		// accepted as a tolerance) can contain special characters and
		// even keywords. The backticks ARE part of the identifier —
		// `var1` and ``var1`` are distinct names.
		if (ch === "`" || ch === "´") {
			const opener = ch;
			advance(1);
			while (pos < len && peek() !== opener && peek() !== "\n") {
				advance(1);
			}
			if (peek() === opener) {
				advance(1);
				emit("identifier", startPos, startLine, startCol);
			} else {
				// Unterminated — emit as unknown.
				emit("unknown", startPos, startLine, startCol);
			}
			continue;
		}

		// ─── Multi-char punctuation (longest match first) ──────────
		const multi = matchMultiCharPunct();
		if (multi !== undefined) {
			advance(multi.length);
			emit("punct", startPos, startLine, startCol);
			continue;
		}

		// ─── Single-char punctuation ───────────────────────────────
		if (SINGLE_CHAR_PUNCT.includes(ch)) {
			advance(1);
			emit("punct", startPos, startLine, startCol);
			continue;
		}

		// ─── Unknown — single char, recover ────────────────────────
		advance(1);
		emit("unknown", startPos, startLine, startCol);
	}

	tokens.push({
		kind: "eof",
		text: "",
		span: spanFromOffsets(src, len, len),
	});

	return tokens;

	// ─── Local helpers (closures over pos/line/col) ──────────────────

	function lexQuotedString(quote: '"' | "'"): void {
		advance(1); // opening quote
		while (pos < len) {
			const c = peek();
			if (c === "\n") break; // IEC strings don't span lines (lexer recovery)
			if (c === "$") {
				// $$ $L $N $P $R $T $' $" $<2 hex> in STRING; $<4 hex> in WSTRING
				advance(1);
				const esc = peek();
				if (esc === "\n" || esc === "") break;
				if (isHexDigit(esc)) {
					// Consume up to 4 hex chars; STRING uses 2, WSTRING up to 4.
					// We don't try to enforce the difference at lex time.
					let n = 0;
					while (n < 4 && isHexDigit(peek())) {
						advance(1);
						n += 1;
					}
				} else {
					advance(1);
				}
				continue;
			}
			if (c === quote) {
				advance(1); // closing quote
				return;
			}
			advance(1);
		}
		// Unterminated — return with cursor wherever we stopped; token
		// span reflects partial consumption. The parser sees an
		// `unknown` token after if needed.
	}

	function lexNumber(): void {
		const s = pos;
		const sl = line;
		const sc = col;
		// CODESYS allows underscores within numeric literals (`1_000_000`).
		while (pos < len && (isDigit(peek()) || peek() === "_")) advance(1);
		// Fractional part — but NOT if followed by another `.` (range op `..`)
		let isReal = false;
		if (peek() === "." && peek(1) !== ".") {
			isReal = true;
			advance(1);
			while (pos < len && (isDigit(peek()) || peek() === "_")) advance(1);
		}
		// Exponent
		if (peek() === "e" || peek() === "E") {
			isReal = true;
			advance(1);
			if (peek() === "+" || peek() === "-") advance(1);
			while (pos < len && (isDigit(peek()) || peek() === "_")) advance(1);
		}
		emit(isReal ? "real_lit" : "int_lit", s, sl, sc);
	}

	function lexTimeLiteralBody(): void {
		// Body: digits, time units (ms/s/m/h/d), underscores. Stop at
		// whitespace/punct that isn't part of the body.
		while (pos < len) {
			const c = peek();
			if (isAlnum(c) || c === "_" || c === ".") {
				advance(1);
			} else {
				break;
			}
		}
	}

	function lexDateLiteralBody(): void {
		// Body: digits and `-` (YYYY-MM-DD).
		while (pos < len) {
			const c = peek();
			if (isDigit(c) || c === "-") {
				advance(1);
			} else {
				break;
			}
		}
	}

	function lexTodLiteralBody(): void {
		// Body: digits, `:`, `.`.
		while (pos < len) {
			const c = peek();
			if (isDigit(c) || c === ":" || c === ".") {
				advance(1);
			} else {
				break;
			}
		}
	}

	function lexDatetimeLiteralBody(): void {
		// Body: digits, `-`, `:`, `.` (DATE_AND_TIME#YYYY-MM-DD-HH:MM:SS.sss).
		while (pos < len) {
			const c = peek();
			if (isDigit(c) || c === "-" || c === ":" || c === ".") {
				advance(1);
			} else {
				break;
			}
		}
	}

	function lexTypedLiteralBody(): void {
		// Body: depends on the type. We accept any non-whitespace
		// alphanumeric/sign/dot/hash sequence — the parser can
		// validate against the prefix type later.
		while (pos < len) {
			const c = peek();
			if (isAlnum(c) || c === "_" || c === "." || c === "+" || c === "-") {
				advance(1);
			} else {
				break;
			}
		}
	}

	function matchMultiCharPunct(): string | undefined {
		for (const m of MULTI_CHAR_PUNCT) {
			let ok = true;
			for (let i = 0; i < m.length; i++) {
				if (peek(i) !== m[i]) {
					ok = false;
					break;
				}
			}
			if (ok) return m;
		}
		return undefined;
	}
}

// ─── Char predicates (kept outside the main fn so they can inline) ───

function isWhitespace(c: string): boolean {
	return c === " " || c === "\t" || c === "\r" || c === "\n";
}

function isAddressAreaChar(c: string): boolean {
	return c === "I" || c === "Q" || c === "M" || c === "i" || c === "q" || c === "m";
}

function isAddressSizeChar(c: string): boolean {
	return (
		c === "X" || c === "B" || c === "W" || c === "D" || c === "L" ||
		c === "x" || c === "b" || c === "w" || c === "d" || c === "l"
	);
}

function isDigit(c: string): boolean {
	return c >= "0" && c <= "9";
}

function isHexDigit(c: string): boolean {
	return isDigit(c) || (c >= "a" && c <= "f") || (c >= "A" && c <= "F");
}

function isAlpha(c: string): boolean {
	return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
}

function isAlnum(c: string): boolean {
	return isAlpha(c) || isDigit(c);
}

function isIdentStart(c: string): boolean {
	return isAlpha(c) || c === "_";
}

function isIdentCont(c: string): boolean {
	return isAlnum(c) || c === "_";
}
