/**
 * `textDocument/completion` — propose completion items at the cursor.
 *
 * Items come from four sources:
 *   1. Static — keywords, types, operators, pragma names from the
 *      CODESYS reference (`src/reference/*`).
 *   2. Local symbols — vars / methods / fields visible in the scope
 *      chain at the cursor position.
 *   3. Member access — when the cursor follows `<expr>.`, the type of
 *      `<expr>` determines available members.
 *   4. Pragma context — when the cursor sits inside `{attribute '...'}`,
 *      only pragma names with snippet expansions are offered.
 *
 * Two-phase per Microsoft's lsp-sample pattern: initial list ships
 * labels only; `completionItem/resolve` fills in markdown docs.
 *
 * Ranking via `sortText` per the Zed/blink hybrid pattern:
 *   - `00_` local symbols
 *   - `10_` keywords
 *   - `20_` types
 *   - `30_` operators
 *   - `40_` type-conversion functions
 *   - `50_` pragmas
 */
import {
	CompletionItemKind,
	InsertTextFormat,
	type CompletionItem,
	type Position,
} from "vscode-languageserver-protocol";
import {
	allEntries,
	lookup as lookupRef,
	renderHover,
	type ReferenceEntry,
	type Vendor,
} from "../../reference/index.js";
import { ALL_PRAGMAS } from "../../reference/pragmas.js";
import type { Scope, Symbol } from "../../semantic/symbol-table.js";
import { offsetFromPosition } from "../position.js";
import type { Document } from "../workspace.js";
import { scopeAtOffset } from "../scope-at.js";

export interface CompletionArgs {
	doc: Document;
	position: Position;
	project: Scope;
	snippetSupport?: boolean;
	/** Active vendor — drives filtering of pragma/operator suggestions. */
	activeVendor?: Vendor;
}

/**
 * Detect the cursor context from the source prefix. Drives which item
 * categories to surface.
 */
type CursorContext =
	| { kind: "default" }
	| { kind: "pragma-attribute" } // inside `{attribute '...'}`
	| { kind: "member-access"; baseName: string }; // after `<name>.`

