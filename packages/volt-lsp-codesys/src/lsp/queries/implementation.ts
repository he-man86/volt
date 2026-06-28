/**
 * `textDocument/implementation` — find concrete implementations of an
 * abstract symbol. In PLC ST that means:
 *
 *   - Cursor on an INTERFACE name → every FB whose declaration includes
 *     `IMPLEMENTS <thisInterface>` (directly).
 *
 * Returns `Location[]` per LSP spec. Empty array when the symbol under
 * the cursor isn't an interface, or no implementations exist in the
 * workspace.
 *
 * Why interface-only:
 *   - FBs aren't "implementations" of anything — they ARE the
 *     implementation. The "find subclasses of an FB" question is
 *     served by `typeHierarchy/subtypes`, which is the correct LSP
 *     primitive for that.
 *   - Cursor-on-method-inside-interface would map to "implementations
 *     of this method"; that needs parent tracking we don't yet do.
 *     Deferred until needed.
 */
import { offsetFromPosition, rangeFromSpan } from "../position.js";
import { lookup } from "../../semantic/resolver.js";
import type { Scope } from "../../semantic/symbol-table.js";
import type { Location, Position } from "../types.js";
import type { Document, Workspace } from "../workspace.js";
import { findIdentifierAtOffset } from "../identifier-at.js";
import type { FunctionBlock } from "../../parser/ast.js";

export interface ImplementationArgs {
	workspace: Workspace;
	doc: Document;
	position: Position;
	project: Scope;
}

export function implementation(args: ImplementationArgs): Location[] {
	const { workspace, doc, position, project } = args;
	const offset = offsetFromPosition(doc.source, position);
	if (offset < 0) return [];

	const idToken = findIdentifierAtOffset(doc.parseResult, offset, doc.bodyModels);
	if (idToken === undefined) return [];

	const sym = lookup(project, idToken.text)?.symbol;
	if (sym === undefined || sym.kind !== "interface") return [];

	const target = sym.name.toLowerCase();
	const out: Location[] = [];
	for (const d of workspace.allDocuments()) {
		for (const unit of d.parseResult.units) {
			if (unit.kind !== "function_block") continue;
			const fb = unit as FunctionBlock;
			const impls = fb.implements ?? [];
			for (const i of impls) {
				if (i.text.toLowerCase() === target) {
					out.push({ uri: d.uri, range: rangeFromSpan(fb.name.span) });
					break;
				}
			}
		}
	}
	return out;
}
