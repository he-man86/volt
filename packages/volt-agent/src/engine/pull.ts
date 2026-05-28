/**
 * `volt pull` — bridge → workspace.
 *
 * Pulls the IDE's current state from the bridge, materializes it into
 * the hidden snapshot bare repo, then writes the snapshot's files out
 * into the workspace. The workspace gets exactly what the IDE has.
 *
 * Conflict policy (v1, deliberately simple):
 *   - If the workspace has any "tracked" files whose content differs
 *     from the snapshot HEAD (i.e. local edits not yet pushed), the
 *     pull REFUSES so the user doesn't lose work.
 *   - `--force` overrides — local edits are discarded.
 *
 * A future v2 can add a real 3-way merge with conflict markers, using
 * the snapshot HEAD as base. For now, the user's escape hatches are
 * `volt push` first (apply your edits) or `--force` (drop them).
 */
import { resolve } from "node:path";
import { BridgeClient } from "../bridge/client.js";
import { syncFromBridge } from "./ops.js";
import { listTree, readBlobBytes } from "./git-cmds.js";
import { loadConfig, workspacePaths } from "./config.js";
import { isTrackedPath } from "./pou-files.js";
import {
	computeIncoming,
	detectWorkspaceDirty,
	ensureGitignore,
	ensureSnapshotRepo,
	hasChanges,
	listWorkspaceFiles,
	loadState,
	removeFilesFromWorkspace,
	writeTreeToWorkspace,
	type ChangeSet,
} from "./snapshot.js";

export interface PullOptions {
	/** Discard any local workspace edits that conflict with the pull. */
	force?: boolean;
	/**
	 * Preview only — compute what WOULD be pulled (the incoming
	 * ChangeSet + a count of files that would be written or removed)
	 * but DON'T touch the snapshot or the workspace. Models
	 * `git fetch --dry-run` / `git pull --dry-run`. The dirty-workspace
	 * conflict guard still runs (callers get the same refusal a real
	 * pull would).
	 */
	dryRun?: boolean;
}

export interface PullResult {
	/** Files written to the workspace (relative paths). */
	written: string[];
	/** Files deleted from the workspace because the IDE no longer has them. */
	removed: string[];
	/** True if no IDE-side changes since the last pull — nothing to do. */
	upToDate: boolean;
	/**
	 * Per-item preview of what `volt pull` would bring in. Present on
	 * every real pull AND on `--dry-run`. Mirrors `volt status`'s
	 * `incoming` field so the same shape works in either reporter.
	 */
	incoming: ChangeSet;
	/**
	 * True when the result came from a `--dry-run` invocation — the
	 * `incoming` / `written` / `removed` fields show what WOULD have
	 * happened, but no snapshot or workspace bytes were touched.
	 */
	dryRun?: boolean;
}

export async function runPull(
	workspaceRoot: string,
	bridge: BridgeClient,
	opts: PullOptions = {},
): Promise<PullResult> {
	const root = resolve(workspaceRoot);
	const paths = workspacePaths(root);
	loadConfig(root); // throws if no workspace; we don't need the value here
	ensureSnapshotRepo(paths.snapshotPath);
	// Safety net: re-ensure .gitignore in case the user deleted it.
	ensureGitignore(root);

	// 1. Capture what the workspace looked like BEFORE we touch anything —
	//    used to figure out which files (if any) need to be deleted when
	//    the IDE removed items.
	const prePaths = new Set(listWorkspaceFiles(root).map((f) => f.path));
	const preState = loadState(paths.snapshotPath);

	// 2. Conflict guard: refuse to pull if the workspace has uncommitted
	//    edits relative to the last snapshot, unless --force. (Same
	//    refusal a real pull would produce — dry-run shows the user
	//    what they're about to fight with.)
	if (preState !== undefined && !opts.force) {
		const dirty = detectWorkspaceDirty(paths.snapshotPath, root, preState.commitSha);
		if (dirty.length > 0) {
			throw new Error(
				`workspace has uncommitted edits that would be overwritten by pull:\n${dirty
					.map((p) => `  - ${p}`)
					.join("\n")}\n\nrun \`volt push\` first to send them to the IDE, or \`volt pull --force\` to discard.`,
			);
		}
	}

	// 3a. Dry-run shortcut: ask the bridge what's there, compute the
	//     incoming ChangeSet against our recorded items, and return —
	//     without writing anything to snapshot or workspace.
	if (opts.dryRun) {
		const refs = await bridge.getRefs();
		const incoming = computeIncoming(refs.items, preState?.items ?? {});
		const upToDate =
			preState !== undefined &&
			preState.projectVersion === refs.projectVersion &&
			!hasChanges(incoming);
		return {
			written: [],
			removed: [],
			upToDate,
			incoming,
			dryRun: true,
		};
	}

	// 3. Pull the IDE state into the snapshot bare repo.
	await syncFromBridge(paths.snapshotPath, bridge);
	const stateAfter = loadState(paths.snapshotPath);
	if (stateAfter === undefined) {
		throw new Error("internal: snapshot state missing after syncFromBridge");
	}

	// 4. Write the snapshot tree into the workspace.
	const newEntries = listTree(paths.snapshotPath, stateAfter.commitSha);
	const newPaths = new Set(newEntries.map((e) => e.path));
	writeTreeToWorkspace(
		root,
		newEntries.map((e) => ({ path: e.path, content: readBlobBytes(paths.snapshotPath, e.sha) })),
	);

	// 5. Remove files the IDE no longer has. Only files that WERE in the
	//    workspace before this pull are eligible — never anything the
	//    user happened to put alongside that we don't track.
	const removed: string[] = [];
	for (const p of prePaths) {
		if (newPaths.has(p)) continue;
		if (isTrackedPath(p)) removed.push(p);
	}
	removeFilesFromWorkspace(root, removed);

	const upToDate =
		preState !== undefined && preState.projectVersion === stateAfter.projectVersion;
	const incoming = computeIncoming(stateAfter.items, preState?.items ?? {});

	return { written: [...newPaths], removed, upToDate, incoming };
}
