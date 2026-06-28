/**
 * Resolve a VG call site's parameters — shared by VG signature-help and
 * VG pin-name completion.
 *
 * A VG call is either a function call `FN(a, b)` (the callee is the
 * function/FB-type itself) or an FB-instance call `inst(PIN := v)` (the
 * callee is a *variable* whose type is the FB). For the instance case we
 * resolve the variable's type to the FB and read its input pins — that's
 * the bit the generic ST signature-help can't do.
 */
import type { Scope } from "../../../semantic/symbol-table.js";
import { lookup as resolverLookup } from "../../../semantic/resolver.js";

export interface CallParam {
	name: string;
	type: string;
}

export interface ResolvedCall {
	name: string;
	params: CallParam[];
}

interface AstWithVarSections {
	varSections?: ReadonlyArray<{
		sectionKind: string;
		decls: ReadonlyArray<{ names: ReadonlyArray<{ text: string }>; type: unknown }>;
	}>;
}

/** Resolve `calleeName` (a function/FB type, or an FB instance variable) to
 *  its input parameters, or undefined when it is not callable. */
export function resolveCallParams(project: Scope, scope: Scope, calleeName: string): ResolvedCall | undefined {
	const r = resolverLookup(scope, calleeName);
	if (r === undefined) return undefined;

	// Direct callable: a function / method / FB type declared with VAR_INPUT.
	const directAst = r.symbol.ast as AstWithVarSections | undefined;
	if (directAst !== undefined && Array.isArray(directAst.varSections)) {
		return { name: r.symbol.name, params: inputParams(directAst) };
	}

	// FB-instance call: resolve the variable's named type to its FB.
	const typeExpr = r.symbol.typeExpr;
	if (typeExpr !== undefined && typeExpr.kind === "named_type") {
		const typeSym = findCallableType(project, typeExpr.name.text);
		if (typeSym !== undefined) {
			return { name: `${r.symbol.name} : ${typeExpr.name.text}`, params: inputParams(typeSym) };
		}
	}
	return undefined;
}

/**
 * The callee name of the innermost call enclosing `offset`, or undefined.
 * Walks back to the nearest unmatched `(` and reads the identifier before
 * it (same scan as signature-help).
 */
export function enclosingCallee(source: string, offset: number): string | undefined {
	let depth = 0;
	let i = offset - 1;
	while (i >= 0) {
		const ch = source[i] as string;
		if (ch === ")") depth++;
		else if (ch === "(") {
			if (depth === 0) break;
			depth--;
		}
		i--;
	}
	if (i < 0) return undefined;
	let j = i - 1;
	while (j >= 0 && /\s/.test(source[j] as string)) j--;
	const end = j + 1;
	while (j >= 0 && /[A-Za-z0-9_]/.test(source[j] as string)) j--;
	const name = source.slice(j + 1, end);
	return name.length > 0 ? name : undefined;
}

function findCallableType(project: Scope, typeName: string): AstWithVarSections | undefined {
	const target = typeName.toLowerCase();
	const stack: Scope[] = [project];
	while (stack.length > 0) {
		const sc = stack.pop()!;
		for (const [, syms] of sc.symbols) {
			for (const sym of syms) {
				if (sym.name.toLowerCase() === target) {
					const ast = sym.ast as AstWithVarSections | undefined;
					if (ast !== undefined && Array.isArray(ast.varSections)) return ast;
				}
			}
		}
		stack.push(...sc.children);
	}
	return undefined;
}

/** Input pins: VAR_INPUT and VAR_IN_OUT (both appear in an FB-call pin list). */
function inputParams(ast: AstWithVarSections): CallParam[] {
	const out: CallParam[] = [];
	for (const section of ast.varSections ?? []) {
		if (section.sectionKind !== "VAR_INPUT" && section.sectionKind !== "VAR_IN_OUT") continue;
		for (const decl of section.decls) {
			const typeText = renderTypeExprText(decl.type);
			for (const id of decl.names) out.push({ name: id.text, type: typeText });
		}
	}
	return out;
}

function renderTypeExprText(t: unknown): string {
	if (t === null || typeof t !== "object") return "?";
	const obj = t as { kind?: string; name?: { text: string }; target?: unknown; element?: unknown; wide?: boolean };
	switch (obj.kind) {
		case "named_type":
			return obj.name?.text ?? "?";
		case "array_type":
			return `ARRAY OF ${renderTypeExprText(obj.element)}`;
		case "pointer_type":
			return `POINTER TO ${renderTypeExprText(obj.target)}`;
		case "reference_type":
			return `REFERENCE TO ${renderTypeExprText(obj.target)}`;
		case "string_type":
			return obj.wide ? "WSTRING" : "STRING";
		default:
			return "?";
	}
}
