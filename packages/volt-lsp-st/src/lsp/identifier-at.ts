/**
 * Find the identifier token at a given byte offset within a parsed
 * document. Walks the AST as well as body tokens — clicking on a
 * declaration name (FB name, var name, type ref in a VAR decl) is a
 * first-class navigation point, not just clicking inside code bodies.
 *
 * Body references go through `BodyModel.identifiers` (pre-populated by
 * `buildBodyModelsForParseResult`), consulted AFTER the declaration
 * walk so cursors on declared names take priority over body references
 * at the same offset.
 */
import type { Token } from "../lexer/tokens.js";
import type {
	BodySpan,
	Identifier,
	ParseResult,
	TopLevel,
	TypeExpr,
	VarDecl,
	VarSection,
} from "../parser/ast.js";
import type { BodyModel } from "../semantic/body.js";

export function findIdentifierAtOffset(
	parseResult: ParseResult,
	offset: number,
	bodyModels?: Map<BodySpan, BodyModel>,
): Token | undefined {
	for (const unit of parseResult.units) {
		const found = findInUnit(unit, offset);
		if (found !== undefined) return found;
	}
	// Body model fallback: `BodyModel.identifiers` carries every name
	// occurrence inside POU bodies with proper document offsets, so
	// cursors landing inside bodies (rather than on declarations)
	// resolve through this index.
	if (bodyModels !== undefined) {
		const ref = findInBodyModels(bodyModels, offset);
		if (ref !== undefined) return ref;
	}
	return undefined;
}

function findInBodyModels(
	bodyModels: Map<BodySpan, BodyModel>,
	offset: number,
): Token | undefined {
	for (const model of bodyModels.values()) {
		// Cheap window filter — skip whole bodies whose region doesn't
		// contain the offset. Caller's offset is in source coordinates.
		if (offset < model.span.start || offset > model.span.end) continue;
		for (const ref of model.identifiers) {
			if (offset >= ref.span.start && offset < ref.span.end) {
				return { kind: "identifier", text: ref.name, span: ref.span };
			}
		}
	}
	return undefined;
}

function findInUnit(unit: TopLevel, offset: number): Token | undefined {
	if (offset < unit.span.start || offset >= unit.span.end) return undefined;

	switch (unit.kind) {
		case "function_block": {
			const inHeader = idMatch(unit.name, offset);
			if (inHeader !== undefined) return inHeader;
			if (unit.extends !== undefined) {
				const ext = idMatch(unit.extends, offset);
				if (ext !== undefined) return ext;
			}
			if (unit.implements !== undefined) {
				for (const i of unit.implements) {
					const m = idMatch(i, offset);
					if (m !== undefined) return m;
				}
			}
			const inVar = findInVarSections(unit.varSections, offset);
			if (inVar !== undefined) return inVar;
			return findInBody(unit.body, offset);
		}
		case "program":
		case "function":
		case "method":
		case "action": {
			if ("name" in unit) {
				const inName = idMatch(unit.name, offset);
				if (inName !== undefined) return inName;
			}
			if ("returnType" in unit && unit.returnType !== undefined) {
				const inRet = findInTypeExpr(unit.returnType, offset);
				if (inRet !== undefined) return inRet;
			}
			if ("varSections" in unit) {
				const inVar = findInVarSections(unit.varSections, offset);
				if (inVar !== undefined) return inVar;
			}
			return findInBody(unit.body, offset);
		}
		case "property": {
			const inName = idMatch(unit.name, offset);
			if (inName !== undefined) return inName;
			return findInTypeExpr(unit.dataType, offset);
		}
		case "interface": {
			const inName = idMatch(unit.name, offset);
			if (inName !== undefined) return inName;
			if (unit.extends !== undefined) {
				for (const e of unit.extends) {
					const m = idMatch(e, offset);
					if (m !== undefined) return m;
				}
			}
			for (const m of unit.methods) {
				if (offset >= m.span.start && offset < m.span.end) {
					const nm = idMatch(m.name, offset);
					if (nm !== undefined) return nm;
					if (m.returnType !== undefined) {
						const t = findInTypeExpr(m.returnType, offset);
						if (t !== undefined) return t;
					}
					const v = findInVarSections(m.varSections, offset);
					if (v !== undefined) return v;
				}
			}
			for (const p of unit.properties) {
				if (offset >= p.span.start && offset < p.span.end) {
					const pn = idMatch(p.name, offset);
					if (pn !== undefined) return pn;
					const pt = findInTypeExpr(p.dataType, offset);
					if (pt !== undefined) return pt;
				}
			}
			return undefined;
		}
		case "type_decl": {
			const inName = idMatch(unit.name, offset);
			if (inName !== undefined) return inName;
			switch (unit.body.kind) {
				case "struct":
					for (const f of unit.body.fields) {
						const m = findInVarDecl(f, offset);
						if (m !== undefined) return m;
					}
					if (unit.body.extends !== undefined) {
						const e = idMatch(unit.body.extends, offset);
						if (e !== undefined) return e;
					}
					break;
				case "union":
					for (const f of unit.body.fields) {
						const m = findInVarDecl(f, offset);
						if (m !== undefined) return m;
					}
					break;
				case "enum":
					for (const v of unit.body.values) {
						const m = idMatch(v.name, offset);
						if (m !== undefined) return m;
					}
					if (unit.body.baseType !== undefined) {
						const m = findInTypeExpr(unit.body.baseType, offset);
						if (m !== undefined) return m;
					}
					break;
				case "alias":
					return findInTypeExpr(unit.body.target, offset);
			}
			return undefined;
		}
		case "global_var_list":
			return findInVarSections(unit.varSections, offset);
		case "namespace": {
			// Namespace name itself
			const inName = idMatch(unit.name, offset);
			if (inName !== undefined) return inName;
			// Recurse into inner units
			for (const inner of unit.units) {
				const m = findInUnit(inner, offset);
				if (m !== undefined) return m;
			}
			return undefined;
		}
	}
}

