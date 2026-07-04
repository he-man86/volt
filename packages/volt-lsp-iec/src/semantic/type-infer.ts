/**
 * Shared semantic-query service over the ST tree + symbol table.
 *
 * The one place that answers "given a name / an expression, what symbol
 * or type does it denote?" so `checks/**` and `lsp/queries/**` stop
 * hand-rolling their own scope walks. Extends `type-resolver.ts` (which
 * stays the named-type → kind lookup); this module adds the project-wide
 * symbol finders and (later) expression type inference + member-chain
 * resolution built on them.
 *
 * See `openspec/changes/st-type-inference/design.md` (D6).
 */
import type { Scope, Symbol } from "./symbol-table.js";

/**
 * Depth-first search of the project scope tree for the first symbol whose
 * name matches (case-insensitive) and passes `ok`. This is the shared core
 * that the per-query `find{Symbol,Callable,CallableType,TypeAst}` walks
 * collapsed into.
 */
export function findSymbolByName(
	project: Scope,
	name: string,
	ok?: (sym: Symbol) => boolean,
): Symbol | undefined {
	const target = name.toLowerCase();
	const stack: Scope[] = [project];
	while (stack.length > 0) {
		const sc = stack.pop() as Scope;
		for (const [, syms] of sc.symbols) {
			for (const sym of syms) {
				if (sym.name.toLowerCase() === target && (ok === undefined || ok(sym))) return sym;
			}
		}
		stack.push(...sc.children);
	}
	return undefined;
}

/** A symbol whose AST carries `varSections` (FB / PROGRAM / FUNCTION / METHOD) — i.e. has members. */
export function hasVarSections(sym: Symbol): boolean {
	return Array.isArray((sym.ast as { varSections?: ReadonlyArray<unknown> }).varSections);
}

/** The first symbol with members (`varSections`) matching `name`, project-wide. */
export function findMemberBearing(project: Scope, name: string): Symbol | undefined {
	return findSymbolByName(project, name, hasVarSections);
}

/**
 * Render a loosely-typed `TypeExpr`-shaped value to display text (`ARRAY OF X`,
 * `POINTER TO X`, `STRING`). Takes `unknown` because call sites read it off a
 * symbol's AST without a precise type. The shared renderer for the two
 * previously-identical copies (signature-help, vg/calls).
 *
 * NOTE: `hover.ts typeText` (typed, renders real `ARRAY[dims]` + enum values)
 * and `vg/type-env.ts renderType` (uppercases, returns undefined for unknowns)
 * have DIFFERENT contracts and deliberately stay separate — unifying them here
 * would change their output.
 */
export function renderTypeExpr(t: unknown): string {
	if (t === null || typeof t !== "object") return "?";
	const obj = t as { kind?: string; name?: { text: string }; target?: unknown; element?: unknown; wide?: boolean };
	switch (obj.kind) {
		case "named_type":
			return obj.name?.text ?? "?";
		case "array_type":
			return `ARRAY OF ${renderTypeExpr(obj.element)}`;
		case "pointer_type":
			return `POINTER TO ${renderTypeExpr(obj.target)}`;
		case "reference_type":
			return `REFERENCE TO ${renderTypeExpr(obj.target)}`;
		case "string_type":
			return obj.wide ? "WSTRING" : "STRING";
		case "implicit_enum_type":
			return "(implicit enum)";
		default:
			return "?";
	}
}
