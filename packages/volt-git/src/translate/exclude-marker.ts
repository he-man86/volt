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

/** Remove a leading exclude-marker line — used on push so the marker never reaches the IDE. */
export function stripExcludeMarker(content: string): string {
	if (!content.startsWith(EXCLUDE_MARKER)) return content;
	const nl = content.indexOf("\n");
	return nl >= 0 ? content.slice(nl + 1) : "";
}
