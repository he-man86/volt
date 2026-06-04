/**
 * `volt merge` verb — resumption + per-file resolution protocol.
 * Mirrors git's vocabulary so AI agents that already know git don't
 * need to learn new verbs:
 *
 *   volt merge --continue                       ≈ git merge --continue
 *   volt merge --abort                          ≈ git merge --abort
 *   volt merge --resolve <path>                 ≈ git add <path>
 *   volt merge --resolve <path> --use-ours      ≈ git checkout --ours <path> && git add <path>
 *   volt merge --resolve <path> --use-theirs    ≈ git checkout --theirs <path> && git add <path>
 *
 * There is no bare `volt merge` because the only upstream is the bridge
 * and the initial merge is always triggered by `volt pull` (same as
 * `git pull = fetch + merge`).
 */
import { resolve as resolvePath } from "node:path";
import { workspacePaths } from "../engine/config.js";
import {
	abortMerge,
	continueMerge,
	isMergingNow,
	MergeUnresolvedError,
	NotConflictedError,
	resolveConflict,
} from "../engine/merge.js";
import { ensureSnapshotRepo, reportSnapshotHeal } from "../engine/snapshot.js";
import { flagBool, flagString, type VerbFn } from "./_shared.js";

export const merge: VerbFn = async ({ workspace, flags }) => {
	const wantContinue = flagBool(flags, "continue");
	const wantAbort = flagBool(flags, "abort");
	const resolveTarget = flagString(flags, "resolve");

	const actionCount =
		(wantContinue ? 1 : 0) + (wantAbort ? 1 : 0) + (resolveTarget !== undefined ? 1 : 0);
	if (actionCount > 1) {
		process.stderr.write("error: --continue, --abort, and --resolve are mutually exclusive\n");
		return 1;
	}
	if (actionCount === 0) {
		process.stderr.write(
			"error: `volt merge` requires --continue, --abort, or --resolve <path>. The initial merge is triggered by `volt pull`.\n",
		);
		return 1;
	}

	const root = resolvePath(workspace);
	const paths = workspacePaths(root);
	reportSnapshotHeal(ensureSnapshotRepo(paths.snapshotPath));

	const state = isMergingNow(paths.snapshotPath);
	if (state === undefined) {
		process.stderr.write("error: not currently merging — nothing to continue, abort, or resolve\n");
		return 1;
	}

	if (wantAbort) {
		abortMerge(paths.snapshotPath, root);
		console.log("merge aborted; workspace restored to pre-merge state.");
		return 0;
	}

	if (resolveTarget !== undefined) {
		const useOurs = flagBool(flags, "use-ours");
		const useTheirs = flagBool(flags, "use-theirs");
		if (useOurs && useTheirs) {
			process.stderr.write("error: --use-ours and --use-theirs are mutually exclusive\n");
			return 1;
		}
		const side = useOurs ? "ours" : useTheirs ? "theirs" : undefined;
		try {
			resolveConflict(paths.snapshotPath, root, resolveTarget, side);
		} catch (err) {
			if (err instanceof NotConflictedError) {
				process.stderr.write(`error: ${err.message}\n`);
				return 1;
			}
			throw err;
		}
		const sideLabel = side ?? "current workspace content";
		console.log(`resolved ${resolveTarget} using ${sideLabel}.`);
		// Surface progress so the caller (CLI user OR VS Code wrapper) knows
		// when all conflicts are done and `--continue` is now valid.
		const after = isMergingNow(paths.snapshotPath);
		if (after !== undefined && after.conflicts.length === 0) {
			console.log("all conflicts resolved; run `volt merge --continue` to finalize.");
		}
		return 0;
	}

	// --continue
	try {
		continueMerge(paths.snapshotPath, root);
	} catch (err) {
		if (err instanceof MergeUnresolvedError) {
			process.stderr.write(
				`error: unresolved conflicts in ${err.paths.length} file(s):\n`,
			);
			for (const p of err.paths) process.stderr.write(`  ${p}\n`);
			process.stderr.write(
				"resolve the conflict markers (remove <<<<<<< / ======= / >>>>>>>), then re-run `volt merge --continue`.\n",
			);
			return 2;
		}
		throw err;
	}
	console.log(`merge committed; workspace now reflects IDE@${state.projectVersion}.`);
	return 0;
};
