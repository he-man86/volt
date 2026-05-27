/**
 * `workspace/symbol` — search every symbol in the project by name.
 *
 * Returns matches whose name contains the query string (case-insensitive
 * substring). The LSP spec lets the server pick the matching algorithm —
 * substring matching is simple and gives the user predictable results;
 * we can upgrade to fuzzy matching later if needed.
 *
 * Returns `SymbolInformation[]` (the legacy LSP shape) — newer
 * `WorkspaceSymbol[]` is similar but has `location: Location | { uri }`
 * for lazy location resolution. Clients accept either, and the legacy
 * shape works in every client we care about.
 */
import { lspSymbolKindFor } from "../capabilities.js";
import { rangeFromSpan } from "../position.js";
import type { Scope, Symbol } from "../../semantic/symbol-table.js";
import type { Location, LspSymbolKindValue } from "../types.js";
import type { Workspace } from "../workspace.js";

export interface SymbolInformation {
	name: string;
	kind: LspSymbolKindValue;
	location: Location;
	containerName?: string;
}

export interface WorkspaceSymbolArgs {
	workspace: Workspace;
	project: Scope;
	query: string;
}

export function workspaceSymbol(args: WorkspaceSymbolArgs): SymbolInformation[] {
	const { project, query } = args;
	const q = query.trim().toLowerCase();

	const out: SymbolInformation[] = [];
	walkScope(project, (sym, container) => {
		if (q.length === 0 || sym.name.toLowerCase().includes(q)) {
			if (sym.uri.length === 0) return;
			out.push({
				name: sym.name,
				kind: lspSymbolKindFor(sym.kind),
				location: { uri: sym.uri, range: rangeFromSpan(sym.span) },
				...(container !== undefined ? { containerName: container } : {}),
			});
		}
	});
	return out;
}

function walkScope(
	scope: Scope,
	cb: (sym: Symbol, container: string | undefined) => void,
	containerName?: string,
): void {
	for (const list of scope.symbols.values()) {
		for (const sym of list) cb(sym, containerName);
	}
	for (const child of scope.children) {
		walkScope(child, cb, child.name);
	}
}
