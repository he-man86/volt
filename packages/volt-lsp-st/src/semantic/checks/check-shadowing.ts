/**
 * Shadowing — every symbol in every scope is checked against its
 * parent chain. A same-name hit in an outer scope produces an
 * "information"-severity diagnostic at the inner declaration.
 */
import type { Symbol, Scope } from "../symbol-table.js";
import type { DiagnosticItem } from "./_shared.js";

export function checkShadowing(project: Scope, out: DiagnosticItem[]): void {
	walkShadowing(project, out);
}

/**
 * IEC 61131-3 has two separate namespaces that NEVER conflict:
 *   Type namespace  — FUNCTION_BLOCK, FUNCTION, PROGRAM, TYPE decls, INTERFACE
 *   Instance namespace — VAR / VAR_INPUT / … variables, GVL vars, method params
 *
 * A local variable `FB_Motor : FB_Motor` does NOT shadow the type `FB_Motor`
 * because in any syntactic position the compiler knows which namespace applies:
 * type position (after `:`) → type namespace; expression position → instance namespace.
 * CODESYS and TwinCAT both accept this pattern without any warning.
 *
 * We therefore only report shadowing when both the inner and outer symbol live
 * in the SAME namespace.
 */
const TYPE_NS_KINDS = new Set([
	"function_block",
	"program",
	"function",
	"type",
	"interface",
	"gvl_block",
	"namespace",
] as const);

function isTypeNamespace(sym: Symbol): boolean {
	return TYPE_NS_KINDS.has(sym.kind as never);
}

function walkShadowing(scope: Scope, out: DiagnosticItem[]): void {
	for (const [, symbols] of scope.symbols) {
		for (const sym of symbols) {
			const symIsType = isTypeNamespace(sym);
			let parent = scope.parent;
			while (parent !== undefined) {
				const outerHits = parent.symbols.get(sym.name.toLowerCase());
				if (outerHits !== undefined) {
					const visibleHits = outerHits.filter((s) => {
						// qualified_only GVL vars are not in the bare-name search path.
						if (s.qualifiedOnly) return false;
						// Cross-namespace references are never shadowing: an instance
						// variable `Motor : FB_Motor` does not shadow the type `FB_Motor`.
						if (symIsType !== isTypeNamespace(s)) return false;
						return true;
					});
					if (visibleHits.length > 0) {
						out.push({
							severity: "information",
							span: sym.span,
							source: "volt-lsp-st",
							code: "shadowing-declaration",
							message: `'${sym.name}' shadows a same-name declaration in outer scope '${parent.name}'.`,
						});
						break;
					}
				}
				parent = parent.parent;
			}
		}
	}
	for (const child of scope.children) {
		walkShadowing(child, out);
	}
}
