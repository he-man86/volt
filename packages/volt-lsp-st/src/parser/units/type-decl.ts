/**
 * `TYPE Name [EXTENDS Base] : <body> [;] END_TYPE`
 *
 * Dispatches on the first keyword/punct after the colon:
 *
 *   STRUCT … END_STRUCT      → struct (fields look like VAR decls; supports EXTENDS)
 *   UNION  … END_UNION       → union (struct-like)
 *   '(' … ')' [base]         → enum (comma-separated values, optional base type)
 *   anything else            → alias (just parses a TypeExpr)
 *
 * The `EXTENDS BaseStruct` clause between the name and the `:`
 * applies to STRUCT DUTs only (OOP-style structs in TwinCAT 3 /
 * CODESYS 3.5). It's hoisted onto the STRUCT body so the AST puts
 * the inheritance info next to the fields.
 *
 * The trailing `;` before END_TYPE is consumed here (single source
 * of truth) — TwinCAT-idiomatic C-style terminator is tolerated for
 * struct/union/enum and required for aliases.
 */
import type { Token } from "../../lexer/tokens.js";
import type {
	AliasBody,
	DutBody,
	EnumBody,
	EnumValue,
	Identifier,
	StructBody,
	TypeDecl,
	UnionBody,
	VarDecl,
} from "../ast.js";
import type { Cursor } from "../cursor.js";
import { parseTypeExpression } from "../type-expr.js";
import { bodySpanFromTokens, identFromToken, joinSpans } from "../util.js";

export function parseTypeDecl(c: Cursor): TypeDecl | undefined {
	const start = c.expectKeyword("TYPE", "at start of TYPE block");
	if (start === undefined) return undefined;
	const nameTok = c.expectIdent("for TYPE name");
	if (nameTok === undefined) return undefined;
	const name = identFromToken(nameTok);
	// Optional `EXTENDS Base` clause between the name and the `:` —
	// applies to STRUCT DUTs (CODESYS / TwinCAT 3.5+ OO-style structs).
	// Per 06-data-types.md: `TYPE S_PENTAGON EXTENDS S_POLYGONLINE : STRUCT ...`.
	let extendsName: Identifier | undefined;
	if (c.eatKeyword("EXTENDS") !== undefined) {
		const t = c.expectIdent("after EXTENDS in TYPE");
		if (t !== undefined) extendsName = identFromToken(t);
	}
	const colon = c.expectPunct(":", "after TYPE name");
	if (colon === undefined) return undefined;
	const body = parseDutBody(c);
	// Hoist the EXTENDS onto the STRUCT body (the AST stores it there).
	if (extendsName !== undefined && body !== undefined && body.kind === "struct" && body.extends === undefined) {
		body.extends = extendsName;
	}
	// TwinCAT-idiomatic optional `;` after the body (engineers C-style
	// terminate the enum/struct/alias before END_TYPE). Spec-permissive
	// for aliases (always required), tolerated by TC for the others.
	c.eatPunct(";");
	const endType = c.expectKeyword("END_TYPE", "after TYPE body");
	const endSpan = endType?.span ?? body?.span ?? start.span;
	if (body === undefined) {
		return {
			kind: "type_decl",
			name,
			body: { kind: "alias", target: { kind: "named_type", name: { kind: "identifier", text: "?", span: name.span }, span: name.span }, span: name.span } satisfies DutBody,
			span: joinSpans(start.span, endSpan),
		};
	}
	return {
		kind: "type_decl",
		name,
		body,
		span: joinSpans(start.span, endSpan),
	};
}

// ─── DUT body parsers ────────────────────────────────────────────────

function parseDutBody(c: Cursor): DutBody | undefined {
	const next = c.peek();
	if (next.kind === "keyword" && next.keyword === "STRUCT") {
		return parseStructBody(c);
	}
	if (next.kind === "keyword" && next.keyword === "UNION") {
		return parseUnionBody(c);
	}
	if (next.kind === "punct" && next.text === "(") {
		return parseEnumBody(c);
	}
	return parseAliasBody(c);
}

function parseStructBody(c: Cursor): StructBody | undefined {
	const start = c.expectKeyword("STRUCT", "at start of struct");
	if (start === undefined) return undefined;

	let extendsName: Identifier | undefined;
	if (c.eatKeyword("EXTENDS") !== undefined) {
		const t = c.expectIdent("after EXTENDS in struct");
		if (t !== undefined) extendsName = identFromToken(t);
	}

	const fields: VarDecl[] = [];
	while (!c.atEof()) {
		const endStruct = c.eatKeyword("END_STRUCT");
		if (endStruct !== undefined) {
			return {
				kind: "struct",
				...(extendsName !== undefined ? { extends: extendsName } : {}),
				fields,
				span: joinSpans(start.span, endStruct.span),
			};
		}
		const decl = parseStructField(c);
		if (decl !== undefined) {
			fields.push(decl);
		} else {
			if (!c.recoverTo({ keywords: ["END_STRUCT"], puncts: [";"] })) break;
			c.eatPunct(";");
		}
	}
	c.pushError("unterminated STRUCT: expected END_STRUCT", start.span);
	return {
		kind: "struct",
		...(extendsName !== undefined ? { extends: extendsName } : {}),
		fields,
		span: start.span,
	};
}

