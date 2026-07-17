/**
 * volt-git pull — fetch the IDE, commit it onto refs/remotes/volt/ide, then `git merge` into the current branch.
 *
 *   no local edits  → fast-forward (no merge commit)
 *   local edits      → one merge commit (or conflict markers)
 *   dirty tree       → refused (commit/stash first — git won't merge a dirty tree)
 *
 * On conflict the sidecar baseline is intentionally NOT advanced: resolve via `git merge --continue`/
 * `--abort`, then run `volt pull` again to finalize.
 */
import type { ProgressHandler, Remote } from "../bridge/types.js";
import { configExists, loadConfig, verifyBinding } from "../config/workspace.js";
import {
	autoCommitSrc,
	currentBranch,
	gitMerge,
	headCommit,
	isMerging,
	readTreeToIndex,
	resolveGitDir,
	updateRef,
} from "../git/plumbing.js";
import { materializeItem } from "../translate/materialize.js";
import { ensureGitignore, stripSrcPrefix, writeSrcFiles } from "../workspace/files.js";
import { changeList, computeIncoming, hasChanges } from "./diff.js";
import { buildVoltIdeTree, commitVoltIde, loadIdeRefs, RANGE, saveIdeRefs, voltIdeHead, type IdeRefs } from "./refs.js";
import { buildStatusData } from "./status.js";
import type { PullResult } from "./types.js";

export interface PullOptions {
	dryRun?: boolean;
	/** Opt into streamed progress from the bridge's `/fetch` (the CLI passes a stderr reporter). */
	onProgress?: ProgressHandler;
}

export async function pull(root: string, bridge: Remote, opts: PullOptions = {}): Promise<PullResult> {
	if (!configExists(root)) return { kind: "refused", reason: "not a Volt workspace — run `volt init` first" };
	const gitDir = resolveGitDir(root);
	ensureGitignore(root);

	if (isMerging(root)) {
		return { kind: "refused", reason: "a merge is already in progress — finish it with `git merge --continue` or `git merge --abort` first" };
	}

	const cfg = loadConfig(root);
	const health = await bridge.getHealth();
	const bindErr = verifyBinding(cfg, health);
	if (bindErr !== undefined) return { kind: "refused", reason: bindErr };

	const sidecar = loadIdeRefs(root);

	// ONE path for dry-run and real pull — no divergent behavior. Always /fetch (incremental: only changed
	// bodies + the full version map + folders), compute incoming, then the up-to-date short-circuit. Dry-run
	// returns the preview right after; the real pull falls through to the merge below.
	const fetched = await bridge.fetchChanges({ knownItems: sidecar?.items ?? {} }, opts.onProgress);
	const incoming = computeIncoming(fetched.items, sidecar?.items ?? {});
	// The resulting status the UI adopts directly (no separate `volt status` /refs after a pull). Reads the
	// sidecar live, so it reflects the advanced baseline on the real path and the current drift on dry-run.
	const postStatus = () =>
		buildStatusData(root, {
			online: true,
			detail: `${health.platform}/${health.projectName ?? "?"}`,
			projectMismatch: null,
			items: fetched.items,
			folders: fetched.folders,
			projectVersion: fetched.projectVersion,
		});
	if (sidecar !== undefined && fetched.projectVersion === sidecar.projectVersion && !hasChanges(incoming)) {
		return { kind: "ok", synced: [], message: "already up to date with the IDE", status: postStatus() };
	}
	if (opts.dryRun === true) {
		return { kind: "ok", synced: changeList(incoming), message: "dry run — these IDE items would be merged in", status: postStatus() };
	}

	// Simple flow (auto-commit-on-pull): commit any local edits, then merge — git won't merge a dirty tree.
	autoCommitSrc(root);
	// The bridge only returns items with compiler ground truth — excluded-from-build and dead/uncompiled
	// objects are omitted at the source, so there is nothing to mark here.
	const ideFiles = fetched.changed.flatMap(materializeItem);
	const newSidecar: IdeRefs = {
		projectVersion: fetched.projectVersion,
		items: fetched.items,
		folders: fetched.folders,
	};
	const head = headCommit(root);
	const parentIde = voltIdeHead(gitDir);

	// Steady state: overlay the fetched items onto the PREVIOUS volt/ide tree (the IDE's last-known state),
	// commit onto the volt/ide chain, then merge into the branch. Sourcing unchanged items from the parent
	// (not HEAD) is what keeps the user's un-pushed edits distinct from the IDE baseline.
	const tree = buildVoltIdeTree(gitDir, head, parentIde, ideFiles, fetched.removed);
	const parent = parentIde ?? head;
	const commit = commitVoltIde(gitDir, tree, parent, `volt: IDE @ ${fetched.projectVersion}`);
	updateRef(gitDir, RANGE, commit);

	const outcome = gitMerge(root, RANGE, `volt: merge IDE @ ${fetched.projectVersion}`);
	if (outcome.kind === "conflict") {
		return { kind: "conflict", paths: outcome.paths.map(stripSrcPrefix) };
	}
	saveIdeRefs(root, newSidecar);
	return { kind: "ok", synced: changeList(incoming), status: postStatus() };
}
