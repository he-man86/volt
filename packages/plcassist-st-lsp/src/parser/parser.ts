/**
 * Top-level parser.
 *
 * Entry point: `parse(tokens)` → `ParseResult`. Dispatches on the
 * first non-trivia keyword to the right POU/DUT/GVL parser. Each
 * top-level unit parses its header, then its VAR sections, then
 * captures the body as opaque tokens up to the matching END_*.
 *
 * Body capture rationale: we deliberately don't parse statement
 * trees — bodies are kept as opaque token spans. Later passes
 * (identifier-reference collection, diagnostics, call-hierarchy
 * scanning) walk them without re-lexing. Per
 * [[feedback-no-fallbacks-single-source]] the IDE compiler remains
 * authoritative for statement-level semantics.
 *
 * Files in the mirrored workspace typically contain one top-level
 * unit. We support more than one defensively, but a file with
 * stray tokens between units records an error and skips to the
 * next dispatch keyword.
 */
import type { Keyword, Token } from "../lexer/tokens.js";
import { lex } from "../lexer/lexer.js";
import type {
	Action,
	BodySpan,
	DutBody,
	FunctionBlock,
	Function as FunctionAST,
	GlobalVarList,
	Identifier,
	Interface,
	InterfaceMethod,
	InterfaceProperty,
	Method,
	ParseResult,
	Program,
	Property,
	TopLevel,
	TypeDecl,
	VarSection,
} from "./ast.js";
import { Cursor } from "./cursor.js";
import { parseDutBody } from "./dut.js";
import { parseTypeExpression } from "./type-expr.js";
import { atVarSection, parseVarSection } from "./var-section.js";
import {
	bodySpanFromTokens,
	identFromToken,
	joinSpans,
} from "./util.js";

/** Convenience wrapper — parse source text directly. */
export function parseSource(src: string): ParseResult {
	return parse(lex(src));
}

/** Parse a stream of tokens into one or more top-level units. */
export function parse(tokens: readonly Token[]): ParseResult {
	const c = new Cursor(tokens);
	const units: TopLevel[] = [];

	while (!c.atEof()) {
		const unit = parseTopLevel(c);
		if (unit !== undefined) {
			units.push(unit);
		} else {
			// Unrecognized token at file scope — record + skip to a
			// known dispatch keyword to keep going.
			const stray = c.peek();
			if (stray.kind === "eof") break;
			c.pushError(`unexpected ${describeToken(stray)} at file scope`, stray.span);
			c.recoverTo({ keywords: TOP_LEVEL_DISPATCH });
			if (c.peek().kind === "eof") break;
		}
	}

	return { units, errors: c.getErrors() };
}

const TOP_LEVEL_DISPATCH: readonly Keyword[] = [
	"FUNCTION_BLOCK",
	"PROGRAM",
	"FUNCTION",
	"METHOD",
	"ACTION",
	"PROPERTY",
	"INTERFACE",
	"TYPE",
	"VAR_GLOBAL",
	"NAMESPACE",
];

function parseTopLevel(c: Cursor): TopLevel | undefined {
	const next = c.peek();
	if (next.kind !== "keyword") return undefined;
	switch (next.keyword) {
		case "FUNCTION_BLOCK":
			return parseFunctionBlock(c);
		case "PROGRAM":
			return parseProgram(c);
		case "FUNCTION":
			return parseFunction(c);
		case "METHOD":
			return parseMethod(c);
		case "ACTION":
			return parseAction(c);
		case "PROPERTY":
			return parseProperty(c);
		case "INTERFACE":
			return parseInterface(c);
		case "TYPE":
			return parseTypeDecl(c);
		case "VAR_GLOBAL":
			return parseGlobalVarList(c);
		case "NAMESPACE":
			return parseNamespace(c);
		default:
			return undefined;
	}
}

// ─── NAMESPACE ───────────────────────────────────────────────────────

