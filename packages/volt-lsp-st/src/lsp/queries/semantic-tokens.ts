/**
 * `textDocument/semanticTokens/full` — semantic token coloring.
 *
 * Returns an integer-encoded array per the LSP 3.17 spec:
 *
 *   For each token, 5 integers:
 *     [deltaLine, deltaStartChar, length, tokenType, tokenModifiers]
 *
 *   deltaLine / deltaStartChar are deltas from the previous token's
 *   line / start (or absolute for the first token).
 *
 * Token types and modifiers are indexed into the registered legends
 * exported below. Clients receive the legend during `initialize` (via
 * `semanticTokensProvider.legend`).
 *
 * Classification source priority (highest wins):
 *   1. Lexer keyword token → `keyword`
 *   2. Reference catalog match → `type` / `function` / `macro` (pragma)
 *   3. Symbol table (user-defined) → `class` / `function` / `method`
 *      / `variable` / `parameter` / `property` / `enumMember`
 *   4. Fallback: skip (TextMate grammar handles unclassified)
 */
import { lex } from "../../lexer/lexer.js";
import type { Token } from "../../lexer/tokens.js";
import { lookup as lookupRef } from "../../reference/index.js";
import type { Scope, Symbol } from "../../semantic/symbol-table.js";

// ─── LSP legend ──────────────────────────────────────────────────────

export const TOKEN_TYPES = [
	"namespace",
	"type",
	"class",
	"enum",
	"interface",
	"struct",
	"typeParameter",
	"parameter",
	"variable",
	"property",
	"enumMember",
	"event",
	"function",
	"method",
	"macro",
	"keyword",
	"modifier",
	"comment",
	"string",
	"number",
	"regexp",
	"operator",
] as const;

export const TOKEN_MODIFIERS = [
	"declaration",
	"definition",
	"readonly",
	"static",
	"deprecated",
	"abstract",
	"async",
	"modification",
	"documentation",
	"defaultLibrary",
] as const;

export type TokenType = (typeof TOKEN_TYPES)[number];

function ti(t: TokenType): number {
	const i = TOKEN_TYPES.indexOf(t);
	if (i < 0) throw new Error(`unknown token type: ${t}`);
	return i;
}

function mod(...names: ReadonlyArray<(typeof TOKEN_MODIFIERS)[number]>): number {
	let bits = 0;
	for (const n of names) {
		const i = TOKEN_MODIFIERS.indexOf(n);
		if (i >= 0) bits |= 1 << i;
	}
	return bits;
}

// ─── Entry point ─────────────────────────────────────────────────────

export interface SemanticTokensArgs {
	source: string;
	project: Scope;
	docUri: string;
}

export interface SemanticTokensResult {
	data: number[];
}

interface ClassifiedToken {
	line: number; // 0-based
	startChar: number; // 0-based column
	length: number;
	type: number;
	modifiers: number;
}

export function semanticTokens(args: SemanticTokensArgs): SemanticTokensResult {
	const tokens = lex(args.source);
	const userSymbolIndex = indexUserSymbols(args.project, args.docUri);

	const classified: ClassifiedToken[] = [];
	for (const t of tokens) {
		const ct = classifyToken(t, userSymbolIndex);
		if (ct !== undefined) classified.push(ct);
	}

	// Sort by line then column (lexer normally produces sorted output,
	// but be defensive).
	classified.sort((a, b) => (a.line - b.line) || (a.startChar - b.startChar));

	// Delta-encode per LSP spec.
	const data: number[] = [];
	let prevLine = 0;
	let prevStart = 0;
	for (const c of classified) {
		const deltaLine = c.line - prevLine;
		const deltaStart = deltaLine === 0 ? c.startChar - prevStart : c.startChar;
		data.push(deltaLine, deltaStart, c.length, c.type, c.modifiers);
		prevLine = c.line;
		prevStart = c.startChar;
	}
	return { data };
}

// ─── Classification ──────────────────────────────────────────────────

function classifyToken(t: Token, userIndex: Map<string, Symbol>): ClassifiedToken | undefined {
	switch (t.kind) {
		case "keyword":
			return makeToken(t, ti("keyword"));
		case "int_lit":
		case "real_lit":
			return makeToken(t, ti("number"));
		case "string_lit":
			return makeToken(t, ti("string"));
		case "line_comment":
		case "block_comment":
			return makeToken(t, ti("comment"));
		case "pragma":
			return makeToken(t, ti("macro"));
		case "identifier": {
			// 1. Reference catalog — known type / operator / pragma name.
			const ref = lookupRef(t.text);
			if (ref !== undefined) {
				const modifiers = mod("defaultLibrary");
				switch (ref.kind) {
					case "data-type":
						return makeToken(t, ti("type"), modifiers);
					case "operator":
					case "type-conversion":
						return makeToken(t, ti("function"), modifiers);
					case "pragma":
						return makeToken(t, ti("macro"), modifiers);
					case "lifecycle-method":
						return makeToken(t, ti("method"), modifiers);
					case "keyword":
						return makeToken(t, ti("keyword"));
				}
			}

			// 2. User symbol table.
			const sym = userIndex.get(t.text.toLowerCase());
			if (sym !== undefined) {
				const mods = sym.uri === "" ? 0 : 0; // could add 'declaration' if we knew this token is the declaring one
				return makeToken(t, tokenTypeForSymbol(sym), mods);
			}

			// Unclassified — leave to TextMate grammar.
			return undefined;
		}
		default:
			return undefined;
	}
}

function makeToken(t: Token, type: number, modifiers: number = 0): ClassifiedToken {
	return {
		line: t.span.startLine - 1, // lexer is 1-based; LSP is 0-based
		startChar: t.span.startCol,
		length: t.span.end - t.span.start,
		type,
		modifiers,
	};
}

function tokenTypeForSymbol(sym: Symbol): number {
	switch (sym.kind) {
		case "function_block":
			return ti("class");
		case "program":
			return ti("namespace");
		case "function":
			return ti("function");
		case "method":
		case "interface_method":
			return ti("method");
		case "action":
			return ti("function");
		case "property":
		case "interface_property":
			return ti("property");
		case "interface":
			return ti("interface");
		case "namespace":
		case "gvl_block":
			return ti("namespace");
		case "type":
			return ti("struct");
		case "enum_value":
			return ti("enumMember");
		case "struct_field":
			return ti("property");
		case "var":
		case "gvl_var":
			return ti("variable");
		case "method_param":
			return ti("parameter");
	}
}

/**
 * Build a flat name→symbol map for fast lookup. We walk the project
 * scope and its children once. Multiple scopes may declare the same
 * name — we keep the first hit (innermost takes priority in real
 * resolution, but for coloring purposes any user-defined classification
 * is preferable to "unclassified").
 */
function indexUserSymbols(project: Scope, _docUri: string): Map<string, Symbol> {
	const out = new Map<string, Symbol>();
	const stack: Scope[] = [project];
	while (stack.length > 0) {
		const sc = stack.pop()!;
		for (const [key, symbols] of sc.symbols) {
			if (!out.has(key)) {
				out.set(key, symbols[0] as Symbol);
			}
		}
		stack.push(...sc.children);
	}
	return out;
}
