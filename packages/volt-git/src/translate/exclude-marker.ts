/**
 * Volt ground-truth markers (legacy).
 *
 * The bridge now OMITS objects with no compiler ground truth (excluded-from-build, dead/uncompiled code)
 * from `/fetch` entirely, so `pull` no longer writes these markers. They are kept only so `push` can STRIP
 * a leading marker off any file pulled before that change, so no Volt marker reaches the IDE's stored source.
 */
export const EXCLUDE_MARKER = "(* @volt-exclude-from-build *)";
export const UNCOMPILED_MARKER = "(* @volt-uncompiled *)";

/** Remove a leading Volt marker line (exclude OR uncompiled) — used on push so no marker reaches the IDE. */
export function stripExcludeMarker(content: string): string {
	if (!content.startsWith(EXCLUDE_MARKER) && !content.startsWith(UNCOMPILED_MARKER)) return content;
	const nl = content.indexOf("\n");
	return nl >= 0 ? content.slice(nl + 1) : "";
}
