/**
 * Type expression parser.
 *
 * Grammar:
 *   TypeExpr        := StringType | ReferenceType | PointerType | ArrayType | NamedType
 *   NamedType       := Identifier ('.' Identifier)*
 *   ArrayType       := ARRAY '[' ArrayDim (',' ArrayDim)* ']' OF TypeExpr
 *   ArrayDim        := <opaque tokens> '..' <opaque tokens>
 *   ReferenceType   := REFERENCE TO TypeExpr
 *   PointerType     := POINTER TO TypeExpr
 *   StringType      := STRING ('(' length ')')? | STRING ('[' length ']')?
 *                    | WSTRING ('(' length ')')? | WSTRING ('[' length ']')?
 *
 * Note: primitive type names like BOOL/INT/REAL are lexed as
 * identifiers (they aren't reserved words in our keyword table).
 * The semantic layer distinguishes "built-in primitive name" from
 * "user-defined DUT name" via a known-primitives table.
 */
import type { Token } from "../lexer/tokens.js";
import {
	type ArrayDim,
	type BodySpan,
	type Identifier,
	type TypeExpr,
} from "./ast.js";
import { Cursor } from "./cursor.js";
import { bodySpanFromTokens, collectUntil, identFromToken, joinSpans } from "./util.js";

export function parseTypeExpression(c: Cursor): TypeExpr | undefined {
	// Implicit enumeration — `(A, B, C := 10, D)` declared inline.
	// Per docs/codesys-reference/02-variables.md (Implicit Enumeration
	// sub-page). The values list is captured; each value may optionally
	// have an explicit numeric assignment.
	const openParen = c.eatPunct("(");
	if (openParen !== undefined) {
		const values: Array<{ name: Identifier; init?: BodySpan }> = [];
		while (true) {
			if (c.peek().kind === "eof" || c.eatPunct(")") !== undefined) break;
			const nameTok = c.eatIdent();
			if (nameTok === undefined) {
				const t = c.peek();
				c.pushError(
					`expected enum value name in implicit enumeration`,
					t.span,
				);
				break;
			}
			const name = identFromToken(nameTok);
			let init: BodySpan | undefined;
			if (c.eatPunct(":=") !== undefined) {
				const initTokens = collectUntil(c, (t) => t.kind === "punct" && (t.text === "," || t.text === ")"));
				init = bodySpanFromTokens(initTokens, nameTok.span);
			}
			values.push(init !== undefined ? { name, init } : { name });
			if (c.eatPunct(",") !== undefined) continue;
			c.expectPunct(")", "closing implicit enumeration");
			break;
		}
		const lastSpan = values.length > 0 ? values[values.length - 1]!.name.span : openParen.span;
		return {
			kind: "implicit_enum_type",
			values,
			span: joinSpans(openParen.span, lastSpan),
		};
	}

	// STRING / WSTRING with optional length
	const stringTok = c.eatAnyKeyword("STRING", "WSTRING");
	if (stringTok !== undefined) {
		const wide = stringTok.keyword === "WSTRING";
		const length = parseOptionalStringLength(c);
		const endSpan = length?.span ?? stringTok.span;
		return {
			kind: "string_type",
			wide,
			...(length !== undefined ? { length } : {}),
			span: joinSpans(stringTok.span, endSpan),
		};
	}

	// REFERENCE TO X
	const refTok = c.eatKeyword("REFERENCE");
	if (refTok !== undefined) {
		c.expectKeyword("TO", "after REFERENCE");
		const target = parseTypeExpression(c);
		if (target === undefined) return undefined;
		return {
			kind: "reference_type",
			target,
			span: joinSpans(refTok.span, target.span),
		};
	}

	// POINTER TO X
	const ptrTok = c.eatKeyword("POINTER");
	if (ptrTok !== undefined) {
		c.expectKeyword("TO", "after POINTER");
		const target = parseTypeExpression(c);
		if (target === undefined) return undefined;
		return {
			kind: "pointer_type",
			target,
			span: joinSpans(ptrTok.span, target.span),
		};
	}

	// ARRAY [a..b, c..d] OF X
	const arrTok = c.eatKeyword("ARRAY");
	if (arrTok !== undefined) {
		c.expectPunct("[", "after ARRAY");
		const dims: ArrayDim[] = [];
		// Read dims until ']' (handle trailing comma defensively).
		// eslint-disable-next-line no-constant-condition
		while (true) {
			if (c.peek().kind === "eof" || c.eatPunct("]") !== undefined) break;
			const dim = parseArrayDim(c);
			if (dim !== undefined) dims.push(dim);
			if (c.eatPunct(",") !== undefined) continue;
			c.expectPunct("]", "closing ARRAY dimensions");
			break;
		}
		c.expectKeyword("OF", "after ARRAY dimensions");
		const element = parseTypeExpression(c);
		if (element === undefined) return undefined;
		return {
			kind: "array_type",
			dims,
			element,
			span: joinSpans(arrTok.span, element.span),
		};
	}

	// NamedType — identifier with optional qualifiers
	const idTok = c.eatIdent();
	if (idTok === undefined) {
		const next = c.peek();
		c.pushError(`expected type, got ${tokenDescription(next)}`, next.span);
		return undefined;
	}
	// CODESYS extension: `__VECTOR[<size>] OF <type>` — SIMD-friendly
	// fixed-size container. Same shape as ARRAY[0..size-1] OF <type>;
	// we reuse array_type in the AST since LSP navigation treats them
	// the same. TC rejects __VECTOR; conformance encodes that.
	if (idTok.text.toUpperCase() === "__VECTOR") {
		c.expectPunct("[", "after __VECTOR");
		const sizeTokens = collectUntil(c, (t) => t.kind === "punct" && t.text === "]");
		c.expectPunct("]", "closing __VECTOR size");
		c.expectKeyword("OF", "after __VECTOR size");
		const element = parseTypeExpression(c);
		if (element === undefined) return undefined;
		// Synthesize a single-dim ArrayType from lower=0, upper=<size-tokens>.
		// Source-slicing helpers don't need exact bound spans for navigation —
		// the dim's span covers the bracketed content.
		const sizeSpan = sizeTokens.length > 0
			? joinSpans(sizeTokens[0]!.span, sizeTokens[sizeTokens.length - 1]!.span)
			: idTok.span;
		return {
			kind: "array_type",
			dims: [{
				kind: "array_dim",
				lower: bodySpanFromTokens([], idTok.span),
				upper: bodySpanFromTokens(sizeTokens, sizeSpan),
				span: sizeSpan,
			}],
			element,
			span: joinSpans(idTok.span, element.span),
		};
	}
	const head = identFromToken(idTok);
	const qualifiers: Identifier[] = [];
	while (c.eatPunct(".") !== undefined) {
		const part = c.eatIdent();
		if (part === undefined) {
			const next = c.peek();
			c.pushError(`expected identifier after '.'`, next.span);
			break;
		}
		qualifiers.push(identFromToken(part));
	}
	let lastSpan = qualifiers.length > 0 ? (qualifiers[qualifiers.length - 1] as Identifier).span : head.span;
	// Optional subrange constraint: `INT(0..100)` after a named type.
	// We don't model subrange in the AST yet — just consume the parens
	// so the parse doesn't fail and the source-slice captures it for
	// downstream round-trip (DUT alias bodies, struct field types).
	if (c.peek().kind === "punct" && c.peek().text === "(") {
		const open = c.consume();
		let depth = 1;
		let closeSpan = open.span;
		while (!c.atEof() && depth > 0) {
			const t = c.consume();
			closeSpan = t.span;
			if (t.kind === "punct" && t.text === "(") depth++;
			else if (t.kind === "punct" && t.text === ")") depth--;
		}
		lastSpan = closeSpan;
	}
	if (qualifiers.length > 0) {
		return {
			kind: "named_type",
			name: qualifiers[qualifiers.length - 1] as Identifier,
			qualifiers: [head, ...qualifiers.slice(0, -1)],
			span: joinSpans(head.span, lastSpan),
		};
	}
	return {
		kind: "named_type",
		name: head,
		span: joinSpans(head.span, lastSpan),
	};
}

