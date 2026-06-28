/**
 * Build a `VgTypeEnv` from the LSP's scope/symbol table — the bridge
 * between VG §8 type inference and the resolved POU declarations.
 */
import type { Scope } from "../../../semantic/symbol-table.js";
import { lookup as resolverLookup } from "../../../semantic/resolver.js";
import type { VgTypeEnv } from "../../../vg/type-infer.js";

export function makeVgTypeEnv(project: Scope, scope: Scope): VgTypeEnv {
	return {
		varType(name) {
			return simpleType(resolverLookup(scope, name));
		},
		functionReturnType(name) {
			const r = resolverLookup(scope, name);
			if (r === undefined) return undefined;
			const ast = r.symbol.ast as { returnType?: unknown } | undefined;
			return renderType(ast?.returnType);
		},
		memberType(instance, pin) {
			const inst = resolverLookup(scope, instance);
			const typeExpr = inst?.symbol.typeExpr;
			if (typeExpr === undefined || typeExpr.kind !== "named_type") return undefined;
			return outputPinType(project, typeExpr.name.text, pin);
		},
	};
}

function simpleType(r: ReturnType<typeof resolverLookup>): string | undefined {
	if (r === undefined) return undefined;
	const t = r.symbol.typeExpr;
	if (t === undefined) return undefined;
	if (t.kind === "named_type") return t.name.text.toUpperCase();
	if (t.kind === "string_type") return t.wide ? "WSTRING" : "STRING";
	return undefined;
}

interface AstWithVarSections {
	varSections?: ReadonlyArray<{
		sectionKind: string;
		decls: ReadonlyArray<{ names: ReadonlyArray<{ text: string }>; type: unknown }>;
	}>;
}

/** The declared type of an output pin (VAR_OUTPUT / VAR_IN_OUT) on an FB type. */
function outputPinType(project: Scope, typeName: string, pin: string): string | undefined {
	const ast = findTypeAst(project, typeName);
	if (ast === undefined) return undefined;
	const want = pin.toLowerCase();
	for (const section of ast.varSections ?? []) {
		if (section.sectionKind !== "VAR_OUTPUT" && section.sectionKind !== "VAR_IN_OUT") continue;
		for (const decl of section.decls) {
			if (decl.names.some((n) => n.text.toLowerCase() === want)) return renderType(decl.type);
		}
	}
	return undefined;
}

function findTypeAst(project: Scope, typeName: string): AstWithVarSections | undefined {
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

function renderType(t: unknown): string | undefined {
	if (t === null || t === undefined || typeof t !== "object") return undefined;
	const obj = t as { kind?: string; name?: { text: string }; wide?: boolean };
	if (obj.kind === "named_type") return obj.name?.text.toUpperCase();
	if (obj.kind === "string_type") return obj.wide ? "WSTRING" : "STRING";
	return undefined;
}
