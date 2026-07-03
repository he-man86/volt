/**
 * `textDocument/rename` — produce a `WorkspaceEdit` that renames every
 * occurrence of the symbol under the cursor.
 *
 * Algorithm mirrors `references`:
 *   1. Identify the symbol via `findIdentifierAtOffset`.
 *   2. Walk every open document's bodies, collecting every matching
 *      identifier span via `findIdentifiersByName`. Replacing the span
 *      with `newText` keeps the body valid.
 *   3. Add the declaration site (`sym.uri` + `sym.span`) so the rename
 *      includes the originating VAR / METHOD / FB / etc.
 *
 * Companion: `prepareRename` returns the range of the identifier at
 * the cursor, or null when the position has no renameable identifier.
 * Clients use this to confirm a rename is possible before prompting
 * the user for the new name.
 */
import { offsetFromPosition, rangeFromSpan } from "../position.js";
import { lookup } from "../../semantic/resolver.js";
import type { Scope } from "../../semantic/symbol-table.js";
import type { Position, Range } from "../types.js";
import type { Document, Workspace } from "../workspace.js";
import type { BodySpan, TopLevel } from "../../parser/ast.js";
import { findIdentifiersByName } from "../../semantic/body.js";
import { findIdentifierAtOffset } from "../identifier-at.js";
import { scopeAtOffset } from "../scope-at.js";
import { vgLocalRefAt } from "./vg/shared.js";

/** Minimal WorkspaceEdit shape — the LSP spec's `changes` map keyed
 *  by URI. The full WorkspaceEdit also supports `documentChanges` for
 *  versioned edits; we use the simpler `changes` shape because every
 *  edit operates on text our server already knows about. */
export interface WorkspaceEdit {
	changes: Record<string, TextEdit[]>;
}

export interface TextEdit {
	range: Range;
	newText: string;
}

export interface RenameArgs {
	workspace: Workspace;
	doc: Document;
	position: Position;
	project: Scope;
	newName: string;
}

export interface PrepareRenameArgs {
	doc: Document;
	position: Position;
}

/**
 * Produce a WorkspaceEdit renaming the symbol at the cursor to
 * `newName`. Returns null when the cursor isn't on a renameable
 * identifier (no token at the offset, or the new name is the same as
 * the old name).
 */
export function rename(args: RenameArgs): WorkspaceEdit | null {
	const { workspace, doc, position, project, newName } = args;
	const trimmed = newName.trim();
	if (trimmed.length === 0) return null;
	const offset = offsetFromPosition(doc.source, position);
	if (offset < 0) return null;

	// VG network-local names (LET wires, labels): rename only the occurrences within the
	// enclosing network — they never escape to the IDE, so this is always safe and confined.
	const vgLocal = vgLocalRefAt(doc.bodyModels, offset);
	if (vgLocal !== undefined) {
		if (vgLocal.name === trimmed) return null;
		return { changes: { [doc.uri]: vgLocal.occurrences.map((span) => ({ range: rangeFromSpan(span), newText: trimmed })) } };
	}

	const idToken = findIdentifierAtOffset(doc.parseResult, offset, doc.bodyModels);
	if (idToken === undefined) return null;
	const oldName = idToken.text;
	if (oldName === trimmed) return null;

	// Look up the symbol from the LOCAL scope at the cursor, not from
	// the project root. A VAR declared inside a PROGRAM lives in the
	// program's scope, not at project level — `lookup(project, …)`
	// would miss it and the declaration site wouldn't be renamed.
	const startScope = scopeAtOffset(project, doc, offset);
	const sym = lookup(startScope, oldName)?.symbol;
	const changes: Record<string, TextEdit[]> = {};

	function push(uri: string, range: Range): void {
		const list = changes[uri] ?? [];
		list.push({ range, newText: trimmed });
		changes[uri] = list;
	}

	// Pass 1: every body usage across the workspace. `findIdentifiersByName`
	// is the same path `references` uses, so coverage is identical —
	// every body-token usage of the name lands here.
	for (const d of workspace.allDocuments()) {
		for (const unit of d.parseResult.units) {
			const body = getBody(unit);
			if (body === undefined) continue;
			const model = d.bodyModels.get(body);
			if (model === undefined) continue;
			for (const ref of findIdentifiersByName(model, oldName)) {
				push(d.uri, rangeFromSpan(ref.span));
			}
		}
	}

	// Pass 2: the declaration. Only included when the symbol resolved
	// — typing on an unknown name (e.g. a typo) still produces edits
	// for all matching usages but doesn't fabricate a declaration.
	if (sym !== undefined) {
		const declUri = sym.uri.length > 0 ? sym.uri : doc.uri;
		push(declUri, rangeFromSpan(sym.span));
	}

	return { changes };
}

/**
 * Return the range of the identifier at the cursor, or null if no
 * renameable identifier is present. Clients call this before
 * prompting the user — the returned range is what the editor pre-
 * selects for the inline rename input.
 */
export function prepareRename(args: PrepareRenameArgs): Range | null {
	const { doc, position } = args;
	const offset = offsetFromPosition(doc.source, position);
	if (offset < 0) return null;
	const vgLocal = vgLocalRefAt(doc.bodyModels, offset);
	if (vgLocal !== undefined) return rangeFromSpan(vgLocal.atSpan);
	const idToken = findIdentifierAtOffset(doc.parseResult, offset, doc.bodyModels);
	if (idToken === undefined) return null;
	return rangeFromSpan(idToken.span);
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
