/**
 * Identifier-shape diagnostics:
 *   - reserved-keyword (identifier names that collide with a keyword)
 *   - double-underscore-prefix (system-reserved)
 *   - consecutive-underscores
 *   - duplicate-declaration (same name twice in one scope)
 *
 * Walks every top-level unit's declared names, and checks each unit's OWN
 * scope tree (its VARs, method params, struct fields, …) for duplicates.
 *
 * Scoped to the CURRENT file's units — NOT the whole project: two files
 * legitimately reuse names (a `GVL`, an `Errors` GVL, a `Delete` FB + a
 * `Delete` function), which CODESYS resolves by namespace and IEC allows;
 * flagging those (and re-emitting every project duplicate on every file's
 * diagnostic pass) was a massive false-positive source.
 */
import type { Span } from "../../lexer/span.js";
import type { ParseResult, TopLevel } from "../../parser/ast.js";
import type { Scope, Symbol } from "../symbol-table.js";
import type { DiagnosticConfig } from "../../lsp/config/index.js";
import { type DiagnosticItem, KEYWORD_SET, getUnitName, findScopeForUnit } from "./_shared.js";

/** Contextual keywords that are ALSO valid identifiers (accessors + access/inheritance modifiers). CODESYS
 *  reserves them only in specific positions, so a method/var named `Set`, `Get`, `Override`, … is legal and
 *  must not be flagged reserved-keyword. Mirrors `Cursor.expectName`'s soft-keyword acceptance. */
const CONTEXTUAL_KEYWORDS = new Set([
	"get", "set", "public", "private", "protected", "internal", "final", "abstract", "override",
]);

export function walkDeclarations(
	parseResult: ParseResult,
	project: Scope,
	cfg: DiagnosticConfig,
	out: DiagnosticItem[],
): void {
	for (const unit of parseResult.units) {
		checkUnitIdentifiers(unit, cfg, out);
	}
	if (cfg.duplicateDeclaration) {
		// Only THIS file's unit scopes — a POU's own locals/methods, a struct's fields, etc. Skip the project
		// scope (cross-file name reuse is legal + resolved by namespace) and never walk other files' units.
		for (const unit of parseResult.units) {
			const scope = findScopeForUnit(project, unit);
			if (scope !== undefined) walkScopeForDuplicates(scope, out);
		}
	}
}

function checkUnitIdentifiers(unit: TopLevel, cfg: DiagnosticConfig, out: DiagnosticItem[]): void {
	const topName = getUnitName(unit);
	if (topName !== undefined) {
		emitIdentifierShapeDiagnostics(topName.text, topName.span, cfg, out);
	}
	if ("varSections" in unit) {
		for (const section of unit.varSections) {
			for (const decl of section.decls) {
				for (const id of decl.names) {
					emitIdentifierShapeDiagnostics(id.text, id.span, cfg, out);
				}
			}
		}
	}
}

function emitIdentifierShapeDiagnostics(
	name: string,
	span: Span,
	cfg: DiagnosticConfig,
	out: DiagnosticItem[],
): void {
	if (cfg.reservedKeyword && KEYWORD_SET.has(name.toLowerCase()) && !CONTEXTUAL_KEYWORDS.has(name.toLowerCase())) {
		out.push({
			severity: "error",
			span,
			source: "volt-lsp-iec",
			code: "reserved-keyword",
			message: `'${name}' is a CODESYS keyword and cannot be used as an identifier`,
		});
	}
	if (cfg.doubleUnderscore && name.startsWith("__")) {
		out.push({
			severity: "error",
			span,
			source: "volt-lsp-iec",
			code: "double-underscore-prefix",
			message: `Identifiers starting with '__' are reserved for system-generated names`,
		});
	}
	if (cfg.consecutiveUnderscores && /_{2,}/.test(name) && !name.startsWith("__")) {
		// The startsWith('__') guard avoids double-firing with double-underscore check.
		out.push({
			severity: "error",
			span,
			source: "volt-lsp-iec",
			code: "consecutive-underscores",
			message: `Multiple consecutive underscores are not permitted in identifiers`,
		});
	}
}

function walkScopeForDuplicates(scope: Scope, out: DiagnosticItem[]): void {
	for (const [, symbols] of scope.symbols) {
		// `qualified_only` GVL vars are NOT in the bare-name search path —
		// they live inside their GVL's own namespace. Two different GVLs may
		// each declare a var with the same name without conflict, so exclude
		// them entirely from the flat-scope duplicate check.
		const bareNameSymbols = symbols.filter((s) => !s.qualifiedOnly);
		if (bareNameSymbols.length > 1) {
			for (let i = 1; i < bareNameSymbols.length; i++) {
				const sym = bareNameSymbols[i] as Symbol;
				out.push({
					severity: "error",
					span: sym.span,
					source: "volt-lsp-iec",
					code: "duplicate-declaration",
					// Mirror the compiler's wording (both vendors identical), naming the enclosing POU.
					message: `A local variable named '${sym.name}' is already defined in '${scope.name}'`,
				});
			}
		}
	}
	for (const child of scope.children) {
		walkScopeForDuplicates(child, out);
	}
}
