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
import { findIdentifierAtOffset } from "../identifier-at.js";
import { scopeAtOffset } from "../scope-at.js";
import { vgBodyAtOffset } from "./vg/shared.js";
import { vgHover } from "./vg/hover.js";
import { makeVgTypeEnv } from "./vg/type-env.js";

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

	// In a VG (graphical) body, try VG-specific hover first (operators,
	// keywords, modifiers, wires). Real variables fall through to the
	// normal symbol hover below.
	const vgEntry = vgBodyAtOffset(args.doc.bodyModels, offset);
	if (vgEntry !== undefined) {
		const env = makeVgTypeEnv(args.project, scopeAtOffset(args.project, args.doc, offset));
		const h = vgHover(vgEntry.vg, vgEntry.tokens, offset, env);
		if (h !== null) return h;
	}

	const idToken = findIdentifierAtOffset(args.doc.parseResult, offset, args.doc.bodyModels);

	// If the cursor is not on an identifier, check for three special comment shapes:
	//
	// 1. `(* @volt-graphical: LANG *)` — Volt's generated-body marker.
	// 2. `(* folder: Control/Option1 *)` — IDE organizational folder annotation.
	// 3. `{attribute 'name'}` (pragma) — reference catalog lookup.
	if (idToken === undefined) {
		const comment = commentAtOffset(args.doc.source, offset);
		if (comment !== undefined) {
			const graphical = parseGraphicalMarker(comment);
			if (graphical !== undefined) {
				return {
					contents: { kind: "markdown", value: renderGraphicalMarkerHover(graphical.language) },
				};
			}
			const folder = parseFolderAnnotation(comment);
			if (folder !== undefined) {
				return {
					contents: { kind: "markdown", value: renderFolderAnnotationHover(folder.path) },
				};
			}
		}
		const pragma = pragmaAtOffset(args.doc.source, offset);
		if (pragma !== undefined) {
			const refEntry = lookupReference(pragma.name, args.activeVendor);
			if (refEntry !== undefined) {
				return {
					contents: {
						kind: "markdown",
						value: renderReferenceHover(refEntry, {
							showSource: args.showSource,
							activeVendor: args.activeVendor,
						}),
					},
				};
			}
		}
		return null;
	}

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

const LANGUAGE_NAMES: Record<string, string> = {
	FBD: "Function Block Diagram (FBD)",
	LD: "Ladder Diagram (LD)",
	SFC: "Sequential Function Chart (SFC)",
	CFC: "Continuous Function Chart (CFC)",
};

/**
 * Extract the raw text of a `(* ... *)` comment that contains the byte
 * offset. Walks left to `(*` and right to `*)` without crossing newlines.
 * Returns undefined when the cursor is not inside any such comment.
 */
function commentAtOffset(source: string, offset: number): string | undefined {
	// Walk left to `(*`, stopping at newlines.
	let start = offset;
	while (start > 0 && source[start] !== "\n") {
		if (source[start] === "(" && source[start + 1] === "*") break;
		start--;
	}
	if (!(source[start] === "(" && source[start + 1] === "*")) return undefined;

	// Walk right to `*)`, stopping at newlines.
	let end = start + 2;
	while (end < source.length - 1 && source[end] !== "\n") {
		if (source[end] === "*" && source[end + 1] === ")") break;
		end++;
	}
	if (!(source[end] === "*" && source[end + 1] === ")")) return undefined;

	return source.slice(start, end + 2); // "(* ... *)"
}

/** Parse `(* @volt-graphical: LANG *)` — returns language token or undefined. */
function parseGraphicalMarker(comment: string): { language: string } | undefined {
	const m = /^\(\* @volt-graphical: (\w+) \*\)$/.exec(comment.trim());
	return m?.[1] !== undefined ? { language: m[1] } : undefined;
}

/** Parse `(* folder: path/to/folder *)` — returns folder path or undefined. */
function parseFolderAnnotation(comment: string): { path: string } | undefined {
	const m = /^\(\*\s*folder\s*:\s*([^*]+?)\s*\*\)$/i.exec(comment.trim());
	return m?.[1] !== undefined ? { path: m[1].trim() } : undefined;
}

function renderGraphicalMarkerHover(language: string): string {
	const langName = LANGUAGE_NAMES[language] ?? language;
	return [
		`\`\`\`iec61131`,
		`(* @volt-graphical: ${language} *)`,
		`\`\`\``,
		``,
		`_Volt graphical body (${langName})_`,
		``,
		`This section was generated by Volt from a **${langName}** body authored in your IDE. ` +
			`Edits here are stripped on push — to modify this unit, open it in CODESYS / TwinCAT.`,
	].join("\n");
}

function renderFolderAnnotationHover(folderPath: string): string {
	const segments = folderPath.split("/");
	const leaf = segments[segments.length - 1] ?? folderPath;
	const isNested = segments.length > 1;
	return [
		`\`\`\`iec61131`,
		`(* folder: ${folderPath} *)`,
		`\`\`\``,
		``,
		`_IDE organizational folder_`,
		``,
		isNested
			? `This child element is placed under **${folderPath}** in the project tree ` +
				`(nested ${segments.length} levels: ${segments.map((s) => `\`${s}\``).join(" → ")}).`
			: `This child element is placed under the folder **${leaf}** in the IDE project tree.`,
		``,
		`The folder is structural only — it has no effect on compiled code. ` +
			`Volt preserves this path so the project tree layout is maintained on push.`,
	].join("\n");
}

/**
 * If the byte offset falls inside a `{...}` pragma block in the source,
 * return the pragma name that should be used for reference lookup.
 *
 * Handles two pragma shapes:
 *   `{attribute 'name'}` → returns "name"
 *   `{IF ...}` / `{ELSE}` / `{define ...}` → returns the first word
 *
 * Returns undefined when the cursor is not inside any pragma.
 */
function pragmaAtOffset(source: string, offset: number): { name: string } | undefined {
	// Walk left to find the opening brace, stopping at newlines.
	let start = offset;
	while (start > 0 && source[start] !== "{" && source[start] !== "\n") start--;
	if (source[start] !== "{") return undefined;

	// Walk right to find the closing brace, stopping at newlines.
	let end = offset;
	while (end < source.length && source[end] !== "}" && source[end] !== "\n") end++;
	if (source[end] !== "}") return undefined;

	const inner = source.slice(start + 1, end).trim();

	// `{attribute 'name'}` → extract the quoted name.
	const attrMatch = /^attribute\s+'([^']+)'/i.exec(inner);
	if (attrMatch?.[1] !== undefined) return { name: attrMatch[1] };

	// `{IF ...}`, `{ELSE}`, `{define name}`, etc. → first word.
	const wordMatch = /^(\w+)/i.exec(inner);
	if (wordMatch?.[1] !== undefined) return { name: wordMatch[1] };

	return undefined;
}
