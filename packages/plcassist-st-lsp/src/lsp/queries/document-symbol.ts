/**
 * `textDocument/documentSymbol` — build a hierarchical outline of
 * a single document.
 *
 * Top-level POU/DUT/GVL → DocumentSymbol with children (methods,
 * properties, actions, var sections' decls, struct fields, enum
 * values). The LSP client renders this as the outline pane.
 */
import { rangeFromSpan } from "../position.js";
import { lspSymbolKindFor } from "../capabilities.js";
import {
	LspSymbolKind,
	type DocumentSymbol,
	type LspSymbolKindValue,
} from "../types.js";
import type {
	EnumBody,
	FunctionBlock,
	Function as FunctionAST,
	GlobalVarList,
	Interface,
	Method,
	ParseResult,
	Program,
	Property,
	StructBody,
	TopLevel,
	TypeDecl,
	UnionBody,
	VarDecl,
	VarSection,
} from "../../parser/ast.js";

export function buildDocumentSymbols(parseResult: ParseResult): DocumentSymbol[] {
	return parseResult.units.map(buildForUnit);
}

function buildForUnit(unit: TopLevel): DocumentSymbol {
	switch (unit.kind) {
		case "function_block":
			return fbToSymbol(unit);
		case "program":
			return programToSymbol(unit);
		case "function":
			return functionToSymbol(unit);
		case "method":
			return methodToSymbol(unit);
		case "action":
			return {
				name: unit.name.text,
				kind: lspSymbolKindFor("action"),
				range: rangeFromSpan(unit.span),
				selectionRange: rangeFromSpan(unit.name.span),
			};
		case "property":
			return propertyToSymbol(unit);
		case "interface":
			return interfaceToSymbol(unit);
		case "type_decl":
			return typeDeclToSymbol(unit);
		case "global_var_list":
			return gvlToSymbol(unit);
		case "namespace": {
			const children: DocumentSymbol[] = unit.units.map(buildForUnit);
			return {
				name: unit.name.text,
				detail: "NAMESPACE",
				kind: lspSymbolKindFor("program"), // closest LSP kind for a logical grouping
				range: rangeFromSpan(unit.span),
				selectionRange: rangeFromSpan(unit.name.span),
				children,
			};
		}
	}
}

function fbToSymbol(fb: FunctionBlock): DocumentSymbol {
	const children: DocumentSymbol[] = [];
	for (const section of fb.varSections) {
		children.push(...varSectionChildren(section));
	}
	return {
		name: fb.name.text,
		detail: detailForFb(fb),
		kind: lspSymbolKindFor("function_block"),
		range: rangeFromSpan(fb.span),
		selectionRange: rangeFromSpan(fb.name.span),
		children,
	};
}

function detailForFb(fb: FunctionBlock): string | undefined {
	const parts: string[] = [];
	if (fb.abstract) parts.push("ABSTRACT");
	if (fb.final) parts.push("FINAL");
	if (fb.extends !== undefined) parts.push(`EXTENDS ${fb.extends.text}`);
	if (fb.implements !== undefined && fb.implements.length > 0) {
		parts.push(`IMPLEMENTS ${fb.implements.map((i) => i.text).join(", ")}`);
	}
	return parts.length > 0 ? parts.join(" ") : undefined;
}

function programToSymbol(p: Program): DocumentSymbol {
	const children: DocumentSymbol[] = [];
	for (const section of p.varSections) children.push(...varSectionChildren(section));
	return {
		name: p.name.text,
		kind: lspSymbolKindFor("program"),
		range: rangeFromSpan(p.span),
		selectionRange: rangeFromSpan(p.name.span),
		children,
	};
}

function functionToSymbol(f: FunctionAST): DocumentSymbol {
	const children: DocumentSymbol[] = [];
	for (const section of f.varSections) children.push(...varSectionChildren(section));
	return {
		name: f.name.text,
		kind: lspSymbolKindFor("function"),
		range: rangeFromSpan(f.span),
		selectionRange: rangeFromSpan(f.name.span),
		children,
	};
}

function methodToSymbol(m: Method): DocumentSymbol {
	const children: DocumentSymbol[] = [];
	for (const section of m.varSections) children.push(...varSectionChildren(section));
	const parts: string[] = [];
	if (m.accessModifier !== undefined) parts.push(m.accessModifier);
	if (m.abstract) parts.push("ABSTRACT");
	if (m.final) parts.push("FINAL");
	if (m.override) parts.push("OVERRIDE");
	return {
		name: m.name.text,
		...(parts.length > 0 ? { detail: parts.join(" ") } : {}),
		kind: lspSymbolKindFor("method"),
		range: rangeFromSpan(m.span),
		selectionRange: rangeFromSpan(m.name.span),
		children,
	};
}