function parseNamespace(c: Cursor): import("./ast.js").Namespace | undefined {
	const start = c.expectKeyword("NAMESPACE", "at start of NAMESPACE");
	if (start === undefined) return undefined;
	const nameTok = c.expectIdent("for NAMESPACE name");
	if (nameTok === undefined) return undefined;
	const name = identFromToken(nameTok);

	const units: TopLevel[] = [];
	while (!c.atEof()) {
		const t = c.peek();
		if (t.kind === "keyword" && t.keyword === "END_NAMESPACE") {
			const closer = c.consume();
			return {
				kind: "namespace",
				name,
				units,
				span: joinSpans(start.span, closer.span),
			};
		}
		const inner = parseTopLevel(c);
		if (inner !== undefined) {
			units.push(inner);
			continue;
		}
		// Unknown token inside namespace — consume one and continue.
		c.pushError(
			`unexpected ${describeToken(t)} inside NAMESPACE — expected POU, TYPE, VAR_GLOBAL, or END_NAMESPACE`,
			t.span,
		);
		c.consume();
	}
	c.pushError(`unterminated NAMESPACE: expected END_NAMESPACE`, start.span);
	return { kind: "namespace", name, units, span: start.span };
}

// ─── FUNCTION_BLOCK ──────────────────────────────────────────────────

function parseFunctionBlock(c: Cursor): FunctionBlock | undefined {
	const start = c.expectKeyword("FUNCTION_BLOCK", "at start of FB");
	if (start === undefined) return undefined;

	// Optional modifiers before name: FINAL, ABSTRACT
	let isFinal = false;
	let isAbstract = false;
	while (true) {
		const mod = c.eatAnyKeyword("FINAL", "ABSTRACT");
		if (mod === undefined) break;
		if (mod.keyword === "FINAL") isFinal = true;
		if (mod.keyword === "ABSTRACT") isAbstract = true;
	}

	const nameTok = c.expectIdent("for FUNCTION_BLOCK name");
	if (nameTok === undefined) return undefined;
	const name = identFromToken(nameTok);

	// Optional EXTENDS X
	let extendsName: Identifier | undefined;
	if (c.eatKeyword("EXTENDS") !== undefined) {
		const t = c.expectIdent("after EXTENDS");
		if (t !== undefined) extendsName = identFromToken(t);
	}

	// Optional IMPLEMENTS X, Y, Z
	let implementsList: Identifier[] | undefined;
	if (c.eatKeyword("IMPLEMENTS") !== undefined) {
		implementsList = [];
		const firstIface = c.expectIdent("after IMPLEMENTS");
		if (firstIface !== undefined) implementsList.push(identFromToken(firstIface));
		while (c.eatPunct(",") !== undefined) {
			const more = c.expectIdent("in IMPLEMENTS list");
			if (more === undefined) break;
			implementsList.push(identFromToken(more));
		}
	}

	const varSections = collectVarSections(c);
	const body = collectBodyUntil(c, "END_FUNCTION_BLOCK", "function block");

	return {
		kind: "function_block",
		name,
		...(extendsName !== undefined ? { extends: extendsName } : {}),
		...(implementsList !== undefined ? { implements: implementsList } : {}),
		...(isFinal ? { final: true } : {}),
		...(isAbstract ? { abstract: true } : {}),
		varSections,
		body,
		span: joinSpans(start.span, body.span),
	};
}

// ─── PROGRAM ─────────────────────────────────────────────────────────

function parseProgram(c: Cursor): Program | undefined {
	const start = c.expectKeyword("PROGRAM", "at start of PROGRAM");
	if (start === undefined) return undefined;
	const nameTok = c.expectIdent("for PROGRAM name");
	if (nameTok === undefined) return undefined;
	const name = identFromToken(nameTok);

	const varSections = collectVarSections(c);
	const body = collectBodyUntil(c, "END_PROGRAM", "program");

	return {
		kind: "program",
		name,
		varSections,
		body,
		span: joinSpans(start.span, body.span),
	};
}

