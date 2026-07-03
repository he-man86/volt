/**
 * `textDocument/definition` — go to the declaration of the identifier
 * under the cursor.
 *
 * Algorithm:
 *   1. Translate (uri, position) → byte offset in the document source.
 *   2. Find the identifier token covering that offset. We search every
 *      body in the document's top-level units AND every identifier
 *      appearing in declarations (POU names, var names, type refs).
 *   3. Look up the name in the scope at that offset (innermost wins).
 *   4. Return the symbol's defining span as a Location.
 *
 * Known limitations:
 *   - Member-access resolution (`obj.foo`) returns matches for `foo`
 *     anywhere — narrowing by `obj`'s type would require type
 *     inference, which is intentionally out of scope per
 *     [[feedback-no-fallbacks-single-source]] (CODESYS/TIA own typing).
 */
import { lookup } from "../../semantic/resolver.js";
import type { Scope } from "../../semantic/symbol-table.js";
import { offsetFromPosition, rangeFromSpan } from "../position.js";
import type { Location, Position } from "../types.js";
import type { Document } from "../workspace.js";
import { findIdentifierAtOffset } from "../identifier-at.js";
import { scopeAtOffset as scopeAt } from "../scope-at.js";
import { vgBodyAtOffset } from "./vg/shared.js";
import { vgLocalNameAtOffset } from "./vg/navigation.js";

export interface DefinitionArgs {
	doc: Document;
	position: Position;
	project: Scope;
}

export function definition(args: DefinitionArgs): Location[] {
	const { doc, position, project } = args;
	const offset = offsetFromPosition(doc.source, position);
	if (offset < 0) return [];

	// VG network-local names (LET wires, labels) resolve within the
	// network, not via the declaration scope.
	const vgEntry = vgBodyAtOffset(doc.bodyModels, offset);
	if (vgEntry !== undefined) {
		const local = vgLocalNameAtOffset(vgEntry.vg, vgEntry.tokens, offset);
		if (local !== undefined) {
			const target = local.declSpan ?? local.atSpan;
			return [{ uri: doc.uri, range: rangeFromSpan(target) }];
		}
	}

	const idToken = findIdentifierAtOffset(doc.parseResult, offset, doc.bodyModels);
	if (idToken === undefined) return [];

	// Determine the most specific scope for this lookup. For now we
	// use a simple heuristic: if the offset falls inside a top-level
	// unit, use that unit's child scope as the starting point; else
	// fall back to project.
	const startScope = scopeAt(project, doc, offset);

	const r = lookup(startScope, idToken.text);
	if (r === undefined) return [];

	// Convert symbol's defining span into a Location. The symbol carries
	// its own URI (set when its containing file was ingested into the
	// project scope), so cross-file definitions point at the right file
	// without us re-scanning the workspace. Fall back to the requesting
	// document's URI only if the symbol came from a parse result that
	// wasn't associated with a URI — which in practice only happens in
	// unit tests that call buildSymbolTable directly.
	const uri = r.symbol.uri.length > 0 ? r.symbol.uri : doc.uri;
	return [
		{
			uri,
			range: rangeFromSpan(r.symbol.span),
		},
	];
}

