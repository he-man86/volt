/**
 * ST expression parser — precedence-climbing (Pratt) over a `Cursor`.
 *
 * Produces the `Expr` tree from `ast.ts`. Every function returns
 * `undefined` on failure and records an error on the cursor (never
 * throws); the statement parser turns "any error / unconsumed tokens"
 * into the body-level `ok = false` fallback, so no parse-error
 * diagnostic ever reaches the user from body parsing.
 *
 * Grammar and precedence follow IEC 61131-3, cross-checked against
 * RuSTy's `expressions_parser.rs` (see
 * `openspec/changes/st-body-ast/design.md` D1a): OR < XOR < AND <
 * equality < comparison < additive < multiplicative < exponent, with
 * exponent right-associative and postfix (`.` `[]` `^` `()`) binding
 * tightest.
 */
import type { Span } from "../lexer/span.js";
import type { Token } from "../lexer/tokens.js";
import { Cursor } from "./cursor.js";
import type { CallArg, CallExpr, Expr, IdentExpr, LiteralKind } from "./ast.js";

// ─── Precedence table (task 1.3) — lowest binding first ──────────────
export const BINARY_PRECEDENCE: ReadonlyArray<{
	ops: readonly string[];
	prec: number;
	rightAssoc?: boolean;
}> = [
	{ ops: ["OR", "OR_ELSE"], prec: 1 },
	{ ops: ["XOR"], prec: 2 },
	{ ops: ["AND", "AND_THEN", "&"], prec: 3 },
	{ ops: ["=", "<>"], prec: 4 },
	{ ops: ["<", ">", "<=", ">="], prec: 5 },
	{ ops: ["+", "-"], prec: 6 },
	{ ops: ["*", "/", "MOD"], prec: 7 },
	{ ops: ["**"], prec: 8, rightAssoc: true },
];

const OP_INFO: ReadonlyMap<string, { prec: number; rightAssoc: boolean }> = new Map(
	BINARY_PRECEDENCE.flatMap((row) =>
		row.ops.map((op) => [op, { prec: row.prec, rightAssoc: row.rightAssoc ?? false }] as const),
	),
);

/** Keywords that are operators (not names), excluded from primary/ident position. */
const OPERATOR_KEYWORDS: ReadonlySet<string> = new Set([
	"AND", "AND_THEN", "OR", "OR_ELSE", "XOR", "NOT", "MOD", "TRUE", "FALSE",
]);

const LIT_KIND: Partial<Record<Token["kind"], LiteralKind>> = {
	int_lit: "int",
	real_lit: "real",
	string_lit: "string",
	wstring_lit: "wstring",
	time_lit: "time",
	date_lit: "date",
	tod_lit: "tod",
	datetime_lit: "datetime",
	typed_lit: "typed",
	address_lit: "address",
};

function merge(a: Span, b: Span): Span {
	return {
		start: a.start,
		end: b.end,
		startLine: a.startLine,
		startCol: a.startCol,
		endLine: b.endLine,
		endCol: b.endCol,
	};
}

/** Canonical operator string for a token, or undefined if it's not a binary operator. */
function binaryOp(t: Token): { op: string; prec: number; rightAssoc: boolean } | undefined {
	const key = t.kind === "keyword" ? t.keyword : t.kind === "punct" ? t.text : undefined;
	if (key === undefined) return undefined;
	const info = OP_INFO.get(key);
	return info === undefined ? undefined : { op: key, ...info };
}

/** Prefix unary operator text, or undefined. */
function unaryOp(t: Token): string | undefined {
	if (t.kind === "keyword" && t.keyword === "NOT") return "NOT";
	if (t.kind === "punct" && (t.text === "-" || t.text === "+" || t.text === "&")) return t.text;
	return undefined;
}

/** Accept a name token (identifier, or a keyword used as a member/function name). */
function eatName(cur: Cursor): Token | undefined {
	const t = cur.peek();
	if (t.kind === "identifier") return cur.consume();
	if (t.kind === "keyword" && t.keyword !== undefined) return cur.consume();
	return undefined;
}

/** Parse a full expression. Returns undefined (and records an error) on failure. */
export function parseExpression(cur: Cursor): Expr | undefined {
	return parseBinary(cur, 1);
}

function parseBinary(cur: Cursor, minPrec: number): Expr | undefined {
	let left = parseUnary(cur);
	if (left === undefined) return undefined;
	for (;;) {
		const info = binaryOp(cur.peek());
		if (info === undefined || info.prec < minPrec) break;
		cur.consume();
		const right = parseBinary(cur, info.rightAssoc ? info.prec : info.prec + 1);
		if (right === undefined) return undefined;
		left = { kind: "binary", op: info.op, left, right, span: merge(left.span, right.span) };
	}
	return left;
}

function parseUnary(cur: Cursor): Expr | undefined {
	const t = cur.peek();
	const op = unaryOp(t);
	if (op !== undefined) {
		cur.consume();
		const operand = parseUnary(cur);
		if (operand === undefined) return undefined;
		return { kind: "unary", op, operand, span: merge(t.span, operand.span) };
	}
	return parsePostfix(cur);
}

