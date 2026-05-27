/**
 * `plc push` — workspace → bridge.
 *
 * Hashes the current workspace files into the hidden snapshot bare
 * repo, builds a synthetic commit on top of snapshot HEAD with that
 * tree, then hands the commit to the diff/ops translator
 * (`applyPushToBridge` in `ops.ts`) — which produces primitive ops,
 * batches them, and sends them to the bridge.
 *
 * Drift policy: before computing the diff we check the bridge's
 * current `/refs.projectVersion` against the snapshot's recorded one.
 * If they differ, the IDE has changed underneath us — refuse with a
 * clear "run `plc pull` first" message unless `--force`. This is
 * the single behavior that prevents the AI from silently overwriting
 * the engineer's work.
 *
 * Force semantic (important):
 *   `--force` bypasses the drift refusal and pushes the workspace's
 *   ops. It does NOT delete engineer-side items the workspace doesn't
 *   touch — the bridge keeps those, since no op targets them. After a
 *   successful force-push, this verb RECONCILES: it pulls the
 *   bridge's post-push state (which is "your edits + everything the
 *   engineer added") into both the snapshot and the workspace. That
 *   way the next `plc status` shows the truth — workspace, snapshot,
 *   and bridge all agree — instead of falsely claiming "in sync"
 *   while the workspace silently lacks engineer-added items.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { BridgeClient } from "../bridge/client.js";
import {
	createDeterministicCommit,
	listTree,
	readBlobBytes,
	resolveRef,
	updateRef,
} from "./git-cmds.js";
import { applyPushToBridge, syncFromBridge } from "./ops.js";
import { loadConfig, workspacePaths } from "./config.js";
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
} from "./snapshot.js";

export interface PushOptions {
	/** Bypass the drift check — push even if the IDE has changed since last pull. */
	force?: boolean;
	/**
	 * Safer alternative to `force`. Bypass drift ONLY if the bridge's
	 * current projectVersion equals this value. Models `git push
	 * --force-with-lease=<refname>:<expect>` — the lease holds when
	 * what we see matches what we expected to see, and fails the moment
	 * someone else moved the bridge further than what the caller last
	 * observed (e.g. via `plc status`).
	 */
	forceWithLease?: string;
	/**
	 * Preview only — compute the outgoing ChangeSet and what would
	 * happen, but DON'T contact the bridge for a write, DON'T mutate
	 * the snapshot, and DON'T touch the workspace. Models `git push
	 * --dry-run`. Drift refusal still applies (we still call /refs to
	 * know whether we'd be refused).
	 */
	dryRun?: boolean;
}

export type PushResult =
	| {
			status: "ok";
			/** New snapshot commit SHA (post-push + post-reconcile). */
			commitSha: string;
			/**
			 * What this push actually sent to the bridge, as per-item
			 * {added, modified, removed} lists (= the diff from snapshot
			 * HEAD → workspace at the moment of push). Same shape as the
			 * status verb's `outgoing` field — this is its post-push
			 * realization. Modeled on `git push --porcelain`'s per-ref
			 * outcome lines: structured proof of exactly which items
			 * moved, so the caller never has to guess.
			 */
			pushed: ChangeSet;
			/**
			 * Populated only when `--force` was used AND drift existed.
			 * Lists items that came IN to the workspace as part of the
			 * post-push reconcile (= items the engineer had added that
			 * we didn't have locally). These were NOT overwritten — they
			 * survived the force-push and are now in your workspace.
			 */
			adoptedFromBridge?: string[];
			/**
			 * True when the result came from a `--dry-run` invocation —
			 * `pushed` shows what WOULD have moved, but the bridge,
			 * snapshot, and workspace are untouched. `commitSha` echoes
			 * the snapshot HEAD that the dry run was computed against.
			 */
			dryRun?: boolean;
	  }
	| {
			status: "nothing_to_push";
	  }
	| {
			status: "drift_detected";
			localProjectVersion: string;
			bridgeProjectVersion: string;
			/**
			 * What the IDE has that we don't (= `hg incoming` /
			 * `HEAD..@{u}`). Caller decides whether to volt_pull
			 * (absorb) or have the human force-push (override).
			 */
			incoming: ChangeSet;
	  }
	| {
			status: "rejected";
			reason: string;
	  }
	| {
			/**
			 * `--force-with-lease=<expectedVersion>` was given but the
			 * bridge has moved further than what the caller expected. We
			 * refuse — the caller's mental model of "what's on the
			 * bridge" is stale. They should re-read status / pull, then
			 * retry. Mirrors `git push --force-with-lease`'s "stale info"
			 * refusal.
			 */
			status: "lease_stale";
			expectedProjectVersion: string;
			bridgeProjectVersion: string;
			incoming: ChangeSet;
	  };

