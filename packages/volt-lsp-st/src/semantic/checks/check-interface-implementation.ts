/**
 * Verify that every FB declaring `IMPLEMENTS <Iface>` provides every
 * method / property the interface declares. Mirrors TC's "method not
 * implemented" error.
 *
 * Resolves each interface name to a scope (cross-file via the project
 * tree). For each interface member, checks the FB's own scope has a
 * matching named child. Signature compatibility is NOT checked here —
 * pure presence-or-absence. Misnamed overrides surface as separate
 * issues; this catches the common "forgot to implement" mistake.
 */
import type { ParseResult } from "../../parser/ast.js";
import type { Scope } from "../symbol-table.js";
import { type DiagnosticItem, findScopeForUnit, findScopeByName } from "./_shared.js";

export function checkInterfaceImplementations(
	parseResult: ParseResult,
	project: Scope,
	out: DiagnosticItem[],
): void {
	for (const unit of parseResult.units) {
		if (unit.kind !== "function_block") continue;
		const implementsList = unit.implements;
		if (implementsList === undefined || implementsList.length === 0) continue;

		const fbScope = findScopeForUnit(project, unit);
		if (fbScope === undefined) continue;

		const fbMethodNames = new Set<string>();
		for (const child of fbScope.children) {
			if (child.kind === "method" || child.kind === "accessor") {
				fbMethodNames.add(child.name.toLowerCase());
			}
		}

		for (const ifaceName of implementsList) {
			const ifaceScope = findScopeByName(project, ifaceName.text);
			if (ifaceScope === undefined || ifaceScope.kind !== "interface") {
				// Interface not found in any scope we can see — silent.
				// Could be in a library, could be a typo. Other checks
				// catch the typo via unresolvedIdentifier on declaration.
				continue;
			}
			for (const [, symbols] of ifaceScope.symbols) {
				for (const ifaceMember of symbols) {
					if (ifaceMember.kind !== "interface_method" && ifaceMember.kind !== "interface_property") {
						continue;
					}
					if (fbMethodNames.has(ifaceMember.name.toLowerCase())) continue;
					out.push({
						severity: "error",
						span: ifaceName.span,
						source: "volt-lsp-st",
						code: "missing-interface-implementation",
						message: `FB '${unit.name.text}' implements '${ifaceName.text}' but doesn't provide ${ifaceMember.kind === "interface_method" ? "method" : "property"} '${ifaceMember.name}'.`,
					});
				}
			}
		}
	}
}
