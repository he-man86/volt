/**
 * `prepareTypeHierarchy` / `typeHierarchy/supertypes` /
 * `typeHierarchy/subtypes`.
 *
 * For PLC code:
 *   - supertypes: FB's EXTENDS chain + IMPLEMENTS list; Interface's
 *     EXTENDS list.
 *   - subtypes: every FB/Interface in the workspace that names the
 *     target in its EXTENDS or IMPLEMENTS clause.
 */
import { lspSymbolKindFor } from "../capabilities.js";
import { offsetFromPosition, rangeFromSpan } from "../position.js";
import { lookup } from "../../semantic/resolver.js";
import type { Scope, Symbol } from "../../semantic/symbol-table.js";
import type { LspSymbolKindValue, Position, Range } from "../types.js";
import type { Document, Workspace } from "../workspace.js";
import { findIdentifierAtOffset } from "./find-identifier.js";
import type {
	FunctionBlock,
	Interface,
	TopLevel,
} from "../../parser/ast.js";

export interface TypeHierarchyItem {
	name: string;
	kind: LspSymbolKindValue;
	uri: string;
	range: Range;
	selectionRange: Range;
}

export interface PrepareArgs {
	doc: Document;
	position: Position;
	project: Scope;
}

export function prepareTypeHierarchy(args: PrepareArgs): TypeHierarchyItem[] {
	const { doc, position, project } = args;
	const offset = offsetFromPosition(doc.source, position);
	if (offset < 0) return [];
	const idToken = findIdentifierAtOffset(doc.parseResult, offset);
	if (idToken === undefined) return [];
	const r = lookup(project, idToken.text);
	if (r === undefined) return [];
	const sym = r.symbol;
	if (sym.kind !== "function_block" && sym.kind !== "interface") return [];
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

export interface HierarchyArgs {
	workspace: Workspace;
	project: Scope;
	item: TypeHierarchyItem;
}

export function supertypes(args: HierarchyArgs): TypeHierarchyItem[] {
	const { workspace, project, item } = args;
	const unit = findUnitByName(workspace, item.name);
	if (unit === undefined) return [];
	const out: TypeHierarchyItem[] = [];

	const names = new Set<string>();
	if (unit.unit.kind === "function_block") {
		const fb = unit.unit;
		if (fb.extends !== undefined) names.add(fb.extends.text);
		if (fb.implements !== undefined) {
			for (const i of fb.implements) names.add(i.text);
		}
	} else if (unit.unit.kind === "interface") {
		const iface = unit.unit;
		if (iface.extends !== undefined) {
			for (const e of iface.extends) names.add(e.text);
		}
	}

	for (const name of names) {
		const r = lookup(project, name);
		if (r === undefined) continue;
		const found = findUnitByName(workspace, r.symbol.name);
		if (found === undefined) continue;
		const tgt = makeTypeItem(found.uri, found.unit);
		if (tgt !== undefined) out.push(tgt);
	}
	return out;
}

export function subtypes(args: HierarchyArgs): TypeHierarchyItem[] {
	const { workspace, item } = args;
	const target = item.name.toLowerCase();
	const out: TypeHierarchyItem[] = [];
	for (const doc of workspace.allDocuments()) {
		for (const unit of doc.parseResult.units) {
			if (unit.kind === "function_block") {
				const fb = unit as FunctionBlock;
				const matches =
					fb.extends?.text.toLowerCase() === target ||
					(fb.implements?.some((i) => i.text.toLowerCase() === target) ?? false);
				if (matches) {
					const tgt = makeTypeItem(doc.uri, fb);
					if (tgt !== undefined) out.push(tgt);
				}
			} else if (unit.kind === "interface") {
				const iface = unit as Interface;
				if (iface.extends?.some((e) => e.text.toLowerCase() === target) ?? false) {
					const tgt = makeTypeItem(doc.uri, iface);
					if (tgt !== undefined) out.push(tgt);
				}
			}
		}
	}
	return out;
}

function makeTypeItem(uri: string, unit: TopLevel): TypeHierarchyItem | undefined {
	if (unit.kind === "function_block" || unit.kind === "interface") {
		return {
			name: unit.name.text,
			kind: lspSymbolKindFor(unit.kind),
			uri,
			range: rangeFromSpan(unit.span),
			selectionRange: rangeFromSpan(unit.name.span),
		};
	}
	return undefined;
}

function findUnitByName(
	workspace: Workspace,
	name: string,
): { uri: string; unit: TopLevel } | undefined {
	const target = name.toLowerCase();
	for (const doc of workspace.allDocuments()) {
		for (const unit of doc.parseResult.units) {
			if (
				"name" in unit &&
				typeof unit.name === "object" &&
				"text" in unit.name &&
				unit.name.text.toLowerCase() === target
			) {
				return { uri: doc.uri, unit };
			}
		}
	}
	return undefined;
}
