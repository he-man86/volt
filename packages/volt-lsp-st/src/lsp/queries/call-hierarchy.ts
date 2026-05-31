/**
 * `prepareCallHierarchy` / `callHierarchy/incomingCalls` /
 * `callHierarchy/outgoingCalls`.
 *
 * Algorithm:
 *   - prepare: at position, find the identifier; if it resolves to a
 *     method / function / action / FB, return a CallHierarchyItem
 *     representing that callable.
 *   - incomingCalls: scan every body in workspace; identifier
 *     occurrences classified as `isCall` whose name matches the item
 *     contribute as incoming calls (the body's owning unit is the
 *     caller).
 *   - outgoingCalls: scan the item's own body; identifier occurrences
 *     classified as `isCall` are outgoing.
 */
import { lspSymbolKindFor } from "../capabilities.js";
import { offsetFromPosition, rangeFromSpan } from "../position.js";
import { lookup } from "../../semantic/resolver.js";
import { findIdentifiersByName } from "../../body/index.js";
import type { Scope, Symbol } from "../../semantic/symbol-table.js";
import type { Location, LspSymbolKindValue, Position, Range } from "../types.js";
import type { Document, Workspace } from "../workspace.js";
import { findIdentifierAtOffset } from "./find-identifier.js";
import type {
	Action,
	BodySpan,
	Function as FunctionAST,
	FunctionBlock,
	Method,
	Program,
	TopLevel,
} from "../../parser/ast.js";

export interface CallHierarchyItem {
	name: string;
	kind: LspSymbolKindValue;
	uri: string;
	range: Range;
	selectionRange: Range;
}

export interface CallHierarchyIncomingCall {
	from: CallHierarchyItem;
	fromRanges: Range[];
}

export interface CallHierarchyOutgoingCall {
	to: CallHierarchyItem;
	fromRanges: Range[];
}

export interface PrepareArgs {
	doc: Document;
	position: Position;
	project: Scope;
}

export function prepareCallHierarchy(args: PrepareArgs): CallHierarchyItem[] {
	const { doc, position, project } = args;
	const offset = offsetFromPosition(doc.source, position);
	if (offset < 0) return [];
	const idToken = findIdentifierAtOffset(doc.parseResult, offset);
	if (idToken === undefined) return [];
	const r = lookup(project, idToken.text);
	if (r === undefined) return [];
	const sym = r.symbol;
	if (!isCallable(sym)) return [];
	return [
		{
			name: sym.name,
			kind: lspSymbolKindFor(sym.kind),
			uri: sym.uri.length > 0 ? sym.uri : doc.uri,
			range: rangeFromSpan(sym.declarationSpan),
			selectionRange: rangeFromSpan(sym.span),
		},
	];
}

export interface IncomingArgs {
	workspace: Workspace;
	item: CallHierarchyItem;
}

export function incomingCalls(args: IncomingArgs): CallHierarchyIncomingCall[] {
	const { workspace, item } = args;
	const callers = new Map<string, { caller: CallHierarchyItem; ranges: Range[] }>();

	for (const doc of workspace.allDocuments()) {
		for (const unit of doc.parseResult.units) {
			const body = bodyOf(unit);
			if (body === undefined) continue;
			const model = doc.bodyModels.get(body);
			if (model === undefined) continue;
			const occs = findIdentifiersByName(model, item.name).filter((o) => o.isCall);
			if (occs.length === 0) continue;
			const callerItem = makeItemForUnit(doc.uri, unit);
			if (callerItem === undefined) continue;
			const key = `${callerItem.uri}#${callerItem.name}`;
			const entry = callers.get(key) ?? { caller: callerItem, ranges: [] };
			for (const o of occs) entry.ranges.push(rangeFromSpan(o.span));
			callers.set(key, entry);
		}
	}

	return [...callers.values()].map((e) => ({
		from: e.caller,
		fromRanges: e.ranges,
	}));
}

export interface OutgoingArgs {
	workspace: Workspace;
	project: Scope;
	item: CallHierarchyItem;
}

export function outgoingCalls(args: OutgoingArgs): CallHierarchyOutgoingCall[] {
	const { workspace, project, item } = args;
	// Find the body of the item by uri + name
	const doc = workspace.getDocument(item.uri);
	if (doc === undefined) return [];

	let body: BodySpan | undefined;
	let containingUnit: TopLevel | undefined;
	for (const unit of doc.parseResult.units) {
		if ("name" in unit && typeof unit.name === "object" && "text" in unit.name &&
			unit.name.text === item.name) {
			body = bodyOf(unit);
			containingUnit = unit;
			break;
		}
	}
	if (body === undefined || containingUnit === undefined) return [];

	const model = doc.bodyModels.get(body);
	if (model === undefined) return [];
	const occs = model.calls.filter((c) => {
		const ref = model.identifiers.find((i) => i.span.start === c.span.start && i.name === c.name);
		return ref !== undefined && !ref.isMemberAccess;
	});
	const targets = new Map<string, { to: CallHierarchyItem; ranges: Range[] }>();
	for (const o of occs) {
		const r = lookup(project, o.name);
		if (r === undefined || !isCallable(r.symbol)) continue;
		// The target's defining doc — we don't yet track per-symbol URI,
		// so we synthesize an item using the project-wide name; the
		// `uri` field falls back to the calling document's URI when
		// unknown. Better than nothing for navigation.
		const targetUri = findUriForUnitByName(workspace, r.symbol.name);
		const targetItem: CallHierarchyItem = {
			name: r.symbol.name,
			kind: lspSymbolKindFor(r.symbol.kind),
			uri: targetUri ?? doc.uri,
			range: rangeFromSpan(r.symbol.declarationSpan),
			selectionRange: rangeFromSpan(r.symbol.span),
		};
		const key = `${targetItem.uri}#${targetItem.name}`;
		const entry = targets.get(key) ?? { to: targetItem, ranges: [] };
		entry.ranges.push(rangeFromSpan(o.span));
		targets.set(key, entry);
	}
	return [...targets.values()].map((e) => ({ to: e.to, fromRanges: e.ranges }));
}

// ─── helpers ─────────────────────────────────────────────────────────

function isCallable(sym: Symbol): boolean {
	return (
		sym.kind === "function_block" ||
		sym.kind === "function" ||
		sym.kind === "method" ||
		sym.kind === "action" ||
		sym.kind === "program"
	);
}

function bodyOf(unit: TopLevel): BodySpan | undefined {
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

function makeItemForUnit(uri: string, unit: TopLevel): CallHierarchyItem | undefined {
	if (
		unit.kind === "function_block" ||
		unit.kind === "program" ||
		unit.kind === "function" ||
		unit.kind === "method" ||
		unit.kind === "action"
	) {
		const u = unit as FunctionBlock | Program | FunctionAST | Method | Action;
		return {
			name: u.name.text,
			kind: lspSymbolKindFor(u.kind),
			uri,
			range: rangeFromSpan(u.span),
			selectionRange: rangeFromSpan(u.name.span),
		};
	}
	return undefined;
}

function findUriForUnitByName(workspace: Workspace, name: string): string | undefined {
	const target = name.toLowerCase();
	for (const doc of workspace.allDocuments()) {
		for (const unit of doc.parseResult.units) {
			if (
				"name" in unit &&
				typeof unit.name === "object" &&
				"text" in unit.name &&
				unit.name.text.toLowerCase() === target
			) {
				return doc.uri;
			}
		}
	}
	return undefined;
}
