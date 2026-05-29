/**
 * Shared helpers for CLI scripts that need to poke at a temp
 * workspace produced by `volt init` / `volt pull`. Underscore prefix
 * to mark "internal to the CLI directory" — not part of any public
 * surface.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Walk a workspace tree and return the first file whose basename
 * matches. Skips `.volt/` (snapshot bare repo) and `.git/`. Used to
 * locate POU files that `volt pull` placed wherever the IDE has
 * them in the project tree — most importantly `PLC_PRG.st`, which
 * the recorder + debug-push-one need to OVERWRITE in place (writing
 * to root creates a ghost POU that volt push silently no-ops on
 * because the name already exists at a different path).
 *
 * Returns the absolute path or undefined when nothing matches.
 */
export function findExistingFile(root: string, basename: string): string | undefined {
	let found: string | undefined;
	function walk(dir: string): void {
		if (found !== undefined) return;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.name === ".volt" || entry.name === ".git") continue;
			const full = join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.isFile() && entry.name === basename) {
				found = full;
				return;
			}
		}
	}
	walk(root);
	return found;
}
