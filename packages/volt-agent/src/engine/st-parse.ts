/**
 * Workspace `.st` file → structured ParsedFile, via the LSP parser.
 *
 * Each workspace file represents one POU (FUNCTION_BLOCK / PROGRAM /
 * FUNCTION). Its children (METHOD / ACTION / PROPERTY) appear as
 * top-level sibling declarations AFTER the outer END_X — parent
 * association is implicit from the filename. The `@opencode-ai/volt-lsp-st`
 * parser already understands this format; this module just walks the
 * AST and slices decl/impl text out of the original source using the
 * AST node spans.
 *
 * Why source-slicing instead of token-walking: the LSP cursor skips
 * trivia (whitespace + comments), so `body.tokens` would be empty for
 * a body that contains only a comment. We want to preserve trivia
 * inside bodies (a hand-written `// TODO ...` should round-trip), so
 * we slice the raw source from the end of the declaration zone up to
 * (but excluding) the closer keyword.
 */
import { parseSource } from "@opencode-ai/volt-lsp-st";
import type {
	Action,
	FunctionBlock,
	Function as FunctionAST,
	Interface,
	InterfaceMethod,
	InterfaceProperty,
	Method,
	Program,
	Property,
	PropertyAccessor,
} from "@opencode-ai/volt-lsp-st";
import { FOLDER_COMMENT_RE, type ChildKind } from "./st-assemble.js";

export interface ParsedFile {
	pou: { declaration: string; implementation: string };
	children: Map<string, ParsedChild>;
}

export interface ParsedChild {
	kind: ChildKind;
	name: string;
	declaration: string;
	implementation: string;
	/**
	 * In-FB folder this child lives in (e.g. "Modes"). Extracted from
	 * a `(* folder: X *)` trailing comment on the signature line —
	 * standard ST comments, treated as load-bearing metadata.
	 */
	folder?: string;
	getter?: { declaration: string; implementation: string };
	setter?: { declaration: string; implementation: string };
}

/**
 * Parse a workspace file. `expectedName` is the POU name derived from
 * the filename — we cross-check it matches the FUNCTION_BLOCK /
 * PROGRAM / FUNCTION declaration inside the file. Throws on parse
 * errors or name mismatch.
 */
export function parseFile(src: string, expectedName: string): ParsedFile {
	const { units, errors } = parseSource(src);
	if (errors.length > 0) {
		throw new Error(`parseFile(${expectedName}): ${errors[0]!.message}`);
	}
	if (units.length === 0) {
		throw new Error(`parseFile(${expectedName}): file is empty`);
	}

	const outer = units[0]!;
	if (
		outer.kind !== "function_block" &&
		outer.kind !== "program" &&
		outer.kind !== "function" &&
		outer.kind !== "interface"
	) {
		throw new Error(
			`parseFile(${expectedName}): first declaration must be FUNCTION_BLOCK / PROGRAM / FUNCTION / INTERFACE, got ${outer.kind}`,
		);
	}
	if (outer.name.text !== expectedName) {
		throw new Error(
			`parseFile: expected POU "${expectedName}" but file declares "${outer.name.text}"`,
		);
	}

	// Interfaces have a different AST shape: nested methods/properties
	// arrays on the Interface node, no body, no varSections at the outer
	// level. The slicing helpers below assume POU shape (body + varSections),
	// so interface gets its own parser branch.
	if (outer.kind === "interface") {
		return parseInterfaceFile(src, outer);
	}

	const pouDecl = sliceDeclaration(src, outer);
	const pouImpl = sliceBody(src, findDeclEnd(outer), outerEnder(outer.kind));

	const children = new Map<string, ParsedChild>();
	for (let i = 1; i < units.length; i++) {
		const unit = units[i]!;
		if (unit.kind === "method") {
			const decl = sliceDeclaration(src, unit);
			children.set(unit.name.text, {
				kind: "method",
				name: unit.name.text,
				declaration: stripFolderAnnotation(decl),
				implementation: sliceBody(src, findDeclEnd(unit), "END_METHOD"),
				...maybeFolder(decl),
			});
		} else if (unit.kind === "action") {
			const decl = sliceDeclaration(src, unit);
			children.set(unit.name.text, {
				kind: "action",
				name: unit.name.text,
				declaration: stripFolderAnnotation(decl),
				implementation: sliceBody(src, findDeclEnd(unit), "END_ACTION"),
				...maybeFolder(decl),
			});
		} else if (unit.kind === "property") {
			children.set(unit.name.text, parsePropertyUnit(src, unit));
		} else {
			// interface_method/interface_property, GVL, TYPE — not expected
			// as children of a composite POU file. Ignore silently.
		}
	}
	return { pou: { declaration: pouDecl, implementation: pouImpl }, children };
}

