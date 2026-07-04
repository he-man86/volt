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
import { lookupLocal } from "../../semantic/symbol-table.js";
import { inferExprType, typeExprToInferred } from "../../semantic/type-infer.js";
import { offsetFromPosition } from "../position.js";
import type { Document } from "../workspace.js";
import { scopeAtOffset } from "../scope-at.js";
import { vgBodyAtOffset } from "./vg/shared.js";
import { enclosingCallee, resolveCallParams } from "./vg/calls.js";

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
	| { kind: "member-access"; basePath: string[] }; // after `<a>.<b>.` → ["a","b"]

function detectContext(source: string, offset: number): CursorContext {
	// Look back from the cursor over the current line, ignoring leading whitespace.
	const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
	const prefix = source.slice(lineStart, offset);

	// Pragma attribute: inside `{attribute '...` (no closing quote yet).
	if (/\{\s*attribute\s+'[^']*$/i.test(prefix)) {
		return { kind: "pragma-attribute" };
	}

	// Member access: a chain `<a>.<b>.` (any depth) with an optional partial member being typed.
	const member = /([A-Za-z_][A-Za-z0-9_]*(?:\s*\.\s*[A-Za-z_][A-Za-z0-9_]*)*)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)?$/.exec(prefix);
	if (member !== null && member[1] !== undefined) {
		return { kind: "member-access", basePath: member[1].split(/\s*\.\s*/) };
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
		return memberCompletions(context.basePath, scopeAtOffset(args.project, args.doc, offset), args.project);
	}

	// Default: static reference items + local symbols.
	const items: CompletionItem[] = [];
	// VG: when the cursor is inside an `inst(… )` / `FN(… )` argument list,
	// offer the callee's pin/parameter names first (`PIN := `).
	if (vgBodyAtOffset(args.doc.bodyModels, offset) !== undefined) {
		addVgPinCompletions(items, args, offset);
	}
	addStaticReferenceItems(items, args.activeVendor);
	addLocalSymbols(items, args.project, args.doc, offset);
	return items;
}

function addVgPinCompletions(items: CompletionItem[], args: CompletionArgs, offset: number): void {
	const callee = enclosingCallee(args.doc.source, offset);
	if (callee === undefined) return;
	const scope = scopeAtOffset(args.project, args.doc, offset);
	const resolved = resolveCallParams(args.project, scope, callee);
	if (resolved === undefined) return;
	for (const p of resolved.params) {
		items.push({
			label: p.name,
			kind: CompletionItemKind.Field,
			detail: `pin : ${p.type}`,
			insertText: (args.snippetSupport ?? true) ? `${p.name} := ` : p.name,
			insertTextFormat: InsertTextFormat.PlainText,
			sortText: `00_${p.name}`,
		});
	}
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

const NO_SPAN = { start: 0, end: 0, startLine: 0, startCol: 0, endLine: 0, endCol: 0 };

/** Members offered after a member chain `<a>.<b>.` — resolves the chain to the final type's scope through
 *  the shared inference service (any depth), then lists that type's members. */
function memberCompletions(basePath: string[], scope: Scope, project: Scope): CompletionItem[] {
	if (basePath.length === 0) return [];
	// Resolve the base ident in the local scope, then walk each further member through its type's scope.
	let t = inferExprType({ kind: "ident_expr", name: basePath[0]!, span: NO_SPAN }, scope, project);
	for (let i = 1; i < basePath.length; i++) {
		if (t.scope === undefined) return [];
		const m = lookupLocal(t.scope, basePath[i]!)[0];
		if (m?.typeExpr === undefined) return [];
		t = typeExprToInferred(m.typeExpr, project);
	}
	if (t.scope === undefined) return [];
	const items: CompletionItem[] = [];
	for (const [, symbols] of t.scope.symbols) {
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
	// Bare-accessible enum members (`StateAutomatic` of a non-qualified_only enum) are global constants off the
	// parent chain — offer them too (st-nav-chains).
	for (const child of project.children) {
		if (child.kind !== "enum" || child.qualifiedOnly === true) continue;
		for (const [, symbols] of child.symbols) {
			for (const sym of symbols) {
				const key = sym.name.toLowerCase();
				if (seen.has(key)) continue;
				seen.add(key);
				items.push({
					label: sym.name,
					kind: lspKindForSymbol(sym),
					detail: humanKind(sym),
					sortText: `01_${sym.name}`,
					data: { source: "enum-const", uri: sym.uri },
				});
			}
		}
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
		case "standard-function":
			return "35_"; // stdlib functions (LEN/CONCAT/…) — rank alongside operators
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
		case "standard-function":
			return CompletionItemKind.Function;
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
		case "standard-function":
			return "standard function";
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
