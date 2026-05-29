/**
 * Shadowing — every symbol in every scope is checked against its
 * parent chain. A same-name hit in an outer scope produces an
 * "information"-severity diagnostic at the inner declaration.
 */
import type { Scope } from "../symbol-table.js";
import type { DiagnosticItem } from "./_shared.js";

export function checkShadowing(project: Scope, out: DiagnosticItem[]): void {
	walkShadowing(project, out);
}

function walkShadowing(scope: Scope, out: DiagnosticItem[]): void {
	for (const [, symbols] of scope.symbols) {
		for (const sym of symbols) {
			let parent = scope.parent;
			while (parent !== undefined) {
				const outerHits = parent.symbols.get(sym.name.toLowerCase());
				if (outerHits !== undefined && outerHits.length > 0) {
					out.push({
						severity: "information",
						span: sym.span,
						source: "volt-lsp-st",
						code: "shadowing-declaration",
						message: `'${sym.name}' shadows a same-name declaration in outer scope '${parent.name}'.`,
					});
					break;
				}
				parent = parent.parent;
			}
		}
	}
	for (const child of scope.children) {
		walkShadowing(child, out);
	}
}
