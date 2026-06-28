/**
 * Shared utilities for per-check modules under `semantic/checks/`.
 *
 * Underscore prefix marks "internal to the checks directory" — not part
 * of any package-public surface. Per-check files import from here; the
 * orchestrator (`semantic/diagnostics.ts`) only re-exports the result
 * type.
 */
import type { Span } from "../../lexer/span.js";
import type { BodySpan, TopLevel } from "../../parser/ast.js";
import type { Scope } from "../symbol-table.js";
import { lookup as resolverLookup } from "../resolver.js";
import { ALL_KEYWORDS } from "../../lexer/tokens.js";
import { isVgBody } from "../../vg/index.js";

export interface DiagnosticItem {
	severity: "error" | "warning" | "information" | "hint";
	span: Span;
	source: string;
	code: string;
	message: string;
}

export const KEYWORD_SET = new Set(ALL_KEYWORDS.map((k) => k.toLowerCase()));

export function getUnitName(unit: TopLevel): { text: string; span: Span } | undefined {
	if (
		unit.kind === "function_block" ||
		unit.kind === "program" ||
		unit.kind === "function" ||
		unit.kind === "method" ||
		unit.kind === "action" ||
		unit.kind === "property" ||
		unit.kind === "interface" ||
		unit.kind === "type_decl"
	) {
		return { text: unit.name.text, span: unit.name.span };
	}
	return undefined;
}

/** True when a body is ordinary ST (not a VG graphical body). */
export function isStBody(body: BodySpan): boolean {
	return !isVgBody(body.tokens);
}

/**
 * The ST statement body of a unit, or undefined.
 *
 * VG (graphical) bodies are deliberately hidden here: every consumer of
 * `getBody` is an ST-grammar check (assignment types, unresolved
 * identifier, conversions, binary operators, deref, vendor operators)
 * that assumes ST token structure and would misfire on VG. VG bodies are
 * analysed by the dedicated VG checks instead.
 */
export function getBody(unit: TopLevel): BodySpan | undefined {
	const body = getAnyBody(unit);
	if (body === undefined || !isStBody(body)) return undefined;
	return body;
}

/** The statement body of a unit regardless of sublanguage (ST or VG). */
export function getAnyBody(unit: TopLevel): BodySpan | undefined {
	switch (unit.kind) {
		case "function_block":
		case "program":
		case "function":
		case "method":
		case "action":
			return unit.body;
		default:
			return undefined;
	}
}

export function findScopeForUnit(project: Scope, unit: TopLevel): Scope | undefined {
	const targetName = getUnitName(unit)?.text.toLowerCase();
	if (targetName === undefined) return undefined;
	// Walk the WHOLE scope tree — standalone METHOD / ACTION /
	// PROPERTY units live as children of their containing FB / PROGRAM
	// scope, not directly under project (workspace-layout convention,
	// see ingestStandaloneMethod). A flat scan of project.children
	// would miss them and the body-walking checks (conversion source
	// mismatch, unresolved identifier) would silently skip every
	// method body.
	function walk(scope: Scope): Scope | undefined {
		for (const child of scope.children) {
			if (child.name.toLowerCase() === targetName) return child;
			const inner = walk(child);
			if (inner !== undefined) return inner;
		}
		return undefined;
	}
	return walk(project);
}

/** Find any scope (project-wide tree walk) whose name matches. */
export function findScopeByName(project: Scope, name: string): Scope | undefined {
	const target = name.toLowerCase();
	function walk(scope: Scope): Scope | undefined {
		for (const child of scope.children) {
			if (child.name.toLowerCase() === target) return child;
			const inner = walk(child);
			if (inner !== undefined) return inner;
		}
		return undefined;
	}
	return walk(project);
}

/** Look up an identifier and return its declared elementary type name (uppercased), or undefined when not resolvable to a simple named type. */
export function simpleIdentifierType(scope: Scope, name: string): string | undefined {
	const r = resolverLookup(scope, name);
	if (r === undefined) return undefined;
	const t = r.symbol.typeExpr;
	if (t === undefined) return undefined;
	if (t.kind === "named_type") return t.name.text.toUpperCase();
	if (t.kind === "string_type") return t.wide ? "WSTRING" : "STRING";
	return undefined;
}

export function isLexerTrivia(kind: string): boolean {
	return (
		kind === "whitespace" ||
		kind === "line_comment" ||
		kind === "block_comment" ||
		kind === "pragma"
	);
}