// ─── FUNCTION ────────────────────────────────────────────────────────

function parseFunction(c: Cursor): FunctionAST | undefined {
	const start = c.expectKeyword("FUNCTION", "at start of FUNCTION");
	if (start === undefined) return undefined;
	const nameTok = c.expectIdent("for FUNCTION name");
	if (nameTok === undefined) return undefined;
	const name = identFromToken(nameTok);

	// Optional `: ReturnType`
	let returnType: FunctionAST["returnType"];
	if (c.eatPunct(":") !== undefined) {
		returnType = parseTypeExpression(c);
	}

	const varSections = collectVarSections(c);
	const body = collectBodyUntil(c, "END_FUNCTION", "function");

	return {
		kind: "function",
		name,
		...(returnType !== undefined ? { returnType } : {}),
		varSections,
		body,
		span: joinSpans(start.span, body.span),
	};
}

// ─── METHOD ──────────────────────────────────────────────────────────

function parseMethod(c: Cursor): Method | undefined {
	const start = c.expectKeyword("METHOD", "at start of METHOD");
	if (start === undefined) return undefined;

	// Stacked modifiers in any order: access (PUBLIC/PRIVATE/PROTECTED/INTERNAL),
	// FINAL, ABSTRACT, OVERRIDE. The April 2026 incident anchor.
	let accessModifier: Method["accessModifier"];
	let isFinal = false;
	let isAbstract = false;
	let isOverride = false;
	while (true) {
		const mod = c.eatAnyKeyword(
			"PUBLIC",
			"PRIVATE",
			"PROTECTED",
			"INTERNAL",
			"FINAL",
			"ABSTRACT",
			"OVERRIDE",
		);
		if (mod === undefined) break;
		if (
			mod.keyword === "PUBLIC" ||
			mod.keyword === "PRIVATE" ||
			mod.keyword === "PROTECTED" ||
			mod.keyword === "INTERNAL"
		) {
			accessModifier = mod.keyword;
		} else if (mod.keyword === "FINAL") {
			isFinal = true;
		} else if (mod.keyword === "ABSTRACT") {
			isAbstract = true;
		} else if (mod.keyword === "OVERRIDE") {
			isOverride = true;
		}
	}

	const nameTok = c.expectIdent("for METHOD name");
	if (nameTok === undefined) return undefined;
	const name = identFromToken(nameTok);

	// Optional `: ReturnType`
	let returnType: Method["returnType"];
	if (c.eatPunct(":") !== undefined) {
		returnType = parseTypeExpression(c);
	}

	const varSections = collectVarSections(c);
	const body = collectBodyUntil(c, "END_METHOD", "method");

	return {
		kind: "method",
		name,
		...(accessModifier !== undefined ? { accessModifier } : {}),
		...(isFinal ? { final: true } : {}),
		...(isAbstract ? { abstract: true } : {}),
		...(isOverride ? { override: true } : {}),
		...(returnType !== undefined ? { returnType } : {}),
		varSections,
		body,
		span: joinSpans(start.span, body.span),
	};
}

// ─── ACTION ──────────────────────────────────────────────────────────

function parseAction(c: Cursor): Action | undefined {
	const start = c.expectKeyword("ACTION", "at start of ACTION");
	if (start === undefined) return undefined;
	const nameTok = c.expectIdent("for ACTION name");
	if (nameTok === undefined) return undefined;
	const name = identFromToken(nameTok);
	const body = collectBodyUntil(c, "END_ACTION", "action");
	return {
		kind: "action",
		name,
		body,
		span: joinSpans(start.span, body.span),
	};
}

// ─── PROPERTY ────────────────────────────────────────────────────────

