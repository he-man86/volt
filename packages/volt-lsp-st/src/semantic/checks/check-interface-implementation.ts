/**
 * Verify that every FB declaring `IMPLEMENTS <Iface>` provides every
 * method / property the interface declares. Mirrors TC's "method not
 * implemented" error.
 *
 * Resolves each interface name to a scope (cross-file via the project
 * tree). For each interface member:
 *   1. Checks the FB's own scope has a matching named child (presence check).
 *   2. When `checkSignatures` is true, also validates that the
 *      concrete method's VAR_INPUT param count and types match the
 *      interface declaration (signature check). Skips type comparison
 *      when either side has an unresolvable type (library type, generic)
 *      to avoid false positives.
 */
import type { InterfaceMethod, InterfaceProperty, ParseResult, VarSection } from "../../parser/ast.js";
import type { Scope, Symbol } from "../symbol-table.js";
import { lookupLocal } from "../symbol-table.js";
import { resolveTypeExpr } from "../type-resolver.js";
import { type DiagnosticItem, findScopeForUnit, findScopeByName } from "./_shared.js";

export function checkInterfaceImplementations(
	parseResult: ParseResult,
	project: Scope,
	checkSignatures: boolean,
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
				// Interface not found — silent. Could be a library type or typo;
				// unresolved-identifier handles the typo case.
				continue;
			}
			for (const [, symbols] of ifaceScope.symbols) {
				for (const ifaceMember of symbols) {
					if (ifaceMember.kind !== "interface_method" && ifaceMember.kind !== "interface_property") {
						continue;
					}
					const memberNameLc = ifaceMember.name.toLowerCase();
					if (!fbMethodNames.has(memberNameLc)) {
						out.push({
							severity: "error",
							span: ifaceName.span,
							source: "volt-lsp-st",
							code: "missing-interface-implementation",
							message: `FB '${unit.name.text}' implements '${ifaceName.text}' but doesn't provide ${ifaceMember.kind === "interface_method" ? "method" : "property"} '${ifaceMember.name}'.`,
						});
						continue;
					}

					// Member is present — optionally check signature.
					if (!checkSignatures) continue;
					const concreteScopeChild = fbScope.children.find(
						(c) => c.name.toLowerCase() === memberNameLc,
					);
					if (concreteScopeChild === undefined) continue;

					if (ifaceMember.kind === "interface_method") {
						checkMethodSignature(
							unit.name.text,
							ifaceName.text,
							ifaceMember,
							concreteScopeChild,
							project,
							out,
						);
					}
					// Property type mismatch: compare data type via resolver.
					if (ifaceMember.kind === "interface_property") {
						checkPropertySignature(
							unit.name.text,
							ifaceName.text,
							ifaceMember,
							lookupLocal(fbScope, ifaceMember.name).find((s) => s.kind === "property"),
							project,
							out,
						);
					}
				}
			}
		}
	}
}

/** Compare the VAR_INPUT param count and types between an interface method and its concrete override. */
function checkMethodSignature(
	fbName: string,
	ifaceName: string,
	ifaceMember: Symbol,
	concreteScope: Scope,
	project: Scope,
	out: DiagnosticItem[],
): void {
	const ifaceAst = ifaceMember.ast as InterfaceMethod;
	const ifaceInputParams = collectInputParams(ifaceAst.varSections);

	// Collect concrete method's VAR_INPUT params from its scope symbols.
	const concreteParams = [...concreteScope.symbols.values()]
		.flat()
		.filter((s) => s.kind === "method_param" && s.varSection === "VAR_INPUT");

	if (ifaceInputParams.length !== concreteParams.length) {
		out.push({
			severity: "error",
			span: ifaceMember.span,
			source: "volt-lsp-st",
			code: "missing-interface-implementation",
			message:
				`Method '${ifaceMember.name}' in FB '${fbName}' has wrong signature: ` +
				`'${ifaceName}.${ifaceMember.name}' declares ${ifaceInputParams.length} ` +
				`VAR_INPUT param(s), but the implementation has ${concreteParams.length}.`,
		});
		return;
	}

	// Compare types for each param position (by declaration order).
	// Skip comparison when either side has an unresolvable type.
	const concreteOrdered = concreteParams.slice().sort((a, b) =>
		a.span.start - b.span.start,
	);
	for (let i = 0; i < ifaceInputParams.length; i++) {
		const ifaceParam = ifaceInputParams[i]!;
		const concreteParam = concreteOrdered[i];
		if (concreteParam?.typeExpr === undefined) continue;

		const ifaceKind = resolveTypeExpr(ifaceParam, project).kind;
		const concreteKind = resolveTypeExpr(concreteParam.typeExpr, project).kind;
		// If either side is unknown, skip — library types can't be compared.
		if (ifaceKind === "unknown" || concreteKind === "unknown") continue;
		if (ifaceKind !== concreteKind) {
			out.push({
				severity: "error",
				span: ifaceMember.span,
				source: "volt-lsp-st",
				code: "missing-interface-implementation",
				message:
					`Method '${ifaceMember.name}' in FB '${fbName}': ` +
					`parameter ${i + 1} type is incompatible with '${ifaceName}.${ifaceMember.name}'.`,
			});
		}
	}
}

/** Compare the declared data type of a property to the interface declaration. */
function checkPropertySignature(
	fbName: string,
	ifaceName: string,
	ifaceMember: Symbol,
	concretePropSym: Symbol | undefined,
	project: Scope,
	out: DiagnosticItem[],
): void {
	if (concretePropSym?.typeExpr === undefined) return;
	const ifaceAst = ifaceMember.ast as InterfaceProperty;
	const ifaceKind = resolveTypeExpr(ifaceAst.dataType, project).kind;
	const concreteKind = resolveTypeExpr(concretePropSym.typeExpr, project).kind;
	if (ifaceKind === "unknown" || concreteKind === "unknown") return;
	if (ifaceKind !== concreteKind) {
		out.push({
			severity: "error",
			span: ifaceMember.span,
			source: "volt-lsp-st",
			code: "missing-interface-implementation",
			message:
				`Property '${ifaceMember.name}' in FB '${fbName}' has a different type ` +
				`than declared in interface '${ifaceName}'.`,
		});
	}
}

/** Collect all TypeExpr entries from VAR_INPUT sections in a method signature. */
function collectInputParams(varSections: readonly VarSection[]): import("../../parser/ast.js").TypeExpr[] {
	const result: import("../../parser/ast.js").TypeExpr[] = [];
	for (const sec of varSections) {
		if (sec.sectionKind !== "VAR_INPUT") continue;
		for (const decl of sec.decls) {
			for (const _name of decl.names) {
				result.push(decl.type);
			}
		}
	}
	return result;
}
