/**
 * Exclude-from-build marker.
 *
 * A CODESYS object can be "excluded from build" — never compiled, so its diagnostics have no ground truth.
 * Rather than track that in a side manifest, `volt pull` records it IN the file: a leading
 * `(* @volt-exclude-from-build *)` ST comment on the excluded source file (self-contained, diffable,
 * mirrors the per-object property in the IDE). The LSP reads it to skip diagnostics.
 *
 * The marker is Volt-managed, not real source: push STRIPS it before sending to the bridge, so it never
 * reaches the IDE's stored source (and won't duplicate on the next pull). Only source-kind files carry it
 * (reference kinds — .library/.visualization — are never analyzed and are read-only).
 */
export const EXCLUDE_MARKER = "(* @volt-exclude-from-build *)";
/** Dead-code marker: a project POU CODESYS never compiled (uncalled). Like the exclude marker it means "no
 *  compiler ground truth" (the LSP skips diagnostics), but it's a DISTINCT property — the object isn't
 *  IDE-excluded, it's just unreachable, and it stays real, pushable source. Only set on a verbose pull/harvest. */
export const UNCOMPILED_MARKER = "(* @volt-uncompiled *)";

const SOURCE_EXTS = new Set([".fb", ".prg", ".fun", ".itf", ".struct", ".enum", ".union", ".alias", ".gvl"]);

/** True for a materialized source-kind path (the kinds the LSP analyzes and that can be pushed). */
export function isSourceFile(path: string): boolean {
	const dot = path.lastIndexOf(".");
	return dot >= 0 && SOURCE_EXTS.has(path.slice(dot).toLowerCase());
}

/** Prepend the exclude marker (idempotent). */
export function addExcludeMarker(content: string): string {
	return content.startsWith(EXCLUDE_MARKER) ? content : `${EXCLUDE_MARKER}\n${content}`;
}

/** Prepend the uncompiled (dead-code) marker (idempotent). */
export function addUncompiledMarker(content: string): string {
	return content.startsWith(UNCOMPILED_MARKER) ? content : `${UNCOMPILED_MARKER}\n${content}`;
}

/** Remove a leading Volt marker line (exclude OR uncompiled) — used on push so no marker reaches the IDE. */
export function stripExcludeMarker(content: string): string {
	if (!content.startsWith(EXCLUDE_MARKER) && !content.startsWith(UNCOMPILED_MARKER)) return content;
	const nl = content.indexOf("\n");
	return nl >= 0 ? content.slice(nl + 1) : "";
}
