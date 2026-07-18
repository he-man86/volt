/**
 * refs/remotes/volt/ide — the live IDE modelled as a git REMOTE-tracking branch, so it shows in the
 * graph as `volt/ide` (the IDE is literally a remote you fetch+merge on pull / push to on push). Each
 * commit's tree is the user's branch tree with ONLY `src/` swapped for the IDE's state, so the merge
 * never touches the scaffold. Living under refs/remotes/ means it's visible locally but never pushed to
 * a real origin. The optimistic-concurrency baseline (what the IDE last had) lives in the sidecar
 * (`sidecar.ts`, `.git/volt/ide-refs.json`).
 */
import { buildTree, commitTree, listTree, resolveRef, writeBlob, type IndexEntry } from "../git.js";
import { isTrackedPath } from "./extensions.js";
import type { MaterializedFile } from "./materialize.js";
import { SRC_DIR } from "../files.js";

export const RANGE = "refs/remotes/volt/ide";

export function voltIdeHead(gitDir: string): string | undefined {
	return resolveRef(gitDir, RANGE);
}

/**
 * Build the volt/ide tree = the IDE's current state under `src/`, plus the user's scaffold from HEAD.
 *
 * Tracked `src/` files (the IDE's items):
 *   - changed items      → the freshly fetched content (`ideFiles`)
 *   - unchanged items    → carried from the PARENT volt/ide tree (`parentIde`) — the IDE's last-known
 *                          content. NOT from HEAD: HEAD holds the USER's edits, and `/fetch` is incremental
 *                          (an item the IDE didn't touch is absent from `ideFiles`), so sourcing it from HEAD
 *                          would fold the user's un-pushed edit into the IDE baseline and strand it forever
 *                          (it would never diff as outgoing). A user-added item absent from `parentIde` is
 *                          correctly left out here, so it surfaces as outgoing and pushes to the IDE.
 *   - removed items      → dropped (`removedNames`)
 * Everything else — non-`src/` scaffold and any non-tracked `src/` file — is carried from HEAD (the user's
 * side), so the merge only ever touches the IDE axis. On init `parentIde` is undefined and `ideFiles` is the
 * whole IDE, so the parent loop is simply empty.
 */
export function buildVoltIdeTree(
	gitDir: string,
	headCommit: string | undefined,
	parentIde: string | undefined,
	ideFiles: readonly MaterializedFile[],
	removedNames: readonly string[],
): string {
	const entries: IndexEntry[] = [];
	const seen = new Set<string>();
	const add = (e: IndexEntry): void => {
		if (!seen.has(e.path)) {
			seen.add(e.path);
			entries.push(e);
		}
	};
	const srcRel = (path: string): string | null => (path.startsWith(`${SRC_DIR}/`) ? path.slice(SRC_DIR.length + 1) : null);
	const replaced = new Set(ideFiles.map((f) => f.path));
	const removed = new Set(removedNames);

	// Changed IDE items — fresh content from the fetch.
	for (const f of ideFiles) add({ mode: "100644", sha: writeBlob(gitDir, f.content), path: `${SRC_DIR}/${f.path}` });

	// Unchanged IDE items — from the previous volt/ide tree (the IDE's last-known content, not the user's HEAD).
	if (parentIde !== undefined) {
		for (const e of listTree(gitDir, parentIde)) {
			const rel = srcRel(e.path);
			if (rel !== null && isTrackedPath(rel) && !replaced.has(rel) && !removed.has(rel)) add(e);
		}
	}

	// Scaffold + non-tracked src/ files — from HEAD (the user's side; the merge leaves these untouched).
	if (headCommit !== undefined) {
		for (const e of listTree(gitDir, headCommit)) {
			const rel = srcRel(e.path);
			if (rel === null || !isTrackedPath(rel)) add(e);
		}
	}

	return buildTree(gitDir, entries);
}

export function commitVoltIde(gitDir: string, treeSha: string, parent: string | undefined, message: string): string {
	return commitTree(gitDir, treeSha, parent !== undefined ? [parent] : [], message);
}
