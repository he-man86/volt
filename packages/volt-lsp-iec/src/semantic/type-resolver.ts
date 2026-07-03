/**
 * Named-type resolver — walks a TypeExpr through the project symbol table
 * to produce a concrete kind (enum, struct, function_block, alias, etc.).
 *
 * Design intent: conservative. When any step fails (name not in scope,
 * library type, generic bracket, multi-level alias chain), we return
 * "unknown" rather than throwing or false-positive diagnosing. Callers
 * treat "unknown" as "skip this check".
 *
 * Does NOT perform full expression type inference — only resolves
 * declared named types through the symbol table.
 */
import type { TypeExpr } from "../parser/ast.js";
import type { TypeDecl } from "../parser/ast.js";
import type { Scope } from "./symbol-table.js";
import { lookupLocal } from "./symbol-table.js";

export type ResolvedKind =
	| "elementary"      // INT, REAL, BOOL, STRING, TIME, etc. — IEC built-ins
	| "enum"            // TYPE X : (A, B, C) END_TYPE  or  implicit enum
	| "struct"          // TYPE X : STRUCT … END_STRUCT END_TYPE (or UNION)
	| "function_block"  // FUNCTION_BLOCK or PROGRAM symbol
	| "alias"           // TYPE X : Y END_TYPE — aliasTarget carries the target
	| "unknown";        // library type, generic, or anything unresolvable

export interface ResolvedType {
	kind: ResolvedKind;
	/** Only set when kind === "alias" — the target TypeExpr to recurse on. */
	aliasTarget?: TypeExpr;
	/**
	 * Set when kind is "enum", "struct", or "function_block" and the
	 * corresponding scope was found. Callers use this to look up member
	 * names (fields, methods, enum values).
	 */
	scope?: Scope;
}

/**
 * All IEC 61131-3 elementary type names (case-insensitive match at call sites).
 * Includes the generic ANY* supertypes, duration/date variants, and CODESYS
 * extensions like LDATE that TC also accepts.
 */
const ELEMENTARY_TYPES: ReadonlySet<string> = new Set([
	"BOOL",
	"BYTE", "WORD", "DWORD", "LWORD",
	"SINT", "USINT", "INT", "UINT", "DINT", "UDINT", "LINT", "ULINT",
	"REAL", "LREAL",
	"TIME", "LTIME",
	"DATE", "LDATE",
	"TIME_OF_DAY", "TOD", "LTOD",
	"DATE_AND_TIME", "DT", "LDT", "LDATE_AND_TIME",
	"STRING", "WSTRING",
	"ANY", "ANY_NUM", "ANY_BIT", "ANY_REAL", "ANY_INT",
	"ANY_DATE", "ANY_ELEMENTARY", "ANY_MAGNITUDE",
	"POINTER", // bare POINTER keyword used as a type in some contexts
]);

/**
 * Resolve a type name string to its concrete kind using the project scope.
 * Returns "elementary" for IEC built-ins. Returns "unknown" for anything
 * not found in scope (library types, generics, etc.) — callers skip checks
 * when "unknown" is returned.
 *
 * Complexity is O(1) amortized: the project scope's `symbols` map is
 * indexed by lowercased name, so lookup is a single Map.get.
 */
export function resolveNamedType(name: string, project: Scope): ResolvedType {
	if (ELEMENTARY_TYPES.has(name.toUpperCase())) return { kind: "elementary" };

	const symbols = lookupLocal(project, name);
	if (symbols.length === 0) return { kind: "unknown" };

	const sym = symbols[0]!;

	if (sym.kind === "function_block" || sym.kind === "program") {
		// Find the corresponding child scope (same name as the FB/program)
		const scope = project.children.find(
			(c) => c.name.toLowerCase() === name.toLowerCase(),
		);
		return { kind: "function_block", scope };
	}

	if (sym.kind === "type") {
		const ast = sym.ast as TypeDecl;
		const body = ast.body;
		if (body.kind === "enum") {
			const scope = project.children.find(
				(c) => c.name.toLowerCase() === name.toLowerCase(),
			);
			return { kind: "enum", scope };
		}
		if (body.kind === "struct" || body.kind === "union") {
			const scope = project.children.find(
				(c) => c.name.toLowerCase() === name.toLowerCase(),
			);
			return { kind: "struct", scope };
		}
		if (body.kind === "alias") {
			return { kind: "alias", aliasTarget: body.target };
		}
	}

	return { kind: "unknown" };
}

/**
 * Resolve a full TypeExpr, following aliases up to 10 levels deep.
 * - named_type: delegates to resolveNamedType
 * - string_type: always "elementary"
 * - implicit_enum_type: always "enum"
 * - array/pointer/reference: always "unknown" (composite; not a simple resolvable kind)
 */
export function resolveTypeExpr(
	typeExpr: TypeExpr,
	project: Scope,
	depth = 0,
): ResolvedType {
	if (depth > 10) return { kind: "unknown" }; // cycle guard
	switch (typeExpr.kind) {
		case "named_type": {
			const r = resolveNamedType(typeExpr.name.text, project);
			if (r.kind === "alias" && r.aliasTarget !== undefined) {
				return resolveTypeExpr(r.aliasTarget, project, depth + 1);
			}
			return r;
		}
		case "string_type":
			return { kind: "elementary" };
		case "implicit_enum_type":
			return { kind: "enum" };
		case "array_type":
		case "pointer_type":
		case "reference_type":
			return { kind: "unknown" };
		default:
			return { kind: "unknown" };
	}
}
