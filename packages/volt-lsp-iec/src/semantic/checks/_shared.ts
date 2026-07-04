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

/** True when a body is ordinary ST — i.e. not an editable VG graphical body. (CFC/SFC bodies now
 *  materialize as an informational marker comment, which is analyzed as ST and yields nothing.) */
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
	// Primary: match by AST-span IDENTITY. A POU/method scope's `span` is the very unit.span object
	// (shared at ingest), so reference equality pins THIS unit's scope unambiguously. Name matching
	// alone is wrong here: the corpus has many FBs sharing method names (Reset/Set/Map/GoIn/…), and a
	// name walk returns the FIRST same-named scope — often a method on a DIFFERENT FB. That wrong scope
	// resolves against the wrong FB's members and lacks this body's locals, so every FB-member and
	// method-local reference (`data`, `drive`, loop `i`, …) false-positives as unresolved.
	const unitSpan = unit.span;
	function bySpan(scope: Scope): Scope | undefined {
		for (const child of scope.children) {
			if (child.span === unitSpan) return child;
			const inner = bySpan(child);
			if (inner !== undefined) return inner;
		}
		return undefined;
	}
	const identity = bySpan(project);
	if (identity !== undefined) return identity;

	// Fallback: name match — for inputs whose scope spans aren't shared object refs (some unit tests
	// construct scopes independently of the parsed unit). Walk the WHOLE tree: standalone METHOD /
	// ACTION / PROPERTY units live under their containing FB/PROGRAM scope, not directly under project.
	const targetName = getUnitName(unit)?.text.toLowerCase();
	if (targetName === undefined) return undefined;
	function byName(scope: Scope): Scope | undefined {
		for (const child of scope.children) {
			if (child.name.toLowerCase() === targetName) return child;
			const inner = byName(child);
			if (inner !== undefined) return inner;
		}
		return undefined;
	}
	return byName(project);
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


