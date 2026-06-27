/**
 * refs/volt/ide — the live IDE modelled as a hidden ref inside the project repo. Each commit's tree is
 * the user's branch tree with ONLY `src/` swapped for the IDE's state, so `git merge refs/volt/ide`
 * never touches the scaffold. The optimistic-concurrency baseline (what the IDE last had) lives in the
 * `.volt/ide-refs.json` sidecar (gitignored, machine-local).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildTree, commitTree, listTree, resolveRef, writeBlob, type IndexEntry } from "../git/plumbing.js";
import { isTrackedPath } from "../registry/extensions.js";
import type { MaterializedFile } from "../translate/materialize.js";
import { SRC_DIR } from "../workspace/files.js";
import { workspacePaths } from "../config/workspace.js";

export const RANGE = "refs/volt/ide";

export function voltIdeHead(gitDir: string): string | undefined {
	return resolveRef(gitDir, RANGE);
}

/**
 * Build the volt/ide tree: the IDE's materialized `src/` files, plus the user's scaffold and any
 * non-tracked `src/` files kept verbatim from HEAD. Tracked HEAD `src/` files absent from the IDE set
 * are dropped (so IDE deletions propagate through the merge).
 */
export function buildVoltIdeTree(gitDir: string, headCommit: string | undefined, ideFiles: readonly MaterializedFile[]): string {
	const entries: IndexEntry[] = [];
	for (const f of ideFiles) {
		entries.push({ mode: "100644", sha: writeBlob(gitDir, f.content), path: `${SRC_DIR}/${f.path}` });
	}
	if (headCommit !== undefined) {
		for (const e of listTree(gitDir, headCommit)) {
			if (e.path.startsWith(`${SRC_DIR}/`)) {
				const rel = e.path.slice(SRC_DIR.length + 1);
				if (isTrackedPath(rel)) continue; // IDE-owned → replaced by ideFiles, or deleted
				entries.push({ mode: e.mode, sha: e.sha, path: e.path }); // foreign src/ file → preserve
			} else {
				entries.push({ mode: e.mode, sha: e.sha, path: e.path }); // scaffold → verbatim
			}
		}
	}
	return buildTree(gitDir, entries);
}

export function commitVoltIde(gitDir: string, treeSha: string, parent: string | undefined, message: string): string {
	return commitTree(gitDir, treeSha, parent !== undefined ? [parent] : [], message);
}

/** The volt/ide src files as src-relative {path, sha} — the baseline for push/status diffs. */
export function srcRelEntries(gitDir: string, treeish: string): Array<{ path: string; sha: string }> {
	return listTree(gitDir, treeish)
		.filter((e) => e.path.startsWith(`${SRC_DIR}/`))
		.map((e) => ({ path: e.path.slice(SRC_DIR.length + 1), sha: e.sha }));
}

// ─── sidecar baseline (.volt/ide-refs.json) ─────────────────────────────────

export interface IdeRefs {
	projectVersion: string;
	items: Record<string, string>; // full name → version  (what the IDE last had)
	folders: Record<string, string>; // full name → folder
}

export function loadIdeRefs(root: string): IdeRefs | undefined {
	const p = workspacePaths(root).ideRefsPath;
	if (!existsSync(p)) return undefined;
	try {
		const raw = JSON.parse(readFileSync(p, "utf-8")) as Partial<IdeRefs>;
		if (raw.projectVersion === undefined || raw.items === undefined || raw.folders === undefined) return undefined;
		return raw as IdeRefs;
	} catch {
		return undefined;
	}
}

export function saveIdeRefs(root: string, refs: IdeRefs): void {
	const paths = workspacePaths(root);
	mkdirSync(paths.stateDir, { recursive: true });
	writeFileSync(paths.ideRefsPath, JSON.stringify(refs, null, 2) + "\n");
}