// ─── Interface branch ─────────────────────────────────────────────────

/**
 * Interfaces aren't POUs: no body, no outer VAR sections, and their
 * methods/properties live as nested arrays on the Interface node
 * rather than sibling top-level units. We slice them out by hand.
 *
 * Wire model mapping:
 *  - pou.declaration = the INTERFACE wrapper text (INTERFACE Name
 *    [EXTENDS X] up to where the first child begins, or up to
 *    END_INTERFACE when childless). Trailing newlines trimmed.
 *  - pou.implementation = "" (interfaces never have a body).
 *  - children: one ParsedChild per InterfaceMethod / InterfaceProperty.
 *    For methods, implementation = "" (signatures only). For properties,
 *    hasGetter / hasSetter map to empty getter/setter objects so the
 *    bridge knows to create the accessor (empty body = signature).
 */
function parseInterfaceFile(src: string, outer: Interface): ParsedFile {
	const wrapperEnd = firstInterfaceChildStart(outer) ?? findEndInterface(src, outer);
	const pouDecl = src.slice(outer.span.start, wrapperEnd).trimEnd();

	const children = new Map<string, ParsedChild>();
	for (const method of outer.methods) {
		const decl = sliceInterfaceMethod(src, method);
		children.set(method.name.text, {
			kind: "method",
			name: method.name.text,
			declaration: stripFolderAnnotation(decl),
			implementation: "",
			...maybeFolder(decl),
		});
	}
	for (const prop of outer.properties) {
		children.set(prop.name.text, parseInterfacePropertyUnit(src, prop));
	}

	return { pou: { declaration: pouDecl, implementation: "" }, children };
}

/** Earliest start offset across an interface's method + property arrays. */
function firstInterfaceChildStart(outer: Interface): number | undefined {
	let earliest: number | undefined;
	for (const m of outer.methods) {
		if (earliest === undefined || m.span.start < earliest) earliest = m.span.start;
	}
	for (const p of outer.properties) {
		if (earliest === undefined || p.span.start < earliest) earliest = p.span.start;
	}
	return earliest;
}

/** Find the END_INTERFACE position within a childless interface span. */
function findEndInterface(src: string, outer: Interface): number {
	const text = src.slice(outer.span.start, outer.span.end);
	const m = text.match(/\bEND_INTERFACE\b/i);
	return m && m.index !== undefined ? outer.span.start + m.index : outer.span.end;
}

/**
 * Slice an interface method signature: METHOD Name : Type [+ VAR sections],
 * up to END_METHOD. No body, so we slice through varSections (if any) and
 * trim. The slice always stops short of END_METHOD so the bridge can
 * regenerate the wrapper.
 */
function sliceInterfaceMethod(src: string, method: InterfaceMethod): string {
	const endIdx = method.varSections.length > 0
		? method.varSections[method.varSections.length - 1]!.span.end
		: declHeaderEnd(src, method.span, /\bEND_METHOD\b/i);
	return src.slice(method.span.start, endIdx).trimEnd();
}

/**
 * Interface property → ParsedChild with empty Get/Set accessors. The
 * bridge wire shape uses empty strings (not undefined) for accessor
 * declaration/implementation to signal "create this accessor with no
 * body" — which is exactly what an interface property's Get/Set is.
 */
function parseInterfacePropertyUnit(src: string, prop: InterfaceProperty): ParsedChild {
	const declaration = src.slice(prop.span.start, declHeaderEnd(src, prop.span, /\bGET\b|\bSET\b|\bEND_PROPERTY\b/i)).trimEnd();
	const out: ParsedChild = {
		kind: "property",
		name: prop.name.text,
		declaration: stripFolderAnnotation(declaration),
		implementation: "",
		...maybeFolder(declaration),
	};
	if (prop.hasGetter) out.getter = { declaration: "", implementation: "" };
	if (prop.hasSetter) out.setter = { declaration: "", implementation: "" };
	return out;
}

/** Find the first match of a keyword regex within a span; returns its absolute offset. */
function declHeaderEnd(src: string, span: { start: number; end: number }, keywordRe: RegExp): number {
	const text = src.slice(span.start, span.end);
	const m = text.match(keywordRe);
	return m && m.index !== undefined ? span.start + m.index : span.end;
}

