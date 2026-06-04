/**
 * `volt pull` verb — bridge → workspace.
 *
 * Pulls the IDE's current state from the bridge. Behavior:
 *
 *   - workspace clean, bridge unchanged → no-op
 *   - workspace clean, bridge changed   → fast-forward
 *   - workspace dirty, bridge unchanged → refuse (suggest `volt push`)
 *   - workspace dirty, bridge changed   → 3-way merge
 *
 * The 3-way merge mirrors `git pull` (= `git fetch + git merge`). On a
 * clean merge, the workspace ends up with both sides' edits visible
 * and `volt pull` exits 0. On conflicts, conflict markers (`<<<<<<<`)
 * land in the workspace and a MERGE_HEAD state file is written; the
 * user / AI resolves and runs `volt merge --continue`. Same mental
 * model as git.
 *
 * Escape hatches:
 *   - `--force`     discards local edits and takes the bridge verbatim
 *   - `--no-merge`  preserves the v1 refuse-on-dirty behavior (so the
 *                   user can stash edits manually before pulling)
 *   - `--dry-run` / `-n` previews without writing anything
 */
import { resolve } from "node:path";
import {
	createMergeCommit,
	listTree,
	readBlobBytes,
	resolveRef,
	updateRef,
} from "../engine/git-cmds.js";
import { loadConfig, workspacePaths } from "../engine/config.js";
import {
	applyMerge,
	isMergingNow,
	planMerge,
} from "../engine/merge.js";
import { syncFromBridge } from "../engine/ops.js";
import { isTrackedPath } from "../engine/pou-files.js";
import {
	buildWorkspaceTreeSha,
	computeIncoming,
	detectWorkspaceDirty,
	ensureGitignore,
	ensureSnapshotRepo,
	hasChanges,
	listWorkspaceFiles,
	loadState,
	removeFilesFromWorkspace,
	reportSnapshotHeal,
	saveState,
	writeTreeToWorkspace,
} from "../engine/snapshot.js";
import { isVoltError, VoltError, wrapEngineError } from "./_error.js";
import { flagBool, type VerbFn } from "./_shared.js";

