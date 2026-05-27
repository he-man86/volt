/**
 * Find the most specific scope containing a given byte offset within
 * a document. Shared between definition, hover, etc.
 *
 * The project scope is the fallback — if the offset is outside any
 * top-level unit, we resolve from project root.
 */
import type { Scope } from "../../semantic/symbol-table.js";
import type { Document } from "../workspace.js";

export function scopeAtOffset(project: Scope, doc: Document, offset: number): Scope {
	for (const unit of doc.parseResult.units) {
		if (offset < unit.span.start || offset > unit.span.end) continue;
		if ("name" in unit && typeof unit.name === "object" && "text" in unit.name) {
			const target = unit.name.text.toLowerCase();
			const childScope = project.children.find(
				(c) => c.name.toLowerCase() === target,
			);
			if (childScope !== undefined) return childScope;
		}
		return project;
	}
	return project;
}
