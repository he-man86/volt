/**
 * Workspace-tree assertion helpers used by scenarios.
 *
 * Scenarios assert on USER-FACING behavior: which files appear in
 * the workspace, what they contain, what's missing. Engine internals
 * (state.json shape, git blob SHAs, snapshot tree entries) are
 * deliberately not exposed here — if a scenario starts caring about
 * those, the right answer is usually "no, assert on the workspace
 * shape instead."
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Return every relative path under `workspace`, excluding `.volt/`
 * (the snapshot) and `.git/` (the engineer's own repo if any).
 * Paths use forward slashes regardless of host OS.
 */
export function listWorkspace(workspace: string): string[] {
	const out: string[] = [];
	function walk(dir: string): void {
		let entries: import("node:fs").Dirent[];
		try {
			entries = readdirSync(dir, { withFileTypes: true }) as import("node:fs").Dirent[];
		} catch {
			return;
		}
		for (const e of entries) {
			if (dir === workspace && (e.name === ".volt" || e.name === ".git")) continue;
			const full = join(dir, e.name);
			if (e.isDirectory()) {
				walk(full);
			} else if (e.isFile()) {
				out.push(relative(workspace, full).split(sep).join("/"));
			}
		}
	}
	walk(workspace);
	out.sort();
	return out;
}

/** Read a file relative to the workspace root. Throws on missing —
 *  callers should `expect(workspaceHas(...))` first if they want a
 *  friendlier error. */
export function readWorkspace(workspace: string, relPath: string): string {
	return readFileSync(join(workspace, relPath), "utf-8");
}

/** True iff a path exists in the workspace (file or directory). */
export function workspaceHas(workspace: string, relPath: string): boolean {
	return existsSync(join(workspace, relPath));
}

/** True iff a path exists AND is a file (not a directory). */
export function workspaceHasFile(workspace: string, relPath: string): boolean {
	const abs = join(workspace, relPath);
	if (!existsSync(abs)) return false;
	try {
		return statSync(abs).isFile();
	} catch {
		return false;
	}
}

/**
 * Group every workspace file by extension. Useful for high-level
 * scenarios like "after a fresh pull the workspace contains 47
 * libraries and 122 devices" — assert on the counts without listing
 * every file by name.
 */
export function workspaceCountByExtension(workspace: string): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const path of listWorkspace(workspace)) {
		const dot = path.lastIndexOf(".");
		const ext = dot >= 0 ? path.slice(dot) : "(no-ext)";
		counts[ext] = (counts[ext] ?? 0) + 1;
	}
	return counts;
}