function parseProperty(c: Cursor): Property | undefined {
	const start = c.expectKeyword("PROPERTY", "at start of PROPERTY");
	if (start === undefined) return undefined;

	const accessModifier = (() => {
		const m = c.eatAnyKeyword("PUBLIC", "PRIVATE", "PROTECTED", "INTERNAL");
		return m?.keyword;
	})();

	const nameTok = c.expectIdent("for PROPERTY name");
	if (nameTok === undefined) return undefined;
	const name = identFromToken(nameTok);

	const colon = c.expectPunct(":", "after PROPERTY name");
	if (colon === undefined) return undefined;
	const dataType = parseTypeExpression(c);
	if (dataType === undefined) return undefined;

	// Some sources put GET/SET accessor bodies inline; many split them
	// into separate child files. We capture the inline form
	// optionally, and skip everything else until END_PROPERTY.
	let getter: Property["getter"];
	let setter: Property["setter"];

	while (!c.atEof()) {
		const endProp = c.eatKeyword("END_PROPERTY");
		if (endProp !== undefined) {
			return {
				kind: "property",
				name,
				...(accessModifier !== undefined ? { accessModifier } : {}),
				dataType,
				...(getter !== undefined ? { getter } : {}),
				...(setter !== undefined ? { setter } : {}),
				span: joinSpans(start.span, endProp.span),
			};
		}
		const accessor = parseInlineAccessor(c);
		if (accessor !== undefined) {
			if (accessor.kind === "get") getter = accessor;
			else setter = accessor;
			continue;
		}
		// Unknown content inside PROPERTY — record and skip to next anchor
		const stray = c.peek();
		c.pushError(`unexpected ${describeToken(stray)} inside PROPERTY body`, stray.span);
		if (!c.recoverTo({ keywords: ["END_PROPERTY", "GET", "SET"] })) break;
	}

	c.pushError("unterminated PROPERTY: expected END_PROPERTY", start.span);
	return {
		kind: "property",
		name,
		...(accessModifier !== undefined ? { accessModifier } : {}),
		dataType,
		...(getter !== undefined ? { getter } : {}),
		...(setter !== undefined ? { setter } : {}),
		span: joinSpans(start.span, dataType.span),
	};
}

function parseInlineAccessor(c: Cursor): Property["getter"] | undefined {
	const kw = c.eatAnyKeyword("GET", "SET");
	if (kw === undefined) return undefined;
	const kind: "get" | "set" = kw.keyword === "GET" ? "get" : "set";
	const varSections = collectVarSections(c);
	const endAccessor: Keyword = kind === "get" ? "END_GET" : "END_SET";

	// Two acceptable termination patterns:
	//   1. Proper IEC-61131 form:  GET … END_GET   /  SET … END_SET
	//      We CONSUME the END_GET / END_SET as the accessor's closer.
	//   2. Sloppy form (some IDE exports omit END_GET/END_SET and let
	//      the next GET/SET/END_PROPERTY implicitly close the prior):
	//      We STOP at the next GET/SET/END_PROPERTY WITHOUT consuming,
	//      so the outer parseProperty loop can dispatch on it.
	//
	// Earlier this code called the shared `collectBodyUntilAny` which
	// always consumes its ender — that swallowed the next accessor's
	// opening keyword and the outer loop's next iteration mis-parsed
	// the body as PROPERTY-level garbage.
	const body = collectAccessorBody(c, endAccessor);
	return {
		kind,
		varSections,
		body,
		span: joinSpans(kw.span, body.span),
	};
}

function collectAccessorBody(c: Cursor, endAccessor: Keyword): BodySpan {
	const startSpan = c.peek().span;
	const tokens: Token[] = [];
	while (!c.atEof()) {
		const t = c.peek();
		if (t.kind === "keyword" && t.keyword !== undefined) {
			if (t.keyword === endAccessor) {
				const closer = c.consume();
				return bodySpanFromTokens(tokens, joinSpans(startSpan, closer.span));
			}
			if (
				t.keyword === "GET" ||
				t.keyword === "SET" ||
				t.keyword === "END_PROPERTY"
			) {
				// Sloppy close — stop without consuming.
				return bodySpanFromTokens(tokens, startSpan);
			}
		}
		tokens.push(c.consume());
	}
	c.pushError(
		`unterminated property accessor: expected ${endAccessor} (or next GET/SET/END_PROPERTY)`,
		startSpan,
	);
	return bodySpanFromTokens(tokens, startSpan);
}