function parseUnionBody(c: Cursor): UnionBody | undefined {
	const start = c.expectKeyword("UNION", "at start of union");
	if (start === undefined) return undefined;
	const fields: VarDecl[] = [];
	while (!c.atEof()) {
		const endUnion = c.eatKeyword("END_UNION");
		if (endUnion !== undefined) {
			return {
				kind: "union",
				fields,
				span: joinSpans(start.span, endUnion.span),
			};
		}
		const decl = parseStructField(c);
		if (decl !== undefined) {
			fields.push(decl);
		} else {
			if (!c.recoverTo({ keywords: ["END_UNION"], puncts: [";"] })) break;
			c.eatPunct(";");
		}
	}
	c.pushError("unterminated UNION: expected END_UNION", start.span);
	return { kind: "union", fields, span: start.span };
}

/**
 * Struct/union field — same shape as a VAR decl but without the
 * VAR/END_VAR wrapper.
 */
function parseStructField(c: Cursor): VarDecl | undefined {
	const first = c.expectIdent("for struct field name");
	if (first === undefined) return undefined;
	const names: Identifier[] = [identFromToken(first)];
	while (c.eatPunct(",") !== undefined) {
		const more = c.expectIdent("in struct field name list");
		if (more === undefined) break;
		names.push(identFromToken(more));
	}
	const colon = c.expectPunct(":", "after struct field name");
	if (colon === undefined) return undefined;
	const type = parseTypeExpression(c);
	if (type === undefined) return undefined;

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

	const semi = c.expectPunct(";", "after struct field");
	const endSpan = semi?.span ?? init?.span ?? type.span;
	return {
		kind: "var_decl",
		names,
		type,
		...(init !== undefined ? { init } : {}),
		span: joinSpans(first.span, endSpan),
	};
}

function parseEnumBody(c: Cursor): EnumBody | undefined {
	const open = c.expectPunct("(", "at start of enum body");
	if (open === undefined) return undefined;
	const values: EnumValue[] = [];

	while (!c.atEof()) {
		if (c.eatPunct(")") !== undefined) break;
		const nameTok = c.expectIdent("for enum value");
		if (nameTok === undefined) {
			if (!c.recoverTo({ puncts: [",", ")"] })) break;
			c.eatPunct(",");
			continue;
		}
		const name = identFromToken(nameTok);
		let value: EnumValue["value"];
		const assign = c.eatPunct(":=");
		if (assign !== undefined) {
			const tokens: Token[] = [];
			while (!c.atEof()) {
				const next = c.peek();
				if (next.kind === "punct" && (next.text === "," || next.text === ")")) break;
				tokens.push(c.consume());
			}
			value = bodySpanFromTokens(tokens, assign.span);
		}
		const valSpan = value?.span ?? name.span;
		values.push({
			kind: "enum_value",
			name,
			...(value !== undefined ? { value } : {}),
			span: joinSpans(name.span, valSpan),
		});
		if (c.eatPunct(",") !== undefined) continue;
		// No comma — expect close paren next iteration
	}

	// Optional explicit base type after the parens: `(VAL1, VAL2) BYTE`
	let baseType: EnumBody["baseType"];
	const peekNext = c.peek();
	if (peekNext.kind === "identifier" || peekNext.kind === "keyword") {
		// Only treat next ident/STRING as base type if it isn't END_TYPE
		// (that's the close of the surrounding TYPE block).
		const isEndType = peekNext.kind === "keyword" && peekNext.keyword === "END_TYPE";
		if (!isEndType) {
			baseType = parseTypeExpression(c);
		}
	}

	const endSpan = baseType?.span ?? open.span;
	return {
		kind: "enum",
		...(baseType !== undefined ? { baseType } : {}),
		values,
		span: joinSpans(open.span, endSpan),
	};
}

function parseAliasBody(c: Cursor): AliasBody | undefined {
	const start = c.peek().span;
	const target = parseTypeExpression(c);
	if (target === undefined) return undefined;

	let init: AliasBody["init"];
	const assign = c.eatPunct(":=");
	if (assign !== undefined) {
		const tokens: Token[] = [];
		while (!c.atEof()) {
			const next = c.peek();
			if (next.kind === "keyword" && next.keyword === "END_TYPE") break;
			if (next.kind === "punct" && next.text === ";") break;
			tokens.push(c.consume());
		}
		init = bodySpanFromTokens(tokens, assign.span);
	}

	// Note: the trailing `;` (and the optional one for struct/union/enum)
	// is consumed at the parseTypeDecl level — single source of truth.

	const endSpan = init?.span ?? target.span;
	return {
		kind: "alias",
		target,
		...(init !== undefined ? { init } : {}),
		span: joinSpans(start, endSpan),
	};
}