function parsePostfix(cur: Cursor): Expr | undefined {
	let base = parsePrimary(cur);
	if (base === undefined) return undefined;
	for (;;) {
		const t = cur.peek();
		if (t.kind !== "punct") break;
		if (t.text === ".") {
			cur.consume();
			// CODESYS bit access `x.0` .. `x.63` — the member is a numeric bit index, not a name.
			const bitTok = cur.peek();
			if (bitTok.kind === "int_lit") {
				cur.consume();
				const member: IdentExpr = { kind: "ident_expr", name: bitTok.text, span: bitTok.span };
				base = { kind: "member", base, member, span: merge(base.span, bitTok.span) };
				continue;
			}
			const nameTok = eatName(cur);
			if (nameTok === undefined) {
				cur.pushError("expected member name after '.'", cur.peek().span);
				return undefined;
			}
			const member: IdentExpr = { kind: "ident_expr", name: nameTok.text, span: nameTok.span };
			base = { kind: "member", base, member, span: merge(base.span, nameTok.span) };
		} else if (t.text === "[") {
			cur.consume();
			const indices: Expr[] = [];
			if (!(cur.peek().kind === "punct" && cur.peek().text === "]")) {
				for (;;) {
					const idx = parseExpression(cur);
					if (idx === undefined) return undefined;
					indices.push(idx);
					// Tolerate a trailing comma (common when a subscript is edited/commented).
					if (cur.eatPunct(",") !== undefined && !(cur.peek().kind === "punct" && cur.peek().text === "]")) continue;
					break;
				}
			}
			const close = cur.expectPunct("]", "closing array index");
			if (close === undefined) return undefined;
			base = { kind: "index", base, indices, span: merge(base.span, close.span) };
		} else if (t.text === "^") {
			const caret = cur.consume();
			base = { kind: "deref", base, span: merge(base.span, caret.span) };
		} else if (t.text === "(") {
			const call = parseCall(cur, base);
			if (call === undefined) return undefined;
			base = call;
		} else break;
	}
	return base;
}

function parseCall(cur: Cursor, callee: Expr): CallExpr | undefined {
	cur.consume(); // '('
	const args: CallArg[] = [];
	if (!(cur.peek().kind === "punct" && cur.peek().text === ")")) {
		for (;;) {
			const arg = parseCallArg(cur);
			if (arg === undefined) return undefined;
			args.push(arg);
			// Tolerate a trailing comma before `)` — common in CODESYS when a call's
			// last argument(s) are commented out but the separating comma remains.
			if (cur.eatPunct(",") !== undefined && !(cur.peek().kind === "punct" && cur.peek().text === ")")) continue;
			break;
		}
	}
	const close = cur.expectPunct(")", "closing call arguments");
	if (close === undefined) return undefined;
	return { kind: "call", callee, args, span: merge(callee.span, close.span) };
}

function parseCallArg(cur: Cursor): CallArg | undefined {
	// Named input `p := v` or output `p => tgt` — an identifier followed by := / =>.
	const t = cur.peek();
	if (t.kind === "identifier") {
		const next = cur.peek(1);
		if (next.kind === "punct" && (next.text === ":=" || next.text === "=>")) {
			const nameTok = cur.consume();
			const opTok = cur.consume();
			const output = opTok.text === "=>";
			const param: IdentExpr = { kind: "ident_expr", name: nameTok.text, span: nameTok.span };
			// An output may be left unconnected: `out => ,` or `out => )`. Only outputs — an empty
			// input target is a genuine error.
			const after = cur.peek();
			if (output && after.kind === "punct" && (after.text === "," || after.text === ")")) {
				return { kind: "call_arg", param, output: true, span: merge(nameTok.span, opTok.span) };
			}
			const value = parseExpression(cur);
			if (value === undefined) return undefined;
			return { kind: "call_arg", param, output, value, span: merge(nameTok.span, value.span) };
		}
	}
	const value = parseExpression(cur);
	if (value === undefined) return undefined;
	return { kind: "call_arg", output: false, value, span: value.span };
}

function parsePrimary(cur: Cursor): Expr | undefined {
	const t = cur.peek();
	const lk = LIT_KIND[t.kind];
	if (lk !== undefined) {
		cur.consume();
		return { kind: "literal", literalKind: lk, text: t.text, span: t.span };
	}
	if (t.kind === "keyword" && (t.keyword === "TRUE" || t.keyword === "FALSE")) {
		cur.consume();
		return { kind: "literal", literalKind: "bool", text: t.text, span: t.span };
	}
	if (t.kind === "identifier") {
		cur.consume();
		return { kind: "ident_expr", name: t.text, span: t.span };
	}
	// A keyword that isn't an operator can start an expression as a name —
	// standard functions/operators lexed as keywords (`ADR`, `SIZEOF`, `SEL`, …).
	if (t.kind === "keyword" && t.keyword !== undefined && !OPERATOR_KEYWORDS.has(t.keyword)) {
		cur.consume();
		return { kind: "ident_expr", name: t.text, span: t.span };
	}
	if (t.kind === "punct" && t.text === "(") {
		const open = cur.consume();
		const inner = parseExpression(cur);
		if (inner === undefined) return undefined;
		const close = cur.expectPunct(")", "closing parenthesis");
		if (close === undefined) return undefined;
		return { kind: "paren", inner, span: merge(open.span, close.span) };
	}
	cur.pushError(`expected expression, got ${t.kind} '${t.text}'`, t.span);
	return undefined;
}

export { merge as mergeSpans };