export const pullVerb: VerbFn = async ({ workspace, bridge, flags }) => {
	const force = flagBool(flags, "force");
	const dryRun = flagBool(flags, "dry-run");
	const noMerge = flagBool(flags, "no-merge");

	const root = resolve(workspace);
	const paths = workspacePaths(root);
	loadConfig(root); // throws if no workspace; we don't need the value here
	const heal = ensureSnapshotRepo(paths.snapshotPath);
	reportSnapshotHeal(heal);
	ensureGitignore(root);

	// 0. Refuse if a merge is already in progress. Same as `git pull`
	//    against an in-progress merge: resolve the merge first.
	if (isMergingNow(paths.snapshotPath) !== undefined) {
		throw new VoltError({
			what: "pull refused — merge in progress",
			why: "a 3-way merge from a previous pull hasn't been finalized yet",
			hint: "resolve any conflict markers, then run `volt merge --continue` — or `volt merge --abort` to back out",
			exitCode: 2,
		});
	}

	// 1. Capture pre-pull workspace state — needed to figure out which
	//    files (if any) need to be deleted when the IDE removed items.
	const prePaths = new Set(listWorkspaceFiles(root).map((f) => f.path));
	const preState = loadState(paths.snapshotPath);

	// 2. Conflict policy. Four cases by (workspace, bridge):
	//      clean / unchanged  → no-op (handled later by the fast path)
	//      clean / changed    → fast-forward (handled later)
	//      dirty / unchanged  → refuse with suggest-push
	//      dirty / changed    → 3-way merge (unless --no-merge or --force)
	let dirty: string[] = [];
	if (preState !== undefined && !force) {
		dirty = detectWorkspaceDirty(paths.snapshotPath, root, preState.commitSha);
	}
	if (dirty.length > 0 && !force) {
		const refs = await bridge.getRefs();
		const incoming = computeIncoming(refs.items, preState?.items ?? {});
		// "Bridge changed" = the bridge's ITEMS differ from ours.
		// projectVersion alone is a cache key, not authoritative drift
		// (TC bumps it for non-content reasons). If items match,
		// there's nothing to merge — pull silently adopts the new
		// projectVersion later via syncFromBridge.
		const bridgeChanged = preState !== undefined && hasChanges(incoming);

		if (!bridgeChanged) {
			// dirty but bridge unchanged — fall through to refuse below.
		} else if (noMerge) {
			const lines = dirty.map((p) => `  - ${p}`);
			throw new VoltError({
				what: `pull refused — ${dirty.length} workspace edit(s) would be overwritten`,
				why: `the IDE has changes too, but --no-merge was set; the following files differ from the snapshot:\n${lines.join("\n")}`,
				hint: "send them first with `volt push`, discard with `volt pull --force`, or omit --no-merge to 3-way merge",
				exitCode: 2,
			});
		} else if (dryRun) {
			console.log(`would 3-way merge ${dirty.length} workspace edit(s) with incoming IDE changes:`);
			for (const n of incoming.added) console.log(`  [IDE] + ${n}`);
			for (const n of incoming.modified) console.log(`  [IDE] M ${n}`);
			for (const n of incoming.removed) console.log(`  [IDE] - ${n}`);
			console.log("dry-run — workspace and snapshot were NOT touched.");
			return 0;
		} else {
			// Run the 3-way merge.
			const plan = await planMerge(paths.snapshotPath, root, bridge);
			const mergeState = applyMerge(paths.snapshotPath, root, plan);
			if (mergeState === undefined) {
				// Clean merge — promote: advance HEAD to a merge commit
				// committed against the merged workspace. This mirrors
				// `git pull` finishing cleanly without a separate
				// `--continue` step.
				const head = resolveRef(paths.snapshotPath, "refs/heads/main");
				if (head === undefined) {
					throw new VoltError({
						what: "merge finalize failed",
						why: "refs/heads/main is missing after a clean auto-merge — snapshot was modified concurrently or is corrupt",
						hint: "delete .volt/snapshot/ and run `volt pull --force` to rebuild from the bridge",
					});
				}
				const treeSha = buildWorkspaceTreeSha(root, paths.snapshotPath);
				const commit = createMergeCommit(
					paths.snapshotPath,
					treeSha,
					[head, plan.theirsCommitSha],
					`Merge IDE@${plan.targetProjectVersion} into workspace (clean auto-merge)\n`,
				);
				updateRef(paths.snapshotPath, "refs/heads/main", commit);
				saveState(paths.snapshotPath, {
					projectVersion: plan.targetProjectVersion,
					commitSha: commit,
					items: plan.targetState.items,
					folders: plan.targetState.folders,
				});
				console.log(
					`merged ${plan.auto.length} file(s) cleanly; workspace now reflects IDE@${plan.targetProjectVersion}.`,
				);
				return 0;
			}
			// Conflicts left — surface them as a structured VoltError so
			// the top-level renderer formats them consistently.
			const lines = mergeState.conflicts.map(
				(c) => `  ${c.kind === "text" ? "T" : "G"} ${c.path}  (${c.reason})`,
			);
			throw new VoltError({
				what: `merge stopped — ${mergeState.conflicts.length} unresolved conflict(s)`,
				why: lines.join("\n"),
				hint: "edit the files to remove <<<<<<< markers, then `volt merge --continue` — or `volt merge --abort` to back out",
				exitCode: 2,
			});
		}
	}

	if (dirty.length > 0 && !force) {
		const lines = dirty.map((p) => `  - ${p}`);
		throw new VoltError({
			what: `pull refused — ${dirty.length} workspace edit(s) would be overwritten`,
			why: `the following files differ from the snapshot:\n${lines.join("\n")}`,
			hint: "send them first with `volt push`, drop them with `volt pull --force`, or `volt pull --no-merge` to refuse on dirty",
			exitCode: 2,
		});
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
	// `--force` triggers a full rebuild — the bridge re-sends every
	// item regardless of cached hash, so the agent re-materializes
	// every file with the current materializer (e.g. after a transpiler
	// upgrade). Without --force, fetchChanges skips items whose bridge
	// hash matches the snapshot's, leaving old materialized output in
	// the workspace.
	//
	// A snapshot heal IMPLIES fullRebuild: state.json was wiped, so
	// every item is "new" to us and the bridge's hash-skip optimization
	// would leave us with an empty workspace.
	try {
		await syncFromBridge(paths.snapshotPath, bridge, { fullRebuild: force || heal.rebuilt });
	} catch (err) {
		// Pass through VoltErrors (e.g. from transpiler refusals).
		// Wrap engine/git failures with user-friendly context.
		if (isVoltError(err)) throw err;
		throw wrapEngineError(err, "pull from bridge");
	}
	const stateAfter = loadState(paths.snapshotPath);
	if (stateAfter === undefined) {
		throw new VoltError({
			what: "snapshot state missing after pull",
			why: "syncFromBridge completed but no state.json was written — bridge may have returned an empty refs list",
			hint: "verify the bridge has a project open (volt status), then retry — if persistent, run with --debug to capture the bridge transcript",
		});
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