function detectContext(source: string, offset: number): CursorContext {
	// Look back from the cursor over the current line, ignoring leading whitespace.
	const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
	const prefix = source.slice(lineStart, offset);

	// Pragma attribute: inside `{attribute '...` (no closing quote yet).
	if (/\{\s*attribute\s+'[^']*$/i.test(prefix)) {
		return { kind: "pragma-attribute" };
	}

	// Member access: `<ident>.` with optional partial identifier following.
	const member = /([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)?$/.exec(prefix);
	if (member !== null && member[1] !== undefined) {
		return { kind: "member-access", baseName: member[1] };
	}

	return { kind: "default" };
}

export function completion(args: CompletionArgs): CompletionItem[] {
	const offset = offsetFromPosition(args.doc.source, args.position);
	if (offset < 0) return [];
	const context = detectContext(args.doc.source, offset);

	if (context.kind === "pragma-attribute") {
		return pragmaAttributeCompletions(args.snippetSupport ?? true, args.activeVendor);
	}

	if (context.kind === "member-access") {
		return memberCompletions(context.baseName, args.project);
	}

	// Default: static reference items + local symbols.
	const items: CompletionItem[] = [];
	addStaticReferenceItems(items, args.activeVendor);
	addLocalSymbols(items, args.project, args.doc, offset);
	return items;
}

// ─── Pragma context ──────────────────────────────────────────────────

function pragmaAttributeCompletions(snippetSupport: boolean, activeVendor?: Vendor): CompletionItem[] {
	const pool = ALL_PRAGMAS.filter((p) => p.category === "attribute").filter(
		(p) => activeVendor === undefined || p.vendor === "shared" || p.vendor === activeVendor,
	);
	return pool.map((p) => {
		// Strip the leading `{attribute '` since the user is already typing inside.
		// We propose JUST the attribute name (and optional ` := '${value}'`).
		const innerSnippet = p.syntax
			.replace(/^\{\s*attribute\s+'/i, "")
			.replace(/'\}$/, "")
			.replace(/^'/, "");
		return {
			label: p.name,
			kind: CompletionItemKind.Keyword,
			detail: "CODESYS pragma",
			insertText: snippetSupport ? innerSnippet : p.name,
			insertTextFormat: snippetSupport ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
			sortText: `50_${p.name}`,
			data: { refName: p.name },
		};
	});
}

// ─── Member-access context ───────────────────────────────────────────

function memberCompletions(baseName: string, project: Scope): CompletionItem[] {
	// Find the FB type referenced by `baseName` and offer its members.
	// We need: lookup baseName in any reachable scope → get its type →
	// find that type's scope → return symbols.
	const baseSym = findSymbol(project, baseName);
	if (baseSym?.typeExpr === undefined) return [];
	if (baseSym.typeExpr.kind !== "named_type") return [];
	const typeName = baseSym.typeExpr.name.text.toLowerCase();

	// Find the type's scope (FB or struct).
	for (const child of project.children) {
		if (child.name.toLowerCase() === typeName) {
			const items: CompletionItem[] = [];
			for (const [, symbols] of child.symbols) {
				for (const sym of symbols) {
					items.push({
						label: sym.name,
						kind: lspKindForSymbol(sym),
						detail: humanKind(sym),
						sortText: `00_${sym.name}`,
						data: { source: "member", uri: sym.uri },
					});
				}
			}
			return items;
		}
	}
	return [];
}

function findSymbol(project: Scope, name: string): Symbol | undefined {
	const key = name.toLowerCase();
	for (const [, syms] of project.symbols) {
		for (const sym of syms) {
			if (sym.name.toLowerCase() === key) return sym;
		}
	}
	for (const child of project.children) {
		for (const [, syms] of child.symbols) {
			for (const sym of syms) {
				if (sym.name.toLowerCase() === key) return sym;
			}
		}
	}
	return undefined;
}

// ─── Default context ─────────────────────────────────────────────────

function addStaticReferenceItems(items: CompletionItem[], activeVendor?: Vendor): void {
	for (const entry of allEntries(activeVendor)) {
		items.push({
			label: entry.name,
			kind: lspKindForReference(entry),
			detail: humanKindForReference(entry),
			sortText: sortPrefixFor(entry) + entry.name,
			data: { source: "reference", refName: entry.name },
		});
	}
}

function addLocalSymbols(items: CompletionItem[], project: Scope, doc: Document, offset: number): void {
	const cursorScope = scopeAtOffset(project, doc, offset);
	// Walk parent chain, collecting unique names.
	const seen = new Set<string>();
	let scope: Scope | undefined = cursorScope;
	while (scope !== undefined) {
		for (const [, symbols] of scope.symbols) {
			for (const sym of symbols) {
				const key = sym.name.toLowerCase();
				if (seen.has(key)) continue;
				seen.add(key);
				items.push({
					label: sym.name,
					kind: lspKindForSymbol(sym),
					detail: humanKind(sym),
					sortText: `00_${sym.name}`,
					data: { source: "local", uri: sym.uri },
				});
			}
		}
		scope = scope.parent;
	}
}

// ─── Resolve (Microsoft lsp-sample two-phase pattern) ────────────────

/**
 * `completionItem/resolve` — Microsoft's lsp-sample two-phase pattern.
 * The initial list ships labels only (cheap). On focus / commit, the
 * client calls back with the original item; we add markdown
 * `documentation` from the reference catalog.
 */
export function resolveCompletion(
	item: CompletionItem,
	opts?: { showSource?: boolean; activeVendor?: Vendor },
): CompletionItem {
	const data = item.data as { source?: string; refName?: string } | undefined;
	if (data?.refName === undefined) return item;
	const entry = lookupRef(data.refName, opts?.activeVendor);
	if (entry === undefined) return item;
	return {
		...item,
		documentation: {
			kind: "markdown",
			value: renderHover(entry, {
				showSource: opts?.showSource,
				activeVendor: opts?.activeVendor,
			}),
		},
	};
}

// ─── Helpers ─────────────────────────────────────────────────────────

function sortPrefixFor(entry: ReferenceEntry): string {
	switch (entry.kind) {
		case "keyword":
			return "10_";
		case "data-type":
			return "20_";
		case "operator":
			return "30_";
		case "type-conversion":
			return "40_";
		case "pragma":
			return "50_";
		case "lifecycle-method":
			return "15_";
		case "standard-fb":
			// Common standard-library FBs (TON/CTU/R_TRIG/...) — ranked
			// just above data-types so they surface near concrete types
			// at completion time. Engineers reach for these constantly.
			return "18_";
	}
}

function lspKindForReference(entry: ReferenceEntry): CompletionItemKind {
	switch (entry.kind) {
		case "keyword":
			return CompletionItemKind.Keyword;
		case "data-type":
			return CompletionItemKind.Class;
		case "operator":
		case "type-conversion":
			return CompletionItemKind.Function;
		case "pragma":
			return CompletionItemKind.Keyword;
		case "lifecycle-method":
			return CompletionItemKind.Method;
		case "standard-fb":
			// Function blocks are class-shaped instantiables — same LSP
			// kind we use for user-defined FBs (see lspKindForSymbol).
			return CompletionItemKind.Class;
	}
}

function humanKindForReference(entry: ReferenceEntry): string {
	switch (entry.kind) {
		case "keyword":
			return "keyword";
		case "data-type":
			return "data type";
		case "operator":
			return "operator";
		case "type-conversion":
			return "type conversion";
		case "pragma":
			return "pragma";
		case "lifecycle-method":
			return "FB lifecycle method";
		case "standard-fb":
			return "standard function block";
	}
}

function lspKindForSymbol(sym: Symbol): CompletionItemKind {
	switch (sym.kind) {
		case "function_block":
			return CompletionItemKind.Class;
		case "program":
			return CompletionItemKind.Module;
		case "function":
			return CompletionItemKind.Function;
		case "method":
		case "interface_method":
			return CompletionItemKind.Method;
		case "action":
			return CompletionItemKind.Function;
		case "property":
		case "interface_property":
			return CompletionItemKind.Property;
		case "interface":
			return CompletionItemKind.Interface;
		case "namespace":
		case "gvl_block":
			return CompletionItemKind.Module;
		case "type":
			return CompletionItemKind.Struct;
		case "enum_value":
			return CompletionItemKind.EnumMember;
		case "struct_field":
			return CompletionItemKind.Field;
		case "var":
		case "method_param":
		case "gvl_var":
			return CompletionItemKind.Variable;
	}
}

function humanKind(sym: Symbol): string {
	return sym.kind.replace(/_/g, " ");
}