// ─── INTERFACE ───────────────────────────────────────────────────────

function parseInterface(c: Cursor): Interface | undefined {
	const start = c.expectKeyword("INTERFACE", "at start of INTERFACE");
	if (start === undefined) return undefined;
	const nameTok = c.expectIdent("for INTERFACE name");
	if (nameTok === undefined) return undefined;
	const name = identFromToken(nameTok);

	// Optional EXTENDS X, Y, Z (interfaces can extend multiple)
	let extendsList: Identifier[] | undefined;
	if (c.eatKeyword("EXTENDS") !== undefined) {
		extendsList = [];
		const first = c.expectIdent("after EXTENDS");
		if (first !== undefined) extendsList.push(identFromToken(first));
		while (c.eatPunct(",") !== undefined) {
			const more = c.expectIdent("in EXTENDS list");
			if (more === undefined) break;
			extendsList.push(identFromToken(more));
		}
	}

	const methods: InterfaceMethod[] = [];
	const properties: InterfaceProperty[] = [];

	while (!c.atEof()) {
		const endIface = c.eatKeyword("END_INTERFACE");
		if (endIface !== undefined) {
			return {
				kind: "interface",
				name,
				...(extendsList !== undefined ? { extends: extendsList } : {}),
				methods,
				properties,
				span: joinSpans(start.span, endIface.span),
			};
		}

		// Interface method signature
		const methodKw = c.peek();
		if (methodKw.kind === "keyword" && methodKw.keyword === "METHOD") {
			const m = parseInterfaceMethod(c);
			if (m !== undefined) methods.push(m);
			continue;
		}
		// Interface property signature
		if (methodKw.kind === "keyword" && methodKw.keyword === "PROPERTY") {
			const p = parseInterfaceProperty(c);
			if (p !== undefined) properties.push(p);
			continue;
		}
		// Unknown — record and skip
		const stray = c.peek();
		c.pushError(`unexpected ${describeToken(stray)} inside INTERFACE`, stray.span);
		if (!c.recoverTo({ keywords: ["END_INTERFACE", "METHOD", "PROPERTY"] })) break;
	}

	c.pushError("unterminated INTERFACE: expected END_INTERFACE", start.span);
	return {
		kind: "interface",
		name,
		...(extendsList !== undefined ? { extends: extendsList } : {}),
		methods,
		properties,
		span: joinSpans(start.span, name.span),
	};
}

function parseInterfaceMethod(c: Cursor): InterfaceMethod | undefined {
	const start = c.expectKeyword("METHOD", "at start of interface method");
	if (start === undefined) return undefined;
	// Modifiers are allowed but informational on interfaces
	while (
		c.eatAnyKeyword(
			"PUBLIC",
			"PRIVATE",
			"PROTECTED",
			"INTERNAL",
			"FINAL",
			"ABSTRACT",
			"OVERRIDE",
		) !== undefined
	) {
		// consume and ignore
	}
	const nameTok = c.expectIdent("for interface method name");
	if (nameTok === undefined) return undefined;
	const name = identFromToken(nameTok);
	let returnType: InterfaceMethod["returnType"];
	if (c.eatPunct(":") !== undefined) {
		returnType = parseTypeExpression(c);
	}
	const varSections = collectVarSections(c);
	// Interfaces have no method bodies — the next keyword should be
	// END_METHOD (then we look for the next interface member). Some
	// formats omit END_METHOD entirely.
	const endMethod = c.eatKeyword("END_METHOD");
	const endSpan = endMethod?.span ?? returnType?.span ?? name.span;
	return {
		kind: "interface_method",
		name,
		...(returnType !== undefined ? { returnType } : {}),
		varSections,
		span: joinSpans(start.span, endSpan),
	};
}

