/**
 * Idempotent `.gitignore` management.
 *
 * The agent owns several blocks the workspace's `.gitignore` must
 * carry (Volt state, bun/node tooling). Each block is declared as a
 * `GitignoreEntry`; `ensureGitignoreEntries` checks each independently
 * and appends only the missing ones, preserving any existing user
 * content. Safe to call repeatedly on the same workspace.
 *
 * Single source of truth lives in `snapshot.ts` — the `ensureGitignore`
 * helper there is a thin caller of this module that ships the canonical
 * entry list. Add a new tracked surface (e.g. `.turbo/`) by adding a
 * line to that list, NOT by writing a parallel helper.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** One labelled block in the workspace `.gitignore`. */
export interface GitignoreEntry {
	/** Header line written above the patterns (without the `#` prefix). */
	readonly comment: string;
	/** Lines to add. Conventionally one pattern per entry. */
	readonly patterns: readonly string[];
	/** Regex that detects "this block is already present" — checked
	 *  against the existing file contents. Should match any of the
	 *  block's patterns on its own line. */
	readonly matcher: RegExp;
}

/**
 * Ensure every entry in `entries` is present in the workspace's
 * `.gitignore`. Missing entries are appended at the end of the file
 * (creating the file if absent). Existing entries are left alone —
 * each entry's `matcher` decides "already present."
 *
 * Atomic per entry: if two entries are missing, both append; if one
 * is missing, only that one appends. No reordering of existing content.
 */
export function ensureGitignoreEntries(
	workspaceRoot: string,
	entries: readonly GitignoreEntry[],
): void {
	if (entries.length === 0) return;
	const path = join(workspaceRoot, ".gitignore");

	if (!existsSync(path)) {
		const initial = entries.map(renderEntry).join("\n");
		writeFileSync(path, initial, "utf-8");
		return;
	}

	let existing = readFileSync(path, "utf-8");
	let appended = false;

	for (const entry of entries) {
		if (entry.matcher.test(existing)) continue;
		const separator = existing.endsWith("\n") ? "\n" : "\n\n";
		existing = existing + separator + renderEntry(entry);
		appended = true;
	}

	if (appended) writeFileSync(path, existing, "utf-8");
}

function renderEntry(entry: GitignoreEntry): string {
	return `# ${entry.comment}\n${entry.patterns.join("\n")}\n`;
}
