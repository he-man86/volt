/**
 * Utilities for the `(* @volt-graphical: LANG *)` marker that Volt
 * emits immediately before each graphical-originated unit inlined into
 * a parent `.st` file.
 *
 * Marker format (one line, no leading indent):
 *
 *   (* @volt-graphical: FBD *)
 *   ACTION P10_CyclicMotion
 *   ...
 *   END_ACTION
 *
 * The marker is a valid IEC 61131-3 comment so it is harmless to the
 * bridge's StSplitter parser when a file is pushed back. `stripGraphicalUnits`
 * removes the child graphical blocks before push so the bridge only receives
 * the textual (ST-authored) portions.
 */

/** Matches the marker comment on its own line, capturing the language token. */
export const GRAPHICAL_MARKER_RE = /^\(\* @volt-graphical: (\w+) \*\)$/m;

/**
 * Strip graphical-unit blocks from a `.st` file's content before pushing
 * to the bridge.
 *
 * Two shapes are handled:
 *
 * 1. **Child graphical units** — blocks appended after the main ST body,
 *    preceded by a newline separator:
 *
 *      ...END_FUNCTION_BLOCK\n
 *      \n
 *      (* @volt-graphical: SFC *)\n
 *      ACTION P10_CyclicMotion\n
 *      ...\n
 *      END_ACTION\n
 *
 *    The entire `\n(* @volt-graphical: ... *)\n...\nEND_WORD\n` block is
 *    removed; only the ST parent body remains.
 *
 * 2. **Top-level graphical POUs** — file starts with the marker line (no
 *    preceding `\n`):
 *
 *      (* @volt-graphical: CFC *)\n
 *      FUNCTION_BLOCK MMT\n
 *      ...
 *
 *    Only the marker LINE is stripped; the declaration body is sent to the
 *    bridge so VAR-section edits can propagate.
 */
/**
 * Strip graphical-unit blocks from `.st` file content before pushing.
 *
 * Input MUST use LF line endings (call on raw blob content, before
 * any CRLF denormalization). Returns LF-normalized output.
 *
 * Two shapes:
 * 1. **Child graphical units** — entire `\n(* @volt-graphical: LANG *)\n…\nEND_WORD\n`
 *    block is removed; only the ST parent body remains.
 * 2. **Top-level graphical POUs** — only the marker LINE at position 0
 *    is stripped; the declaration body (VAR sections) is preserved so
 *    the bridge can pick up declaration edits.
 */
export function stripGraphicalUnits(content: string): string {
	// Normalize to LF so the regex works regardless of caller line endings.
	const lf = content.replace(/\r\n/g, "\n");
	// Remove child graphical-unit blocks appended after the main ST body.
	let result = lf.replace(
		/\n\(\* @volt-graphical: \w+ \*\)\n[\s\S]*?\nEND_\w+\n?/g,
		"\n",
	);
	// Strip the marker line if the file starts with one (top-level graphical POU).
	result = result.replace(/^\(\* @volt-graphical: \w+ \*\)\n/, "");
	return result.trimEnd() + "\n";
}