function propertyToSymbol(p: Property): DocumentSymbol {
	return {
		name: p.name.text,
		...(p.accessModifier !== undefined ? { detail: p.accessModifier } : {}),
		kind: lspSymbolKindFor("property"),
		range: rangeFromSpan(p.span),
		selectionRange: rangeFromSpan(p.name.span),
	};
}

function interfaceToSymbol(iface: Interface): DocumentSymbol {
	const children: DocumentSymbol[] = [];
	for (const m of iface.methods) {
		children.push({
			name: m.name.text,
			kind: lspSymbolKindFor("interface_method"),
			range: rangeFromSpan(m.span),
			selectionRange: rangeFromSpan(m.name.span),
		});
	}
	for (const p of iface.properties) {
		children.push({
			name: p.name.text,
			kind: lspSymbolKindFor("interface_property"),
			range: rangeFromSpan(p.span),
			selectionRange: rangeFromSpan(p.name.span),
		});
	}
	return {
		name: iface.name.text,
		...(iface.extends !== undefined && iface.extends.length > 0
			? { detail: `EXTENDS ${iface.extends.map((e) => e.text).join(", ")}` }
			: {}),
		kind: lspSymbolKindFor("interface"),
		range: rangeFromSpan(iface.span),
		selectionRange: rangeFromSpan(iface.name.span),
		children,
	};
}

function typeDeclToSymbol(t: TypeDecl): DocumentSymbol {
	const children: DocumentSymbol[] = [];
	switch (t.body.kind) {
		case "struct":
			children.push(...structFieldChildren(t.body));
			break;
		case "union":
			children.push(...unionFieldChildren(t.body));
			break;
		case "enum":
			children.push(...enumValueChildren(t.body));
			break;
		case "alias":
			// no children
			break;
	}
	return {
		name: t.name.text,
		detail: dutBodyDetail(t.body.kind),
		kind: kindForDut(t.body.kind),
		range: rangeFromSpan(t.span),
		selectionRange: rangeFromSpan(t.name.span),
		children,
	};
}

function gvlToSymbol(gvl: GlobalVarList): DocumentSymbol {
	const children: DocumentSymbol[] = [];
	for (const section of gvl.varSections) children.push(...varSectionChildren(section));
	return {
		name: "VAR_GLOBAL",
		kind: LspSymbolKind.Namespace,
		range: rangeFromSpan(gvl.span),
		selectionRange: rangeFromSpan(gvl.span),
		children,
	};
}

// ─── Var-section / decl children ─────────────────────────────────────

function varSectionChildren(section: VarSection): DocumentSymbol[] {
	return section.decls.flatMap((d) => varDeclChildren(d));
}

function varDeclChildren(decl: VarDecl): DocumentSymbol[] {
	return decl.names.map((name) => ({
		name: name.text,
		kind: lspSymbolKindFor("var"),
		range: rangeFromSpan(decl.span),
		selectionRange: rangeFromSpan(name.span),
	}));
}

function structFieldChildren(body: StructBody): DocumentSymbol[] {
	return body.fields.flatMap((decl) =>
		decl.names.map((name) => ({
			name: name.text,
			kind: lspSymbolKindFor("struct_field"),
			range: rangeFromSpan(decl.span),
			selectionRange: rangeFromSpan(name.span),
		})),
	);
}

function unionFieldChildren(body: UnionBody): DocumentSymbol[] {
	return body.fields.flatMap((decl) =>
		decl.names.map((name) => ({
			name: name.text,
			kind: lspSymbolKindFor("struct_field"),
			range: rangeFromSpan(decl.span),
			selectionRange: rangeFromSpan(name.span),
		})),
	);
}

function enumValueChildren(body: EnumBody): DocumentSymbol[] {
	return body.values.map((v) => ({
		name: v.name.text,
		kind: lspSymbolKindFor("enum_value"),
		range: rangeFromSpan(v.span),
		selectionRange: rangeFromSpan(v.name.span),
	}));
}

function kindForDut(kind: "struct" | "union" | "enum" | "alias"): LspSymbolKindValue {
	switch (kind) {
		case "struct":
			return LspSymbolKind.Struct;
		case "union":
			return LspSymbolKind.Struct;
		case "enum":
			return LspSymbolKind.Enum;
		case "alias":
			return LspSymbolKind.TypeParameter;
	}
}

function dutBodyDetail(kind: "struct" | "union" | "enum" | "alias"): string {
	return kind.toUpperCase();
}
