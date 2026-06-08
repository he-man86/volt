/**
 * Map an IDE build diagnostic onto a line in the single assembled `.st`
 * file (the form the workspace, the LSP, and the AI all see). Shared by
 * the agent's `volt build` debug loop and the VS Code extension's
 * Problems-panel display.
 *
 * All behavior below verified live against TwinCAT (TcXaeShell 15.0,
 * 2026-06-08) by pushing error POUs and reading `/build`.
 *
 * The IDE reports `(object, line)`:
 *   - `object`:
 *       `"FB_X"`            — a top-level POU
 *       `"FB_X.DoWork"`     — a child method / action
 *       `"FB_X.Prop.Get"`   — a property accessor (3-part!)
 *   - `line` = 1-based, within THAT object's own text.
 *
 * Per-object line model (the whole subtlety):
 *   - POU / method / action: text = declaration (from the HEADER line —
 *     `FUNCTION_BLOCK` / `METHOD` / … is line 1) through the last `END_VAR`,
 *     then the implementation body. The IDE counts the declaration verbatim
 *     (blank lines included) but STRIPS leading blank lines of the body, so
 *     the body is anchored at its first real token.
 *   - Property accessor (`.Get` / `.Set`): text = the accessor's `VAR`
 *     block (line 1 = `VAR`; the `GET`/`SET` keyword is NOT counted) then
 *     its body. A var-less accessor shows a phantom two-line `VAR`/`END_VAR`
 *     in the IDE — those don't exist in our file, so a var-less accessor's
 *     decl lines are unmappable; its body still maps (offset by 2).
 *
 * Returns a 0-based line (LSP convention). `undefined` when the object
 * isn't a POU/child in THIS source (cross-file / project-level), the IDE
 * gave no line, or the line falls on a phantom (IDE-only) declaration line.
 */
import { parseSource } from "./parser/parser.js";
import type { BodySpan, PropertyAccessor, TopLevel, VarSection } from "./parser/ast.js";

/** Minimal structural shape of an IDE build diagnostic — `object` names
 *  the POU/child (`"FB"`, `"FB.Method"`, `"FB.Prop.Get"`), `line` is
 *  1-based within that object's own text. Kept structural so this module
 *  has no dependency on any bridge wire type. */
export interface ObjectDiagnosticRef {
	object: string | null;
	line: number;
}

/** Two-part dotted children (parent.child). Properties are 3-part (handled separately). */
const CHILD_KINDS: ReadonlySet<string> = new Set(["method", "action", "property"]);

interface ObjectLayout {
	/** 1-based file line where the object's declaration line 1 sits, or
	 *  `undefined` when the declaration is phantom (IDE-only, not in our file). */
	declAnchor: number | undefined;
	/** Number of declaration lines in the IDE's view of the object. */
	declLineCount: number;
	/** 1-based file line of the first non-whitespace body token, or undefined. */
	firstBodyLine: number | undefined;
}

export function bridgeDiagnosticFileLine(
	diag: ObjectDiagnosticRef,
	source: string,
): number | undefined {
	if (diag.object === null || diag.line <= 0) return undefined;
	const layout = objectLayout(diag.object, source);
	if (layout === undefined) return undefined;

	if (diag.line <= layout.declLineCount) {
		// Declaration line — counted verbatim from the anchor. Unmappable
		// when the anchor is phantom (e.g. a var-less accessor's VAR/END_VAR).
		if (layout.declAnchor === undefined) return undefined;
		return layout.declAnchor + (diag.line - 1) - 1; // → 0-based
	}

	// Implementation line — anchored at the first real body token.
	if (layout.firstBodyLine === undefined) return undefined;
	const implLine = diag.line - layout.declLineCount;
	return layout.firstBodyLine + (implLine - 1) - 1; // → 0-based
}

function objectLayout(object: string, source: string): ObjectLayout | undefined {
	const segs = object.split(".");
	const units = parseSource(source).units;
	const eq = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
	const byName = (kindOk: (k: string) => boolean, name: string): TopLevel | undefined =>
		units.find((u) => kindOk(u.kind) && "name" in u && eq(u.name.text, name));

	// 3-part property accessor: FB.Prop.Get / FB.Prop.Set
	if (segs.length === 3 && (eq(segs[2]!, "get") || eq(segs[2]!, "set"))) {
		const prop = byName((k) => k === "property", segs[1]!);
		if (prop === undefined || prop.kind !== "property") return undefined;
		const accessor = eq(segs[2]!, "get") ? prop.getter : prop.setter;
		return accessor === undefined ? undefined : accessorLayout(accessor);
	}

	// 2-part child: method / action (property without an accessor segment).
	if (segs.length === 2) {
		const child = byName((k) => CHILD_KINDS.has(k), segs[1]!);
		return child === undefined ? undefined : pouLayout(child);
	}

	// 1-part top-level POU.
	if (segs.length === 1) {
		const u = byName(() => true, segs[0]!);
		return u === undefined ? undefined : pouLayout(u);
	}

	return undefined;
}

/** Layout for a POU / method / action: header line is declaration line 1. */
function pouLayout(unit: TopLevel): ObjectLayout {
	const headerLine = unit.span.startLine;
	let declEndLine = headerLine;
	if ("varSections" in unit) {
		declEndLine = lastVarEnd(unit.varSections, headerLine);
	}
	return {
		declAnchor: headerLine,
		declLineCount: declEndLine - headerLine + 1,
		firstBodyLine: "body" in unit && unit.body.kind === "body" ? firstBodyToken(unit.body) : undefined,
	};
}

/**
 * Layout for a property accessor. The IDE's accessor text is the VAR block
 * (line 1 = `VAR`) then the body — the `GET`/`SET` keyword is not counted.
 * A var-less accessor shows a phantom two-line `VAR`/`END_VAR`.
 */
function accessorLayout(accessor: PropertyAccessor): ObjectLayout {
	const firstBodyLine = firstBodyToken(accessor.body);
	if (accessor.varSections.length === 0) {
		return { declAnchor: undefined, declLineCount: 2, firstBodyLine };
	}
	let varStart = accessor.varSections[0]!.span.startLine;
	for (const v of accessor.varSections) if (v.span.startLine < varStart) varStart = v.span.startLine;
	const varEnd = lastVarEnd(accessor.varSections, varStart);
	return {
		declAnchor: varStart,
		declLineCount: varEnd - varStart + 1,
		firstBodyLine,
	};
}

function lastVarEnd(sections: readonly VarSection[], fallback: number): number {
	let end = fallback;
	for (const v of sections) if (v.span.endLine > end) end = v.span.endLine;
	return end;
}

function firstBodyToken(body: BodySpan): number | undefined {
	const tok = body.tokens.find((t) => t.kind !== "whitespace");
	return tok?.span.startLine;
}
