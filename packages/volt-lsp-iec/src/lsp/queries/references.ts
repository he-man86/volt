/**
 * `textDocument/references` — find every usage of the symbol under
 * the cursor, project-wide.
 *
 * Algorithm:
 *   1. Identify the symbol via the same path as `definition`.
 *   2. Walk every open document's top-level unit bodies and scan for
 *      identifier tokens matching the target name (case-insensitive).
 *   3. Optionally include the declaration site itself.
 *
 * Phase-3 limitations (same as definition):
 *   - No type-aware narrowing: `motor.Start` references match every
 *     `Start` in the project, not just the method on `motor`'s type.
 *   - Local-var shadowing isn't filtered. For navigation this is
 *     mostly fine — a method-local "count" reported alongside a
 *     project-global "count" is usually what the user wants to see.
 */
import { offsetFromPosition, rangeFromSpan } from "../position.js";
import type { Scope } from "../../semantic/symbol-table.js";
import type { Location, Position } from "../types.js";
import type { Document, Workspace } from "../workspace.js";
import { findIdentifierAtOffset } from "../identifier-at.js";
import { vgLocalRefAt } from "./vg/shared.js";
import { findReferences, symbolAtOffset } from "../symbol-refs.js";

export interface ReferencesArgs {
	workspace: Workspace;
	doc: Document;
	position: Position;
	project: Scope;
	includeDeclaration: boolean;
}

export function references(args: ReferencesArgs): Location[] {
	const { workspace, doc, position, project, includeDeclaration } = args;
	const offset = offsetFromPosition(doc.source, position);
	if (offset < 0) return [];

	// VG network-local names (LET wires, labels): references are confined to the enclosing network.
	const vgLocal = vgLocalRefAt(doc.bodyModels, offset);
	if (vgLocal !== undefined) {
		return vgLocal.occurrences.map((span) => ({ uri: doc.uri, range: rangeFromSpan(span) }));
	}

	const idToken = findIdentifierAtOffset(doc.parseResult, offset, doc.bodyModels);
	if (idToken === undefined) return [];

	// Type-aware: resolve the target symbol (through a member chain if the cursor is on `a.b`), then narrow
	// to occurrences that bind to it. Falls back to name-based when the target can't be resolved.
	const target = symbolAtOffset(doc, project, offset);
	const locations: Location[] = findReferences(workspace.allDocuments(), idToken.text, target, project).map(
		(r) => ({ uri: r.uri, range: rangeFromSpan(r.span) }),
	);

	if (includeDeclaration && target !== undefined) {
		const declUri = target.uri.length > 0 ? target.uri : doc.uri;
		locations.push({ uri: declUri, range: rangeFromSpan(target.span) });
	}

	return locations;
}
