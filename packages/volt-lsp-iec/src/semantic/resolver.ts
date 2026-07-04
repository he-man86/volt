/**
 * Name resolution — answer "where is this name defined?"
 *
 * Walks the scope tree built by `symbol-table-build.ts` outward from
 * a starting scope toward the project root: `lookup` returns the FIRST
 * match (innermost shadow wins) — use for go-to-definition.
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
 */
export function lookup(start: Scope, name: string): LookupResult | undefined {
	let cur: Scope | undefined = start;
	while (cur !== undefined) {
		// Check this scope AND its EXTENDS base chain (inherited members) before moving outward.
		const seen = new Set<Scope>();
		let inh: Scope | undefined = cur;
		while (inh !== undefined && !seen.has(inh)) {
			seen.add(inh);
			const hits = lookupLocal(inh, name);
			if (hits.length > 0) return { symbol: hits[0] as Symbol, foundIn: inh };
			inh = inh.baseScope;
		}
		cur = cur.parent;
	}
	return undefined;
}