function parseInterfaceProperty(c: Cursor): InterfaceProperty | undefined {
	const start = c.expectKeyword("PROPERTY", "at start of interface property");
	if (start === undefined) return undefined;
	const nameTok = c.expectIdent("for interface property name");
	if (nameTok === undefined) return undefined;
	const name = identFromToken(nameTok);
	if (c.expectPunct(":", "after interface property name") === undefined) return undefined;
	const dataType = parseTypeExpression(c);
	if (dataType === undefined) return undefined;
	// Interfaces may declare which of GET/SET accessors are required.
	let hasGetter = false;
	let hasSetter = false;
	while (true) {
		const accessor = c.eatAnyKeyword("GET", "SET");
		if (accessor === undefined) break;
		if (accessor.keyword === "GET") hasGetter = true;
		if (accessor.keyword === "SET") hasSetter = true;
	}
	const endProp = c.eatKeyword("END_PROPERTY");
	const endSpan = endProp?.span ?? dataType.span;
	return {
		kind: "interface_property",
		name,
		dataType,
		hasGetter,
		hasSetter,
		span: joinSpans(start.span, endSpan),
	};
}

// ─── TYPE … END_TYPE ─────────────────────────────────────────────────

function parseTypeDecl(c: Cursor): TypeDecl | undefined {
	const start = c.expectKeyword("TYPE", "at start of TYPE block");
	if (start === undefined) return undefined;
	const nameTok = c.expectIdent("for TYPE name");
	if (nameTok === undefined) return undefined;
	const name = identFromToken(nameTok);
	const colon = c.expectPunct(":", "after TYPE name");
	if (colon === undefined) return undefined;
	const body = parseDutBody(c);
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

// ─── VAR_GLOBAL list (top-level GVL file) ────────────────────────────

function parseGlobalVarList(c: Cursor): GlobalVarList | undefined {
	const start = c.peek();
	const varSections = collectVarSections(c);
	if (varSections.length === 0) return undefined;
	const last = varSections[varSections.length - 1] as VarSection;
	return {
		kind: "global_var_list",
		varSections,
		span: joinSpans(start.span, last.span),
	};
}

// ─── Shared collectors ───────────────────────────────────────────────

function collectVarSections(c: Cursor): VarSection[] {
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
function collectBodyUntil(c: Cursor, ender: Keyword, context: string): BodySpan {
	return collectBodyUntilAny(c, [ender], context);
}

function collectBodyUntilAny(
	c: Cursor,
	enders: readonly Keyword[],
	context: string,
): BodySpan {
	const startSpan = c.peek().span;
	const tokens: Token[] = [];
	while (!c.atEof()) {
		const t = c.peek();
		if (t.kind === "keyword" && t.keyword !== undefined && enders.includes(t.keyword)) {
			// Consume the ender. (For the multi-ender case, the caller
			// might want it back — but interface/property recover by
			// peeking BEFORE calling collectBodyUntilAny, so by the
			// time we get here, consuming is right.)
			const closer = c.consume();
			return bodySpanFromTokens(tokens, joinSpans(startSpan, closer.span));
		}
		tokens.push(c.consume());
	}
	c.pushError(`unterminated ${context}: expected ${enders.join(" or ")}`, startSpan);
	return bodySpanFromTokens(tokens, startSpan);
}

function describeToken(t: Token): string {
	if (t.kind === "eof") return "end of input";
	if (t.kind === "keyword") return `keyword '${t.keyword ?? t.text}'`;
	if (t.kind === "identifier") return `identifier '${t.text}'`;
	if (t.kind === "punct") return `'${t.text}'`;
	return `${t.kind} '${t.text}'`;
}
