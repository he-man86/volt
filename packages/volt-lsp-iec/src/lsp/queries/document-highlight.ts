/**
 * `textDocument/documentHighlight` — highlight occurrences of the
 * symbol under the cursor within the current document only.
 *
 * Differs from `references` in that:
 *   - Single-file (current document only)
 *   - Returns DocumentHighlight[] (ranges + optional kind) instead of
 *     Location[] (uri + range)
 *
 * Shares the type-aware core with references/rename: resolve the target symbol at
 * the cursor, then keep only occurrences that bind to it (a `motor.Start` highlight
 * no longer lights up every `Start`). Scoped to the single document by passing just
 * this doc to `findReferences`. Falls back to name-based when the target can't resolve.
 */
import type {
	DocumentHighlight,
	Position,
} from "vscode-languageserver-protocol";
import { DocumentHighlightKind } from "vscode-languageserver-protocol";
import type { Scope } from "../../semantic/symbol-table.js";
import { offsetFromPosition, rangeFromSpan } from "../position.js";
import type { Document } from "../workspace.js";
import { findIdentifierAtOffset } from "../identifier-at.js";
import { vgLocalRefAt } from "./vg/shared.js";
import { findReferences, symbolAtOffset } from "../symbol-refs.js";

export interface DocumentHighlightArgs {
	doc: Document;
	position: Position;
	project: Scope;
}

export function documentHighlight(args: DocumentHighlightArgs): DocumentHighlight[] {
	const { doc, project } = args;
	const offset = offsetFromPosition(doc.source, args.position);
	if (offset < 0) return [];

	// VG network-local names (LET wires / labels): occurrences confined to the enclosing
	// network, resolved via the same seam references/rename use — so a wire highlights too.
	const vgLocal = vgLocalRefAt(doc.bodyModels, offset);
	if (vgLocal !== undefined) {
		return vgLocal.occurrences.map((span) => ({ range: rangeFromSpan(span), kind: DocumentHighlightKind.Text }));
	}

	const idToken = findIdentifierAtOffset(doc.parseResult, offset, doc.bodyModels);
	if (idToken === undefined) return [];

	const target = symbolAtOffset(doc, project, offset);
	return findReferences([doc], idToken.text, target, project).map((r) => ({
		range: rangeFromSpan(r.span),
		kind: DocumentHighlightKind.Read,
	}));
}
