/**
 * `textDocument/hover` — show a markdown tooltip at the cursor.
 *
 * Content shape:
 *
 *   ```iec61131
 *   <declaration line>
 *   ```
 *   _<symbol kind>_
 *
 * Where the declaration line is reconstructed from the AST — for a
 * var declaration that's `name : Type [:= init]`, for a method that's
 * the method signature with stacked modifiers.
 */
import type { Token } from "../../lexer/tokens.js";
import { lookup } from "../../semantic/resolver.js";
import type { Scope, Symbol } from "../../semantic/symbol-table.js";
import {
	lookup as lookupReference,
	renderHover as renderReferenceHover,
	type Vendor,
} from "../../reference/index.js";
import { offsetFromPosition, rangeFromSpan } from "../position.js";
import type { Position, Range } from "../types.js";
import type { Document } from "../workspace.js";
import { findIdentifierAtOffset } from "./find-identifier.js";
import { scopeAtOffset } from "./scope-at.js";

export interface HoverArgs {
	doc: Document;
	position: Position;
	project: Scope;
	/** Whether to append the source URL to corpus-derived hover. Default true. */
	showSource?: boolean;
	/** Active vendor — drives vendor badges + wrong-vendor warning in hover. */
	activeVendor?: Vendor;
}

export interface HoverResult {
	contents: { kind: "markdown"; value: string };
	range?: Range;
}

export function hover(args: HoverArgs): HoverResult | null {
	const offset = offsetFromPosition(args.doc.source, args.position);
	if (offset < 0) return null;
	const idToken = findIdentifierAtOffset(args.doc.parseResult, offset);
	if (idToken === undefined) return null;

	// First, try the user's project scope — a name that resolves to a
	// user-defined symbol takes priority. The CODESYS corpus is for the
	// "what is `INT` / `FB_Init` / `{attribute 'no_init'}`" cases the
	// user did NOT declare.
	const start = scopeAtOffset(args.project, args.doc, offset);
	const r = lookup(start, idToken.text);
	if (r !== undefined) {
		const userHover = renderHover(r.symbol);
		// Augment user-symbol hover with corpus info IF the symbol's type
		// refers to a known reference entry. e.g. hovering `tCycle :
		// TIME` shows both the user var AND the TIME type docs.
		const typeRef = r.symbol.typeExpr !== undefined ? lookupTypeReference(r.symbol, args.activeVendor) : undefined;
		const combined =
			typeRef !== undefined
				? `${userHover}\n\n---\n\n${renderReferenceHover(typeRef, { showSource: args.showSource, activeVendor: args.activeVendor })}`
				: userHover;
		return {
			contents: { kind: "markdown", value: combined },
			range: rangeFromSpan(idToken.span),
		};
	}

	// Fall back to the corpus: keyword / type name / operator / pragma /
	// lifecycle method. This is the high-value AI case — hovering `INT`
	// or `FB_Init` returns the canonical CODESYS docs.
	const refEntry = lookupReference(idToken.text, args.activeVendor);
	if (refEntry !== undefined) {
		return {
			contents: {
				kind: "markdown",
				value: renderReferenceHover(refEntry, {
					showSource: args.showSource,
					activeVendor: args.activeVendor,
				}),
			},
			range: rangeFromSpan(idToken.span),
		};
	}

	return null;
}

/**
 * If the symbol's declared type is a known elementary type (e.g.
 * `count : INT`), return the reference entry for that type so hover
 * can append its docs. Vendor-aware: prefers entries matching the
 * active vendor.
 */
function lookupTypeReference(
	sym: Symbol,
	activeVendor?: Vendor,
): ReturnType<typeof lookupReference> {
	if (sym.typeExpr === undefined) return undefined;
	if (sym.typeExpr.kind !== "named_type") return undefined;
	return lookupReference(sym.typeExpr.name.text, activeVendor);
}

function renderHover(sym: Symbol): string {
	const lines: string[] = [];
	lines.push("```iec61131");
	lines.push(renderDeclaration(sym));
	lines.push("```");
	lines.push("");
	lines.push(`_${humanKind(sym)}_`);
	if (sym.varSection !== undefined) {
		lines.push(`_section_: \`${sym.varSection}\``);
	}
	return lines.join("\n");
}

function renderDeclaration(sym: Symbol): string {
	const t = sym.typeExpr === undefined ? "" : ` : ${typeText(sym.typeExpr)}`;
	switch (sym.kind) {
		case "function_block":
			return `FUNCTION_BLOCK ${sym.name}`;
		case "program":
			return `PROGRAM ${sym.name}`;
		case "function":
			return `FUNCTION ${sym.name}${t}`;
		case "method":
		case "interface_method":
			return `METHOD ${sym.name}${t}`;
		case "action":
			return `ACTION ${sym.name}`;
		case "property":
		case "interface_property":
			return `PROPERTY ${sym.name}${t}`;
		case "interface":
			return `INTERFACE ${sym.name}`;
		case "namespace":
			return `NAMESPACE ${sym.name}`;
		case "gvl_block":
			return `VAR_GLOBAL ${sym.name}`;
		case "type":
			return `TYPE ${sym.name}`;
		case "enum_value":
			return sym.name;
		case "struct_field":
			return `${sym.name}${t}`;
		case "var":
		case "method_param":
		case "gvl_var":
			return `${sym.name}${t}`;
	}
}

function humanKind(sym: Symbol): string {
	switch (sym.kind) {
		case "function_block":
			return "function block";
		case "interface_method":
			return "interface method";
		case "interface_property":
			return "interface property";
		case "method_param":
			return "method parameter";
		case "struct_field":
			return "struct field";
		case "enum_value":
			return "enum value";
		case "gvl_var":
			return "global variable";
		default:
			return sym.kind.replace(/_/g, " ");
	}
}

import type { TypeExpr } from "../../parser/ast.js";

function typeText(t: TypeExpr): string {
	switch (t.kind) {
		case "named_type": {
			const q = t.qualifiers?.map((x) => x.text).join(".") ?? "";
			return q.length > 0 ? `${q}.${t.name.text}` : t.name.text;
		}
		case "array_type":
			return `ARRAY[${t.dims.map(dimText).join(", ")}] OF ${typeText(t.element)}`;
		case "reference_type":
			return `REFERENCE TO ${typeText(t.target)}`;
		case "pointer_type":
			return `POINTER TO ${typeText(t.target)}`;
		case "string_type":
			return t.wide ? "WSTRING" : "STRING";
		case "implicit_enum_type":
			return `(${t.values.map((v) => v.name.text).join(", ")})`;
	}
}

function dimText(dim: { lower: { tokens: readonly Token[] }; upper: { tokens: readonly Token[] } }): string {
	const l = dim.lower.tokens.map((t) => t.text).join("").trim();
	const u = dim.upper.tokens.map((t) => t.text).join("").trim();
	return `${l}..${u}`;
}
