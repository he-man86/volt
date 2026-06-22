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
import { lookup } from "../../semantic/resolver.js";
import type { Scope } from "../../semantic/symbol-table.js";
import type { Location, Position } from "../types.js";
import type { Document, Workspace } from "../workspace.js";
import type { BodySpan, TopLevel } from "../../parser/ast.js";
import { findIdentifiersByName } from "../../semantic/body.js";
import { findIdentifierAtOffset } from "../identifier-at.js";
import { vgBodyAtOffset } from "./vg/shared.js";
import { vgLocalNameAtOffset } from "./vg/navigation.js";

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

	// VG network-local names (LET wires, labels): references are confined
	// to the enclosing network.
	const vgEntry = vgBodyAtOffset(doc.bodyModels, offset);
	if (vgEntry !== undefined) {
		const local = vgLocalNameAtOffset(vgEntry.vg, vgEntry.tokens, offset);
		if (local !== undefined) {
			return local.occurrences.map((span) => ({ uri: doc.uri, range: rangeFromSpan(span) }));
		}
	}

	const idToken = findIdentifierAtOffset(doc.parseResult, offset, doc.bodyModels);
	if (idToken === undefined) return [];

	const targetName = idToken.text;
	const sym = lookup(project, targetName)?.symbol;

	const locations: Location[] = [];

	for (const d of workspace.allDocuments()) {
		for (const unit of d.parseResult.units) {
			const body = getBody(unit);
			if (body === undefined) continue;
			const model = d.bodyModels.get(body);
			if (model === undefined) continue;
			for (const ref of findIdentifiersByName(model, targetName)) {
				locations.push({ uri: d.uri, range: rangeFromSpan(ref.span) });
			}
		}
	}

	if (includeDeclaration && sym !== undefined) {
		const declUri = sym.uri.length > 0 ? sym.uri : doc.uri;
		locations.push({ uri: declUri, range: rangeFromSpan(sym.span) });
	}

	return locations;
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
