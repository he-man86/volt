/**
 * Top-level parser.
 *
 * Entry point: `parse(tokens)` → `ParseResult`. Dispatches on the
 * first non-trivia keyword to the matching unit parser in `units/`.
 * Each unit parses its header, its VAR sections, then captures the
 * body as opaque tokens up to the matching END_*.
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
import { lex } from "../lexer/lexer.js";
import type { Keyword, Token } from "../lexer/tokens.js";
import type { ParseResult, TopLevel } from "./ast.js";
import { Cursor } from "./cursor.js";
import { parseAction } from "./units/action.js";
import { parseFunction } from "./units/function.js";
import { parseFunctionBlock } from "./units/function-block.js";
import { parseGlobalVarList } from "./units/global-var-list.js";
import { parseInterface } from "./units/interface.js";
import { parseMethod } from "./units/method.js";
import { parseNamespace } from "./units/namespace.js";
import { parseProgram } from "./units/program.js";
import { parseProperty } from "./units/property.js";
import { parseTypeDecl } from "./units/type-decl.js";
import { describeToken } from "./util.js";

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
	"VAR_CONFIG",
	"NAMESPACE",
];

/**
 * Dispatch on the next keyword. Returns `undefined` only when the
 * cursor doesn't sit on a top-level dispatch keyword — the caller is
 * responsible for error recovery in that case.
 *
 * Exported because `units/namespace.ts` recurses into us — it accepts
 * a `parseInner` callback to break the import cycle.
 */
export function parseTopLevel(c: Cursor): TopLevel | undefined {
	const next = c.peek();
	if (next.kind !== "keyword") return undefined;
	switch (next.keyword) {
		case "FUNCTION_BLOCK": return parseFunctionBlock(c);
		case "PROGRAM":        return parseProgram(c);
		case "FUNCTION":       return parseFunction(c);
		case "METHOD":         return parseMethod(c);
		case "ACTION":         return parseAction(c);
		case "PROPERTY":       return parseProperty(c);
		case "INTERFACE":      return parseInterface(c);
		case "TYPE":           return parseTypeDecl(c);
		case "NAMESPACE":      return parseNamespace(c, parseTopLevel);
		case "VAR_GLOBAL":
		case "VAR_CONFIG":
			// VAR_CONFIG is the IEC address-binding block; same outer
			// shape as a GVL file (single section + END_VAR), so we
			// route through the same parser. The captured VarSection
			// preserves its sectionKind so downstream consumers can
			// distinguish.
			return parseGlobalVarList(c);
		default:
			return undefined;
	}
}
