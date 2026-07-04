/**
 * Exclude-from-build marker.
 *
 * A CODESYS object can be "excluded from build" — the compiler never touches it, so there's no ground
 * truth for its diagnostics (it may reference symbols that only exist once it's built back in). The LSP
 * must skip semantic diagnostics on such files.
 *
 * Rather than a side manifest, `volt pull` records this in the file itself: it prepends a leading
 * `(* @volt-exclude-from-build *)` ST comment to an excluded source file — self-contained, diffable, and
 * mirroring how CODESYS shows the exclusion as a per-object property. (The marker is Volt-managed: push
 * strips it, so it never reaches the IDE's stored source.) The LSP reads it from the file content.
 */
export const EXCLUDE_MARKER = "(* @volt-exclude-from-build *)"

/** Dead-code marker: a project POU CODESYS never compiled (uncalled). Same consequence as the exclude marker —
 *  no compiler ground truth, so the LSP skips its semantic diagnostics — but a DISTINCT property (the object
 *  isn't IDE-excluded; it's just unreachable). Set only on a verbose pull/harvest, which has the build result. */
export const UNCOMPILED_MARKER = "(* @volt-uncompiled *)"

/** True when the file's IDE object is excluded from build (its leading comment is the marker). */
export function isExcludedFromBuild(source: string): boolean {
	return source.trimStart().startsWith(EXCLUDE_MARKER)
}

/** True when the file is dead code CODESYS never compiled (leading uncompiled marker). */
export function isUncompiled(source: string): boolean {
	return source.trimStart().startsWith(UNCOMPILED_MARKER)
}

/** True when the file has NO compiler ground truth — either explicitly excluded from build OR dead/uncompiled
 *  code. Semantic diagnostics on such files are suppressed from the precision count. */
export function hasNoBuildGroundTruth(source: string): boolean {
	return isExcludedFromBuild(source) || isUncompiled(source)
}