function findInVarSections(
	sections: readonly VarSection[],
	offset: number,
): Token | undefined {
	for (const s of sections) {
		if (offset < s.span.start || offset >= s.span.end) continue;
		for (const d of s.decls) {
			const m = findInVarDecl(d, offset);
			if (m !== undefined) return m;
		}
	}
	return undefined;
}

function findInVarDecl(decl: VarDecl, offset: number): Token | undefined {
	if (offset < decl.span.start || offset >= decl.span.end) return undefined;
	for (const n of decl.names) {
		const m = idMatch(n, offset);
		if (m !== undefined) return m;
	}
	return findInTypeExpr(decl.type, offset);
}

function findInTypeExpr(type: TypeExpr, offset: number): Token | undefined {
	if (offset < type.span.start || offset >= type.span.end) return undefined;
	switch (type.kind) {
		case "named_type": {
			const m = idMatch(type.name, offset);
			if (m !== undefined) return m;
			if (type.qualifiers !== undefined) {
				for (const q of type.qualifiers) {
					const qm = idMatch(q, offset);
					if (qm !== undefined) return qm;
				}
			}
			return undefined;
		}
		case "array_type":
			return findInTypeExpr(type.element, offset);
		case "reference_type":
		case "pointer_type":
			return findInTypeExpr(type.target, offset);
		case "string_type":
			return undefined;
		case "implicit_enum_type": {
			// Click could land on any of the enum value names.
			for (const v of type.values) {
				const m = idMatch(v.name, offset);
				if (m !== undefined) return m;
			}
			return undefined;
		}
	}
}

function findInBody(body: BodySpan, offset: number): Token | undefined {
	if (offset < body.span.start || offset > body.span.end) return undefined;
	for (const t of body.tokens) {
		if (t.kind !== "identifier") continue;
		if (offset >= t.span.start && offset < t.span.end) return t;
	}
	return undefined;
}

function idMatch(id: Identifier, offset: number): Token | undefined {
	if (offset >= id.span.start && offset < id.span.end) {
		return {
			kind: "identifier",
			text: id.text,
			span: id.span,
		};
	}
	return undefined;
}
