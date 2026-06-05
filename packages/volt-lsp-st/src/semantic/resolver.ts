/**
 * Name resolution — answer "where is this name defined?"
 *
 * Walks the scope tree built by `symbol-table-build.ts` outward from
 * a starting scope toward the project root. Two flavors:
 *
 *   - `lookup` — return the FIRST match (innermost shadow wins).
 *     Use for go-to-definition.
 *   - `lookupAll` — return EVERY match up the chain. Use for
 *     inheritance walks (e.g. resolving `super.x()` candidates).
 *
 * Identifier comparison is case-insensitive (PLC convention).
 *
 * Reference/usage scanning (find the identifier OCCURRENCES inside
 * a body, not the definition) lives in `identifier-scan.ts`. The
 * two operations are deliberately separated because they have
 * different consumers — most LSP queries need only one of them.
 */
import { lookupLocal, type Scope, type Symbol } from "./symbol-table.js";

export interface LookupResult {
	symbol: Symbol;
	/** The scope where we found it (innermost match if it shadows). */
	foundIn: Scope;
}

/**
 * Walk parent chain from `start` outward. Returns the FIRST match
 * (innermost shadow wins) and the scope it was defined in. Returns
 * undefined if not found anywhere up to the root.
 *
 * For find-all-matches semantics (overloads / inheritance), call
 * `lookupAll` instead.
 */
export function lookup(start: Scope, name: string): LookupResult | undefined {
	let cur: Scope | undefined = start;
	while (cur !== undefined) {
		const hits = lookupLocal(cur, name);
		if (hits.length > 0) {
			return { symbol: hits[0] as Symbol, foundIn: cur };
		}
		cur = cur.parent;
	}
	return undefined;
}

/** Like `lookup` but returns ALL matches up the chain. Useful for inheritance lookups. */
export function lookupAll(start: Scope, name: string): LookupResult[] {
	const out: LookupResult[] = [];
	let cur: Scope | undefined = start;
	while (cur !== undefined) {
		const hits = lookupLocal(cur, name);
		for (const s of hits) out.push({ symbol: s, foundIn: cur });
		cur = cur.parent;
	}
	return out;
}
