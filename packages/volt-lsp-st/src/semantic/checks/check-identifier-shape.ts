/**
 * Identifier-shape diagnostics:
 *   - reserved-keyword (identifier names that collide with a keyword)
 *   - double-underscore-prefix (system-reserved)
 *   - consecutive-underscores
 *   - duplicate-declaration (same name twice in one scope)
 *
 * Walks every top-level unit's declared names + a project-wide pass
 * over the scope tree for duplicates.
 */
import type { Span } from "../../lexer/span.js";
import type { ParseResult, TopLevel } from "../../parser/ast.js";
import type { Scope, Symbol } from "../symbol-table.js";
import type { DiagnosticConfig } from "../../lsp/config/index.js";
import { type DiagnosticItem, KEYWORD_SET, getUnitName } from "./_shared.js";

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
		walkScopeForDuplicates(project, out);
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
	if (cfg.reservedKeyword && KEYWORD_SET.has(name.toLowerCase())) {
		out.push({
			severity: "error",
			span,
			source: "volt-lsp-st",
			code: "reserved-keyword",
			message: `'${name}' is a CODESYS keyword and cannot be used as an identifier`,
		});
	}
	if (cfg.doubleUnderscore && name.startsWith("__")) {
		out.push({
			severity: "error",
			span,
			source: "volt-lsp-st",
			code: "double-underscore-prefix",
			message: `Identifiers starting with '__' are reserved for system-generated names`,
		});
	}
	if (cfg.consecutiveUnderscores && /_{2,}/.test(name) && !name.startsWith("__")) {
		// The startsWith('__') guard avoids double-firing with double-underscore check.
		out.push({
			severity: "error",
			span,
			source: "volt-lsp-st",
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
					source: "volt-lsp-st",
					code: "duplicate-declaration",
					message: `'${sym.name}' is already declared in this scope`,
				});
			}
		}
	}
	for (const child of scope.children) {
		walkScopeForDuplicates(child, out);
	}
}
