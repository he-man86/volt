/**
 * `volt push` verb — workspace → bridge.
 *
 * Hashes the current workspace files into the hidden snapshot bare
 * repo, builds a synthetic commit on top of snapshot HEAD with that
 * tree, then hands the commit to the diff/ops translator
 * (`applyPushToBridge` in `engine/ops.ts`) — which emits one
 * item-level op per changed file (pushItem / deleteItem / renameItem
 * / moveItem), batches them, and sends them to the bridge.
 *
 * Drift policy: before computing the diff we check the bridge's
 * current `/refs.projectVersion` against the snapshot's recorded one.
 * If they differ, the IDE has changed underneath us — refuse with a
 * clear "run `volt pull` first" message unless `--force`. This is
 * the single behavior that prevents the AI from silently overwriting
 * the engineer's work.
 *
 * Force semantic:
 *   `--force` bypasses the drift refusal and pushes the workspace's
 *   ops. It does NOT delete engineer-side items the workspace doesn't
 *   touch — the bridge keeps those, since no op targets them. After a
 *   successful force-push, this verb RECONCILES: it pulls the bridge's
 *   post-push state (= "your edits + everything the engineer added")
 *   into both the snapshot and the workspace.
 *
 * Exit codes: 0 = pushed (or dry-run / nothing-to-push). 2 = the push
 * DIDN'T happen because of drift or bridge rejection.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
	createDeterministicCommit,
	listTree,
	readBlobBytes,
	resolveRef,
	updateRef,
} from "../engine/git-cmds.js";
import { applyPushToBridge, syncFromBridge } from "../engine/ops.js";
import { loadConfig, workspacePaths } from "../engine/config.js";
import {
	buildWorkspaceTreeSha,
	computeIncoming,
	computeOutgoing,
	ensureSnapshotRepo,
	hasChanges,
	loadState,
	saveState,
	writeTreeToWorkspace,
	type ChangeSet,
} from "../engine/snapshot.js";
import { flagBool, flagString, type VerbFn } from "./_shared.js";

export const pushVerb: VerbFn = async ({ workspace, bridge, flags }) => {
	const force = flagBool(flags, "force");
	const forceWithLease = flagString(flags, "force-with-lease");
	const dryRun = flagBool(flags, "dry-run");
	const noDriftCheck = flagBool(flags, "no-drift-check");

	const root = resolve(workspace);
	const paths = workspacePaths(root);
	loadConfig(root);
	ensureSnapshotRepo(paths.snapshotPath);

	const state = loadState(paths.snapshotPath);
	if (state === undefined) {
		throw new Error(
			`no snapshot to diff against — run \`volt pull\` once before \`volt push\``,
		);
	}

	// 1. Drift check against the live bridge.
	let driftAdoptedItems: ChangeSet | undefined;
	if (!noDriftCheck) {
		const refs = await bridge.getRefs();
		if (refs.projectVersion !== state.projectVersion) {
			const incoming = computeIncoming(refs.items, state.items);
			const leaseHolds =
				forceWithLease !== undefined && forceWithLease === refs.projectVersion;
			if (forceWithLease !== undefined && !leaseHolds) {
				printLeaseStale(forceWithLease, refs.projectVersion, incoming);
				return 2;
			}
			if (!force && !leaseHolds) {
				printDriftDetected(state.projectVersion, refs.projectVersion, incoming);
				return 2;
			}
			if (hasChanges(incoming)) driftAdoptedItems = incoming;
			// Dry-run must NOT persist the adopted state.
			if (!dryRun) {
				saveState(paths.snapshotPath, {
					...state,
					projectVersion: refs.projectVersion,
					items: { ...refs.items },
				});
			}
			state.projectVersion = refs.projectVersion;
			state.items = { ...refs.items };
		}
	}

	// 2. Build a workspace tree; nothing-to-push shortcut.
	const newTreeSha = buildWorkspaceTreeSha(root, paths.snapshotPath);
	const parentSha = resolveRef(paths.snapshotPath, "refs/heads/main");
	if (parentSha !== state.commitSha) {
		throw new Error(
			`snapshot HEAD (${parentSha ?? "<unborn>"}) doesn't match recorded commit (${state.commitSha})`,
		);
	}
	const headTreeSha = treeShaOfCommit(paths.snapshotPath, state.commitSha);
	if (newTreeSha === headTreeSha) {
		console.log("nothing to push — workspace matches snapshot.");
		return 0;
	}

	// 3. Compute the per-item delta BEFORE the push for the OK response.
	const pushed = computeOutgoing(paths.snapshotPath, root, state.commitSha);

	if (dryRun) {
		const adopted = driftAdoptedItems
			? [...driftAdoptedItems.added, ...driftAdoptedItems.modified].sort()
			: [];
		printPushed(pushed, true);
		if (adopted.length > 0) printAdopted(adopted, true);
		console.log("dry-run — nothing was sent to the bridge.");
		return 0;
	}

	// 4. Build a synthetic commit on top of snapshot HEAD with the
	//    workspace tree, and translate the diff into bridge ops.
	const newCommitSha = createDeterministicCommit(
		paths.snapshotPath,
		newTreeSha,
		state.commitSha,
		"workspace push",
	);
	const result = await applyPushToBridge(paths.snapshotPath, bridge, newCommitSha);
	if (!result.accepted) {
		process.stderr.write(`bridge rejected push: ${result.reason}\n`);
		return 2;
	}

	// 5. Advance snapshot HEAD so the next push diffs against the right
	//    baseline. (applyPushToBridge updates state.json but not the ref.)
	updateRef(paths.snapshotPath, "refs/heads/main", result.commitSha);

	// 6. Post-push reconcile when drift was adopted via --force.
	let adoptedNames: string[] | undefined;
	if (driftAdoptedItems !== undefined) {
		// `fullRebuild` is critical: the normal syncFromBridge would
		// short-circuit because state.projectVersion already matches
		// bridge.projectVersion (we just adopted it).
		await syncFromBridge(paths.snapshotPath, bridge, { fullRebuild: true });
		const postSyncState = loadState(paths.snapshotPath);
		if (postSyncState !== undefined) {
			const tree = listTree(paths.snapshotPath, postSyncState.commitSha);
			writeTreeToWorkspace(
				root,
				tree.map((e) => ({
					path: e.path,
					content: readBlobBytes(paths.snapshotPath, e.sha),
				})),
			);
		}
		const adopted = [
			...driftAdoptedItems.added,
			...driftAdoptedItems.modified,
		].sort();
		if (adopted.length > 0) adoptedNames = adopted;
	}

	printPushed(pushed, false);
	if (adoptedNames !== undefined) printAdopted(adoptedNames, false);
	console.log(`pushed. snapshot now @ ${result.commitSha.slice(0, 12)}`);
	return 0;
};

function treeShaOfCommit(repoPath: string, commitSha: string): string {
	const r = spawnSync("git", ["-C", repoPath, "rev-parse", `${commitSha}^{tree}`], { encoding: "utf-8" });
	if (r.status !== 0) throw new Error(`rev-parse ${commitSha}^{tree} failed: ${r.stderr}`);
	return r.stdout.trim();
}

function printPushed(p: ChangeSet, dryRun: boolean): void {
	const total = p.added.length + p.modified.length + p.removed.length;
	if (total === 0) return;
	process.stdout.write(dryRun ? "would push to bridge (dry-run):\n" : "pushed to bridge:\n");
	for (const n of p.added) process.stdout.write(`  [WS]  + ${n}  (created)\n`);
	for (const n of p.modified) process.stdout.write(`  [WS]  M ${n}  (updated)\n`);
	for (const n of p.removed) process.stdout.write(`  [WS]  - ${n}  (deleted)\n`);
}

function printAdopted(adopted: string[], dryRun: boolean): void {
	const header = dryRun
		? "--force / --force-with-lease was used. The following items would be pulled in as part of " +
			"the post-push reconcile (NOT overwritten on the bridge):\n"
		: "--force was used. The following items were on the bridge but NOT in your workspace " +
			"and have been pulled in as part of the post-push reconcile:\n";
	process.stderr.write(header);
	for (const n of adopted) process.stderr.write(`  [IDE] + ${n}  (added to workspace)\n`);
	if (!dryRun) {
		process.stderr.write(
			"These items were NOT overwritten — they survived the force-push and now live in your workspace too.\n\n",
		);
	}
}

function printDriftDetected(localVersion: string, bridgeVersion: string, incoming: ChangeSet): void {
	process.stderr.write(
		`drift detected: IDE has changed since last pull.\n` +
			`  local snapshot:  ${localVersion}\n` +
			`  bridge current:  ${bridgeVersion}\n`,
	);
	const anyChanges = incoming.added.length + incoming.modified.length + incoming.removed.length > 0;
	if (anyChanges) {
		process.stderr.write("\nincoming (engineer-side changes):\n");
		for (const n of incoming.added) process.stderr.write(`  [IDE] + ${n}\n`);
		for (const n of incoming.modified) process.stderr.write(`  [IDE] M ${n}\n`);
		for (const n of incoming.removed) process.stderr.write(`  [IDE] - ${n}\n`);
	}
	process.stderr.write(
		`\nrun \`volt pull\` to bring in IDE changes, or \`volt push --force\` to push anyway ` +
			`(force does NOT delete the engineer's items — it bypasses the version guard and ` +
			`reconciles your workspace with the bridge afterwards).\n`,
	);
}

function printLeaseStale(expectedVersion: string, bridgeVersion: string, incoming: ChangeSet): void {
	process.stderr.write(
		`--force-with-lease refused: bridge has moved further than what you expected.\n` +
			`  expected:  ${expectedVersion}\n` +
			`  current:   ${bridgeVersion}\n\n` +
			`Someone (or another client) changed the bridge AFTER you observed it. ` +
			`Re-run \`volt status\` to see what's new, then retry — use the bridge's ` +
			`current projectVersion as your new lease.\n`,
	);
	const anyChanges = incoming.added.length + incoming.modified.length + incoming.removed.length > 0;
	if (anyChanges) {
		process.stderr.write("\nincoming since your lease was issued:\n");
		for (const n of incoming.added) process.stderr.write(`  [IDE] + ${n}\n`);
		for (const n of incoming.modified) process.stderr.write(`  [IDE] M ${n}\n`);
		for (const n of incoming.removed) process.stderr.write(`  [IDE] - ${n}\n`);
	}
}
