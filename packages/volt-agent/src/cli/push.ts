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
import { readdirSync, readFileSync } from "node:fs";
import { join as pathJoin } from "node:path";
import {
	createDeterministicCommit,
	listTree,
	readBlob,
	readBlobBytes,
	resolveRef,
	updateRef,
} from "../engine/git-cmds.js";
import { isMergingNow } from "../engine/merge.js";
import { applyPushToBridge, syncFromBridge } from "../engine/ops.js";
import { effectivePushAllowExtensions, loadConfig, workspacePaths } from "../engine/config.js";
import {
	buildWorkspaceTreeSha,
	computeIncoming,
	computeOutgoing,
	ensureSnapshotRepo,
	hasChanges,
	loadState,
	reportSnapshotHeal,
	saveState,
	writeTreeToWorkspace,
	type ChangeSet,
} from "../engine/snapshot.js";
import { isVoltError, VoltError, wrapEngineError } from "./_error.js";
import { flagBool, flagString, type VerbFn } from "./_shared.js";

export const pushVerb: VerbFn = async ({ workspace, bridge, flags }) => {
	const force = flagBool(flags, "force");
	const forceWithLease = flagString(flags, "force-with-lease");
	const dryRun = flagBool(flags, "dry-run");
	const noDriftCheck = flagBool(flags, "no-drift-check");

	const root = resolve(workspace);
	const paths = workspacePaths(root);
	const cfg = loadConfig(root);
	const heal = ensureSnapshotRepo(paths.snapshotPath);
	reportSnapshotHeal(heal);

	// Mid-merge guard. Mirror `git push` against an in-progress merge:
	// the user MUST resolve the merge first so the push sends a
	// coherent merged state, not a half-resolved one.
	if (isMergingNow(paths.snapshotPath) !== undefined) {
		throw new VoltError({
			what: "push refused — merge in progress",
			why: "you have unresolved conflicts from a 3-way merge",
			hint: "run `volt merge --continue` (after resolving markers) or `volt merge --abort` to back out",
			exitCode: 2,
		});
	}

	const state = loadState(paths.snapshotPath);
	if (state === undefined) {
		throw new VoltError({
			what: "no snapshot to diff against",
			why: heal.rebuilt
				? "the snapshot was just rebuilt because it was corrupt; there's nothing to diff yet"
				: "this workspace has never been pulled, so there's no baseline to compute changes from",
			hint: "run `volt pull` once before `volt push`",
		});
	}

	// 1. Drift check against the live bridge.
	//
	// "Drift" = the bridge's items differ from our recorded items —
	// NOT just that `projectVersion` differs. The bridge can bump its
	// projectVersion for non-item reasons (TC's dirty-bit flips, a
	// structural save without content change). Refusing on that
	// produces phantom merge conflicts where nothing actually changed.
	// Per "trust authoritative data": the items map is the truth;
	// projectVersion is a cache key.
	let driftAdoptedItems: ChangeSet | undefined;
	// Always refresh state from the bridge so `expectedProjectVersion`
	// reflects reality on the wire. `--no-drift-check` only suppresses
	// the user-facing REFUSAL on real drift — it doesn't (and shouldn't)
	// mean "send stale expectedProjectVersion and let the bridge reject."
	// That was the recorder's failure mode in P5: between two batched
	// pushes, TC bumped projectVersion for non-content reasons, the
	// recorder skipped the sync, and chunk 2's push got rejected on
	// the bridge with "project-level drift".
	const refs = await bridge.getRefs();
	const projectVersionBumped = refs.projectVersion !== state.projectVersion;
	const incoming = projectVersionBumped
		? computeIncoming(refs.items, state.items)
		: { added: [], removed: [], modified: [] };
	const realDrift = projectVersionBumped && hasChanges(incoming);

	if (realDrift && !noDriftCheck) {
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
		driftAdoptedItems = incoming;
	} else if (realDrift) {
		// noDriftCheck: track adopted items so the post-push reconciler
		// can sync any engineer-side additions into the workspace.
		driftAdoptedItems = incoming;
	}

	if (projectVersionBumped && !dryRun) {
		saveState(paths.snapshotPath, {
			...state,
			projectVersion: refs.projectVersion,
			items: { ...refs.items },
		});
		state.projectVersion = refs.projectVersion;
		state.items = { ...refs.items };
	} else if (projectVersionBumped) {
		// Dry-run still updates the in-memory state so the rest of
		// this verb sees consistent data; the on-disk state is left
		// alone (per the --dry-run contract).
		state.projectVersion = refs.projectVersion;
		state.items = { ...refs.items };
	}

	// 2. Build a workspace tree; nothing-to-push shortcut.
	let newTreeSha: string;
	try {
		newTreeSha = buildWorkspaceTreeSha(root, paths.snapshotPath);
	} catch (err) {
		if (isVoltError(err)) throw err;
		throw wrapEngineError(err, "build workspace tree");
	}
	const parentSha = resolveRef(paths.snapshotPath, "refs/heads/main");
	if (parentSha !== state.commitSha) {
		throw new VoltError({
			what: "internal snapshot inconsistency",
			why: `snapshot HEAD (${parentSha ?? "<unborn>"}) doesn't match the recorded commit in state.json (${state.commitSha})`,
			hint: "delete .volt/snapshot/ and run `volt pull --force` to rebuild from the bridge",
		});
	}
	const headTreeSha = treeShaOfCommit(paths.snapshotPath, state.commitSha);
	if (newTreeSha === headTreeSha) {
		console.log("nothing to push — workspace matches snapshot.");
		return 0;
	}

	// 2b. Per-extension push policy guard.
	//
	// `.volt/config.json`'s `pushPolicy.allowExtensions` declares which
	// file types may travel from workspace to bridge. Files with any
	// other extension are pull-only — useful for engineer-managed
	// configs (.device, .visu, .recipes, .task, .tmc, .alarm, .trace,
	// etc.) that the AI / user should be able to READ for context but
	// never push back. Default allowlist when unset = ST-grammar files
	// (.st, .gvl, .dut, .itf); graphical files are NOT in the default,
	// matching the v1 graphical-read-only contract.
	const allowExtensions = effectivePushAllowExtensions(cfg);
	const policyRefusals = findPolicyRefusals(root, paths.snapshotPath, state.commitSha, allowExtensions);
	if (policyRefusals.length > 0) {
		printPolicyRefusal(policyRefusals, allowExtensions);
		return 2;
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
	let result: Awaited<ReturnType<typeof applyPushToBridge>>;
	try {
		result = await applyPushToBridge(paths.snapshotPath, bridge, newCommitSha);
	} catch (err) {
		if (isVoltError(err)) throw err;
		throw wrapEngineError(err, "send push to bridge");
	}
	if (!result.accepted) {
		throw new VoltError({
			what: "bridge rejected push",
			why: result.reason,
			hint: "run `volt status` to see current state, then `volt pull` to bring in IDE changes — or retry with `--force` to override",
			exitCode: 2,
		});
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
	if (r.status !== 0) {
		throw new VoltError({
			what: "could not resolve snapshot commit",
			why: `git rev-parse ${commitSha}^{tree} exited ${r.status ?? "?"}: ${r.stderr.trim()}`,
			hint: "snapshot may be corrupt — delete .volt/snapshot/ and run `volt pull --force` to rebuild",
		});
	}
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

/**
 * Walk every changed-or-added workspace file and return those whose
 * file extension is NOT in the workspace's `pushPolicy.allowExtensions`.
 * The check compares the file's lowercase extension (with leading dot)
 * against the allowlist; files with no extension are always refused
 * (they're never POU sources). Snapshot blobs identical to workspace
 * files are skipped — only diff-emitting files are considered.
 */
function findPolicyRefusals(
	workspaceRoot: string,
	snapshotPath: string,
	commitSha: string,
	allowExtensions: readonly string[],
): Array<{ path: string; ext: string }> {
	const refused: Array<{ path: string; ext: string }> = [];
	const allowSet = new Set(allowExtensions.map((e) => e.toLowerCase()));

	const snapshotEntries = listTree(snapshotPath, commitSha);
	const snapshotByPath = new Map<string, string>();
	for (const e of snapshotEntries) snapshotByPath.set(e.path, e.sha);

	const wsFiles = listWorkspaceFiles(workspaceRoot);
	for (const wsPath of wsFiles) {
		// Pull extension (lowercased, with leading dot).
		const dot = wsPath.lastIndexOf(".");
		const ext = dot >= 0 ? wsPath.slice(dot).toLowerCase() : "";
		if (allowSet.has(ext)) continue;

		const wsAbs = `${workspaceRoot.replace(/[\\/]+$/, "")}/${wsPath}`;
		const wsContent = readFileSync(wsAbs);
		const wsHash = hashBytes(wsContent);
		const snapshotSha = snapshotByPath.get(wsPath);
		// Identical to snapshot → no diff, no push attempt; skip.
		if (snapshotSha !== undefined) {
			const snapHash = hashBytes(readBlobBytes(snapshotPath, snapshotSha));
			if (wsHash === snapHash) continue;
		}
		refused.push({ path: wsPath, ext: ext.length > 0 ? ext : "(no ext)" });
	}
	return refused;
}

/** Cheap, stable byte hash for content equality. Uses node's built-in
 *  hash so we don't pull in a dependency. */
function hashBytes(buf: Buffer): string {
	const { createHash } = require("node:crypto") as typeof import("node:crypto");
	return createHash("sha1").update(buf).digest("hex");
}

function printPolicyRefusal(
	refused: Array<{ path: string; ext: string }>,
	allowExtensions: readonly string[],
): void {
	process.stderr.write(
		`refused: ${refused.length} file(s) have extensions not in this workspace's push allowlist.\n\n`,
	);
	process.stderr.write("Files refused:\n");
	for (const r of refused) process.stderr.write(`  ${r.ext.padEnd(10)} ${r.path}\n`);
	process.stderr.write(
		`\nCurrent push allowlist: ${allowExtensions.join(", ")}\n` +
			`\nThese files were pulled so AI / you can READ them, but pushing\n` +
			`them back risks overwriting engineer-managed config. If you really\n` +
			`want to push them, edit .volt/config.json:\n\n` +
			`  "pushPolicy": {\n` +
			`    "allowExtensions": [".st", ".gvl", ".dut", ".itf", "<add yours>"]\n` +
			`  }\n`,
	);
}

/**
 * List every file under `root`, returning paths relative to `root`
 * with forward slashes. Excludes `.volt/`, `.git/`, and any hidden
 * dotfiles at any depth — same exclusions used by
 * `buildWorkspaceTreeSha` so we walk the same surface.
 */
function listWorkspaceFiles(root: string): string[] {
	const out: string[] = [];
	function walk(dir: string, rel: string): void {
		const entries = readdirSync(dir, { withFileTypes: true });
		for (const e of entries) {
			if (e.name.startsWith(".")) continue;
			const childAbs = pathJoin(dir, e.name);
			const childRel = rel.length === 0 ? e.name : `${rel}/${e.name}`;
			if (e.isDirectory()) walk(childAbs, childRel);
			else if (e.isFile()) out.push(childRel);
		}
	}
	walk(root, "");
	return out;
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