function parseArrayDim(c: Cursor): ArrayDim | undefined {
	// Capture lower bound tokens until '..'
	const start = c.peek().span;
	const lowerTokens: Token[] = [];
	while (!c.atEof()) {
		const next = c.peek();
		if (next.kind === "punct" && next.text === "..") break;
		if (next.kind === "punct" && (next.text === "]" || next.text === ",")) {
			c.pushError("missing '..' in array dimension", next.span);
			return undefined;
		}
		lowerTokens.push(c.consume());
	}
	const dotDot = c.expectPunct("..", "in array dimension");
	if (dotDot === undefined) return undefined;
	// Capture upper bound tokens until ',' or ']'
	const upperTokens: Token[] = [];
	while (!c.atEof()) {
		const next = c.peek();
		if (next.kind === "punct" && (next.text === "," || next.text === "]")) break;
		upperTokens.push(c.consume());
	}
	const lower: BodySpan = {
		kind: "body",
		tokens: lowerTokens,
		span: lowerTokens.length > 0
			? joinSpans((lowerTokens[0] as Token).span, (lowerTokens[lowerTokens.length - 1] as Token).span)
			: dotDot.span,
	};
	const upper: BodySpan = {
		kind: "body",
		tokens: upperTokens,
		span: upperTokens.length > 0
			? joinSpans((upperTokens[0] as Token).span, (upperTokens[upperTokens.length - 1] as Token).span)
			: dotDot.span,
	};
	return {
		kind: "array_dim",
		lower,
		upper,
		span: joinSpans(start, upper.span),
	};
}

function parseOptionalStringLength(c: Cursor): BodySpan | undefined {
	const openParen = c.eatPunct("(");
	const openBracket = openParen === undefined ? c.eatPunct("[") : undefined;
	if (openParen === undefined && openBracket === undefined) return undefined;
	const closer = openParen !== undefined ? ")" : "]";
	const tokens = collectUntil(c, (t) => t.kind === "punct" && t.text === closer);
	const close = c.expectPunct(closer, "closing string length");
	const opener = (openParen ?? openBracket) as Token;
	return {
		kind: "body",
		tokens,
		span: joinSpans(opener.span, close?.span ?? opener.span),
	};
}

function tokenDescription(t: Token): string {
	if (t.kind === "eof") return "end of input";
	if (t.kind === "keyword") return `keyword '${t.keyword ?? t.text}'`;
	return `'${t.text}'`;
}
