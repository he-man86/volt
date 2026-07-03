/**
 * CODESYS name-resolution / shadowing rules.
 * Source: `docs/codesys-reference/09-shadowing.md`.
 *
 * This module captures the 14-step compiler search order as data so
 * the `shadowing-declaration` diagnostic can flag when a declaration
 * shadows an outer-scope name, and hover can describe a shadowed
 * binding's resolution order.
 *
 * Encoded as a list of search steps rather than reference entries —
 * not really a "thing you hover on", more a predicate-source.
 */

export interface ShadowingStep {
	order: number;
	description: string;
}

/**
 * Compiler search order for an unqualified identifier in an application.
 * Lower `order` wins. Steps 7, 10, 11, 14 require library symbol-table
 * data we don't currently index — flagged as `requiresLibraryIndex: true`
 * for completeness.
 */
export const APPLICATION_SEARCH_ORDER: ReadonlyArray<ShadowingStep & { requiresLibraryIndex: boolean }> = [
	{ order: 1, description: "Local variables", requiresLibraryIndex: false },
	{ order: 2, description: "Local variables of a method", requiresLibraryIndex: false },
	{ order: 3, description: "Local variables in FB/program/function and any base FBs", requiresLibraryIndex: false },
	{ order: 4, description: "Local methods of the POU", requiresLibraryIndex: false },
	{ order: 5, description: "Global variables in the application (without qualified_only)", requiresLibraryIndex: false },
	{ order: 6, description: "Global variables in a parent application (without qualified_only)", requiresLibraryIndex: false },
	{ order: 7, description: "Global variables in referenced libraries", requiresLibraryIndex: true },
	{ order: 8, description: "POU/type names from the application (GVL/FB/etc.)", requiresLibraryIndex: false },
	{ order: 9, description: "POU/type names from a parent application", requiresLibraryIndex: false },
	{ order: 10, description: "POU/type names from a library", requiresLibraryIndex: true },
	{ order: 11, description: "Namespaces of locally referred libraries (and their published libs)", requiresLibraryIndex: true },
	{ order: 12, description: "Global variables in the POUs view (without qualified_only)", requiresLibraryIndex: false },
	{ order: 13, description: "POU/type names from the POUs view", requiresLibraryIndex: false },
	{ order: 14, description: "Libraries from POUs", requiresLibraryIndex: true },
];

/**
 * Qualified-access escape hatches — the syntactic forms that bypass the
 * search order entirely.
 */
export const QUALIFIED_ACCESS_FORMS: ReadonlyArray<{ form: string; meaning: string }> = [
	{ form: ".identifier", meaning: "Force global namespace lookup (skips local)." },
	{ form: "gvl.var", meaning: "Variable in that specific GVL." },
	{ form: "lib.symbol", meaning: "Symbol in that referenced library." },
	{ form: "lib0.lib1.symbol", meaning: "Transitively referenced library symbol." },
	{ form: "THIS^.field", meaning: "FB's own field, even if a local of the same name exists in a method." },
	{ form: "__POOL.POU()", meaning: "POU in the POUs view (not Devices view)." },
	{ form: "SUPER^.method()", meaning: "Inherited method, even if overridden locally." },
];

export const SHADOWING_SOURCE = {
	url: "https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_shadowing_rules.html",
	localFile: "docs/codesys-reference/09-shadowing.md",
	retrievedAt: "2026-05-26",
};
