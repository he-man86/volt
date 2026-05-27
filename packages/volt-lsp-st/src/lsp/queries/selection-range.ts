/**
 * `textDocument/selectionRange` — smart-expand selection by AST.
 *
 * VS Code maps Alt+Shift+→ / Alt+Shift+← to this. Each request comes
 * with multiple positions (typically multi-cursor); we return one
 * nested SelectionRange per position.
 *
 * Expansion ladder (innermost → outermost):
 *   1. The identifier token at the cursor
 *   2. The enclosing VAR declaration (if applicable)
 *   3. The enclosing VAR section
 *   4. The enclosing POU / TYPE / GVL / NAMESPACE
 *
 * For body positions (inside method/FB code), the immediate parent
 * is the POU itself — we don't parse statement trees, so finer
 * granularity isn't available.
 */
import type {
	Position,
	SelectionRange,
} from "vscode-languageserver-protocol";
import type { Span } from "../../lexer/span.js";
import type { TopLevel, VarDecl, VarSection } from "../../parser/ast.js";
import { offsetFromPosition, rangeFromSpan } from "../position.js";
import type { Document } from "../workspace.js";
import { findIdentifierAtOffset } from "./find-identifier.js";

export interface SelectionRangeArgs {
	doc: Document;
	positions: ReadonlyArray<Position>;
}

export function selectionRanges(args: SelectionRangeArgs): SelectionRange[] {
	return args.positions.map((p) => computeForPosition(args.doc, p));
}

function computeForPosition(doc: Document, position: Position): SelectionRange {
	const offset = offsetFromPosition(doc.source, position);
	if (offset < 0) {
		// Degenerate — return a zero-width range at the position.
		return { range: { start: position, end: position } };
	}

	// Build the chain from outermost to innermost. We then nest them
	// so the returned object's `.parent` chain walks outward.
	const chain: Span[] = [];

	for (const unit of doc.parseResult.units) {
		walk(unit, offset, chain);
	}

	// Innermost: identifier at cursor (preferable to byte-offset range).
	const idTok = findIdentifierAtOffset(doc.parseResult, offset);
	if (idTok !== undefined) chain.push(idTok.span);

	// Outermost → innermost: build the nested SelectionRange.
	let current: SelectionRange | undefined;
	for (const span of chain) {
		current = current === undefined
			? { range: rangeFromSpan(span) }
			: { range: rangeFromSpan(span), parent: current };
	}
	if (current === undefined) {
		return { range: { start: position, end: position } };
	}
	return current;
}

function walk(unit: TopLevel, offset: number, chain: Span[]): void {
	if (offset < unit.span.start || offset >= unit.span.end) return;
	chain.push(unit.span);

	if ("varSections" in unit) {
		for (const section of unit.varSections) {
			if (offset < section.span.start || offset >= section.span.end) continue;
			chain.push(section.span);
			for (const decl of section.decls) {
				if (offset >= decl.span.start && offset < decl.span.end) {
					chain.push(decl.span);
					break;
				}
			}
			break;
		}
	}

	if (unit.kind === "namespace") {
		for (const inner of unit.units) {
			walk(inner, offset, chain);
		}
	}
}