export async function runPush(
	workspaceRoot: string,
	bridge: BridgeClient,
	opts: PushOptions = {},
): Promise<PushResult> {
	const root = resolve(workspaceRoot);
	const paths = workspacePaths(root);
	loadConfig(root);
	ensureSnapshotRepo(paths.snapshotPath);

	const state = loadState(paths.snapshotPath);
	if (state === undefined) {
		throw new Error(
			`no snapshot to diff against — run \`plc pull\` once before \`plc push\``,
		);
	}

	// 1. Drift check against the live bridge.
	//    Without --force / --force-with-lease: drift → refuse.
	//    With --force: bypass unconditionally (the human said so).
	//    With --force-with-lease=X: bypass only if the bridge is still
	//    exactly at X (= what the caller saw last); else lease_stale.
	//    Adopting the bridge's CURRENT per-item versions as our
	//    ifVersion baseline keeps the push from being rejected for "your
	//    X version doesn't match my X version" reasons. The diff itself
	//    is still workspace-vs-snapshot — we're just overriding the
	//    optimistic-concurrency guard the user explicitly chose to bypass.
	let driftAdoptedItems: ChangeSet | undefined;
	{
		const refs = await bridge.getRefs();
		if (refs.projectVersion !== state.projectVersion) {
			const incoming = computeIncoming(refs.items, state.items);
			const leaseHolds =
				opts.forceWithLease !== undefined &&
				opts.forceWithLease === refs.projectVersion;
			if (opts.forceWithLease !== undefined && !leaseHolds) {
				return {
					status: "lease_stale",
					expectedProjectVersion: opts.forceWithLease,
					bridgeProjectVersion: refs.projectVersion,
					incoming,
				};
			}
			if (!opts.force && !leaseHolds) {
				return {
					status: "drift_detected",
					localProjectVersion: state.projectVersion,
					bridgeProjectVersion: refs.projectVersion,
					incoming,
				};
			}
			if (hasChanges(incoming)) driftAdoptedItems = incoming;
			// Dry-run must NOT persist the adopted state. We've collected
			// the incoming preview already; the real run is what writes.
			if (!opts.dryRun) {
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

	// 2. Build a tree from the workspace's current files. If it matches
	//    the snapshot HEAD's tree, nothing to do — skip everything else.
	const newTreeSha = buildWorkspaceTreeSha(root, paths.snapshotPath);
	const parentSha = resolveRef(paths.snapshotPath, "refs/heads/main");
	if (parentSha !== state.commitSha) {
		// Snapshot HEAD diverged from our recorded commit — shouldn't
		// happen in normal use, but if it does, fail loudly.
		throw new Error(
			`snapshot HEAD (${parentSha ?? "<unborn>"}) doesn't match recorded commit (${state.commitSha})`,
		);
	}
	const headTreeSha = treeShaOfCommit(paths.snapshotPath, state.commitSha);
	if (newTreeSha === headTreeSha) {
		return { status: "nothing_to_push" };
	}

	// 3. Compute the per-item delta BEFORE the push so we can echo it
	//    back in the OK response (= "here is exactly what landed on the
	//    bridge"). Modeled on `git push --porcelain`'s per-ref outcome.
	const pushed = computeOutgoing(paths.snapshotPath, root, state.commitSha);

	// Dry-run exit: we now have everything the caller needs to preview
	// (incoming if drift was adopted, outgoing in `pushed`) without
	// touching the bridge, the snapshot, or the workspace.
	if (opts.dryRun) {
		return {
			status: "ok",
			commitSha: state.commitSha,
			pushed,
			dryRun: true,
			...(driftAdoptedItems !== undefined && {
				adoptedFromBridge: [
					...driftAdoptedItems.added,
					...driftAdoptedItems.modified,
				].sort(),
			}),
		};
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
		return { status: "rejected", reason: result.reason };
	}

	// 4. Advance snapshot HEAD so the next push diffs against the
	//    right baseline. (applyPushToBridge updates state.json but not
	//    the ref.)
	updateRef(paths.snapshotPath, "refs/heads/main", result.commitSha);

	// 5. Post-push reconcile — only when drift was adopted via --force.
	//
	// Why this exists: when --force adopts bridge state, our `state.items`
	// gains entries (e.g. shouldstay the engineer added) but the snapshot
	// TREE and the workspace don't have those files. Subsequent `plc
	// status` then falsely reports "in sync" because it compares items
	// without checking that the tree actually contains them — and
	// `plc pull` is a no-op because projectVersion already matches.
	// Net effect: the workspace silently lacks engineer-added items
	// and the system keeps lying that everything's fine.
	//
	// Fix: after the bridge accepts our push, refresh the snapshot
	// from the bridge (which now reflects OUR edits + everything the
	// engineer had added) and write the new files into the workspace.
	// snapshot, workspace, and bridge all agree.
	let adoptedNames: string[] | undefined;
	if (driftAdoptedItems !== undefined) {
		// `fullRebuild` is critical: the normal syncFromBridge would
		// short-circuit because state.projectVersion already matches
		// bridge.projectVersion (we just adopted it). We need to FORCE
		// a complete re-materialization so the engineer-added items
		// (which state.items knows about but the snapshot tree doesn't)
		// actually get written.
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

	return {
		status: "ok",
		commitSha: result.commitSha,
		pushed,
		...(adoptedNames !== undefined && { adoptedFromBridge: adoptedNames }),
	};
}

function treeShaOfCommit(repoPath: string, commitSha: string): string {
	const r = spawnSync("git", ["-C", repoPath, "rev-parse", `${commitSha}^{tree}`], { encoding: "utf-8" });
	if (r.status !== 0) throw new Error(`rev-parse ${commitSha}^{tree} failed: ${r.stderr}`);
	return r.stdout.trim();
}
