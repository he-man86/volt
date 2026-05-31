/**
 * `textDocument/documentHighlight` — highlight occurrences of the
 * symbol under the cursor within the current document only.
 *
 * Differs from `references` in that:
 *   - Single-file (current document only)
 *   - Returns DocumentHighlight[] (ranges + optional kind) instead of
 *     Location[] (uri + range)
 *   - Cheap — no project-wide scan
 *
 * Implementation: find the identifier at the cursor, then scan every
 * body in the same document for matching occurrences. We also include
 * the declaration site if it's in this document.
 */
import type {
	DocumentHighlight,
	Position,
} from "vscode-languageserver-protocol";
import { DocumentHighlightKind } from "vscode-languageserver-protocol";
import type { BodySpan, TopLevel } from "../../parser/ast.js";
import { findIdentifiersByName } from "../../body/index.js";
import { offsetFromPosition, rangeFromSpan } from "../position.js";
import type { Document } from "../workspace.js";
import { findIdentifierAtOffset } from "./find-identifier.js";

export interface DocumentHighlightArgs {
	doc: Document;
	position: Position;
}

export function documentHighlight(args: DocumentHighlightArgs): DocumentHighlight[] {
	const offset = offsetFromPosition(args.doc.source, args.position);
	if (offset < 0) return [];
	const idToken = findIdentifierAtOffset(args.doc.parseResult, offset);
	if (idToken === undefined) return [];

	const target = idToken.text;
	const out: DocumentHighlight[] = [];
	for (const unit of args.doc.parseResult.units) {
		collectFromUnit(args.doc, unit, target, out);
	}
	return out;
}

function collectFromUnit(
	doc: Document,
	unit: TopLevel,
	target: string,
	out: DocumentHighlight[],
): void {
	const body = getBody(unit);
	if (body !== undefined) {
		const model = doc.bodyModels.get(body);
		if (model !== undefined) {
			for (const ref of findIdentifiersByName(model, target)) {
				out.push({
					range: rangeFromSpan(ref.span),
					kind: ref.isCall
						? DocumentHighlightKind.Read
						: DocumentHighlightKind.Read,
				});
			}
		}
	}
	// Recurse into namespace's inner units.
	if (unit.kind === "namespace") {
		for (const inner of unit.units) {
			collectFromUnit(doc, inner, target, out);
		}
	}
}

function getBody(unit: TopLevel): BodySpan | undefined {
	switch (unit.kind) {
		case "function_block":
		case "program":
		case "function":
		case "method":
		case "action":
			return unit.body;
		default:
			return undefined;
	}
}
