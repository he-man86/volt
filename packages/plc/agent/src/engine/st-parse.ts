/**
 * Workspace `.st` file → structured ParsedFile, via the LSP parser.
 *
 * Each workspace file represents one POU (FUNCTION_BLOCK / PROGRAM /
 * FUNCTION). Its children (METHOD / ACTION / PROPERTY) appear as
 * top-level sibling declarations AFTER the outer END_X — parent
 * association is implicit from the filename. The `@opencode-ai/plc-lsp-st`
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
import { parseSource } from "@opencode-ai/plc-lsp-st";
import type {
	Action,
	FunctionBlock,
	Function as FunctionAST,
	Method,
	Program,
	Property,
	PropertyAccessor,
} from "@opencode-ai/plc-lsp-st";
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
		outer.kind !== "function"
	) {
		throw new Error(
			`parseFile(${expectedName}): first declaration must be FUNCTION_BLOCK / PROGRAM / FUNCTION, got ${outer.kind}`,
		);
	}
	if (outer.name.text !== expectedName) {
		throw new Error(
			`parseFile: expected POU "${expectedName}" but file declares "${outer.name.text}"`,
		);
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