// ─── Helpers ──────────────────────────────────────────────────────────

type WithVarAndBody = FunctionBlock | Program | FunctionAST | Method | Action;

function outerEnder(kind: "function_block" | "program" | "function"): string {
	switch (kind) {
		case "function_block": return "END_FUNCTION_BLOCK";
		case "program": return "END_PROGRAM";
		case "function": return "END_FUNCTION";
	}
}

function parsePropertyUnit(src: string, prop: Property): ParsedChild {
	const declaration = src.slice(prop.span.start, accessorBoundary(prop)).trimEnd();
	const out: ParsedChild = {
		kind: "property",
		name: prop.name.text,
		declaration: stripFolderAnnotation(declaration),
		implementation: "",
		...maybeFolder(declaration),
	};
	if (prop.getter !== undefined) out.getter = sliceAccessor(src, prop.getter);
	if (prop.setter !== undefined) out.setter = sliceAccessor(src, prop.setter);
	return out;
}

/** Pull `folder` from a `(* folder: X *)` comment on the signature line. */
function maybeFolder(declaration: string): { folder?: string } {
	const firstLine = declaration.split("\n", 1)[0] ?? "";
	const m = firstLine.match(FOLDER_COMMENT_RE);
	if (m === null) return {};
	const folder = (m[1] ?? "").trim();
	return folder.length > 0 ? { folder } : {};
}

/** Remove the folder-annotation comment from the signature line so the
 *  bridge-side declaration we send doesn't include our metadata. */
function stripFolderAnnotation(declaration: string): string {
	const lines = declaration.split("\n");
	if (lines.length === 0) return declaration;
	lines[0] = (lines[0] ?? "").replace(FOLDER_COMMENT_RE, "").replace(/\s+$/, "");
	return lines.join("\n");
}

function accessorBoundary(prop: Property): number {
	// Where the property's own declaration ends. Properties have no
	// VAR sections at their own level (varsections live on accessors).
	if (prop.getter !== undefined) return prop.getter.span.start;
	if (prop.setter !== undefined) return prop.setter.span.start;
	// No accessors — the entire property block IS just the declaration
	// (up to but not including END_PROPERTY).
	return prop.span.end - "END_PROPERTY".length;
}

function sliceAccessor(
	src: string,
	acc: PropertyAccessor,
): { declaration: string; implementation: string } {
	// We treat the "declaration" of an accessor as its VAR section text
	// (matching the bridge wire shape where getterDeclaration is the
	// local VAR block). Implementation is the body code.
	const decl = (() => {
		if (acc.varSections.length === 0) return "";
		const firstVar = acc.varSections[0]!.span.start;
		const lastVar = acc.varSections[acc.varSections.length - 1]!.span.end;
		return src.slice(firstVar, lastVar).trimEnd();
	})();
	const accDeclEnd = acc.varSections.length > 0
		? acc.varSections[acc.varSections.length - 1]!.span.end
		: acc.body.span.start;
	const ender = acc.kind === "get" ? "END_GET" : "END_SET";
	const implementation = sliceBody(src, accDeclEnd, ender);
	return { declaration: decl, implementation };
}

/** End of the declaration zone (last VAR section's end, or body start). */
function findDeclEnd(unit: WithVarAndBody): number {
	if (unit.kind !== "action" && unit.varSections.length > 0) {
		return unit.varSections[unit.varSections.length - 1]!.span.end;
	}
	return unit.body.span.start;
}

function sliceDeclaration(src: string, unit: WithVarAndBody): string {
	return src.slice(unit.span.start, findDeclEnd(unit)).trimEnd();
}

/**
 * Slice the body of a block from `declEnd` up to (but excluding) the
 * closer keyword. Source-driven so that trivia inside the body
 * (comments, blank lines) survives the round-trip.
 *
 * Why we have to search forward for the closer: `bodySpanFromTokens`
 * in the LSP builds `body.span` from the first/last meaningful token
 * when any tokens are present, so it doesn't include the closer's
 * position. We know END_X comes next in source (modulo trivia)
 * because the parser already consumed it.
 */
function sliceBody(src: string, declEnd: number, enderKeyword: string): string {
	const after = src.slice(declEnd);
	const re = new RegExp(`\\b${enderKeyword}\\b`, "i");
	const m = after.match(re);
	const enderAbsIdx = m && m.index !== undefined ? declEnd + m.index : src.length;
	return src.slice(declEnd, enderAbsIdx).trim();
}
