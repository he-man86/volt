/**
 * `volt pull` verb — bridge → workspace.
 *
 * Pulls the IDE's current state from the bridge, materializes it into
 * the hidden snapshot bare repo, then writes the snapshot's files
 * out into the workspace. The workspace gets exactly what the IDE has.
 *
 * Conflict policy (v1, deliberately simple):
 *   - If the workspace has any "tracked" files whose content differs
 *     from the snapshot HEAD (i.e. local edits not yet pushed), the
 *     pull REFUSES so the user doesn't lose work.
 *   - `--force` overrides — local edits are discarded.
 *   - `--dry-run` / `-n` previews the incoming ChangeSet without
 *     writing anything (modeled on `git fetch --dry-run`).
 *
 * A future v2 can add a real 3-way merge with conflict markers, using
 * the snapshot HEAD as base. For now, the user's escape hatches are
 * `volt push` first (apply your edits) or `--force` (drop them).
 */
import { resolve } from "node:path";
import { listTree, readBlobBytes } from "../engine/git-cmds.js";
import { loadConfig, workspacePaths } from "../engine/config.js";
import { syncFromBridge } from "../engine/ops.js";
import { isTrackedPath } from "../engine/pou-files.js";
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
} from "../engine/snapshot.js";
import { flagBool, type VerbFn } from "./_shared.js";

export const pullVerb: VerbFn = async ({ workspace, bridge, flags }) => {
	const force = flagBool(flags, "force");
	const dryRun = flagBool(flags, "dry-run");

	const root = resolve(workspace);
	const paths = workspacePaths(root);
	loadConfig(root); // throws if no workspace; we don't need the value here
	ensureSnapshotRepo(paths.snapshotPath);
	ensureGitignore(root);

	// 1. Capture pre-pull workspace state — needed to figure out which
	//    files (if any) need to be deleted when the IDE removed items.
	const prePaths = new Set(listWorkspaceFiles(root).map((f) => f.path));
	const preState = loadState(paths.snapshotPath);

	// 2. Conflict guard: refuse to pull if the workspace has uncommitted
	//    edits relative to the last snapshot, unless --force.
	if (preState !== undefined && !force) {
		const dirty = detectWorkspaceDirty(paths.snapshotPath, root, preState.commitSha);
		if (dirty.length > 0) {
			throw new Error(
				`workspace has uncommitted edits that would be overwritten by pull:\n${dirty
					.map((p) => `  - ${p}`)
					.join("\n")}\n\nrun \`volt push\` first to send them to the IDE, or \`volt pull --force\` to discard.`,
			);
		}
	}

	// 3a. Dry-run: compute incoming ChangeSet against recorded items
	//     and exit without touching snapshot or workspace.
	if (dryRun) {
		const refs = await bridge.getRefs();
		const incoming = computeIncoming(refs.items, preState?.items ?? {});
		const upToDate =
			preState !== undefined &&
			preState.projectVersion === refs.projectVersion &&
			!hasChanges(incoming);
		const incCount = incoming.added.length + incoming.modified.length + incoming.removed.length;
		if (upToDate || incCount === 0) {
			console.log("dry-run — already up to date, nothing to pull.");
		} else {
			console.log("would pull from bridge (dry-run):");
			for (const n of incoming.added) console.log(`  [IDE] + ${n}  (engineer created)`);
			for (const n of incoming.modified) console.log(`  [IDE] M ${n}  (engineer edited)`);
			for (const n of incoming.removed) console.log(`  [IDE] - ${n}  (engineer deleted)`);
			console.log("dry-run — workspace and snapshot were NOT touched.");
		}
		return 0;
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
	if (upToDate && newPaths.size > 0 && removed.length === 0) {
		console.log("already up to date.");
	} else {
		console.log(`pulled: ${newPaths.size} file(s), removed: ${removed.length} file(s).`);
	}
	return 0;
};
